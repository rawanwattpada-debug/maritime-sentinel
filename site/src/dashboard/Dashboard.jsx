import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Radar, AlertTriangle, Eye, Anchor, Pause, Play, Undo2, ShieldAlert, Crosshair, LocateFixed,
} from 'lucide-react';
import { alertsNow, fmtTime, SCENE_AR } from '../data/useDemo';
import { OverviewPage, MonitorPage, AlertPage, DronePage, VesselPage } from './pages';

const TABS = [
  { id: 'overview', label: 'نظرة عامة', icon: Activity, dim: 0 },
  { id: 'monitor', label: 'المراقبة ثلاثية الأبعاد', icon: Radar, dim: 0 },
  { id: 'alert', label: 'التحقيق في التنبيه', icon: AlertTriangle, dim: 0.93 },
  { id: 'drone', label: 'التحقق بالمسيّرة', icon: Eye, dim: 0.93 },
  { id: 'vessel', label: 'ملف السفينة', icon: Anchor, dim: 0.93 },
];

function ModeBadge({ mode }) {
  // The badge always tells the truth: this is the recorded demo loop
  return (
    <span className="num inline-flex items-center gap-1.5 rounded border border-amber/50 bg-amber/10 px-2 py-0.5 text-[11px] font-semibold text-amber">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />
      {mode}
    </span>
  );
}

function SceneBar({ demo }) {
  const scenes = demo.meta.scenes;
  const pct = (s) => `${(s / demo.loop) * 100}%`;
  return (
    <div className="glass pointer-events-auto rounded-xl px-4 py-3">
      <div className="mb-2 flex items-center justify-between text-[11px] text-muted">
        <span>مشاهد الديمو</span>
        <span className="num">
          {Math.floor(demo.sec)} / {demo.loop} ث
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-line">
        <div className="absolute inset-y-0 right-0 rounded-full bg-sea/70" style={{ width: pct(demo.sec) }} />
        {scenes.map((s) => (
          <button
            key={s.label}
            onClick={() => demo.seek(s.at_second)}
            className="absolute -top-1 h-4 w-1.5 -translate-x-1/2 rounded bg-amber hover:scale-125"
            style={{ right: pct(s.at_second) }}
            title={SCENE_AR[s.label] || s.label}
            aria-label={`انتقل إلى ${SCENE_AR[s.label] || s.label}`}
          />
        ))}
      </div>
      <div className="relative mt-1.5 h-4 text-[11px] text-ink/80">
        {!scenes.some((s) => s.at_second < demo.loop * 0.08) && <span className="absolute right-0">البداية</span>}
        {scenes.map((s) => (
          <span key={s.label} className={`absolute whitespace-nowrap ${s.at_second < demo.loop * 0.08 ? '' : '-translate-x-1/2'}`} style={{ right: pct(s.at_second) }}>
            {SCENE_AR[s.label] || s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard({ demo, stage, selectedId, onSelect, setDim, onExit }) {
  const [tab, setTab] = useState('overview');
  const [shown, setShown] = useState(false);
  const [decisions, setDecisions] = useState([]); // operator log
  const [drone, setDrone] = useState('STANDBY'); // STANDBY | ACTIVE
  const [follow, setFollow] = useState(false); // camera follows our ship

  useEffect(() => {
    const t = setTimeout(() => setShown(true), 400);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => setDim(TABS.find((t) => t.id === tab).dim), [tab, setDim]);

  const alerts = useMemo(() => alertsNow(demo.points), [demo.points]);
  const highCount = alerts.filter((a) => a.level === 'HIGH').length;
  const own = demo.points.find((p) => p.track_id === 'own_ship');
  const selected = demo.points.find((p) => p.track_id === selectedId) || null;

  // start following once the entry flight has landed; stop when the user drags the map
  useEffect(() => {
    const t = setTimeout(() => setFollow(true), 2700);
    const m = stage.current?.map;
    const stop = () => setFollow(false);
    m?.on('dragstart', stop);
    return () => {
      clearTimeout(t);
      m?.off('dragstart', stop);
    };
  }, [stage]);
  const lastFollow = useRef(0);
  useEffect(() => {
    if (!follow || !own || (tab !== 'overview' && tab !== 'monitor')) return;
    const now = performance.now();
    if (now - lastFollow.current < 60) return;
    lastFollow.current = now;
    const pad = tab === 'overview'
      ? { top: 120, bottom: 120, left: 400, right: 0 }
      : { top: 20, bottom: 120, left: 380, right: 0 };
    stage.current?.follow(own.lon, own.lat, pad);
  }, [follow, own, tab, stage]);

  const decide = (target, action) =>
    setDecisions((d) => [{ t: demo.points[0]?.timestamp, target, action }, ...d].slice(0, 20));

  const ctx = { demo, stage, alerts, own, selected, selectedId, onSelect, setTab, decide, decisions, drone, setDrone, setFollow };

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-20 flex transition-opacity duration-1000 ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* sidebar (right, RTL) */}
      <aside className="glass pointer-events-auto flex w-64 shrink-0 flex-col justify-between border-y-0 border-r-0">
        <div>
          <div className="flex items-center gap-3 border-b border-line p-4">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-sea/50 bg-sea/10">
              <ShieldAlert className="text-sea" size={22} />
            </div>
            <div dir="ltr" className="text-left">
              <p className="font-display text-sm font-extrabold tracking-wider text-white">
                MARITIME<span className="text-sea">SENTINEL</span>
              </p>
              <p className="text-[10px] tracking-widest text-teal">EARLY WARNING</p>
            </div>
          </div>
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-xs">
            <span className="flex items-center gap-2 text-muted">
              <span className="h-2 w-2 rounded-full bg-safe" /> النظام يعمل
            </span>
            <ModeBadge mode={demo.meta.mode} />
          </div>
          <nav className="space-y-1.5 p-3 text-sm">
            {TABS.map(({ id, label, icon: Icon }) => {
              const active = tab === id;
              const badge = id === 'alert' && highCount ? `${highCount} عالي` : id === 'drone' ? (drone === 'ACTIVE' ? 'في الجو' : 'جاهزة') : null;
              return (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3.5 py-3 transition ${
                    active
                      ? 'border-sea/50 bg-sea/10 font-semibold text-sea shadow-[0_0_20px_rgba(34,211,238,.12)]'
                      : 'border-transparent text-ink/70 hover:bg-white/5 hover:text-ink'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <Icon size={17} /> {label}
                  </span>
                  {badge && (
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] ${
                        id === 'alert' ? 'border-danger/50 bg-danger/15 text-danger' : 'border-sea/40 bg-sea/10 text-sea'
                      }`}
                    >
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
        <div className="space-y-2 border-t border-line p-3 text-xs">
          <div className="flex items-center justify-between rounded-lg bg-white/5 p-2.5">
            <span className="text-muted">الوقت (UTC)</span>
            <span className="num text-ink">{fmtTime(demo.points[0]?.timestamp)}</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => demo.setPlaying(!demo.playing)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line py-2 hover:border-sea/50"
            >
              {demo.playing ? <Pause size={14} /> : <Play size={14} />} {demo.playing ? 'إيقاف' : 'تشغيل'}
            </button>
            <button
              onClick={onExit}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line py-2 hover:border-sea/50"
            >
              <Undo2 size={14} /> العرض
            </button>
          </div>
          <p className="text-[10px] leading-relaxed text-muted">
            ديمو مسجّل: سفن حقيقية (دوفر ← باب المندب) وأهداف محاكاة.
            {demo.meta.risk_engine === 'interim' && ' تقييم الخطورة: نسخة مؤقتة.'}
          </p>
        </div>
      </aside>

      {/* main area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass pointer-events-auto flex h-14 shrink-0 items-center justify-between border-x-0 border-t-0 px-5">
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-2 text-muted">
              <Crosshair size={15} className="text-sea" /> سفينتنا
            </span>
            <span className="num text-ink" dir="ltr">
              {own ? `${own.lat.toFixed(4)}°N  ${own.lon.toFixed(4)}°E` : '—'}
            </span>
            <span className="num text-muted" dir="ltr">
              {own?.sog_kn ?? '—'} kn · {own?.cog_deg?.toFixed?.(0) ?? '—'}°
            </span>
          </div>
          <div className="flex items-center gap-2">
          {(tab === 'overview' || tab === 'monitor') && (
            <button
              onClick={() => setFollow(!follow)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition ${
                follow ? 'border-sea/60 bg-sea/10 text-sea' : 'border-line text-muted hover:border-sea/50'
              }`}
            >
              <LocateFixed size={15} /> {follow ? 'تتبّع سفينتنا: يعمل' : 'تتبّع سفينتنا'}
            </button>
          )}
          <button
            onClick={() => setTab('alert')}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              highCount
                ? 'animate-pulse border-danger/60 bg-danger/15 text-danger'
                : 'border-line text-muted hover:border-sea/50'
            }`}
          >
            <AlertTriangle size={15} /> تنبيهات نشطة ({alerts.length})
          </button>
          </div>
        </header>

        <main className="relative min-h-0 flex-1">
          {tab === 'overview' && <OverviewPage {...ctx} />}
          {tab === 'monitor' && <MonitorPage {...ctx} />}
          {tab === 'alert' && <AlertPage {...ctx} />}
          {tab === 'drone' && <DronePage {...ctx} />}
          {tab === 'vessel' && <VesselPage {...ctx} />}
          {(tab === 'overview' || tab === 'monitor') && (
            <div className="absolute inset-x-5 bottom-5">
              <SceneBar demo={demo} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
