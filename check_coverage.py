"""
How many ships per hour did each region get?  Used to pick the demo area.

Run:  python check_coverage.py
Reads data/raw/ais_raw.jsonl (works while record_ais.py is still running).
Rule from the plan: fewer than 20 ships per hour = weak coverage.
"""

import json
from datetime import datetime

from record_ais import OUT_FILE, REGIONS, region_of

ships = {name: set() for name in REGIONS}
first = last = None

with open(OUT_FILE, encoding="utf-8") as f:
    for line in f:
        try:
            meta = json.loads(line)["MetaData"]
        except (json.JSONDecodeError, KeyError):
            continue
        # time_utc looks like "2026-11-10 08:00:00.123456789 +0000 UTC"
        t = datetime.fromisoformat(meta["time_utc"][:19])
        first = t if first is None or t < first else first
        last = t if last is None or t > last else last
        region = region_of(meta.get("latitude", 0), meta.get("longitude", 0))
        if region:
            ships[region].add(meta["MMSI"])

if first is None:
    print("No data yet. Run record_ais.py first.")
else:
    hours = max((last - first).total_seconds() / 3600, 1 / 60)
    print(f"Recorded period: {first:%H:%M} -> {last:%H:%M} UTC  ({hours * 60:.0f} min)\n")
    for name, mmsis in ships.items():
        per_hour = len(mmsis) / max(hours, 1)
        verdict = "OK" if per_hour >= 20 else "WEAK"
        print(f"   {name:<14} {len(mmsis):>4} ships  ({per_hour:.0f}/hour)  -> {verdict}")
    if hours < 1:
        print("\n(Less than an hour recorded: numbers are ships so far, not per hour.)")
