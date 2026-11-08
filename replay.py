"""
REPLAY server: plays the recorded ships (plus simulated targets, if any) as a live feed.

Run:   python replay.py
Then:  open http://localhost:8000          -> small test map to see it working
       ws://localhost:8000/ws?speed=10     -> the feed for the dashboard (member 5)

Every real second the server sends ONE message with every ship's position at that moment:
    {"mode": "REPLAY", "t": "2026-11-08T11:00:00Z", "speed": 10,
     "points": [ {timestamp, track_id, lat, lon, sog_kn, cog_deg, source, mmsi, label}, ... ]}
The point fields are exactly the team's data contract. At the end it loops from the start.

speed = how many recorded seconds pass per real second (1, 10, 60 ...).

Positions between two AIS reports are interpolated so ships move smoothly.
"own_ship" = one real recorded ship we treat as our vessel (source "own").
The replay window = the time our ship is in the recording, so it is on the map the whole loop.

Simulated targets (member 2): put contract-format files in data/sim/ (.parquet or .csv).
Each file is shifted in time to start SIM_START_MIN minutes after the window starts.
"""

import asyncio
import glob
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

AIS_FILE = "data/ais_live.parquet"
SIM_GLOB = "data/sim/*"
OWN_SHIP_MMSI = None        # None = pick automatically; or put a number, e.g. 538007774
SIM_START_MIN = 5           # simulated scenarios start this many minutes into the loop
MAX_GAP_MIN = 20            # do not draw a ship across a gap longer than this
DEFAULT_SPEED = 10

COLUMNS = ["timestamp", "track_id", "lat", "lon", "sog_kn", "cog_deg", "source", "mmsi", "label"]


def to_seconds(timestamps):
    """ISO timestamps -> seconds since 1970 (works on every pandas version)."""
    t = pd.to_datetime(timestamps, utc=True)
    return (t - pd.Timestamp("1970-01-01", tz="UTC")).dt.total_seconds()


def read_any(path):
    return pd.read_parquet(path) if path.endswith(".parquet") else pd.read_csv(path, dtype=str)


def pick_own_ship(ais):
    """The moving ship that stays longest in the recording."""
    if OWN_SHIP_MMSI is not None:
        return f"ais_{OWN_SHIP_MMSI}"
    g = ais.groupby("track_id")
    span = g["t"].max() - g["t"].min()
    moving = g["sog_kn"].median() > 8
    return span[moving].idxmax() if moving.any() else span.idxmax()


class Track:
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
        """Position at time t (seconds), or None if the ship is not there."""
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


def nan_to_none(x, digits):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), digits)


def load():
    ais = pd.read_parquet(AIS_FILE)
    ais["t"] = to_seconds(ais["timestamp"])
    ais["mmsi"] = ais["mmsi"].astype(str)

    own = pick_own_ship(ais)
    is_own = ais["track_id"] == own
    ais.loc[is_own, "track_id"] = "own_ship"
    ais.loc[is_own, "source"] = "own"
    start, end = ais.loc[is_own, "t"].min(), ais.loc[is_own, "t"].max()

    frames = [ais]
    for path in sorted(glob.glob(SIM_GLOB)):
        if not path.endswith((".parquet", ".csv")):
            continue
        sim = read_any(path)[COLUMNS].copy()
        sim["t"] = to_seconds(sim["timestamp"])
        sim["t"] += (start + SIM_START_MIN * 60) - sim["t"].min()
        for col in ("lat", "lon", "sog_kn", "cog_deg"):
            sim[col] = pd.to_numeric(sim[col], errors="coerce")
        frames.append(sim)
        print(f"  + simulated targets: {Path(path).name} ({sim['track_id'].nunique()} tracks)")

    data = pd.concat(frames, ignore_index=True)
    tracks = [Track(g) for _, g in data.groupby("track_id")]
    print(f"Replay ready: {len(tracks)} tracks, own ship = {own}, "
          f"loop = {(end - start) / 60:.0f} recorded minutes")
    return tracks, start, end


TRACKS, START, END = load()
app = FastAPI(title="Maritime Sentinel - replay")


def frame(t, speed):
    ts = pd.Timestamp(t, unit="s", tz="UTC").strftime("%Y-%m-%dT%H:%M:%SZ")
    points = []
    for tr in TRACKS:
        pos = tr.at(t)
        if pos is None:
            continue
        lat, lon, sog, cog = pos
        points.append({"timestamp": ts, **tr.info,
                       "lat": round(lat, 5), "lon": round(lon, 5),
                       "sog_kn": nan_to_none(sog, 1), "cog_deg": nan_to_none(cog, 1)})
    return {"mode": "REPLAY", "t": ts, "speed": speed, "points": points}


@app.websocket("/ws")
async def feed(ws: WebSocket, speed: float = DEFAULT_SPEED):
    await ws.accept()
    t = START
    try:
        while True:
            await ws.send_text(json.dumps(frame(t, speed)))
            await asyncio.sleep(1)
            t += speed
            if t > END:
                t = START          # exhibition mode: loop forever
    except WebSocketDisconnect:
        pass


@app.get("/info")
def info():
    return {"mode": "REPLAY", "tracks": len(TRACKS),
            "start": pd.Timestamp(START, unit="s", tz="UTC").isoformat(),
            "end": pd.Timestamp(END, unit="s", tz="UTC").isoformat()}


TEST_PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>Replay test</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{height:100%;margin:0}
#bar{position:absolute;z-index:999;top:10px;left:60px;background:#0b1626;color:#e2e8f0;
font:14px monospace;padding:8px 12px;border-radius:6px}</style></head>
<body><div id="bar">connecting...</div><div id="map"></div><script>
const map = L.map('map').setView([12.58, 43.33], 11);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  {maxZoom: 18, attribution: 'Tiles &copy; Esri'}).addTo(map);
const speed = new URLSearchParams(location.search).get('speed') || 60;
const ws = new WebSocket(`ws://${location.host}/ws?speed=${speed}`);
const markers = {};
ws.onmessage = e => {
  const f = JSON.parse(e.data), seen = new Set();
  f.points.forEach(p => {
    seen.add(p.track_id);
    const color = p.source === 'own' ? '#facc15' : p.source === 'ais' ? '#22d3ee' : '#f87171';
    if (!markers[p.track_id]) markers[p.track_id] = L.circleMarker([p.lat, p.lon],
      {radius: p.source === 'own' ? 8 : 5, color, fillOpacity: .9}).bindTooltip(p.track_id).addTo(map);
    markers[p.track_id].setLatLng([p.lat, p.lon]);
  });
  Object.keys(markers).forEach(id => { if (!seen.has(id)) { map.removeLayer(markers[id]); delete markers[id]; } });
  document.getElementById('bar').textContent = `${f.mode}  ${f.t}  x${f.speed}  ships: ${f.points.length}`;
};
ws.onclose = () => document.getElementById('bar').textContent = 'disconnected - is replay.py running?';
</script></body></html>"""


@app.get("/", response_class=HTMLResponse)
def test_page():
    return TEST_PAGE


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
