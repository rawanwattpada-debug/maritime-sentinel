"""
How good is the risk engine (member 3)?   ->   python evaluate_risk.py

Two tests:

A) Simulated scenarios with known answers, generated at random (many runs per type).
   Every boat really does what its label says (attackers chase our ship, fishing boats
   drift, crossing boats pass at a distance). The boats are seen the way a radar sees
   them: position error, missed sweeps, noisy speed and course.
     threats  (should reach HIGH in time):  single approach, coordinated attack,
                                            skiff launched from a mother ship, sudden turn
     benign   (should NOT reach HIGH):      fishing cluster, fast crossing, slow dark transit
B) Real recorded AIS ships (the whole ~5 h recording around our ship): every alert
   there is a false alarm.

Writes risk_eval.json and prints a summary. Section A uses simulated boats; section B
uses real ships. Say so when presenting.
"""

import argparse
import json
import math

import numpy as np
import pandas as pd

from risk_engine import RiskEngine

M_LAT = 110_540.0
REF = (12.58, 43.33)
KN = 1852 / 3600
STEP_S = 5
NOISE = {"pos_m": 35, "drop": 0.08, "sog_kn": 1.2, "cog_deg": 6}
OWN = {"sog_kn": 10.0, "cog_deg": 330.0}
ARRIVE_M = 300      # an attacker "arrives" at this distance: the run ends
IN_TIME_M = 1000    # HIGH must come before the attacker is this close
LEVELS = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}


def to_latlon(x, y):
    lat = REF[0] + y / M_LAT
    lon = REF[1] + x / (M_LAT * math.cos(math.radians(REF[0])))
    return lat, lon


def heading_to(dx, dy):
    return math.degrees(math.atan2(dx, dy)) % 360


def vel(sog, cog):
    r = math.radians(cog)
    return sog * KN * math.sin(r), sog * KN * math.cos(r)


class Boat:
    def __init__(self, tid, x, y, sog, cog, role, threat=False, start_s=0, behaviour="straight", **kw):
        self.tid, self.x, self.y, self.sog, self.cog = tid, x, y, sog, cog
        self.role, self.threat, self.start_s, self.behaviour, self.kw = role, threat, start_s, behaviour, kw


def rel_cpa(x, y, sog, cog):
    """Closest distance (m) a boat on a straight course passes our moving ship."""
    bvx, bvy = vel(sog, cog)
    ovx, ovy = vel(OWN["sog_kn"], OWN["cog_deg"])
    vx, vy = bvx - ovx, bvy - ovy
    v2 = vx * vx + vy * vy
    t = max(0.0, -(x * vx + y * vy) / v2) if v2 > 1e-9 else 0.0
    return math.hypot(x + vx * t, y + vy * t)


def scenario(kind, rng):
    """Returns (boats, duration_s). Positions in metres from our ship at t=0."""
    def at(dist, brg):
        r = math.radians(brg)
        return dist * math.sin(r), dist * math.cos(r)

    b = []
    if kind == "single_approach":
        x, y = at(rng.uniform(4000, 8000), rng.uniform(0, 360))
        b.append(Boat("t0", x, y, rng.uniform(20, 35), 0, kind, True, behaviour="pursue"))
        return b, 900
    if kind == "coordinated_attack":
        n = int(rng.integers(2, 5))
        base = rng.uniform(0, 360)
        for i in range(n):
            x, y = at(rng.uniform(4000, 7000), base + i * rng.uniform(60, 110))
            b.append(Boat(f"t{i}", x, y, rng.uniform(22, 35), 0, kind, True, behaviour="pursue"))
        return b, 900
    if kind == "mother_ship":
        brg = rng.uniform(0, 360)
        x, y = at(rng.uniform(5000, 8000), brg)
        cog = (brg + 90 + rng.uniform(-30, 30)) % 360          # the mother ship loiters, not toward us
        b.append(Boat("mother", x, y, rng.uniform(6, 10), cog, "mother_ship_vessel", False))
        b.append(Boat("skiff", x, y, rng.uniform(25, 32), 0, kind, True,
                      start_s=float(rng.uniform(60, 180)), behaviour="launch", parent=0))
        return b, 1000
    if kind == "sudden_turn":
        brg = rng.uniform(0, 360)
        x, y = at(rng.uniform(4000, 6000), brg)
        cog = (brg + 180 + rng.choice([-1, 1]) * rng.uniform(60, 90)) % 360   # first passing by
        b.append(Boat("t0", x, y, rng.uniform(12, 18), cog, kind, True, behaviour="turn",
                      turn_s=float(rng.uniform(90, 180)), attack_kn=float(rng.uniform(25, 32))))
        return b, 900
    if kind == "fishing_cluster":
        cx, cy = at(rng.uniform(1500, 5000), rng.uniform(0, 360))
        for i in range(int(rng.integers(3, 7))):
            b.append(Boat(f"f{i}", cx + rng.normal(0, 300), cy + rng.normal(0, 300), rng.uniform(0, 3),
                          rng.uniform(0, 360), kind, False, behaviour="drift"))
        return b, 600
    if kind == "fast_crossing":
        # a fast boat that crosses and passes 2-4 km from our (moving) ship
        while True:
            x, y = at(rng.uniform(5000, 8000), rng.uniform(0, 360))
            sog, cog = rng.uniform(20, 30), rng.uniform(0, 360)
            if 2000 <= rel_cpa(x, y, sog, cog) <= 4000 and rel_cpa(x, y, sog, cog) < math.hypot(x, y) - 1500:
                break
        b.append(Boat("c0", x, y, sog, cog, kind, False))
        return b, 900
    if kind == "dark_transit":
        # a slow boat with no AIS going about its business, never closer than 2 km
        while True:
            x, y = at(rng.uniform(2500, 6000), rng.uniform(0, 360))
            sog, cog = rng.uniform(6, 12), rng.uniform(0, 360)
            if rel_cpa(x, y, sog, cog) >= 2000:
                break
        b.append(Boat("d0", x, y, sog, cog, kind, False))
        return b, 600
    raise ValueError(kind)


THREATS = ["single_approach", "coordinated_attack", "mother_ship", "sudden_turn"]
BENIGN = ["fishing_cluster", "fast_crossing", "dark_transit"]


ENGINE_CONFIG = None  # optional overrides of the engine's CONFIG (to try a setting without editing it)


def run_scenario(kind, seed, t0=pd.Timestamp("2026-11-10T08:00:00Z")):
    rng = np.random.default_rng(seed)
    boats, duration = scenario(kind, rng)
    eng = RiskEngine(own_track_id="own", config=ENGINE_CONFIG)
    ox = oy = 0.0
    out = {bt.tid: {"role": bt.role, "threat": bt.threat, "max": "LOW", "first_high": None,
                    "first_high_dist": None, "first_medium": None, "arrived": None} for bt in boats}
    ovx, ovy = vel(OWN["sog_kn"], OWN["cog_deg"])
    for k in range(int(duration / STEP_S) + 1):
        t = k * STEP_S
        rows = [dict(track_id="own", lat=to_latlon(ox, oy)[0], lon=to_latlon(ox, oy)[1],
                     sog_kn=OWN["sog_kn"], cog_deg=OWN["cog_deg"], source="own", mmsi="")]
        for bt in boats:
            if t < bt.start_s:
                if bt.behaviour == "launch":                        # still aboard the mother ship
                    p = boats[bt.kw["parent"]]
                    bt.x, bt.y = p.x, p.y
                continue
            dist = math.hypot(bt.x - ox, bt.y - oy)
            if out[bt.tid]["arrived"] is not None:
                continue
            if bt.behaviour in ("pursue", "launch") or (bt.behaviour == "turn" and t >= bt.kw["turn_s"]):
                bt.cog = (heading_to(ox - bt.x, oy - bt.y) + rng.normal(0, 4)) % 360
                if bt.behaviour == "turn":
                    bt.sog = bt.kw["attack_kn"]
            elif bt.behaviour == "drift":
                bt.cog = (bt.cog + rng.normal(0, 12)) % 360
                bt.sog = float(np.clip(bt.sog + rng.normal(0, 0.3), 0, 3))
            if bt.threat and dist < ARRIVE_M:
                out[bt.tid]["arrived"] = t
                continue
            # what the radar reports
            if rng.random() > NOISE["drop"]:
                lat, lon = to_latlon(bt.x + rng.normal(0, NOISE["pos_m"]), bt.y + rng.normal(0, NOISE["pos_m"]))
                rows.append(dict(track_id=bt.tid, lat=lat, lon=lon,
                                 sog_kn=max(0.0, bt.sog + rng.normal(0, NOISE["sog_kn"])),
                                 cog_deg=(bt.cog + rng.normal(0, NOISE["cog_deg"])) % 360,
                                 source="radar", mmsi=""))
            vx, vy = vel(bt.sog, bt.cog)
            bt.x += vx * STEP_S
            bt.y += vy * STEP_S
        df = pd.DataFrame(rows)
        df["timestamp"] = t0 + pd.Timedelta(seconds=t)
        res = eng.update(df)
        for r in res.itertuples(index=False):
            o = out[r.track_id]
            bt = next(x for x in boats if x.tid == r.track_id)
            if LEVELS[r.level] > LEVELS[o["max"]]:
                o["max"] = r.level
            if r.level == "MEDIUM" and o["first_medium"] is None:
                o["first_medium"] = t
            if r.level == "HIGH" and o["first_high"] is None:
                o["first_high"] = t
                o["first_high_dist"] = math.hypot(bt.x - ox, bt.y - oy)
        ox += ovx * STEP_S
        oy += ovy * STEP_S
    return out


def real_ais_false_alarms():
    """Real recorded ships around our ship, scored by the engine over the whole recording."""
    import replay as rp
    R = rp.REPLAY
    eng = RiskEngine(own_track_id="own_ship", config=ENGINE_CONFIG)
    seen, high, med, ship_time = set(), set(), set(), 0
    level_counts = {"LOW": 0, "MEDIUM": 0, "HIGH": 0}
    for t in np.arange(R.own_start, R.own_end, 10):
        pts = rp.tracks_at(R.tracks, t, rp.iso(t))
        if not any(p["track_id"] == "own_ship" for p in pts):
            continue
        df = pd.DataFrame(pts)
        res = eng.update(df)
        for r in res.itertuples(index=False):
            seen.add(r.track_id)
            level_counts[r.level] += 1
            ship_time += 1
            if r.level == "HIGH":
                high.add(r.track_id)
            elif r.level == "MEDIUM":
                med.add(r.track_id)
    return {
        "real_ships": len(seen),
        "readings": ship_time,
        "readings_high_pct": round(100 * level_counts["HIGH"] / max(1, ship_time), 2),
        "readings_medium_pct": round(100 * level_counts["MEDIUM"] / max(1, ship_time), 2),
        "ships_ever_high": len(high),
        "ships_ever_medium": len(med - high),
    }


def summarise(runs):
    res = {}
    for kind in THREATS + BENIGN:
        boats = [b for r in runs if r["kind"] == kind for b in r["boats"].values() if b["role"] == kind]
        if kind in THREATS:
            in_time = [b for b in boats if b["first_high"] is not None and (b["first_high_dist"] or 0) >= IN_TIME_M]
            warn_s = [b["arrived"] - b["first_high"] for b in boats if b["first_high"] is not None and b["arrived"] is not None]
            res[kind] = {
                "boats": len(boats),
                "reached_high_pct": round(100 * np.mean([b["max"] == "HIGH" for b in boats]), 1),
                "high_before_1km_pct": round(100 * len(in_time) / len(boats), 1),
                "median_km_at_first_high": round(float(np.median([b["first_high_dist"] for b in boats if b["first_high_dist"]])) / 1000, 2)
                if any(b["first_high_dist"] for b in boats) else None,
                "median_warning_s_before_300m": float(np.median(warn_s)) if warn_s else None,
            }
        else:
            res[kind] = {
                "boats": len(boats),
                "false_high_pct": round(100 * np.mean([b["max"] == "HIGH" for b in boats]), 1),
                "medium_pct": round(100 * np.mean([b["max"] == "MEDIUM" for b in boats]), 1),
                "stayed_low_pct": round(100 * np.mean([b["max"] == "LOW" for b in boats]), 1),
            }
    # scenario-level confusion (positive = any HIGH in the scenario's own boats)
    tp = sum(1 for r in runs if r["kind"] in THREATS and any(b["max"] == "HIGH" for b in r["boats"].values() if b["threat"]))
    fn = sum(1 for r in runs if r["kind"] in THREATS) - tp
    fp = sum(1 for r in runs if r["kind"] in BENIGN and any(b["max"] == "HIGH" for b in r["boats"].values()))
    tn = sum(1 for r in runs if r["kind"] in BENIGN) - fp
    res["scenarios"] = {
        "threat_scenarios": tp + fn, "benign_scenarios": fp + tn, "tp": tp, "fn": fn, "fp": fp, "tn": tn,
        "recall_pct": round(100 * tp / max(1, tp + fn), 1),
        "precision_pct": round(100 * tp / max(1, tp + fp), 1),
        "false_alarm_rate_pct": round(100 * fp / max(1, fp + tn), 1),
    }
    return res


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=40, help="random runs per scenario type")
    ap.add_argument("--out", default="risk_eval.json")
    ap.add_argument("--no-real", action="store_true", help="skip the real AIS test")
    ap.add_argument("--config", help='try engine settings, e.g. \'{"approach_cpa_nm": 1.0}\'')
    a = ap.parse_args()
    if a.config:
        ENGINE_CONFIG = json.loads(a.config)

    runs = []
    for i, kind in enumerate(THREATS + BENIGN):
        for s in range(a.runs):
            runs.append({"kind": kind, "boats": run_scenario(kind, seed=1000 * i + s)})
        print(f"  {kind}: {a.runs} runs")
    result = {"settings": {"engine_overrides": ENGINE_CONFIG, "runs_per_type": a.runs, "step_s": STEP_S, "radar_noise": NOISE, "own_ship": OWN,
                           "in_time_m": IN_TIME_M, "arrive_m": ARRIVE_M},
              "simulated": summarise(runs)}
    if not a.no_real:
        result["real_ais"] = real_ais_false_alarms()
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    sim = result["simulated"]
    print("\nA) Simulated scenarios (known answers)")
    for k in THREATS:
        r = sim[k]
        print(f"   THREAT {k:20s} boats {r['boats']:3d} | HIGH {r['reached_high_pct']:5.1f}% | HIGH before 1 km {r['high_before_1km_pct']:5.1f}%"
              f" | first HIGH at {r['median_km_at_first_high']} km | warning {r['median_warning_s_before_300m']} s")
    for k in BENIGN:
        r = sim[k]
        print(f"   BENIGN {k:20s} boats {r['boats']:3d} | false HIGH {r['false_high_pct']:5.1f}% | MEDIUM {r['medium_pct']:5.1f}% | LOW {r['stayed_low_pct']:5.1f}%")
    s = sim["scenarios"]
    print(f"   scenarios: recall {s['recall_pct']}% | precision {s['precision_pct']}% | false alarm rate {s['false_alarm_rate_pct']}%"
          f"  (tp {s['tp']}, fn {s['fn']}, fp {s['fp']}, tn {s['tn']})")
    if "real_ais" in result:
        r = result["real_ais"]
        print(f"\nB) Real AIS ships: {r['real_ships']} ships, {r['readings']} readings | HIGH {r['readings_high_pct']}%"
              f" | MEDIUM {r['readings_medium_pct']}% | ships ever HIGH {r['ships_ever_high']}, ever MEDIUM {r['ships_ever_medium']}")
    print(f"\n-> {a.out}")
