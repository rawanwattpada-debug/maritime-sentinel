"""
Clean one day of NOAA Marine Cadastre AIS data -> normal ship movement for training.

Member 3 trains the anomaly model (Isolation Forest) on this: it learns what NORMAL
movement looks like (speeds, turns, spacing), which does not depend on the location,
so this data is NOT moved to the Red Sea.

1. Download ONE day (2024 format, a .zip with one CSV inside) from:
   https://coast.noaa.gov/htdata/CMSP/AISDataHandler/2024/index.html
   e.g. AIS_2024_01_15.zip  (~300 MB) and put it in data/raw/  (do not unzip it)
2. Run:   python clean_noaa.py data/raw/AIS_2024_01_15.zip
3. Output: data/ais_noaa_clean.parquet  (contract columns + vessel_type)

The file is read in chunks, so it works on a normal laptop.
"""

import sys

import numpy as np
import pandas as pd

OUT_FILE = "data/ais_noaa_clean.parquet"

# Los Angeles / Long Beach approaches: busy traffic lanes + fishing boats,
# similar mix to a strait. (lat_min, lat_max, lon_min, lon_max)
BOX = (33.40, 33.90, -118.60, -117.90)

NEEDED = ["MMSI", "BaseDateTime", "LAT", "LON", "SOG", "COG", "VesselType"]
CHUNK_ROWS = 500_000


def clean_chunk(c):
    lat_min, lat_max, lon_min, lon_max = BOX
    c = c[c["LAT"].between(lat_min, lat_max) & c["LON"].between(lon_min, lon_max)]
    c = c[c["MMSI"].between(100_000_000, 999_999_999)]          # real 9-digit MMSI
    c = c[c["SOG"].between(0, 50)]                               # 102.3 = not available
    c = c.copy()
    c.loc[~c["COG"].between(0, 359.9), "COG"] = np.nan           # 360 = not available
    return c


def main(path):
    parts, total = [], 0
    for i, chunk in enumerate(pd.read_csv(path, usecols=NEEDED, chunksize=CHUNK_ROWS)):
        total += len(chunk)
        parts.append(clean_chunk(chunk))
        print(f"  read {total:,} rows...", end="\r")
    df = pd.concat(parts, ignore_index=True)
    print(f"\nRows in the file: {total:,}   inside the area: {len(df):,}")

    t = pd.to_datetime(df["BaseDateTime"], utc=True)
    out = pd.DataFrame({
        "timestamp": t.dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "track_id": "ais_" + df["MMSI"].astype(str),
        "lat": df["LAT"].round(5),
        "lon": df["LON"].round(5),
        "sog_kn": df["SOG"].round(1),
        "cog_deg": df["COG"].round(1),
        "source": "ais",
        "mmsi": df["MMSI"].astype(str),
        "label": "",
        "vessel_type": df["VesselType"],   # extra: 30 = fishing, 70-79 cargo, 80-89 tanker
    })
    out = (out.drop_duplicates(["track_id", "timestamp"])
              .sort_values(["track_id", "timestamp"])
              .reset_index(drop=True))
    out.to_parquet(OUT_FILE, index=False)

    fishing = out.loc[out["vessel_type"] == 30, "track_id"].nunique()
    print(f"Saved {len(out):,} points, {out['track_id'].nunique()} ships "
          f"({fishing} fishing boats) -> {OUT_FILE}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python clean_noaa.py data/raw/AIS_2024_01_15.zip")
    else:
        main(sys.argv[1])
