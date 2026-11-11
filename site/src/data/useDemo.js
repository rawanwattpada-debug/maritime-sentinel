import { useEffect, useMemo, useRef, useState } from 'react';

// Plays site/public/data/demo.json (made by export_demo.py) in the browser.
// One frame = one real second of the demo loop; positions are interpolated in between.

export const LEVEL_COLOR = {
  HIGH: [239, 68, 68],
  MEDIUM: [245, 181, 71],
  LOW: [52, 211, 153],
};
export const AIS_COLOR = [34, 211, 238];
export const OWN_COLOR = [250, 204, 21];

export const TENTATIVE_COLOR = [167, 139, 250];

// a target the radar sees but no AIS vessel matches (found by fusion), or an older simulated target
export const isDark = (p) => p && (p.source === 'radar' || p.source === 'radar_sim');

export function colorOf(p) {
  if (p.source === 'own') return OWN_COLOR;
  if (p.source === 'ais') return AIS_COLOR;
  if (p.fusion === 'tentative') return TENTATIVE_COLOR;
  return LEVEL_COLOR[p.level] || AIS_COLOR;
}

export const LEVEL_AR = { HIGH: 'عالي', MEDIUM: 'متوسط', LOW: 'منخفض' };
export const SCENE_AR = {
  fishing_cluster: 'تجمّع صيد',
  coordinated_attack: 'هجوم منسّق',
  single_approach: 'اقتراب منفرد',
  fast_crossing: 'قارب يعبر بسرعة',
  mother_ship: 'سفينة أم',
  normal_transit: 'مرور طبيعي',
};

function lerpAngle(a, b, f) {
  if (a == null || b == null) return a ?? b;
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * f + 360) % 360;
}

function buildIndex(frames) {
  // per frame: Map(track_id -> point); per track: trail + level history
  const byFrame = frames.map((f) => new Map(f.points.map((p) => [p.track_id, p])));
  const tracks = new Map();
  frames.forEach((f) => {
    f.points.forEach((p) => {
      let tr = tracks.get(p.track_id);
      if (!tr) {
        tr = { id: p.track_id, source: p.source, label: p.label, mmsi: p.mmsi, path: [], times: [], events: [] };
        tracks.set(p.track_id, tr);
      }
      tr.path.push([p.lon, p.lat]);
      tr.times.push(f.sec);
      const last = tr.events[tr.events.length - 1];
      if (p.level && (!last || last.level !== p.level)) {
        tr.events.push({ sec: f.sec, t: f.t, level: p.level, score: p.score, reasons: p.reasons });
      }
    });
  });
  return { byFrame, tracks };
}

export function useDemo() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sec, setSec] = useState(0);
  const [playing, setPlaying] = useState(true);
  const secRef = useRef(0);
  const rate = useRef(1);

  useEffect(() => {
    fetch('data/demo.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  const index = useMemo(() => (data ? buildIndex(data.frames) : null), [data]);
  const loop = data ? data.meta.loop_seconds : 1;

  // clock: real time drives the demo; ~30 updates per second
  useEffect(() => {
    if (!data) return undefined;
    let raf;
    let last = performance.now();
    let acc = 0;
    const tick = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      if (playing) {
        secRef.current = (secRef.current + dt * rate.current) % loop;
        acc += dt;
        if (acc > 1 / 30) {
          acc = 0;
          setSec(secRef.current);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [data, playing, loop]);

  const points = useMemo(() => {
    if (!index) return [];
    const i = Math.floor(sec);
    const j = Math.min(i + 1, index.byFrame.length - 1);
    const f = sec - i;
    const A = index.byFrame[i];
    const B = index.byFrame[j];
    const out = [];
    A.forEach((a, id) => {
      const b = B.get(id) || a;
      out.push({
        ...a,
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lon + (b.lon - a.lon) * f,
        cog_deg: lerpAngle(a.cog_deg, b.cog_deg, f),
      });
    });
    return out;
  }, [index, sec]);

  const api = {
    ready: !!data,
    error,
    meta: data?.meta,
    frames: data?.frames,
    tracks: index?.tracks,
    sec,
    loop,
    points,
    playing,
    setPlaying,
    seek: (s) => {
      secRef.current = ((s % loop) + loop) % loop;
      setSec(secRef.current);
    },
    setRate: (r) => {
      rate.current = r;
    },
  };
  return api;
}

// helpers used by several pages
export function frameAt(demo, s) {
  return demo.frames?.[Math.min(Math.floor(s), demo.frames.length - 1)];
}

export function alertsNow(points) {
  return points
    .filter((p) => p.source !== 'own' && p.source !== 'ais' && p.level && p.level !== 'LOW')
    .sort((a, b) => b.score - a.score);
}

export function fmtTime(t) {
  return t ? t.slice(11, 19) : '--:--:--';
}

export function fmtRange(m) {
  if (m == null) return '—';
  return m >= 1852 ? `${(m / 1852).toFixed(1)} ميل` : `${Math.round(m)} م`;
}
