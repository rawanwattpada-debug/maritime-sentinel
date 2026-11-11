"""
How accurate is radar + AIS fusion?   ->   python evaluate_fusion.py

A) Real traffic: the whole recording (real AIS ships, ~5 hours, one radar sweep every
   10 recorded seconds). Question: are registered ships recognised as themselves,
   or wrongly flagged "dark"?
B) Demo with member 2's scenarios, repeated with different radar noise (seeds).
   Question: are the dark targets caught, how fast, and is any of them mistaken
   for a registered ship?

Writes fusion_eval.json and prints a summary. Numbers are measurements of our code
on recorded real traffic (A) and on simulated targets (B); say so when presenting.
"""

import argparse
import json

import numpy as np

import replay as rp
from fusion import Fuser, FusionMetrics, RadarSim, load_config

SCAN_S = 10  # seconds of recorded time between radar sweeps


def run(frames, cfg, seed):
    radar, fuser, metrics = RadarSim(cfg, seed=seed), Fuser(cfg), FusionMetrics()
    for t, points in frames:
        fused = fuser.update(radar.scan(t, points), points)
        metrics.add(t, fused)
    return metrics.summary()


def real_traffic_frames():
    R = rp.REPLAY
    for t in np.arange(R.own_start, R.own_end, SCAN_S):
        yield t, rp.tracks_at(R.tracks, t, rp.iso(t))


def demo_frames():
    R = rp.REPLAY
    speed = R.default_speed()
    start, end = R.window(speed)
    targets = R.targets(speed)
    for t in np.arange(start, end, SCAN_S):
        ts = rp.iso(t)
        yield t, rp.tracks_at(R.tracks, t, ts) + rp.tracks_at(targets, t, ts)


def mean_of(runs, key):
    vals = [r[key] for r in runs if r[key] is not None]
    return round(float(np.mean(vals)), 2) if vals else None


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=20)
    ap.add_argument("--out", default="fusion_eval.json")
    a = ap.parse_args()
    cfg = load_config()

    real = run(list(real_traffic_frames()), cfg, seed=1)
    demo_list = list(demo_frames())
    demo_runs = [run(demo_list, cfg, seed=s) for s in range(1, a.runs + 1)]
    keys = [k for k in demo_runs[0] if isinstance(demo_runs[0][k], (int, float)) or demo_runs[0][k] is None]
    demo = {k: mean_of(demo_runs, k) for k in keys}
    demo["runs"] = a.runs

    result = {"config": cfg, "scan_seconds": SCAN_S, "real_traffic": real, "demo_scenarios_mean": demo}
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print("\nA) Real recorded traffic (registered ships only)")
    print(f"   ships: {real['registered_ships']} | correctly identified: {real['registered_ships_correctly_identified_pct']}%"
          f" | wrongly flagged dark: {real['registered_ships_wrongly_flagged_dark_pct']}%"
          f" | matched to wrong vessel: {real['registered_ships_matched_to_wrong_vessel_pct']}%")
    print(f"\nB) Demo scenarios, mean of {a.runs} runs with different radar noise")
    print(f"   dark targets: {demo['dark_targets']} | detected: {demo['dark_targets_detected_pct']}%"
          f" | median time to flag: {demo['median_seconds_to_flag_dark']} s"
          f" | dark scans hidden as a ship: {demo['dark_scans_hidden_as_ship_pct']}%")
    print(f"   registered ships correctly identified: {demo['registered_ships_correctly_identified_pct']}%"
          f" | wrongly flagged dark: {demo['registered_ships_wrongly_flagged_dark_pct']}%")
    print(f"\n-> {a.out}")
