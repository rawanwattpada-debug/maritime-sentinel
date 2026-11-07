"""
Record live AIS ship positions from aisstream.io to a file.

Run:   python record_ais.py
Stop:  Ctrl + C   (everything recorded so far stays in the file)

Output: data/raw/ais_raw.jsonl  (one JSON message per line, appended)
Needs:  a .env file with  AISSTREAM_KEY=...
"""

import asyncio
import json
import os
import time
from datetime import datetime

import websockets
from dotenv import load_dotenv

load_dotenv()
API_KEY = os.getenv("AISSTREAM_KEY")

URL = "wss://stream.aisstream.io/v0/stream"
OUT_FILE = "data/raw/ais_raw.jsonl"

# The three candidate demo areas: name -> [[lat_min, lon_min], [lat_max, lon_max]]
REGIONS = {
    "bab_el_mandeb": [[12.0, 42.5], [13.5, 44.0]],
    "jeddah":        [[21.2, 38.8], [21.8, 39.3]],
    "jubail":        [[26.8, 49.5], [27.5, 50.3]],
}

STATUS_EVERY_SEC = 60


def region_of(lat, lon):
    for name, ((lat_min, lon_min), (lat_max, lon_max)) in REGIONS.items():
        if lat_min <= lat <= lat_max and lon_min <= lon <= lon_max:
            return name
    return None


async def record():
    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    ships = {name: set() for name in REGIONS}   # unique ships (MMSI) seen per region
    total = 0
    started = time.time()
    last_status = started

    print(f"Recording to {OUT_FILE}  (press Ctrl + C to stop)")

    while True:
        try:
            async with websockets.connect(URL) as ws:
                # aisstream closes the connection if this is not sent within 3 seconds
                await ws.send(json.dumps({
                    "APIKey": API_KEY,
                    "BoundingBoxes": list(REGIONS.values()),
                    "FilterMessageTypes": ["PositionReport"],
                }))
                print("Connected. Waiting for ships...")

                with open(OUT_FILE, "a", encoding="utf-8") as f:
                    async for raw in ws:
                        if isinstance(raw, bytes):
                            raw = raw.decode("utf-8")
                        msg = json.loads(raw)

                        if "error" in msg:
                            print("aisstream error:", msg["error"])
                            print("Check the key in your .env file.")
                            return

                        f.write(raw.strip() + "\n")
                        f.flush()
                        total += 1

                        meta = msg.get("MetaData", {})
                        region = region_of(meta.get("latitude", 0), meta.get("longitude", 0))
                        if region:
                            ships[region].add(meta.get("MMSI"))

                        now = time.time()
                        if now - last_status >= STATUS_EVERY_SEC:
                            last_status = now
                            minutes = (now - started) / 60
                            print(f"\n[{datetime.now():%H:%M}] running {minutes:.0f} min | messages saved: {total}")
                            for name, mmsis in ships.items():
                                print(f"   {name:<14} {len(mmsis):>4} ships")

        except (websockets.WebSocketException, OSError) as e:
            print(f"Connection lost ({e}). Reconnecting in 5 seconds...")
            await asyncio.sleep(5)


if __name__ == "__main__":
    if not API_KEY:
        print("AISSTREAM_KEY not found. Create a .env file with:  AISSTREAM_KEY=your_key")
    else:
        try:
            asyncio.run(record())
        except KeyboardInterrupt:
            print("\nStopped. Everything recorded so far is saved in", OUT_FILE)
