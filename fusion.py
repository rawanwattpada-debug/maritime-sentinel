"""
fusion.py - radar + AIS fusion: which targets are registered, and which are "dark"?

The ship's radar sees EVERY object around it, but only as anonymous dots.
AIS gives names, but only for vessels that choose to broadcast.
Fusion matches the two: a radar track that keeps lining up with an AIS vessel is that
vessel; a radar track that matches nothing is a DARK TARGET and goes to the risk engine.

Two parts:
  RadarSim  - turns the true picture into what a radar (ARPA) would report:
              anonymous track ids, position noise, missed scans, speed/course
              estimated from the noisy positions (not copied from the truth).
  Fuser     - matches radar tracks to AIS vessels each scan (one-to-one, closest first,
              only inside the gate: distance, course and speed must agree), and keeps a
              short memory so one lucky/unlucky scan does not flip the decision.

All numbers come from fusion_config.json (starting assumptions from the team plan).
Evaluation: evaluate_fusion.py
"""

import json
import math
from collections import defaultdict, deque
from pathlib import Path

import numpy as np
from scipy.optimize import linear_sum_assignment

M_PER_DEG_LAT = 110_540
M_PER_DEG_LON_EQ = 111_320
KN = 1852 / 3600  # m/s per knot
CONFIG_FILE = Path(__file__).with_name("fusion_config.json")


def load_config(path=CONFIG_FILE):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def to_xy(lat, lon, lat0, lon0):
    """metres east (x) and north (y) of (lat0, lon0)"""
    return ((lon - lon0) * math.cos(math.radians(lat0)) * M_PER_DEG_LON_EQ,
            (lat - lat0) * M_PER_DEG_LAT)


def course_diff(a, b):
    d = abs(a - b) % 360
    return min(d, 360 - d)


# ---------------------------------------------------------------- radar

class RadarSim:
    """What our radar reports. No names, no AIS: only noisy positions and estimated motion."""

    def __init__(self, cfg, seed=7):
        self.c = cfg["radar"]
        self.rng = np.random.default_rng(seed)
        self.ids = {}                                   # true id -> anonymous radar id
        self.trail = defaultdict(lambda: deque(maxlen=7))  # radar id -> recent (t, x, y) in metres
        self.vel = {}                                   # radar id -> smoothed (vx, vy) m/s

    def scan(self, t, points):
        own = next((p for p in points if p["track_id"] == "own_ship"), None)
        if own is None:
            return []
        lat0, lon0 = own["lat"], own["lon"]
        out = []
        for p in points:
            if p["track_id"] == "own_ship":
                continue
            x, y = to_xy(p["lat"], p["lon"], lat0, lon0)
            if math.hypot(x, y) > self.c["range_nm"] * 1852:
                continue
            small = p["source"] != "ais"
            if self.rng.random() > (self.c["detect_prob_small_craft"] if small else self.c["detect_prob_ship"]):
                continue  # missed on this sweep
            rid = self.ids.setdefault(p["track_id"], f"R{len(self.ids) + 1:03d}")
            nx = x + self.rng.normal(0, self.c["noise_m"])
            ny = y + self.rng.normal(0, self.c["noise_m"])
            # absolute position (lat/lon) of the noisy plot
            lat = lat0 + ny / M_PER_DEG_LAT
            lon = lon0 + nx / (math.cos(math.radians(lat0)) * M_PER_DEG_LON_EQ)
            # motion is estimated from the radar's own plots over ~1 minute, like ARPA
            ax, ay = to_xy(lat, lon, 0.0, 0.0)  # fixed frame so own-ship motion does not leak in
            tr = self.trail[rid]
            tr.append((t, ax, ay))
            sog = cog = None
            if len(tr) >= 3 and tr[-1][0] - tr[0][0] > 0:
                dt = tr[-1][0] - tr[0][0]
                vx, vy = (tr[-1][1] - tr[0][1]) / dt, (tr[-1][2] - tr[0][2]) / dt
                a = self.c["speed_smoothing"]
                if rid in self.vel:
                    vx = a * vx + (1 - a) * self.vel[rid][0]
                    vy = a * vy + (1 - a) * self.vel[rid][1]
                self.vel[rid] = (vx, vy)
                sog = math.hypot(vx, vy) / KN
                cog = math.degrees(math.atan2(vx, vy)) % 360
            out.append({
                "radar_id": rid, "t": t, "lat": lat, "lon": lon,
                "sog_kn": None if sog is None else round(sog, 1),
                "cog_deg": None if cog is None else round(cog, 1),
                # ground truth, used ONLY to measure accuracy, never by the Fuser
                "_truth_id": p["track_id"], "_truth_ais": not small,
            })
        return out


# ---------------------------------------------------------------- fusion

class Fuser:
    """Decides, for every radar track, 'matched to AIS vessel X', 'dark', or 'tentative'."""

    def __init__(self, cfg):
        self.a = cfg["association"]
        self.d = cfg["dark"]
        win = max(self.a["window_scans"], self.d["unmatched_scans"])
        self.hist = defaultdict(lambda: deque(maxlen=win))  # radar id -> recent matches (mmsi or None)

    def _cost(self, r, s, lat0):
        dx, dy = to_xy(r["lat"], r["lon"], s["lat"], s["lon"])
        dist = math.hypot(dx, dy)
        if dist > self.a["gate_m"]:
            return None
        if r["sog_kn"] is not None and s.get("sog_kn") is not None:
            if abs(r["sog_kn"] - s["sog_kn"]) > self.a["max_speed_diff_kn"]:
                return None
            moving = min(r["sog_kn"], s["sog_kn"]) >= self.a["min_speed_for_course_kn"]
            if moving and r["cog_deg"] is not None and s.get("cog_deg") is not None:
                if course_diff(r["cog_deg"], s["cog_deg"]) > self.a["max_course_diff_deg"]:
                    return None
        return dist

    def update(self, radar, ais):
        """radar: RadarSim.scan() output; ais: contract rows with source == 'ais'.
        Returns radar tracks with 'status' ('ais' | 'dark' | 'tentative') and 'mmsi'."""
        ais = [s for s in ais if s.get("source") == "ais"]
        match = {}
        if radar and ais:
            big = 1e9
            cost = np.full((len(radar), len(ais)), big)
            for i, r in enumerate(radar):
                for j, s in enumerate(ais):
                    c = self._cost(r, s, r["lat"])
                    if c is not None:
                        cost[i, j] = c
            rows, cols = linear_sum_assignment(cost)
            for i, j in zip(rows, cols):
                if cost[i, j] < big:
                    match[radar[i]["radar_id"]] = str(ais[j]["mmsi"])

        out = []
        for r in radar:
            h = self.hist[r["radar_id"]]
            h.append(match.get(r["radar_id"]))
            recent = list(h)[-self.a["window_scans"]:]
            best, votes = None, 0
            for m in set(x for x in recent if x):
                n = recent.count(m)
                if n > votes:
                    best, votes = m, n
            last_n = list(h)[-self.d["unmatched_scans"]:]
            if best and votes >= self.a["confirm_scans"]:
                status = "ais"
            elif len(last_n) >= self.d["unmatched_scans"] and all(x is None for x in last_n):
                status, best = "dark", None
            else:
                status = "tentative"
            out.append({**r, "status": status, "mmsi": best if status == "ais" else None})
        return out


# ---------------------------------------------------------------- scoring the fusion itself

class FusionMetrics:
    """Compares fusion decisions with the hidden truth (only possible because we simulate radar)."""

    def __init__(self):
        self.n = defaultdict(int)
        self.first_seen = {}
        self.first_dark = {}

    def add(self, t, fused):
        for f in fused:
            truth, is_ais = f["_truth_id"], f["_truth_ais"]
            self.first_seen.setdefault(truth, t)
            if f["status"] == "tentative":
                self.n["ship_tentative" if is_ais else "dark_tentative"] += 1
                continue
            if is_ais:
                self.n["ship_decided"] += 1
                if f["status"] == "ais" and f"ais_{f['mmsi']}" == truth:
                    self.n["ship_correct"] += 1
                elif f["status"] == "ais":
                    self.n["ship_wrong_vessel"] += 1
                else:
                    self.n["ship_false_dark"] += 1
            else:
                self.n["dark_decided"] += 1
                if f["status"] == "dark":
                    self.n["dark_correct"] += 1
                    self.first_dark.setdefault(truth, t)
                else:
                    self.n["dark_hidden_as_ship"] += 1

    def summary(self):
        n = self.n
        pct = lambda a, b: round(100 * a / b, 2) if b else None
        delays = [self.first_dark[k] - self.first_seen[k] for k in self.first_dark]
        dark_targets = [k for k in self.first_seen if not k.startswith("ais_")]
        return {
            "registered_ships_correctly_identified_pct": pct(n["ship_correct"], n["ship_decided"]),
            "registered_ships_wrongly_flagged_dark_pct": pct(n["ship_false_dark"], n["ship_decided"]),
            "registered_ships_matched_to_wrong_vessel_pct": pct(n["ship_wrong_vessel"], n["ship_decided"]),
            "dark_targets_detected_pct": pct(len(self.first_dark), len(dark_targets)),
            "dark_scans_correct_pct": pct(n["dark_correct"], n["dark_decided"]),
            "dark_scans_hidden_as_ship_pct": pct(n["dark_hidden_as_ship"], n["dark_decided"]),
            "median_seconds_to_flag_dark": float(np.median(delays)) if delays else None,
            "counts": dict(n),
            "dark_targets": len(dark_targets),
            "registered_ships": len(self.first_seen) - len(dark_targets),
        }
