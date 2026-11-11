"""
Export the demo loop into ONE file the website plays by itself (no server needed):

    python export_demo.py   ->   site/public/data/demo.json

What goes in:
  - real recorded ships + our ship, exactly as replay.py plays them (same window, same speed)
  - simulated targets from data/sim/ (member 2) following data/sim/schedule.json
      * if a scheduled scenario file is missing, a TEMPORARY placeholder is generated
        and marked "placeholder": true in the file, until member 2's file arrives
  - a risk score for every target at every second:
      * from risk_engine.py (member 3) if it exists and has score_targets()
      * otherwise a TEMPORARY rule-based score, marked "risk_engine": "interim"

Re-run it whenever the recording, the scenarios or the risk engine change.
"""

import json
import math
import os
from pathlib import Path

import numpy as np
import pandas as pd

import replay as rp

OUT_FILE = Path("site/public/data/demo.json")
M_PER_DEG_LAT = 110_540
M_PER_DEG_LON_EQ = 111_320


# ------------------------------------------------------------ temporary scenarios

def placeholder_scenario(name, ref):
    """Simple stand-ins for member 2's scenarios, drawn around our ship fixed at `ref`."""
    lat0, lon0 = ref
    m_lon = M_PER_DEG_LON_EQ * math.cos(math.radians(lat0))
    t0 = pd.Timestamp("2026-01-01T00:00:00Z")
    rng = np.random.default_rng(7)
    rows = []

    def add(track, i, lat, lon, sog, cog, label):
        rows.append({"timestamp": (t0 + pd.Timedelta(seconds=i)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                     "track_id": track, "lat": lat, "lon": lon, "sog_kn": sog, "cog_deg": cog,
                     "source": "radar_sim", "mmsi": "", "label": label})

    if name == "fishing_cluster.csv":          # 6 boats ~2.5 km off, slow, random, to the end
        for k in range(6):
            x, y = 2500 + rng.uniform(-700, 700), rng.uniform(-900, 900)
            heading = rng.uniform(0, 360)
            for i in range(0, 1201, 10):
                heading += rng.uniform(-35, 35)
                sog = rng.uniform(0.5, 3.5)
                d = sog * 1852 / 3600 * 10
                x += d * math.sin(math.radians(heading))
                y += d * math.cos(math.radians(heading))
                add(f"sim_fish_{k}", i, lat0 + y / M_PER_DEG_LAT, lon0 + x / m_lon,
                    round(sog, 1), round(heading % 360, 1), "fishing_cluster")
    elif name == "coordinated_attack.csv":     # 3 skiffs from 3 sides: approach slowly, then sprint
        for k, bearing in enumerate([20, 140, 260]):
            dist = 6000.0
            for i in range(0, 901, 10):
                sog = 7 if i < 180 else 26         # 3 min slow approach, then sprint in
                if dist <= 150:
                    sog = 0
                dist = max(dist - sog * 1852 / 3600 * 10, 150)
                b = math.radians(bearing)
                add(f"sim_atk_{k}", i, lat0 + dist * math.cos(b) / M_PER_DEG_LAT,
                    lon0 + dist * math.sin(b) / m_lon, sog, (bearing + 180) % 360,
                    "coordinated_attack")
    else:
        return None
    df = pd.DataFrame(rows)
    df["t"] = rp.to_seconds(df["timestamp"])
    return df[rp.COLUMNS + ["t"]]


# ------------------------------------------------------------ temporary risk scoring

def xy(p, ref_lat):
    return (p["lon"] * math.cos(math.radians(ref_lat)) * M_PER_DEG_LON_EQ,
            p["lat"] * M_PER_DEG_LAT)


def velocity(p):
    if p.get("sog_kn") is None or p.get("cog_deg") is None:
        return 0.0, 0.0
    v = p["sog_kn"] * 1852 / 3600
    c = math.radians(p["cog_deg"])
    return v * math.sin(c), v * math.cos(c)


def cpa_tcpa(own, tgt, ref_lat):
    """Closest point of approach (m) and time to it (s), straight-line motion."""
    ox, oy = xy(own, ref_lat)
    tx, ty = xy(tgt, ref_lat)
    ovx, ovy = velocity(own)
    tvx, tvy = velocity(tgt)
    rx, ry = tx - ox, ty - oy
    vx, vy = tvx - ovx, tvy - ovy
    v2 = vx * vx + vy * vy
    tcpa = 0.0 if v2 < 1e-6 else max(0.0, -(rx * vx + ry * vy) / v2)
    cx, cy = rx + vx * tcpa, ry + vy * tcpa
    return math.hypot(cx, cy), tcpa, math.hypot(rx, ry), (rx * vx + ry * vy) / max(math.hypot(rx, ry), 1)


def interim_risk(points):
    """TEMPORARY rules until member 3's risk_engine.py is ready. Same output format:
    score 0-100, level LOW/MEDIUM/HIGH, reasons in Arabic."""
    own = next((p for p in points if p["track_id"] == "own_ship"), None)
    if own is None:
        return {}
    ref_lat = own["lat"]
    out, dark_closing = {}, []
    info = {}
    for p in points:
        if p["track_id"] == "own_ship":
            continue
        cpa, tcpa, rng_m, range_rate = cpa_tcpa(own, p, ref_lat)
        info[p["track_id"]] = (cpa, tcpa, rng_m, range_rate)
        if p["source"] != "ais" and range_rate < -3 and rng_m < 4000:
            dark_closing.append(p["track_id"])

    for p in points:
        tid = p["track_id"]
        if tid == "own_ship":
            continue
        cpa, tcpa, rng_m, range_rate = info[tid]
        sog = p.get("sog_kn") or 0
        score, reasons = 0, []
        if p["source"] != "ais":
            score += 25
            reasons.append("بدون AIS")
        if range_rate < -3 and rng_m < 8000:
            score += 20
            reasons.append("يتجه نحو السفينة")
        if cpa < 600 and tcpa < 6 * 60 and range_rate < 0:
            score += 25
            reasons.append(f"أقرب اقتراب بعد {max(1, round(tcpa / 60))} دقيقة")
        if sog > 18 and p["source"] != "ais":
            score += 15
            reasons.append(f"سرعة عالية ({sog:.0f} عقدة)")
        if tid in dark_closing and len(dark_closing) >= 2:
            score += 20
            reasons.append(f"{len(dark_closing)} أهداف تتقارب")
        if p["source"] != "ais" and rng_m < 400:
            score = 100
            reasons = ["بدون AIS", f"على بعد {rng_m:.0f} متر من السفينة"] + (
                [f"{len(dark_closing)} أهداف تتقارب"] if len(dark_closing) >= 2 else [])
        if p["source"] != "ais" and sog < 4 and range_rate >= -3 and rng_m >= 400:
            score = min(score, 30)
            reasons = ["بدون AIS", "حركة بطيئة وعشوائية بدون اتجاه نحو السفينة"]
        score = min(score, 100)
        level = "HIGH" if score >= 70 else "MEDIUM" if score >= 40 else "LOW"
        if not reasons:
            reasons = ["سفينة تجارية على خط الملاحة"]
        out[tid] = {"score": score, "level": level, "reasons": reasons,
                    "range_m": round(rng_m), "cpa_m": round(cpa), "tcpa_s": round(tcpa)}
    return out


def load_risk_engine():
    """Use member 3's engine if present: risk_engine.score_targets(points) -> {track_id: {...}}."""
    if not os.path.exists("risk_engine.py"):
        return None
    try:
        import risk_engine
        return getattr(risk_engine, "score_targets", None)
    except Exception as e:
        print(f"  ! risk_engine.py could not be loaded ({e}) - using interim rules")
        return None


# ------------------------------------------------------------ export

def main():
    R = rp.REPLAY
    schedule = R.schedule
    ref = tuple(schedule["reference"])
    placeholders = []
    for sc in schedule["scenarios"]:
        if sc["file"] not in rp.SIMS:
            df = placeholder_scenario(sc["file"], ref)
            if df is not None:
                rp.SIMS[sc["file"]] = df
                placeholders.append(sc["file"])
    R.cache.clear()

    engine = load_risk_engine()
    speed = R.default_speed()
    start, end = R.window(speed)
    frames, n = [], int(round((end - start) / speed))
    for sec in range(n + 1):
        t = start + sec * speed
        f = rp.frame(t, speed)
        risk = engine(f["points"]) if engine else interim_risk(f["points"])
        for p in f["points"]:
            p.update(risk.get(p["track_id"], {}))
            for k in ("lat", "lon"):
                p[k] = round(float(p[k]), 5)
        frames.append({"sec": sec, "t": f["t"], "points": f["points"]})

    meta = {
        "mode": "REPLAY",
        "speed": speed,
        "loop_seconds": n,
        "reference": list(ref),
        "risk_engine": "member3" if engine else "interim",
        "placeholder_scenarios": placeholders,
        "scenes": [{"file": sc["file"], "at_second": sc["at_second"],
                    "label": sc["file"].rsplit(".", 1)[0]} for sc in schedule["scenarios"]],
        "data_note": "سفن حقيقية مسجلة من مضيق دوفر ومنقولة لباب المندب، والأهداف بدون AIS محاكاة",
    }
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump({"meta": meta, "frames": frames}, fh, ensure_ascii=False, separators=(",", ":"))

    levels = [p.get("level") for fr in frames for p in fr["points"] if p.get("level")]
    print(f"Saved {OUT_FILE}: {len(frames)} frames, "
          f"{OUT_FILE.stat().st_size / 1024:.0f} KB | HIGH {levels.count('HIGH')}, "
          f"MEDIUM {levels.count('MEDIUM')}, LOW {levels.count('LOW')}")
    if placeholders:
        print(f"  ! TEMPORARY scenarios (member 2's files missing): {', '.join(placeholders)}")
    print(f"  risk engine: {meta['risk_engine']}")


if __name__ == "__main__":
    main()
