"""
risk_engine.py  -  محرك الخطورة (العضوة 3)

المدخل : صفوف المسارات بصيغة العقد المشترك
         timestamp,track_id,lat,lon,sog_kn,cog_deg,source,mmsi,label
المخرج : timestamp,track_id,score,level,reasons

الاستخدام:
    engine = RiskEngine(own_ship=dict(lat=12.60, lon=43.30, sog_kn=12, cog_deg=0))
    out = engine.update(batch_df)          # batch = نقاط لحظة واحدة (أو عدة لحظات)
    out = engine.score_all(full_df)        # للتقييم evaluate.py على ملف كامل

كل الأرقام في CONFIG افتراضات بداية، تتعدل من مكان واحد.
"""
from __future__ import annotations

import math
from collections import defaultdict, deque
from pathlib import Path

import numpy as np
import pandas as pd

# ----------------------------------------------------------------------------
# الإعدادات (غيّريها هنا فقط)
# ----------------------------------------------------------------------------
CONFIG = {
    # مستويات التنبيه
    "level_medium": 40,
    "level_high": 70,
    # أوزان القواعد (المجموع الأقصى للقواعد 85، ونموذج الشذوذ يضيف حتى 15)
    "w_no_ais": 15,
    "w_approach": 25,       # الاتجاه نحو السفينة
    "w_speed": 15,          # سرعة عالية أثناء الاقتراب
    "w_cpa": 20,            # أقرب اقتراب قريب وقريب بالزمن
    "w_turn": 15,           # تغيّر اتجاه مفاجئ نحو السفينة
    "w_coord": 15,          # تنسيق مع أهداف أخرى
    "w_iforest": 15,
    "rules_cap": 85,
    "ais_discount": 0.5,    # الهدف اللي معه AIS تُخفَّض قواعده (نربط الغياب بالنية)
    # حدود
    "approach_heading_deg": 30,   # الهدف "متجه للسفينة" لو انحرافه أقل من هذا
    "fast_kn": 20,
    "medium_fast_kn": 15,
    "cpa_close_nm": 0.5,
    "cpa_mid_nm": 1.0,
    "tcpa_close_min": 10,
    "tcpa_mid_min": 20,
    "turn_deg": 30,               # تغيّر اتجاه خلال turn_window_s
    "turn_window_s": 120,
    "sustain_s": 60,              # لازم يستمر الاقتراب قبل HIGH
    "coord_range_nm": 6,
    "coord_min_bearing_gap_deg": 45,
    "history_len": 60,            # عدد النقاط المحفوظة لكل مسار
    "min_dt_s": 30,               # أقل فرق زمني لحساب معدّلات التغيّر للنموذج
    "max_range_nm": 12,           # أبعد من هذا الهدف ما يُعتبر تهديداً مباشراً
    "min_threat_kn": 6,           # أبطأ من هذا (صيد/تعويم) ما يُعدّ اقتراباً عدائياً
    "approach_cpa_nm": 2.0,       # لازم مساره فعلاً يمر قريباً من السفينة
    "sustain_tolerance_nm": 0.05, # تذبذب الموقع (خطأ الرادار ~90 م) ما يقطع "الاقتراب المتواصل"
    "level_hold_s": 30,           # التنبيه يطلع فوراً، بس ما ينزل إلا إذا ظل أقل 30 ثانية (يمنع الرمش)
}

DEFAULT_MODEL_PATH = Path("models/iforest.joblib")
COLS = ["timestamp", "track_id", "lat", "lon", "sog_kn", "cog_deg", "source", "mmsi"]


# ----------------------------------------------------------------------------
# هندسة: إسقاط محلي + CPA/TCPA
# ----------------------------------------------------------------------------
def to_xy_nm(lat, lon, lat0, lon0):
    """إسقاط إلى ميل بحري (x شرق، y شمال) حول نقطة مرجعية."""
    x = (lon - lon0) * 60.0 * math.cos(math.radians(lat0))
    y = (lat - lat0) * 60.0
    return x, y


def velocity_nm_per_h(sog_kn, cog_deg):
    r = math.radians(cog_deg)
    return sog_kn * math.sin(r), sog_kn * math.cos(r)


def cpa_tcpa(rel_pos, rel_vel):
    """
    rel_pos: موقع الهدف نسبةً لسفينتنا (nm)
    rel_vel: سرعة الهدف نسبةً لسفينتنا (kn)
    يرجع (cpa_nm, tcpa_min). tcpa سالب = الاقتراب انتهى (ابتعد).
    """
    px, py = rel_pos
    vx, vy = rel_vel
    v2 = vx * vx + vy * vy
    if v2 < 1e-9:
        return math.hypot(px, py), float("inf")
    t_h = -(px * vx + py * vy) / v2
    cx, cy = px + vx * t_h, py + vy * t_h
    return math.hypot(cx, cy), t_h * 60.0


def angle_diff(a, b):
    """أصغر فرق بين اتجاهين بالدرجات (0..180)."""
    return abs((a - b + 180.0) % 360.0 - 180.0)


def bearing_deg(dx, dy):
    return (math.degrees(math.atan2(dx, dy)) + 360.0) % 360.0


# ----------------------------------------------------------------------------
# مزايا نموذج الشذوذ: نفس الدالة تُستخدم في التدريب وفي التشغيل
# ----------------------------------------------------------------------------
IF_FEATURES = ["sog", "abs_dsog_per_min", "abs_dcog_per_min"]


def kinematic_features(sog, dsog, dcog, dt_s):
    """sog بالعقدة، dsog تغيّر السرعة، dcog تغيّر الاتجاه (درجة، ملفوف)، dt بالثواني."""
    per_min = 60.0 / max(dt_s, 1e-6)
    return [float(sog), abs(dsog) * per_min, abs(dcog) * per_min]


class AnomalyScorer:
    """غلاف حول IsolationForest المُدرَّب على حركة NOAA الطبيعية."""

    def __init__(self, path=DEFAULT_MODEL_PATH):
        self.model = None
        self.lo, self.hi = 0.0, 1.0
        p = Path(path)
        if p.exists():
            import joblib

            bundle = joblib.load(p)
            self.model = bundle["model"]
            self.lo, self.hi = bundle["lo"], bundle["hi"]

    @property
    def available(self):
        return self.model is not None

    def score01(self, feats):
        """0 = طبيعي، 1 = شاذ جداً."""
        if not self.available:
            return 0.0
        raw = -float(self.model.score_samples(np.array([feats]))[0])
        return float(np.clip((raw - self.lo) / max(self.hi - self.lo, 1e-9), 0.0, 1.0))


# ----------------------------------------------------------------------------
# المحرك
# ----------------------------------------------------------------------------
class RiskEngine:
    def __init__(self, own_ship=None, own_track_id="own", model_path=DEFAULT_MODEL_PATH, config=None):
        """
        own_ship: dict(lat, lon, sog_kn, cog_deg) ثابت. لو سفينتنا موجودة كمسار
                  في البيانات باسم own_track_id نستخدم موقعها الفعلي بدلاً منه.
        """
        self.cfg = {**CONFIG, **(config or {})}
        self.own_fixed = own_ship
        self.own_track_id = own_track_id
        self.scorer = AnomalyScorer(model_path)
        self.hist = defaultdict(lambda: deque(maxlen=self.cfg["history_len"]))
        self.own_now = dict(own_ship) if own_ship else None
        self.alert = {}  # track_id -> (آخر مستوى, آخر وقت كان فيه بهذا المستوى أو أعلى)

    # ---- واجهة عامة ------------------------------------------------------
    def update(self, batch: pd.DataFrame) -> pd.DataFrame:
        """يستقبل نقاطاً جديدة (يفضّل لحظة واحدة) ويرجع تقييم كل هدف فيها."""
        batch = batch.copy()
        batch["timestamp"] = pd.to_datetime(batch["timestamp"], utc=True)
        batch = batch.sort_values("timestamp")

        # حدّثي موقع سفينتنا والتاريخ أولاً
        for r in batch.itertuples(index=False):
            self.hist[r.track_id].append(r)
            if r.track_id == self.own_track_id:
                self.own_now = dict(lat=r.lat, lon=r.lon, sog_kn=r.sog_kn, cog_deg=r.cog_deg)
        if self.own_now is None:
            raise ValueError("لازم own_ship أو مسار باسم own_track_id")

        out = []
        for tid in batch["track_id"].unique():
            if tid == self.own_track_id:
                continue
            ts = batch.loc[batch["track_id"] == tid, "timestamp"].iloc[-1]
            out.append(self._score_track(tid, ts, batch))
        return pd.DataFrame(out, columns=["timestamp", "track_id", "score", "level", "reasons"])

    def score_all(self, df: pd.DataFrame, step_s=None) -> pd.DataFrame:
        """للتقييم: يمر على الملف كله بالترتيب الزمني، لحظة بلحظة."""
        df = df.copy()
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
        results = []
        for _, g in df.sort_values("timestamp").groupby("timestamp", sort=True):
            res = self.update(g)
            if len(res):
                results.append(res)
        return pd.concat(results, ignore_index=True) if results else pd.DataFrame(
            columns=["timestamp", "track_id", "score", "level", "reasons"]
        )

    # ---- المزايا ----------------------------------------------------------
    def _features(self, tid, now_batch):
        c = self.cfg
        pts = list(self.hist[tid])
        cur = pts[-1]
        own = self.own_now
        x, y = to_xy_nm(cur.lat, cur.lon, own["lat"], own["lon"])
        rng = math.hypot(x, y)
        brg_to_ship = bearing_deg(-x, -y)                      # من الهدف إلى سفينتنا
        head_err = angle_diff(cur.cog_deg, brg_to_ship)

        tvx, tvy = velocity_nm_per_h(cur.sog_kn, cur.cog_deg)
        ovx, ovy = velocity_nm_per_h(own["sog_kn"], own["cog_deg"])
        cpa, tcpa = cpa_tcpa((x, y), (tvx - ovx, tvy - ovy))

        # سرعة الاقتراب (موجبة = يقترب)
        closing = -((x * (tvx - ovx) + y * (tvy - ovy)) / rng) if rng > 1e-6 else 0.0

        # مدة الاقتراب المتواصل: نمشي للخلف طالما المسافة تنقص
        sustain_s = 0.0
        prev_rng, prev_t = rng, cur.timestamp
        for p in reversed(pts[:-1]):
            px, py = to_xy_nm(p.lat, p.lon, own["lat"], own["lon"])
            r = math.hypot(px, py)
            if r > prev_rng - c["sustain_tolerance_nm"]:   # كانت أبعد (أو نفس المسافة ضمن خطأ القياس) = ما زال يقترب
                sustain_s += (prev_t - p.timestamp).total_seconds()
                prev_rng, prev_t = r, p.timestamp
            else:
                break

        # تغيّر الاتجاه خلال النافذة
        turn_deg = 0.0
        for p in reversed(pts[:-1]):
            if (cur.timestamp - p.timestamp).total_seconds() >= c["turn_window_s"]:
                turn_deg = angle_diff(cur.cog_deg, p.cog_deg)
                head_err_before = angle_diff(p.cog_deg, brg_to_ship)
                break
        else:
            head_err_before = head_err
        # قارب شبه واقف اتجاهه عشوائي (انجراف)، فما نعتبر "تغيّر الاتجاه" إلا لو يتحرك فعلاً
        turned_toward = (turn_deg >= c["turn_deg"] and head_err <= c["approach_heading_deg"] < head_err_before
                         and cur.sog_kn >= c["min_threat_kn"])

        # ميزات نموذج الشذوذ (من آخر نقطة بعيدة min_dt_s)
        if_feats, accel = None, 0.0
        for p in reversed(pts[:-1]):
            dt = (cur.timestamp - p.timestamp).total_seconds()
            if dt >= c["min_dt_s"]:
                dcog = (cur.cog_deg - p.cog_deg + 180.0) % 360.0 - 180.0
                if_feats = kinematic_features(cur.sog_kn, cur.sog_kn - p.sog_kn, dcog, dt)
                accel = cur.sog_kn - p.sog_kn
                break

        is_dark = (cur.source != "ais") or pd.isna(getattr(cur, "mmsi", np.nan)) or cur.mmsi in ("", None)
        return dict(
            rng=rng, brg=brg_to_ship, head_err=head_err, cpa=cpa, tcpa=tcpa, closing=closing,
            sustain_s=sustain_s, turned_toward=turned_toward, turn_deg=turn_deg,
            sog=cur.sog_kn, is_dark=bool(is_dark), if_feats=if_feats, accel=accel, x=x, y=y,
        )

    def _coordination(self, tid, f, now_batch):
        """عدد الأهداف المظلمة الأخرى المقتربة من اتجاهات مختلفة."""
        c = self.cfg
        n = 0
        for other in now_batch["track_id"].unique():
            if other in (tid, self.own_track_id):
                continue
            if not self.hist[other]:
                continue
            g = self._features(other, now_batch)
            if not g["is_dark"] or g["rng"] > c["coord_range_nm"]:
                continue
            approaching = (
                g["closing"] > 1.0
                and g["head_err"] <= c["approach_heading_deg"] * 1.5
                and g["sog"] >= c["min_threat_kn"]
            )
            if approaching and angle_diff(g["brg"], f["brg"]) >= c["coord_min_bearing_gap_deg"]:
                n += 1
        return n

    # ---- التسجيل ------------------------------------------------------------
    def _score_track(self, tid, ts, now_batch):
        c = self.cfg
        f = self._features(tid, now_batch)
        score, reasons = 0.0, []

        approaching = (
            f["closing"] > 1.0
            and f["head_err"] <= c["approach_heading_deg"]
            and f["rng"] <= c["max_range_nm"]
            and f["sog"] >= c["min_threat_kn"]
            and f["cpa"] <= c["approach_cpa_nm"]
        )

        if f["is_dark"]:
            score += c["w_no_ais"]
            reasons.append("بدون AIS")

        if approaching:
            score += c["w_approach"]
            reasons.append("يتجه نحو السفينة")
            if f["sog"] > c["fast_kn"]:
                score += c["w_speed"]
                reasons.append(f"سرعة عالية ({f['sog']:.0f} عقدة)")
            elif f["sog"] > c["medium_fast_kn"]:
                score += c["w_speed"] * 0.5
                reasons.append(f"سرعة مرتفعة ({f['sog']:.0f} عقدة)")

        if f["tcpa"] > 0 and f["rng"] <= c["max_range_nm"] and f["sog"] >= c["min_threat_kn"]:
            if f["cpa"] < c["cpa_close_nm"] and f["tcpa"] < c["tcpa_close_min"]:
                score += c["w_cpa"]
                reasons.append(f"أقرب اقتراب {f['cpa']:.1f} ميل بعد {f['tcpa']:.0f} دقائق")
            elif f["cpa"] < c["cpa_mid_nm"] and f["tcpa"] < c["tcpa_mid_min"]:
                score += c["w_cpa"] * 0.5
                reasons.append(f"أقرب اقتراب {f['cpa']:.1f} ميل بعد {f['tcpa']:.0f} دقيقة")

        if f["turned_toward"]:
            score += c["w_turn"]
            reasons.append(f"غيّر اتجاهه ({f['turn_deg']:.0f}°) نحو السفينة")

        if f["is_dark"] and approaching:
            n_other = self._coordination(tid, f, now_batch)
            if n_other >= 1:
                score += c["w_coord"]
                reasons.append(f"{n_other + 1} أهداف بدون AIS تتقارب من اتجاهات مختلفة")

        score = min(score, c["rules_cap"])
        if not f["is_dark"]:
            score *= c["ais_discount"]

        # نموذج الشذوذ: مؤشر ثانوي
        if f["if_feats"] is not None and self.scorer.available:
            a = self.scorer.score01(f["if_feats"])
            score += c["w_iforest"] * a
            if a > 0.7:
                reasons.append("حركة غير معتادة مقارنة بالحركة الطبيعية")

        # شرط الاستمرار: ما نصعد إلى HIGH إلا بعد اقتراب متواصل
        if score >= c["level_high"] and f["sustain_s"] < c["sustain_s"]:
            score = c["level_high"] - 1
            reasons.append("اقتراب لم يستمر بعد (ننتظر التأكيد)")

        score = int(round(min(score, 100)))
        level = "HIGH" if score >= c["level_high"] else "MEDIUM" if score >= c["level_medium"] else "LOW"

        # ثبات التنبيه: المستوى يطلع فوراً، وما ينزل إلا بعد level_hold_s من آخر مرة كان فيها أعلى
        rank = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}
        prev = self.alert.get(tid)
        if prev and rank[level] < rank[prev[0]] and (ts - prev[1]).total_seconds() < c["level_hold_s"]:
            level = prev[0]
            score = max(score, c["level_high"] if level == "HIGH" else c["level_medium"])
            reasons.append("نبقي التنبيه حتى نتأكد من زوال الخطر")
        else:
            self.alert[tid] = (level, ts)

        if level == "LOW" and not approaching:
            reasons = ["بدون AIS | حركة بطيئة وعشوائية بدون اتجاه نحو السفينة"] if f["is_dark"] \
                else ["سفينة بـ AIS على مسار اعتيادي"]

        return dict(timestamp=ts, track_id=tid, score=score, level=level, reasons=" | ".join(reasons))
