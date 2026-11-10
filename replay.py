"""
Ship feed server for the dashboard, in two modes:

  python replay.py          REPLAY: plays the recording (data/ais_live.parquet) in a loop.
                            Works with NO internet (exhibition mode).
  python replay.py --live   LIVE: real ships right now from aisstream (Dover Strait),
                            moved onto the Bab el-Mandeb lane exactly like the recording.
                            Needs internet + AISSTREAM_KEY in .env + data/relocation.json
                            (made by convert_ais.py).

Then:  open http://localhost:8000          -> small test map to see it working
       ws://localhost:8000/ws?speed=10     -> the feed for the dashboard (member 5)

Every real second the server sends ONE message with every ship's position at that moment:
    {"mode": "REPLAY" | "LIVE", "t": "2026-11-08T11:00:00Z", "speed": 10,
     "points": [ {timestamp, track_id, lat, lon, sog_kn, cog_deg, source, mmsi, label}, ... ]}
The point fields are exactly the team's data contract.

REPLAY: speed = recorded seconds per real second (1, 10, 60 ...). Positions between AIS
        reports are interpolated. Loops forever.
LIVE:   speed is always 1. Ships keep moving along their course between reports
        (dead reckoning) and disappear if not heard from for LIVE_MAX_AGE_MIN.

"own_ship" = one real ship we treat as our vessel (source "own").

Simulated targets (member 2): put contract-format files in data/sim/ (.parquet or .csv).
  REPLAY with data/sim/schedule.json (the demo script):
          each scenario starts at its "at_second" (REAL seconds into the loop) and is
          attached to our ship: "follow" (moves with it - attacks) or "place" (put near it,
          then stays in the sea - fishing). Draw every scenario around our ship FIXED at
          "reference". The loop is "loop_seconds" long, taken from the busiest part of the
          recording ("start_offset_min": "auto").
  REPLAY without schedule.json: every scenario starts SIM_START_MIN minutes in, as drawn.
  LIVE:   they start when someone opens http://localhost:8000/inject  ("press the button").
"""

import asyncio
import glob
import json
import math
import os
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

from convert_ais import OUT_SETTINGS, SOURCE_REGION, apply_relocation, axis_diff
from record_ais import API_KEY, REGIONS, URL as AISSTREAM_URL

MODE = "LIVE" if "--live" in sys.argv else "REPLAY"

AIS_FILE = "data/ais_live.parquet"
SIM_GLOB = "data/sim/*"
OWN_SHIP_MMSI = None        # REPLAY: None = pick automatically; or a number, e.g. 538007774
SIM_START_MIN = 5           # REPLAY without schedule.json: scenarios start this many minutes in
SCHEDULE_FILE = "data/sim/schedule.json"   # REPLAY: the demo script (see load_schedule)
SIM_REFERENCE = (12.58, 43.33)  # member 2 draws our ship FIXED here; we attach it to the real one
MAX_GAP_MIN = 20            # REPLAY: do not draw a ship across a gap longer than this
LIVE_MAX_AGE_MIN = 15       # LIVE: hide a ship not heard from for this long
DEFAULT_SPEED = 10

COLUMNS = ["timestamp", "track_id", "lat", "lon", "sog_kn", "cog_deg", "source", "mmsi", "label"]
M_PER_DEG_LAT = 110_540
M_PER_DEG_LON_EQ = 111_320


# ---------------------------------------------------------------- shared helpers

def to_seconds(timestamps):
    """ISO timestamps -> seconds since 1970 (works on every pandas version)."""
    t = pd.to_datetime(timestamps, utc=True)
    return (t - pd.Timestamp("1970-01-01", tz="UTC")).dt.total_seconds()


def iso(t):
    return pd.Timestamp(t, unit="s", tz="UTC").strftime("%Y-%m-%dT%H:%M:%SZ")


def num(x, digits):
    """Round a number for JSON; missing values become null."""
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), digits)


def point(ts, info, lat, lon, sog, cog):
    return {"timestamp": ts, **info, "lat": round(lat, 5), "lon": round(lon, 5),
            "sog_kn": num(sog, 1), "cog_deg": num(cog, 1)}


class Track:
    """One ship's recorded points; gives its (interpolated) position at any time."""

    def __init__(self, df):
        df = df.sort_values("t")
        self.t = df["t"].to_numpy(dtype=float)
        self.lat = df["lat"].to_numpy(dtype=float)
        self.lon = df["lon"].to_numpy(dtype=float)
        self.sog = df["sog_kn"].to_numpy(dtype=float)
        self.cog = df["cog_deg"].to_numpy(dtype=float)
        first = df.iloc[0]
        self.info = {k: ("" if pd.isna(first[k]) else str(first[k]))
                     for k in ("track_id", "source", "mmsi", "label")}

    def at(self, t):
        i = int(np.searchsorted(self.t, t, side="right")) - 1
        if i < 0 or t > self.t[-1]:
            return None
        if i == len(self.t) - 1:
            f, j = 0.0, i
        else:
            j = i + 1
            gap = self.t[j] - self.t[i]
            if gap > MAX_GAP_MIN * 60:
                return None
            f = (t - self.t[i]) / gap if gap else 0.0
        lat = self.lat[i] + f * (self.lat[j] - self.lat[i])
        lon = self.lon[i] + f * (self.lon[j] - self.lon[i])
        return lat, lon, self.sog[i], self.cog[i]


def load_sims():
    """Simulated scenario files from member 2: {file name: table}."""
    sims = {}
    for path in sorted(glob.glob(SIM_GLOB)):
        if not path.endswith((".parquet", ".csv")):
            continue
        df = pd.read_parquet(path) if path.endswith(".parquet") else pd.read_csv(path, dtype=str)
        df = df[COLUMNS].copy()
        df["t"] = to_seconds(df["timestamp"])
        for col in ("lat", "lon", "sog_kn", "cog_deg"):
            df[col] = pd.to_numeric(df[col], errors="coerce")
        sims[Path(path).name] = df
        print(f"  + simulated targets: {Path(path).name} ({df['track_id'].nunique()} tracks)")
    return sims


def sim_tracks(sims, start_t):
    """Shift every scenario so it starts at start_t, and make Tracks out of them."""
    tracks = []
    for df in sims.values():
        df = df.copy()
        df["t"] += start_t - df["t"].min()
        tracks += [Track(g) for _, g in df.groupby("track_id")]
    return tracks


class AnchoredTarget:
    """A simulated target drawn around a FIXED ship at the reference point,
    attached to our real (moving) ship:
      follow - the whole scenario moves with our ship (attackers really reach it);
               speed/course are recomputed so they are the true speed over ground
      place  - the scenario is put around our ship when it starts, then stays put
               in the sea (fishing boats do not follow us; we sail past them)
      none   - coordinates used exactly as given in the file
    """

    def __init__(self, track, mode, own_track, start_t, reference):
        self.track, self.mode, self.own, self.ref = track, mode, own_track, reference
        self.info = track.info
        self.fixed = self.offset(start_t) if mode == "place" else None

    def offset(self, t):
        p = self.own.at(t)
        return None if p is None else (p[0] - self.ref[0], p[1] - self.ref[1])

    def absolute(self, t):
        rel = self.track.at(t)
        if rel is None or self.mode == "none":
            return rel
        off = self.fixed if self.mode == "place" else self.offset(t)
        if off is None:
            return None
        return rel[0] + off[0], rel[1] + off[1], rel[2], rel[3]

    def at(self, t):
        pos = self.absolute(t)
        if pos is None or self.mode != "follow":
            return pos
        nxt = self.absolute(t + 10)
        if nxt is None:
            return pos
        dy = (nxt[0] - pos[0]) * M_PER_DEG_LAT
        dx = (nxt[1] - pos[1]) * math.cos(math.radians(pos[0])) * M_PER_DEG_LON_EQ
        sog = math.hypot(dx, dy) / 10 * 3600 / 1852
        cog = math.degrees(math.atan2(dx, dy)) % 360
        return pos[0], pos[1], sog, cog


def tracks_at(tracks, t, ts):
    out = []
    for tr in tracks:
        pos = tr.at(t)
        if pos is not None:
            out.append(point(ts, tr.info, *pos))
    return out


SIMS = load_sims()


# ---------------------------------------------------------------- REPLAY mode

def load_replay():
    ais = pd.read_parquet(AIS_FILE)
    ais["t"] = to_seconds(ais["timestamp"])
    ais["mmsi"] = ais["mmsi"].astype(str)

    if OWN_SHIP_MMSI is not None:
        own = f"ais_{OWN_SHIP_MMSI}"
    else:   # the moving ship that stays longest in the recording
        g = ais.groupby("track_id")
        span = g["t"].max() - g["t"].min()
        moving = g["sog_kn"].median() > 8
        own = span[moving].idxmax() if moving.any() else span.idxmax()
    is_own = ais["track_id"] == own
    ais.loc[is_own, "track_id"] = "own_ship"
    ais.loc[is_own, "source"] = "own"
    start, end = ais.loc[is_own, "t"].min(), ais.loc[is_own, "t"].max()

    tracks = [Track(g) for _, g in ais.groupby("track_id")]
    own_track = next(tr for tr in tracks if tr.info["track_id"] == "own_ship")
    return tracks, own_track, start, end


def load_schedule():
    """data/sim/schedule.json = the demo script. Without it: every scenario
    starts SIM_START_MIN minutes in, and the whole recording loops."""
    if not os.path.exists(SCHEDULE_FILE):
        return None
    with open(SCHEDULE_FILE, encoding="utf-8") as f:
        s = json.load(f)
    s.setdefault("speed", DEFAULT_SPEED)
    s.setdefault("loop_seconds", 130)
    s.setdefault("start_offset_min", "auto")
    s.setdefault("reference", list(SIM_REFERENCE))
    s.setdefault("scenarios", [])
    return s


def busiest_start(tracks, start, end, length):
    """Start of the window (of `length` recorded seconds) with the most ships on screen."""
    others = [tr for tr in tracks if tr.info["track_id"] != "own_ship"]
    best, best_score = start, -1
    for s in np.arange(start, max(start, end - length) + 1, 60):
        score = sum(tr.at(t) is not None for tr in others for t in np.arange(s, s + length, 120))
        if score > best_score:
            best, best_score = s, score
    return best


class Replay:
    """Everything REPLAY needs; the demo window and targets depend on the speed."""

    def __init__(self):
        self.tracks, self.own, self.own_start, self.own_end = load_replay()
        self.schedule = load_schedule()
        self.cache = {}
        if self.schedule:
            s = self.schedule
            length = s["loop_seconds"] * s["speed"]
            if s["start_offset_min"] == "auto":
                self.start = busiest_start(self.tracks, self.own_start, self.own_end, length)
            else:
                self.start = self.own_start + float(s["start_offset_min"]) * 60
            names = ", ".join(f"{sc['file']}@{sc['at_second']}s/{sc.get('anchor', 'place')}"
                              for sc in s["scenarios"])
            print(f"Demo script: {s['loop_seconds']} s loop at x{s['speed']}, "
                  f"starting {(self.start - self.own_start) / 60:.0f} min into the recording | {names}")
        else:
            self.start = self.own_start
        print(f"REPLAY ready: {len(self.tracks)} recorded tracks, "
              f"own ship in recording for {(self.own_end - self.own_start) / 60:.0f} min")

    def default_speed(self):
        return self.schedule["speed"] if self.schedule else DEFAULT_SPEED

    def window(self, speed):
        if not self.schedule:
            return self.own_start, self.own_end
        return self.start, min(self.start + self.schedule["loop_seconds"] * speed, self.own_end)

    def targets(self, speed):
        """Simulated targets for this speed (scenario times are in real demo seconds)."""
        if speed in self.cache:
            return self.cache[speed]
        out = []
        if not self.schedule:
            out = sim_tracks(SIMS, self.start + SIM_START_MIN * 60)
        else:
            ref = tuple(self.schedule["reference"])
            for sc in self.schedule["scenarios"]:
                df = SIMS.get(sc["file"])
                if df is None:
                    print(f"  ! {sc['file']} is in schedule.json but not in data/sim/ - skipped")
                    continue
                t0 = self.start + sc["at_second"] * speed
                df = df.copy()
                df["t"] += t0 - df["t"].min()
                out += [AnchoredTarget(Track(g), sc.get("anchor", "place"), self.own, t0, ref)
                        for _, g in df.groupby("track_id")]
        self.cache[speed] = out
        return out


# ---------------------------------------------------------------- LIVE mode

class Live:
    ships = {}          # mmsi -> latest relocated report
    own = None          # mmsi of the ship shown as own_ship
    sims = []           # simulated Tracks, set by /inject
    status = "connecting"


def load_settings():
    if not os.path.exists(OUT_SETTINGS):
        sys.exit(f"{OUT_SETTINGS} not found. Run  python convert_ais.py  once first.")
    with open(OUT_SETTINGS, encoding="utf-8") as f:
        return json.load(f)


async def live_listener(settings):
    """Keep a connection to aisstream and store every ship's latest relocated position."""
    url = os.getenv("AISSTREAM_URL", AISSTREAM_URL)   # can point at a test server
    while True:
        try:
            async with websockets.connect(url) as ws:
                await ws.send(json.dumps({
                    "APIKey": API_KEY,
                    "BoundingBoxes": [REGIONS[SOURCE_REGION]],
                    "FilterMessageTypes": ["PositionReport"],
                }))
                Live.status = "connected"
                async for raw in ws:
                    msg = json.loads(raw)
                    if msg.get("MessageType") != "PositionReport":
                        continue
                    meta, rep = msg["MetaData"], msg["Message"]["PositionReport"]
                    sog = rep.get("Sog", float("nan"))
                    cog = rep.get("Cog", float("nan"))
                    sog = float("nan") if sog is None or sog >= 102.2 else float(sog)
                    cog = float("nan") if cog is None or cog >= 360 else float(cog)
                    # skip ships crossing the lane (e.g. ferries), like convert_ais.py does
                    if sog > 3 and axis_diff(cog, settings["source_axis"]) > 35:
                        Live.ships.pop(meta["MMSI"], None)
                        continue
                    lat, lon, new_cog, inside = apply_relocation(
                        meta["latitude"], meta["longitude"], cog, settings)
                    if not inside:
                        Live.ships.pop(meta["MMSI"], None)
                        continue
                    Live.ships[meta["MMSI"]] = {"t": time.time(), "lat": lat, "lon": lon,
                                                "sog": sog, "cog": new_cog}
        except (websockets.WebSocketException, OSError, json.JSONDecodeError) as e:
            Live.status = f"reconnecting ({e})"
            await asyncio.sleep(5)


def live_points(now, ts, settings):
    out, fresh = [], {}
    for mmsi, s in list(Live.ships.items()):
        age = now - s["t"]
        if age > LIVE_MAX_AGE_MIN * 60:
            del Live.ships[mmsi]
            continue
        lat, lon = s["lat"], s["lon"]
        if not math.isnan(s["sog"]) and not math.isnan(s["cog"]):   # keep moving on course
            dist = s["sog"] * 1852 / 3600 * age
            c = math.radians(s["cog"])
            lat += dist * math.cos(c) / M_PER_DEG_LAT
            lon += dist * math.sin(c) / (math.cos(math.radians(lat)) * M_PER_DEG_LON_EQ)
        fresh[mmsi] = (lat, lon, s["sog"], s["cog"])

    # our ship: keep the same one while we hear it; else the moving ship nearest the centre
    if Live.own not in fresh:
        lat_t, lon_t = settings["target_center"]
        movers = [m for m, v in fresh.items() if not math.isnan(v[2]) and v[2] > 5]
        Live.own = min(movers, key=lambda m: (fresh[m][0] - lat_t) ** 2 + (fresh[m][1] - lon_t) ** 2,
                       default=None)

    for mmsi, pos in fresh.items():
        own = mmsi == Live.own
        info = {"track_id": "own_ship" if own else f"ais_{mmsi}",
                "source": "own" if own else "ais", "mmsi": str(mmsi), "label": ""}
        out.append(point(ts, info, *pos))
    return out


# ---------------------------------------------------------------- server

if MODE == "REPLAY":
    REPLAY = Replay()
else:
    SETTINGS = load_settings()
    if not API_KEY:
        sys.exit("AISSTREAM_KEY not found in .env")
    print(f"LIVE mode: real ships from the Dover Strait, relocated to Bab el-Mandeb")


@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(live_listener(SETTINGS)) if MODE == "LIVE" else None
    yield
    if task:
        task.cancel()


app = FastAPI(title="Maritime Sentinel - ship feed", lifespan=lifespan)


def frame(t, speed):
    ts = iso(t)
    if MODE == "REPLAY":
        points = tracks_at(REPLAY.tracks, t, ts) + tracks_at(REPLAY.targets(speed), t, ts)
    else:
        points = live_points(t, ts, SETTINGS) + tracks_at(Live.sims, t, ts)
    return {"mode": MODE, "t": ts, "speed": speed, "points": points}


@app.websocket("/ws")
async def feed(ws: WebSocket, speed: Optional[float] = None):
    await ws.accept()
    if MODE == "LIVE":
        speed = 1
    else:
        speed = speed or REPLAY.default_speed()
        start, end = REPLAY.window(speed)
    t = start if MODE == "REPLAY" else time.time()
    try:
        while True:
            await ws.send_text(json.dumps(frame(t, speed)))
            await asyncio.sleep(1)
            if MODE == "REPLAY":
                t += speed
                if t > end:
                    t = start          # exhibition mode: loop forever
            else:
                t = time.time()
    except WebSocketDisconnect:
        pass


@app.get("/inject")
def inject():
    """LIVE only: drop the simulated targets onto the live picture, starting now."""
    if MODE != "LIVE":
        return {"ok": False, "why": "only in LIVE mode; in REPLAY they start automatically"}
    Live.sims = sim_tracks(SIMS, time.time())
    return {"ok": True, "simulated_tracks": len(Live.sims)}


@app.get("/info")
def info():
    if MODE == "REPLAY":
        speed = REPLAY.default_speed()
        start, end = REPLAY.window(speed)
        return {"mode": MODE, "recorded_tracks": len(REPLAY.tracks), "speed": speed,
                "loop_start": iso(start), "loop_end": iso(end),
                "loop_real_seconds": round((end - start) / speed),
                "simulated_tracks": len(REPLAY.targets(speed)),
                "demo_script": REPLAY.schedule is not None}
    return {"mode": MODE, "aisstream": Live.status, "ships_now": len(Live.ships),
            "simulated_tracks": len(Live.sims)}


TEST_PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>Feed test</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{height:100%;margin:0}
#bar{position:absolute;z-index:999;top:10px;left:60px;background:#0b1626;color:#e2e8f0;
font:14px monospace;padding:8px 12px;border-radius:6px}
#bar button{margin-left:10px;font:inherit;cursor:pointer}</style></head>
<body><div id="bar"><span id="txt">connecting...</span>
<button id="inject" hidden onclick="fetch('/inject')">inject simulated targets</button></div>
<div id="map"></div><script>
const map = L.map('map').setView([12.58, 43.33], 11);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  {maxZoom: 18, attribution: 'Tiles &copy; Esri'}).addTo(map);
const speed = new URLSearchParams(location.search).get('speed');
const ws = new WebSocket(`ws://${location.host}/ws` + (speed ? `?speed=${speed}` : ''));
const markers = {};
ws.onmessage = e => {
  const f = JSON.parse(e.data), seen = new Set();
  f.points.forEach(p => {
    seen.add(p.track_id);
    const color = p.source === 'own' ? '#facc15' : p.source === 'ais' ? '#22d3ee' : '#f87171';
    if (!markers[p.track_id]) markers[p.track_id] = L.circleMarker([p.lat, p.lon],
      {radius: p.source === 'own' ? 8 : 5, color, fillOpacity: .9}).bindTooltip(p.track_id).addTo(map);
    markers[p.track_id].setLatLng([p.lat, p.lon]).setStyle({color});
  });
  Object.keys(markers).forEach(id => { if (!seen.has(id)) { map.removeLayer(markers[id]); delete markers[id]; } });
  document.getElementById('txt').textContent = `${f.mode}  ${f.t}  x${f.speed}  ships: ${f.points.length}`;
  document.getElementById('inject').hidden = f.mode !== 'LIVE';
};
ws.onclose = () => document.getElementById('txt').textContent = 'disconnected - is replay.py running?';
</script></body></html>"""


@app.get("/", response_class=HTMLResponse)
def test_page():
    return TEST_PAGE


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
