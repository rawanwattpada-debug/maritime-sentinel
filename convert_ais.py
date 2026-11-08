"""
Turn the raw aisstream recording into the team's data contract, moved to Bab el-Mandeb.

Why move it?  aisstream has no coverage in the Red Sea or the Gulf (tested: 0 ships in
3 hours), but it covers the Dover Strait well. So we record REAL ship traffic in the
Dover Strait and place it on the Bab el-Mandeb shipping lane. Distances, speeds and
timing stay exactly as recorded; only the location and heading are rotated/shifted.
Say this clearly in the presentation: "real traffic recorded in the Dover Strait,
relocated to Bab el-Mandeb".

Run:     python convert_ais.py
Input:   data/raw/ais_raw.jsonl              (from record_ais.py)
Output:  data/ais_live.parquet               (the contract format, for the team)
         data/ais_live_preview.html          (open in a browser to check the result)
"""

import json
import math

import numpy as np
import pandas as pd

from record_ais import OUT_FILE as RAW_FILE, REGIONS

OUT_PARQUET = "data/ais_live.parquet"
OUT_PREVIEW = "data/ais_live_preview.html"

# ---- Settings you may tune after looking at the preview map ----------------------
SOURCE_REGION = "test_channel"        # which recorded area to use
TARGET_CENTER = (12.58, 43.33)        # (lat, lon) middle of the Bab el-Mandeb lane
TARGET_LANE_BEARING = 140             # direction of the target lane, degrees (0 = north)
CORRIDOR_HALF_WIDTH_KM = 8            # keep only points this close to the lane axis
LANE_ALIGNED_SHARE = 0.6              # a moving ship must follow the lane this often
# ----------------------------------------------------------------------------------

M_PER_DEG_LAT = 110_540
M_PER_DEG_LON_EQ = 111_320


def load_raw(path):
    """Read PositionReport messages from the raw recording into a table."""
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if msg.get("MessageType") != "PositionReport":
                continue
            meta = msg["MetaData"]
            report = msg["Message"]["PositionReport"]
            rows.append({
                "time": meta["time_utc"][:19],
                "mmsi": meta["MMSI"],
                "lat": meta["latitude"],
                "lon": meta["longitude"],
                "sog_kn": report.get("Sog"),
                "cog_deg": report.get("Cog"),
            })
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df["time"] = pd.to_datetime(df["time"], utc=True)
    # AIS "not available" codes
    df.loc[df["sog_kn"] >= 102.2, "sog_kn"] = np.nan
    df.loc[df["cog_deg"] >= 360, "cog_deg"] = np.nan
    return df


def in_region(df, name):
    (lat_min, lon_min), (lat_max, lon_max) = REGIONS[name]
    return df["lat"].between(lat_min, lat_max) & df["lon"].between(lon_min, lon_max)


def lane_axis(cog):
    """Main traffic direction (0-180) from courses, treating 40 and 220 as the same lane."""
    doubled = np.radians(cog.dropna() * 2)
    mean = math.degrees(math.atan2(np.sin(doubled).mean(), np.cos(doubled).mean())) / 2
    return mean % 180


def axis_diff(cog, axis):
    """Angle between a course and the lane axis, ignoring direction (0-90)."""
    d = (cog - axis) % 180
    return np.minimum(d, 180 - d)


def relocate(df):
    df = df[in_region(df, SOURCE_REGION)].copy()
    if df.empty:
        return df, None

    moving = df["sog_kn"] > 3
    src_axis = lane_axis(df.loc[moving, "cog_deg"])
    # lane centre = middle of the ships that actually follow the lane
    along = moving & (axis_diff(df["cog_deg"], src_axis) <= 35)
    lat0, lon0 = df.loc[along, "lat"].median(), df.loc[along, "lon"].median()

    # local metres around that point
    x = (df["lon"] - lon0) * math.cos(math.radians(lat0)) * M_PER_DEG_LON_EQ
    y = (df["lat"] - lat0) * M_PER_DEG_LAT

    # re-centre using medians measured along / across the lane (robust on a diagonal lane)
    a = math.radians(src_axis)
    along_m = (x * math.sin(a) + y * math.cos(a))[along].median()
    across_m = (x * math.cos(a) - y * math.sin(a))[along].median()
    x = x - (along_m * math.sin(a) + across_m * math.cos(a))
    y = y - (along_m * math.cos(a) - across_m * math.sin(a))

    # keep points inside the lane corridor
    off_axis_km = (x * math.cos(a) - y * math.sin(a)).abs() / 1000
    keep = off_axis_km <= CORRIDOR_HALF_WIDTH_KM

    # drop ships that mostly cross the lane (e.g. Dover-Calais ferries)
    aligned = axis_diff(df["cog_deg"], src_axis) <= 35
    share = aligned[moving].groupby(df.loc[moving, "mmsi"]).mean()
    crossers = share[share < LANE_ALIGNED_SHARE].index
    keep &= ~df["mmsi"].isin(crossers)

    # rotate so the source lane lines up with the target lane, then move it there
    theta = math.radians((TARGET_LANE_BEARING - src_axis) % 180)
    x2 = x * math.cos(theta) + y * math.sin(theta)
    y2 = -x * math.sin(theta) + y * math.cos(theta)
    lat_t, lon_t = TARGET_CENTER
    df["lat"] = lat_t + y2 / M_PER_DEG_LAT
    df["lon"] = lon_t + x2 / (math.cos(math.radians(lat_t)) * M_PER_DEG_LON_EQ)
    df["cog_deg"] = (df["cog_deg"] + math.degrees(theta)) % 360

    info = {
        "source_axis": round(src_axis, 1),
        "rotation": round(math.degrees(theta), 1),
        "ships_dropped_as_crossers": len(crossers),
        "points_outside_corridor": int((~keep).sum()),
    }
    return df[keep], info


def to_contract(df):
    out = pd.DataFrame({
        "timestamp": df["time"].dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "track_id": "ais_" + df["mmsi"].astype(str),
        "lat": df["lat"].round(5),
        "lon": df["lon"].round(5),
        "sog_kn": df["sog_kn"].round(1),
        "cog_deg": df["cog_deg"].round(1),
        "source": "ais",
        "mmsi": df["mmsi"].astype(str),
        "label": "",
    })
    return (out.drop_duplicates(["track_id", "timestamp"])
               .sort_values(["timestamp", "track_id"])
               .reset_index(drop=True))


def write_preview(df, path):
    """A small Leaflet map with one line per ship, to check nothing lands on the coast."""
    tracks = [
        g[["lat", "lon"]].values.tolist()
        for _, g in df.groupby("track_id") if len(g) > 1
    ]
    html = f"""<!doctype html><html><head><meta charset="utf-8">
<title>AIS preview</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{{height:100%;margin:0}}</style></head><body><div id="map"></div>
<script>
const map = L.map('map').setView([{TARGET_CENTER[0]}, {TARGET_CENTER[1]}], 10);
const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const layers = {{
  'Satellite (Esri)': L.tileLayer(esri + 'World_Imagery/MapServer/tile/{{z}}/{{y}}/{{x}}',
    {{maxZoom: 18, attribution: 'Tiles &copy; Esri'}}),
  'Streets (Esri)': L.tileLayer(esri + 'World_Street_Map/MapServer/tile/{{z}}/{{y}}/{{x}}',
    {{maxZoom: 18, attribution: 'Tiles &copy; Esri'}}),
  'Topo (OpenTopoMap)': L.tileLayer('https://{{s}}.tile.opentopomap.org/{{z}}/{{x}}/{{y}}.png',
    {{maxZoom: 17, attribution: '&copy; OpenStreetMap &copy; OpenTopoMap'}}),
}};
layers['Satellite (Esri)'].addTo(map);
L.control.layers(layers).addTo(map);
const tracks = {json.dumps(tracks)};
tracks.forEach(t => L.polyline(t, {{color: '#0891b2', weight: 2}}).addTo(map));
</script></body></html>"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)


if __name__ == "__main__":
    raw = load_raw(RAW_FILE)
    print(f"Position reports in recording: {len(raw)}")
    moved, info = relocate(raw) if not raw.empty else (raw, None)
    if moved.empty:
        print(f"No ships found in '{SOURCE_REGION}'. Record longer, then try again.")
    else:
        out = to_contract(moved)
        out.to_parquet(OUT_PARQUET, index=False)
        write_preview(out, OUT_PREVIEW)
        span = pd.to_datetime(out["timestamp"])
        print(f"Lane direction in Dover: {info['source_axis']} deg, rotated by {info['rotation']} deg")
        print(f"Dropped: {info['ships_dropped_as_crossers']} crossing ships, "
              f"{info['points_outside_corridor']} points outside the lane")
        print(f"Saved {len(out)} points, {out['track_id'].nunique()} ships, "
              f"{span.min():%H:%M} -> {span.max():%H:%M} UTC")
        print(f"  -> {OUT_PARQUET}")
        print(f"  -> {OUT_PREVIEW}   (open it in a browser to check)")
