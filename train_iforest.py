"""
train_iforest.py - تدريب Isolation Forest على حركة NOAA الطبيعية (العضوة 3)

التشغيل:
    python train_iforest.py                       # يقرأ data/ais_noaa_clean.parquet
    python train_iforest.py --data path.parquet --out models/iforest.joblib

الملف يتعرف تلقائياً على أسماء الأعمدة الشائعة في NOAA وفي عقد البيانات.
لو أسماء أعمدتك مختلفة عدّلي COLUMN_ALIASES.
"""
import argparse
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from risk_engine import IF_FEATURES

COLUMN_ALIASES = {
    "timestamp": ["timestamp", "basedatetime", "base_date_time", "time", "datetime"],
    "id": ["mmsi", "track_id", "vessel_id"],
    "sog": ["sog_kn", "sog", "speed"],
    "cog": ["cog_deg", "cog", "course"],
}


def pick(df, key):
    lower = {c.lower(): c for c in df.columns}
    for name in COLUMN_ALIASES[key]:
        if name in lower:
            return lower[name]
    raise KeyError(f"ما لقيت عمود '{key}'. الأعمدة الموجودة: {list(df.columns)}")


def build_features(df: pd.DataFrame, min_dt=30, max_dt=600) -> pd.DataFrame:
    t, i, s, c = (pick(df, k) for k in ("timestamp", "id", "sog", "cog"))
    d = df[[t, i, s, c]].rename(columns={t: "t", i: "id", s: "sog", c: "cog"}).dropna()
    d["t"] = pd.to_datetime(d["t"], utc=True)
    d = d[(d["sog"] >= 0) & (d["sog"] < 60) & (d["cog"] >= 0) & (d["cog"] <= 360)]  # 511 وأمثالها = غير متاح
    d = d.sort_values(["id", "t"])
    g = d.groupby("id")
    d["dt"] = g["t"].diff().dt.total_seconds()
    d["dsog"] = g["sog"].diff()
    d["dcog"] = (g["cog"].diff() + 180.0) % 360.0 - 180.0
    d = d[(d["dt"] >= min_dt) & (d["dt"] <= max_dt)].copy()
    per_min = 60.0 / d["dt"]
    out = pd.DataFrame(
        {
            "sog": d["sog"],
            "abs_dsog_per_min": d["dsog"].abs() * per_min,
            "abs_dcog_per_min": d["dcog"].abs() * per_min,
        }
    )
    return out[IF_FEATURES].replace([np.inf, -np.inf], np.nan).dropna()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/ais_noaa_clean.parquet")
    ap.add_argument("--out", default="models/iforest.joblib")
    ap.add_argument("--max-rows", type=int, default=500_000)
    a = ap.parse_args()

    df = pd.read_parquet(a.data)
    print("أعمدة الملف:", list(df.columns), "| الصفوف:", len(df))
    X = build_features(df)
    print("صفوف التدريب بعد التنظيف:", len(X))
    if len(X) > a.max_rows:
        X = X.sample(a.max_rows, random_state=0)

    model = IsolationForest(n_estimators=200, contamination="auto", random_state=0, n_jobs=-1)
    model.fit(X.values)

    # نطبّع الدرجة إلى 0..1: الوسيط = طبيعي (0)، المئين 99.5 = شاذ جداً (1)
    raw = -model.score_samples(X.values)
    lo, hi = float(np.percentile(raw, 50)), float(np.percentile(raw, 99.5))

    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "lo": lo, "hi": hi, "features": IF_FEATURES}, a.out)
    print(f"تم الحفظ: {a.out}  (lo={lo:.3f}, hi={hi:.3f})")


if __name__ == "__main__":
    main()
