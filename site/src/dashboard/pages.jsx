import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Anchor, CheckCircle2, Eye, MapPin, Radio, ShieldAlert, Ship, Target, Video, XCircle,
  Navigation, Gauge, Crosshair, Clock,
} from 'lucide-react';
import { LEVEL_AR, fmtRange, fmtTime, isDark } from '../data/useDemo';
import { VIEWS } from '../map/MapStage';

// ---------------------------------------------------------------- small pieces

export function targetName(p) {
  if (!p) return '—';
  if (p.source === 'own') return 'سفينتنا';
  if (p.source === 'ais') return `سفينة ${p.mmsi}`;
  if (p.source === 'radar') return p.fusion === 'tentative' ? `هدف رادار ${p.track_id} (قيد التحقق)` : `هدف مظلم ${p.track_id}`;
  const n = (p.track_id.match(/(\d+)$/) || [, '?'])[1];
  const kind = p.label === 'fishing_cluster' ? 'قارب' : 'هدف';
  return `${kind} بدون AIS #${Number(n) + 1}`;
}

const LEVEL_STYLE = {
  HIGH: 'border-danger/60 bg-danger/15 text-danger',
  MEDIUM: 'border-amber/60 bg-amber/15 text-amber',
  LOW: 'border-safe/50 bg-safe/10 text-safe',
};

export function LevelPill({ level, score }) {
  if (!level) return null;
  return (
    <span className={`num inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-semibold ${LEVEL_STYLE[level]}`}>
      {LEVEL_AR[level]} {score != null && `· ${score}`}
    </span>
  );
}

function Panel({ title, icon: Icon, children, className = '', right }) {
  return (
    <div className={`glass pointer-events-auto rounded-xl p-4 ${className}`}>
      {title && (
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-display text-sm font-bold text-white">
            {Icon && <Icon size={16} className="text-sea" />} {title}
          </h3>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

function Kpi({ label, value, tone = 'text-white', note }) {
  return (
    <div className="glass pointer-events-auto min-w-0 flex-1 rounded-xl px-4 py-3">
      <p className="truncate text-[11px] text-muted">{label}</p>
      <p className={`num mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
      {note && <p className="mt-0.5 truncate text-[10px] text-muted">{note}</p>}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-white/5 p-2.5">
      <p className="text-[10px] text-muted">{label}</p>
      <p className="num mt-0.5 text-sm text-ink">{value}</p>
    </div>
  );
}

function flyTo(stage, p, setFollow) {
  if (!p) return;
  setFollow?.(false);
  stage.current?.fly({ ...VIEWS.dashboard, center: [p.lon, p.lat], zoom: 12.8, padding: { top: 0, bottom: 0, left: 380, right: 0 } }, 1400);
}

function AlertCard({ p, onInvestigate, onLocate }) {
  return (
    <div className={`rounded-lg border bg-abyss/60 p-3 ${p.level === 'HIGH' ? 'border-danger/40' : 'border-amber/30'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold text-white">{targetName(p)}</span>
        <LevelPill level={p.level} score={p.score} />
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink/85">{p.reasons?.join(' · ')}</p>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className="num text-muted">المسافة: {fmtRange(p.range_m)}</span>
        <span className="flex gap-3">
          <button onClick={onLocate} className="text-sea hover:underline">على الخريطة</button>
          <button onClick={onInvestigate} className="text-amber hover:underline">تحقيق ←</button>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 1. overview

export function OverviewPage({ demo, stage, alerts, onSelect, setTab, drone, decisions, setFollow }) {
  const ais = demo.points.filter((p) => p.source === 'ais').length;
  const confirmed = demo.points.filter((p) => p.source === 'ais' && p.radar_id).length;
  const dark = demo.points.filter((p) => isDark(p) && p.fusion !== 'tentative').length;
  const checking = demo.points.filter((p) => p.fusion === 'tentative').length;
  const fe = demo.meta.fusion_eval?.real_traffic;
  const high = alerts.filter((a) => a.level === 'HIGH').length;
  const med = alerts.filter((a) => a.level === 'MEDIUM').length;
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col gap-4 p-5 pb-28">
      <div className="flex gap-3">
        <Kpi label="سفن مسجلة (AIS)" value={ais} tone="text-sea" note={`${confirmed} منها أكّدها الرادار`} />
        <Kpi label="أهداف مظلمة اكتشفها الرادار" value={dark} tone={dark ? 'text-amber' : 'text-white'} note={checking ? `${checking} قيد التحقق` : 'لا تطابق أي سفينة AIS'} />
        <Kpi label="تنبيهات عالية" value={high} tone={high ? 'text-danger' : 'text-white'} />
        <Kpi label="تنبيهات متوسطة" value={med} tone={med ? 'text-amber' : 'text-white'} />
        <Kpi
          label="دقة مطابقة الرادار مع AIS"
          value={fe ? `${fe.registered_ships_correctly_identified_pct}%` : '—'}
          tone="text-teal"
          note={fe ? `على ${fe.registered_ships} سفينة حقيقية · إنذار كاذب ${fe.registered_ships_wrongly_flagged_dark_pct}%` : 'شغّلي evaluate_fusion.py'}
        />
      </div>
      <div className="flex min-h-0 flex-1 justify-end">
        <Panel title="التنبيهات الحالية" icon={ShieldAlert} className="flex w-[360px] flex-col overflow-hidden">
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto">
            {alerts.length === 0 && (
              <p className="py-6 text-center text-sm text-muted">لا توجد تنبيهات حاليًا. المراقبة مستمرة.</p>
            )}
            {alerts.map((p) => (
              <AlertCard
                key={p.track_id}
                p={p}
                onLocate={() => { onSelect(p.track_id); flyTo(stage, p, setFollow); }}
                onInvestigate={() => { onSelect(p.track_id); setTab('alert'); }}
              />
            ))}
          </div>
          {decisions.length > 0 && (
            <div className="mt-3 border-t border-line pt-2 text-[11px] text-muted">
              <p className="mb-1 font-semibold text-ink/80">قرارات المشغّل</p>
              {decisions.slice(0, 3).map((d, i) => (
                <p key={i}><span className="num">{fmtTime(d.t)}</span> · {d.target}: {d.action}</p>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 2. 3D monitor

export function MonitorPage({ demo, stage, selected, onSelect, setTab, setFollow }) {
  const top = selected || null;
  return (
    <div className="pointer-events-none absolute inset-0 flex justify-end gap-4 p-5 pb-28">
      <div className="flex w-[340px] flex-col gap-3">
        <Panel title="الهدف المحدد" icon={Target}>
          {!top && <p className="text-sm text-muted">اضغطي على أي سفينة أو هدف في الخريطة لعرض تفاصيله.</p>}
          {top && (
            <>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">{targetName(top)}</span>
                <LevelPill level={top.level} score={top.score} />
              </div>
              <p className="mt-1 text-[11px] text-muted">
                {top.source === 'own'
                  ? 'سفينتنا'
                  : top.source === 'ais'
                    ? (top.radar_id ? `يرسل AIS · أكّده الرادار (${top.radar_id})` : 'يرسل AIS · لم يلتقطه الرادار في هذه المسحة')
                    : top.fusion === 'tentative'
                      ? 'رادار فقط · جاري مطابقته مع سفن AIS'
                      : 'رادار فقط · لا يطابق أي سفينة AIS ← هدف مظلم'}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Stat label="السرعة" value={`${top.sog_kn ?? '—'} عقدة`} />
                <Stat label="الاتجاه" value={`${top.cog_deg != null ? Math.round(top.cog_deg) : '—'}°`} />
                <Stat label="المسافة" value={fmtRange(top.range_m)} />
                <Stat label="أقرب اقتراب" value={fmtRange(top.cpa_m)} />
              </div>
              {top.reasons && <p className="mt-3 text-xs leading-relaxed text-ink/85">{top.reasons.join(' · ')}</p>}
              <div className="mt-3 flex gap-2">
                <button onClick={() => flyTo(stage, top, setFollow)} className="flex-1 rounded-lg border border-sea/40 py-2 text-xs text-sea hover:bg-sea/10">
                  تتبّع على الخريطة
                </button>
                {isDark(top) && (
                  <button onClick={() => setTab('alert')} className="flex-1 rounded-lg border border-amber/40 py-2 text-xs text-amber hover:bg-amber/10">
                    فتح التحقيق
                  </button>
                )}
              </div>
            </>
          )}
        </Panel>
        <Panel title="مفتاح الخريطة" icon={MapPin}>
          <ul className="space-y-1.5 text-xs text-ink/85">
            <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-[#facc15]" /> سفينتنا</li>
            <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-sea" /> سفينة تجارية (AIS)</li>
            <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border border-sea" /> نقطة رادار طابقت سفينة AIS (مع خط)</li>
            <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-[#a78bfa]" /> هدف رادار قيد التحقق</li>
            <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-safe" /> بدون AIS · منخفض</li>
            <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-amber" /> بدون AIS · متوسط</li>
            <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-danger" /> بدون AIS · عالي</li>
            <li className="flex items-center gap-2 pt-1 text-muted">الحلقات: 500 م · 1 كم · 2 كم حول سفينتنا</li>
          </ul>
          <div className="mt-3 flex gap-2">
            <button onClick={() => setFollow(true)} className="flex-1 rounded-lg border border-line py-1.5 text-xs hover:border-sea/50">منظور 3D</button>
            <button onClick={() => stage.current?.fly({ pitch: 0, bearing: 0 }, 1200)} className="flex-1 rounded-lg border border-line py-1.5 text-xs hover:border-sea/50">من الأعلى</button>
            <button onClick={() => onSelect(null)} className="flex-1 rounded-lg border border-line py-1.5 text-xs hover:border-sea/50">إلغاء التحديد</button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 3. alert investigation

const FACTOR_WEIGHT = [
  ['بدون AIS', 25],
  ['يتجه نحو', 20],
  ['أقرب اقتراب', 25],
  ['سرعة عالية', 15],
  ['تتقارب', 20],
  ['على بعد', 30],
  ['حركة بطيئة', 0],
];
const weightOf = (r) => (FACTOR_WEIGHT.find(([k]) => r.includes(k)) || [, 10])[1];

function RangeChart({ series }) {
  if (series.length < 2) return <p className="text-xs text-muted">لا توجد بيانات كافية بعد.</p>;
  const W = 520, H = 130, maxR = Math.max(...series.map((d) => d.r), 1000);
  const x = (s) => ((s - series[0].s) / Math.max(1, series[series.length - 1].s - series[0].s)) * W;
  const y = (r) => H - (r / maxR) * H;
  const d = series.map((p, i) => `${i ? 'L' : 'M'}${x(p.s).toFixed(1)},${y(p.r).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" dir="ltr" role="img" aria-label="المسافة إلى سفينتنا مع الزمن">
      {[500, 1000, 2000].filter((r) => r < maxR).map((r) => (
        <g key={r}>
          <line x1="0" x2={W} y1={y(r)} y2={y(r)} stroke={r === 500 ? '#ef4444' : r === 1000 ? '#f5b547' : '#22d3ee'} strokeOpacity=".35" strokeDasharray="4 4" />
          <text x={W - 2} y={y(r) - 3} textAnchor="end" fontSize="9" fill="#8ba3bf">{r} m</text>
        </g>
      ))}
      <path d={d} fill="none" stroke="#f5b547" strokeWidth="2.5" />
      <circle cx={x(series[series.length - 1].s)} cy={y(series[series.length - 1].r)} r="4" fill="#ef4444" />
      <text x="0" y={H + 14} fontSize="9" fill="#8ba3bf">{series[0].t}</text>
      <text x={W} y={H + 14} textAnchor="end" fontSize="9" fill="#8ba3bf">{series[series.length - 1].t}</text>
    </svg>
  );
}

export function AlertPage({ demo, alerts, selected, onSelect, setTab, decide, decisions }) {
  const target = (selected && isDark(selected) ? selected : null) || alerts[0] || null;
  const track = target ? demo.tracks.get(target.track_id) : null;
  const events = (track?.events || []).filter((e) => e.sec <= demo.sec);
  const series = useMemo(() => {
    if (!target) return [];
    const out = [];
    for (let s = 0; s <= Math.floor(demo.sec); s += 1) {
      const p = demo.frames[s].points.find((q) => q.track_id === target.track_id);
      if (p?.range_m != null) out.push({ s, r: p.range_m, t: demo.frames[s].t.slice(11, 16) });
    }
    return out;
    // recompute about once a second
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.track_id, Math.floor(demo.sec)]);

  if (!target) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-8">
        <Panel className="max-w-md text-center">
          <CheckCircle2 className="mx-auto mb-2 text-safe" />
          <p className="text-ink">لا يوجد تنبيه نشط الآن.</p>
          <p className="mt-1 text-sm text-muted">الهجوم المنسّق يبدأ عند الثانية 45 من الحلقة.</p>
          <button onClick={() => { demo.seek(70); }} className="mt-4 rounded-lg border border-amber/50 px-4 py-2 text-sm text-amber hover:bg-amber/10">
            انتقل إلى لحظة الهجوم
          </button>
        </Panel>
      </div>
    );
  }
  const name = targetName(target);
  const decided = decisions.find((d) => d.target === name);
  return (
    <div className="absolute inset-0 overflow-y-auto p-5">
      <div className={`pointer-events-auto mb-4 flex items-center justify-between rounded-xl border p-5 ${target.level === 'HIGH' ? 'border-danger/50 bg-danger/10' : 'border-amber/40 bg-amber/10'}`}>
        <div className="flex items-center gap-4">
          <ShieldAlert size={34} className={target.level === 'HIGH' ? 'animate-pulse text-danger' : 'text-amber'} />
          <div>
            <div className="flex items-center gap-2"><LevelPill level={target.level} score={target.score} /><span className="text-xs text-muted">تنبيه نشط</span></div>
            <h1 className="mt-1 font-display text-xl font-extrabold text-white">{name}</h1>
            <p className="text-xs text-muted">على بعد {fmtRange(target.range_m)} من سفينتنا · السرعة {target.sog_kn ?? '—'} عقدة</p>
          </div>
        </div>
        <div className="text-left">
          <p className="text-[11px] text-muted">درجة الخطورة</p>
          <p className={`num text-4xl font-semibold ${target.level === 'HIGH' ? 'text-danger' : 'text-amber'}`}>{target.score}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-4">
          <Panel title="المسافة إلى سفينتنا" icon={Gauge}>
            <RangeChart series={series} />
          </Panel>
          <Panel title="تسلسل الأحداث" icon={Clock}>
            <ol className="relative mr-2 space-y-4 border-r-2 border-line pr-5">
              {events.map((e, i) => (
                <li key={i} className="relative">
                  <span className={`absolute -right-[27px] top-1 h-3 w-3 rounded-full ${e.level === 'HIGH' ? 'bg-danger' : e.level === 'MEDIUM' ? 'bg-amber' : 'bg-safe'}`} />
                  <p className="num text-[11px] text-sea">{fmtTime(e.t)}</p>
                  <p className="text-sm font-semibold text-white">المستوى: {LEVEL_AR[e.level]} ({e.score})</p>
                  <p className="text-xs text-ink/80">{e.reasons?.join(' · ')}</p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="لماذا هذا التنبيه؟" icon={AlertTriangle}>
            <div className="space-y-3">
              {target.reasons?.map((r) => (
                <div key={r}>
                  <div className="flex justify-between text-xs"><span className="text-ink">{r}</span><span className="num text-muted">+{weightOf(r)}</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-line">
                    <div className="h-full rounded-full bg-amber" style={{ width: `${Math.min(100, weightOf(r) * 3)}%` }} />
                  </div>
                </div>
              ))}
            </div>
            {demo.meta.risk_engine === 'interim' && <p className="mt-3 text-[10px] text-muted">قواعد تقييم مؤقتة إلى حين اكتمال محرك الخطورة.</p>}
          </Panel>
          <Panel title="قرار المشغّل" icon={Radio}>
            {decided && <p className="mb-2 rounded bg-white/5 p-2 text-xs text-sea">تم: {decided.action}</p>}
            <div className="space-y-2">
              <button onClick={() => setTab('drone')} className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-l from-sea to-teal py-2.5 text-sm font-bold text-abyss">
                <Eye size={16} /> طلب تحقق بالمسيّرة
              </button>
              <button onClick={() => decide(name, 'رُفع إلى قائد السفينة')} className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber/50 py-2 text-sm text-amber hover:bg-amber/10">
                <Radio size={15} /> رفع التنبيه لقائد السفينة
              </button>
              <button onClick={() => { decide(name, 'صُنّف نشاطًا طبيعيًا'); onSelect(null); }} className="flex w-full items-center justify-center gap-2 rounded-lg border border-line py-2 text-sm text-muted hover:text-ink">
                <XCircle size={15} /> تصنيفه نشاطًا طبيعيًا
              </button>
            </div>
            <p className="mt-3 text-[10px] text-muted">الذكاء الاصطناعي يستكشف، والإنسان يقرر.</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 4. drone verification

export function DronePage({ alerts, selected, drone, setDrone, decide }) {
  const [authorized, setAuthorized] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [summary, setSummary] = useState(null);
  const target = (selected && isDark(selected) ? selected : null) || alerts[0] || null;

  useEffect(() => {
    fetch('media/vision_summary.json').then((r) => (r.ok ? r.json() : null)).then(setSummary).catch(() => {});
  }, []);

  return (
    <div className="absolute inset-0 overflow-y-auto p-5">
      <div className="grid grid-cols-3 gap-4">
        <div className="pointer-events-auto relative col-span-2 flex h-[480px] items-center justify-center overflow-hidden rounded-xl border border-sea/40 bg-black">
          {drone === 'ACTIVE' && !videoFailed && (
            <video className="h-full w-full object-cover" src="media/drone_detect.mp4" autoPlay muted loop playsInline onError={() => setVideoFailed(true)} />
          )}
          {drone === 'ACTIVE' && videoFailed && (
            <div className="p-8 text-center text-muted">
              <Video className="mx-auto mb-2 text-sea" />
              هنا يظهر فيديو الكشف بنموذج YOLO
              <p className="mt-1 text-xs">(يُضاف من مهمة الرؤية الحاسوبية: site/public/media/drone_detect.mp4)</p>
            </div>
          )}
          {drone !== 'ACTIVE' && (
            <div className="text-center text-muted">
              <Eye className="mx-auto mb-2 text-sea/60" size={40} />
              المسيّرة في منصتها على ظهر السفينة
              <p className="mt-1 text-xs">تنطلق فقط بعد موافقة المشغّل</p>
            </div>
          )}
          <div className="absolute inset-x-0 top-0 flex justify-between bg-gradient-to-b from-black/80 to-transparent p-3 text-xs text-sea">
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${drone === 'ACTIVE' ? 'animate-pulse bg-danger' : 'bg-muted'}`} />
              {drone === 'ACTIVE' ? 'بث مباشر من المسيّرة' : 'في وضع الاستعداد'}
            </span>
            <span>{target ? `الهدف: ${targetName(target)}` : 'لا يوجد هدف محدد'}</span>
          </div>
        </div>
        <div className="space-y-4">
          <Panel title="الموافقة البشرية على الإطلاق" icon={CheckCircle2}>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-white/5 p-3 text-sm">
              <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} className="mt-1 h-4 w-4 accent-[#22d3ee]" />
              أؤكد إطلاق المسيّرة للتحقق البصري من الهدف.
            </label>
            {drone !== 'ACTIVE' ? (
              <button
                disabled={!authorized}
                onClick={() => { setDrone('ACTIVE'); decide(targetName(target), 'أُطلقت المسيّرة للتحقق'); }}
                className={`mt-3 w-full rounded-lg py-3 text-sm font-bold transition ${authorized ? 'bg-gradient-to-l from-sea to-teal text-abyss' : 'cursor-not-allowed border border-line text-muted'}`}
              >
                إطلاق المسيّرة
              </button>
            ) : (
              <button onClick={() => { setDrone('STANDBY'); setAuthorized(false); }} className="mt-3 w-full rounded-lg border border-danger/50 py-3 text-sm text-danger hover:bg-danger/10">
                إعادة المسيّرة إلى المنصة
              </button>
            )}
          </Panel>
          <Panel title="نتيجة الكشف" icon={Target}>
            {summary ? (
              <div className="grid grid-cols-2 gap-2">
                <Stat label="قوارب مكتشفة" value={summary.unique_tracked_boats ?? summary.boats ?? summary.count ?? '—'} />
                <Stat label="متوسط الثقة" value={(summary.average_confidence ?? summary.mean_confidence) != null ? `${Math.round((summary.average_confidence ?? summary.mean_confidence) * 100)}%` : '—'} />
              </div>
            ) : (
              <p className="text-xs text-muted">تظهر هنا نتائج نموذج YOLO (عدد القوارب ونسبة الثقة) عند توفر vision_summary.json.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 5. vessel profile

export function VesselPage({ demo, own, onSelect, setTab }) {
  const nearby = demo.points
    .filter((p) => p.source !== 'own' && p.range_m != null)
    .sort((a, b) => a.range_m - b.range_m)
    .slice(0, 12);
  return (
    <div className="absolute inset-0 overflow-y-auto p-5">
      <Panel className="mb-4">
        <div className="flex items-center gap-4">
          <div className="rounded-xl border border-sea/40 bg-sea/10 p-3"><Anchor className="text-sea" size={28} /></div>
          <div>
            <h1 className="font-display text-xl font-extrabold text-white">سفينتنا</h1>
            <p className="text-xs text-muted"><span className="num">MMSI {own?.mmsi}</span> · سفينة حقيقية من التسجيل</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-3">
          <Stat label="السرعة" value={`${own?.sog_kn ?? '—'} عقدة`} />
          <Stat label="الاتجاه" value={`${own?.cog_deg != null ? Math.round(own.cog_deg) : '—'}°`} />
          <Stat label="خط العرض" value={own?.lat.toFixed(4)} />
          <Stat label="خط الطول" value={own?.lon.toFixed(4)} />
        </div>
      </Panel>
      <Panel title="الأهداف القريبة" icon={Ship}>
        <table className="w-full text-right text-xs">
          <thead className="text-muted">
            <tr className="border-b border-line">
              <th className="pb-2 font-normal">الهدف</th><th className="pb-2 font-normal">النوع</th>
              <th className="pb-2 font-normal">المسافة</th><th className="pb-2 font-normal">أقرب اقتراب</th>
              <th className="pb-2 font-normal">السرعة</th><th className="pb-2 font-normal">الخطورة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {nearby.map((p) => (
              <tr key={p.track_id} className="cursor-pointer hover:bg-white/5" onClick={() => { onSelect(p.track_id); setTab('monitor'); }}>
                <td className="py-2 text-ink">{targetName(p)}</td>
                <td className="py-2 text-muted">{p.source === 'ais' ? (p.radar_id ? 'AIS + رادار' : 'AIS') : p.fusion === 'tentative' ? 'رادار · قيد التحقق' : 'رادار فقط'}</td>
                <td className="num py-2">{fmtRange(p.range_m)}</td>
                <td className="num py-2">{fmtRange(p.cpa_m)}</td>
                <td className="num py-2">{p.sog_kn ?? '—'}</td>
                <td className="py-2"><LevelPill level={p.level} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
