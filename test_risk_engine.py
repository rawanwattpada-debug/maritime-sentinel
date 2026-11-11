"""اختبار محرك الخطورة على سيناريوهات اصطناعية. التشغيل: python test_risk_engine.py"""
import math

import numpy as np
import pandas as pd

from risk_engine import RiskEngine, cpa_tcpa, bearing_deg

OWN = dict(lat=12.60, lon=43.30, sog_kn=5.0, cog_deg=0.0)
T0 = pd.Timestamp("2026-11-10T08:00:00Z")
STEP_S, N_STEPS = 10, 60  # 10 دقائق


def xy_to_ll(x, y):
    return OWN["lat"] + y / 60.0, OWN["lon"] + x / (60.0 * math.cos(math.radians(OWN["lat"])))


def track(tid, x0, y0, speed_fn, heading_fn, source="radar_sim", label=""):
    rows, x, y = [], x0, y0
    for k in range(N_STEPS):
        sog, cog = speed_fn(k), heading_fn(k, x, y)
        lat, lon = xy_to_ll(x, y)
        rows.append(dict(timestamp=T0 + pd.Timedelta(seconds=k * STEP_S), track_id=tid, lat=lat, lon=lon,
                         sog_kn=sog, cog_deg=cog % 360, source=source,
                         mmsi=(tid.split("_")[1] if source == "ais" else None), label=label))
        x += sog * math.sin(math.radians(cog)) * STEP_S / 3600.0
        y += sog * math.cos(math.radians(cog)) * STEP_S / 3600.0
    return rows


def toward_ship(k, x, y):
    return bearing_deg(-x, -y)


def own_drift_y(k):  # سفينتنا تتحرك شمالاً 5 عقد
    return OWN["lat"] + 0  # نخليها ثابتة (own_ship ثابت في المحرك)


def scenario_fishing(rng):
    rows = []
    for i in range(6):
        ang = rng.uniform(0, 2 * math.pi)
        x0, y0 = 5 * math.sin(ang), 5 * math.cos(ang)
        hd = {"h": rng.uniform(0, 360)}

        def hf(k, x, y, hd=hd):
            hd["h"] += rng.normal(0, 40)
            return hd["h"]

        rows += track(f"sim_f{i}", x0, y0, lambda k: rng.uniform(0.5, 3.5), hf, label="fishing_cluster")
    return rows


def scenario_single_approach():
    return track("sim_a1", 0.0, 6.0, lambda k: 25.0, toward_ship, label="single_approach")


def scenario_coordinated():
    rows = []
    for i, b in enumerate((10, 130, 250)):
        r = math.radians(b)
        rows += track(f"sim_c{i}", 6 * math.sin(r), 6 * math.cos(r), lambda k: 24.0, toward_ship, label="coordinated_attack")
    return rows


def scenario_normal_ais():
    return track("ais_412345678", -8.0, 3.0, lambda k: 14.0, lambda k, x, y: 90.0, source="ais", label="")


def run(rows):
    eng = RiskEngine(own_ship=OWN, model_path="models/does_not_exist.joblib")
    out = eng.score_all(pd.DataFrame(rows))
    return out


def summarize(name, out, expect):
    last = out.sort_values("timestamp").groupby("track_id").tail(1)
    peak = out.groupby("track_id")["score"].max()
    levels = last["level"].tolist()
    ok = all(l == expect for l in levels)
    print(f"[{'OK ' if ok else 'FAIL'}] {name:<18} متوقع={expect:<6} آخر مستوى={levels} أعلى درجة={peak.to_dict()}")
    print("      سبب:", last["reasons"].iloc[0])
    return ok


if __name__ == "__main__":
    # CPA/TCPA يدوي: هدف على بعد 5 ميل شرقاً يتجه غرباً 10 عقد، سفينتنا ساكنة -> CPA=0, TCPA=30 دقيقة
    cpa, tcpa = cpa_tcpa((5, 0), (-10, 0))
    assert abs(cpa) < 1e-6 and abs(tcpa - 30) < 1e-6, (cpa, tcpa)
    # هدف على بعد 5 شرقاً و1 شمالاً يتجه غرباً 10 عقد -> CPA=1, TCPA=30
    cpa, tcpa = cpa_tcpa((5, 1), (-10, 0))
    assert abs(cpa - 1) < 1e-6 and abs(tcpa - 30) < 1e-6, (cpa, tcpa)
    print("[OK ] CPA/TCPA تطابق الحساب اليدوي")

    rng = np.random.default_rng(1)
    results = [
        summarize("مرور AIS عادي", run(scenario_normal_ais()), "LOW"),
        summarize("تجمع صيد", run(scenario_fishing(rng)), "LOW"),
        summarize("اقتراب منفرد", run(scenario_single_approach()), "HIGH"),
        summarize("هجوم منسق", run(scenario_coordinated()), "HIGH"),
    ]
    print("\nالنتيجة:", "كل الاختبارات نجحت" if all(results) else "فيه اختبار فاشل")
