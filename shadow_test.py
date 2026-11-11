"""
Shadowing test   ->   python shadow_test.py

A dark boat (no AIS) is first seen far from a real registered ship, then closes in and
sails next to it (~120 m) for several minutes, hoping to be taken for that ship.
Questions: does the system keep it as "dark"? does it raise a "dark target next to a
registered ship" alert? is the real ship still recognised as itself?
Real AIS ships from the recording + one simulated shadowing boat; many seeds and ships.
"""
import json
import math

import numpy as np

import replay as rp
from fusion import Fuser, RadarSim, load_config, M_PER_DEG_LAT, M_PER_DEG_LON_EQ

SCAN_S = 10
APPROACH_S, SHADOW_S, START_GAP_M, SHADOW_GAP_M = 240, 480, 3000, 120


def offset(lat, lon, dx, dy):
    return lat + dy / M_PER_DEG_LAT, lon + dx / (math.cos(math.radians(lat)) * M_PER_DEG_LON_EQ)


def one_run(cfg, ship_id, t0, seed):
    R = rp.REPLAY
    radar, fuser = RadarSim(cfg, seed=seed), Fuser(cfg)
    side = 1 if seed % 2 else -1
    n = {"approach_dark": 0, "approach": 0, "shadow": 0, "shadow_dark": 0, "shadow_alert": 0,
         "ship": 0, "ship_ok": 0}
    for k, t in enumerate(np.arange(t0, t0 + APPROACH_S + SHADOW_S, SCAN_S)):
        pts = rp.tracks_at(R.tracks, t, rp.iso(t))
        ship = next((p for p in pts if p["track_id"] == ship_id), None)
        if ship is None:
            return None
        el = t - t0
        gap = START_GAP_M + (SHADOW_GAP_M - START_GAP_M) * min(1, el / APPROACH_S)
        a = math.radians(ship["cog_deg"] + 90 * side)          # abeam of the ship
        lat, lon = offset(ship["lat"], ship["lon"], gap * math.sin(a), gap * math.cos(a))
        pts = pts + [{**ship, "track_id": "shadow", "lat": lat, "lon": lon, "source": "sim", "mmsi": ""}]
        for f in fuser.update(radar.scan(t, pts), pts):
            if f["_truth_id"] == "shadow":
                phase = "approach" if el < APPROACH_S else "shadow"
                n[phase] += 1
                n[phase + "_dark"] += f["status"] == "dark"
                if phase == "shadow":
                    n["shadow_alert"] += f.get("near_mmsi") == str(ship["mmsi"])
            elif f["_truth_id"] == ship_id and el >= APPROACH_S:
                n["ship"] += 1
                n["ship_ok"] += f["status"] == "ais" and f"ais_{f['mmsi']}" == ship_id
    return n


if __name__ == "__main__":
    cfg = load_config()
    R = rp.REPLAY
    # ships in range of our own ship for the whole test window
    tot, runs = {}, 0
    for seed in range(1, 31):
        t0 = R.own_start + 300 + seed * 480
        pts = rp.tracks_at(R.tracks, t0, rp.iso(t0))
        own = next((p for p in pts if p["track_id"] == "own_ship"), None)
        if own is None:
            continue
        near = lambda p: math.hypot((p["lat"] - own["lat"]) * M_PER_DEG_LAT,
                                    (p["lon"] - own["lon"]) * M_PER_DEG_LON_EQ * math.cos(math.radians(own["lat"])))
        ships = [p["track_id"] for p in pts if p["source"] == "ais" and near(p) < 12_000][:3]
        for sid in ships:
            r = one_run(cfg, sid, t0, seed)
            if r and r["shadow"]:
                runs += 1
                for k, v in r.items():
                    tot[k] = tot.get(k, 0) + v
    pct = lambda a, b: round(100 * tot[a] / tot[b], 1) if tot.get(b) else None
    res = {"runs": runs,
           "flagged_dark_before_reaching_ship_pct": pct("approach_dark", "approach"),
           "kept_dark_while_next_to_ship_pct": pct("shadow_dark", "shadow"),
           "alert_dark_next_to_ship_pct": pct("shadow_alert", "shadow"),
           "real_ship_still_identified_pct": pct("ship_ok", "ship")}
    print(json.dumps(res, indent=2))
    json.dump(res, open("shadow_eval.json", "w"), indent=2)
