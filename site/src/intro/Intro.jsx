import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ChevronDown, ShieldCheck, Radar, Eye, Ship, Route, BrainCircuit, Volume2, VolumeX, CloudSun, Moon, Sun } from 'lucide-react';
import OceanScene from './OceanScene';
import Ambience, { SOUNDS } from './ambience';
import { fetchWeather, lookFor, fitMode, CONDITION_AR, DAY_OPTIONS, NIGHT_OPTIONS } from './weather';
import { SLIDES, SOURCES, DATA_NOTE } from '../content';
import { VIEWS } from '../map/MapStage';

gsap.registerPlugin(ScrollTrigger);

const lerp = (a, b, f) => a + (b - a) * f;
const mix = (A, B, f) => ({
  center: [lerp(A.center[0], B.center[0], f), lerp(A.center[1], B.center[1], f)],
  zoom: lerp(A.zoom, B.zoom, f),
  pitch: lerp(A.pitch, B.pitch, f),
  bearing: lerp(A.bearing, B.bearing, f),
  padding: {
    top: 0,
    bottom: 0,
    left: 0,
    right: lerp(A.padding?.right || 0, B.padding?.right || 0, f),
  },
});
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const SHIP_POS = [43.33, 12.58]; // where the weather is read: our ship's waters
const SPIN_START = 5; // longitude the globe starts turning from

// slide 3: the globe turns, then the camera travels to the strait and dives down to it
function globeView(p, spinLon) {
  const G = VIEWS.globe;
  const S = VIEWS.strait;
  const e = ease(clamp01((p - 0.12) / 0.88));
  const travel = 1 - Math.pow(1 - e, 2.5); // move over the sea first...
  const dive = Math.pow(e, 1.8); // ...then come down
  const dLon = ((((S.center[0] - spinLon) % 360) + 540) % 360) - 180;
  const arc = Math.sin(Math.PI * e);
  return {
    center: [spinLon + dLon * travel, lerp(G.center[1], S.center[1], travel)],
    zoom: lerp(G.zoom, S.zoom, dive),
    pitch: 48 * Math.pow(arc, 1.3),
    bearing: -32 * arc,
    padding: { top: 0, bottom: 0, left: 0, right: lerp(0, S.padding?.right || 0, travel) },
  };
}

// small, quiet controls for the hero: sea sound (waves / rain) + weather
// (real by default; the presenter picks day or night, then the weather under it)
const realLabel = (real) =>
  real
    ? `الطقس الآن عند موقع السفينة · ${Math.round(real.tempC)}° · ${real.night ? 'ليل' : 'نهار'} · ${CONDITION_AR[real.condition]}${real.waveM != null ? ` · ارتفاع الموج ${real.waveM.toFixed(1)} م` : ''}`
    : 'الطقس الحالي عند موقع السفينة غير متاح (بدون اتصال)';

function HeroControls({ visible, sound, setSound, soundId, setSoundId, real, override, setOverride }) {
  const [open, setOpen] = useState(null); // 'weather' | 'sound' | null
  const shown = fitMode(override || real || { condition: 'clear', night: false });
  const options = shown.night ? NIGHT_OPTIONS : DAY_OPTIONS;
  const pick = (patch) => setOverride(fitMode({ condition: shown.condition, night: shown.night, ...patch }));
  // at night "clear" is the base (just stars): clicking the chosen weather again goes back to it
  const pickCondition = (c) => pick({ condition: shown.night && shown.condition === c ? 'clear' : c });
  const chip = (on) => `rounded-md px-3 py-1.5 transition ${on ? 'bg-sea/20 text-sea' : 'text-ink/80 hover:bg-white/10'}`;
  const toggle = (k) => setOpen(open === k ? null : k);
  return (
    <div className={`fixed bottom-5 left-6 z-30 flex flex-col items-start gap-2 transition-opacity duration-700 ${visible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
      {open === 'weather' && (
        <div className="glass w-[17rem] space-y-2 rounded-xl p-2.5 text-xs">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-black/20 p-1">
            {[[false, 'نهار', Sun], [true, 'ليل', Moon]].map(([n, t, Icon]) => (
              <button key={t} onClick={() => pick({ night: n })} className={`flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-semibold transition ${shown.night === n ? 'bg-sea text-abyss' : 'text-ink/80 hover:bg-white/10'}`}>
                <Icon size={15} /> {t}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {options.map((c) => (
              <button key={c} onClick={() => pickCondition(c)} className={chip(shown.condition === c)}>{CONDITION_AR[c]}</button>
            ))}
          </div>
          <button onClick={() => setOverride(null)} className={`w-full ${chip(!override)}`}>تلقائي: الطقس الحقيقي الآن</button>
        </div>
      )}
      {open === 'sound' && (
        <div className="glass w-40 rounded-xl p-1.5 text-xs">
          {SOUNDS.map((x) => (
            <button
              key={x.id}
              onClick={() => { setSoundId(x.id); setSound(true); setOpen(null); }}
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-right ${chip(soundId === x.id)}`}
            >
              {x.label}
              {soundId === x.id && <Volume2 size={13} />}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <div className="glass flex items-center rounded-full text-xs text-ink/90">
          <button
            onClick={() => setSound(!sound)}
            aria-label={sound ? 'إيقاف الصوت' : 'تشغيل الصوت'}
            className="flex items-center gap-2 rounded-full py-2 ps-3.5 pe-2 transition hover:text-white"
          >
            {sound ? <Volume2 size={15} className="text-sea" /> : <VolumeX size={15} />}
            {sound ? `صوت: ${SOUNDS.find((x) => x.id === soundId)?.label}` : 'تشغيل الصوت'}
          </button>
          <button onClick={() => toggle('sound')} aria-label="اختيار الصوت" className="rounded-full py-2 pe-3 ps-1.5 text-ink/60 hover:text-white">
            <ChevronDown size={14} className={open === 'sound' ? 'rotate-180' : ''} />
          </button>
        </div>
        <button
          onClick={() => toggle('weather')}
          aria-label="الطقس"
          className="flex items-center gap-1.5 rounded-full px-2.5 py-2 text-[11px] text-ink/55 transition hover:bg-white/5 hover:text-ink/90"
        >
          <CloudSun size={14} /> {realLabel(real)}
        </button>
      </div>
    </div>
  );
}

const POINT_ICONS = [Ship, Route, BrainCircuit];
const SOLUTION_ICONS = [Radar, ShieldCheck, Eye];

const NAV = [
  { label: 'الرئيسية', slide: 0 },
  { label: 'التحدي', slide: 2 },
  { label: 'الفجوة', slide: 3 },
  { label: 'الحل', slide: 4 },
];

function Header({ section, go, onEnter }) {
  return (
    <header className="fixed inset-x-0 top-0 z-30 border-b border-white/10 bg-abyss/40 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <button onClick={() => go(0)} className="flex items-center gap-2.5" aria-label="Maritime Sentinel">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-sea/50 bg-sea/15">
            <ShieldCheck size={19} className="text-sea" />
          </span>
          <span dir="ltr" className="font-display text-sm font-extrabold tracking-wider text-white">
            MARITIME<span className="text-sea">SENTINEL</span>
          </span>
        </button>
        <nav className="hidden items-center gap-1 md:flex" aria-label="أقسام العرض">
          {NAV.map((n) => (
            <button
              key={n.label}
              onClick={() => go(n.slide)}
              className={`rounded-lg px-3.5 py-2 text-sm transition ${
                section === n.slide || (n.slide === 0 && section === 1)
                  ? 'bg-white/10 text-white'
                  : 'text-ink/70 hover:bg-white/5 hover:text-white'
              }`}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <button
          onClick={onEnter}
          className="flex items-center gap-2 rounded-lg bg-sea px-4 py-2 text-sm font-bold text-abyss transition hover:bg-sea/90"
        >
          <Radar size={16} /> غرفة العمليات
        </button>
      </div>
    </header>
  );
}

function Source({ k }) {
  return <span className="num ms-2 align-super text-[11px] text-muted">[{k}]</span>;
}

export default function Intro({ stage, onPhase, onEnter }) {
  const scroller = useRef(null);
  const [section, setSection] = useState(0);
  const heroProgress = useRef(0);
  const heroActive = useRef(true);
  const [heroOn, setHeroOn] = useState(true);
  const globeP = useRef(0);
  const globeOn = useRef(false);
  const flatP = useRef(0);

  // weather: real by default; the presenter can override it (also keys W and N)
  const [real, setReal] = useState(null);
  const [override, setOverride] = useState(null);
  const lookRef = useRef(lookFor());
  useEffect(() => {
    let alive = true;
    fetchWeather(SHIP_POS[1], SHIP_POS[0]).then((w) => alive && w && setReal(w)).catch(() => {});
    return () => { alive = false; };
  }, []);
  const shown = fitMode(override || real || { condition: 'clear', night: false });
  lookRef.current = lookFor({ ...shown, waveM: real?.waveM });

  // sea sound: only after the visitor turns it on; fades out when the ocean hands over to the map
  const amb = useRef(null);
  const [sound, setSound] = useState(false);
  const [soundId, setSoundId] = useState('waves');
  useEffect(() => { amb.current?.setSound(soundId); }, [soundId]);
  useEffect(() => {
    if (sound) {
      if (!amb.current) amb.current = new Ambience();
      amb.current.setSound(soundId);
      amb.current.start();
    }
    amb.current?.fadeTo(sound && heroOn ? 0.9 : 0, sound && heroOn ? 2.5 : 1.5);
  }, [sound, heroOn]);
  useEffect(() => { amb.current?.setWeather({ rain: lookRef.current.rain, waves: lookRef.current.waves }); });
  useEffect(() => () => amb.current?.stop(), []);

  // camera choreography, scrubbed by scroll
  useEffect(() => {
    const root = scroller.current;
    const ctx = gsap.context(() => {
      const secs = gsap.utils.toArray('section', root);
      secs.forEach((s, i) => {
        ScrollTrigger.create({
          trigger: s,
          scroller: root,
          start: 'top center',
          end: 'bottom center',
          onToggle: (self) => {
            if (self.isActive) {
              setSection(i);
              onPhase?.(SLIDES[i].id);
            }
          },
        });
        gsap.from(s.querySelectorAll('.reveal'), {
          y: 40,
          opacity: 0,
          duration: 0.9,
          stagger: 0.12,
          ease: 'power3.out',
          scrollTrigger: { trigger: s, scroller: root, start: 'top 65%', toggleActions: 'play none none reverse' },
        });
      });

      // slides 1-2: the ocean camera moves toward the bow
      ScrollTrigger.create({
        trigger: secs[0],
        endTrigger: secs[2],
        scroller: root,
        start: 'top top',
        end: 'top 35%',
        scrub: true,
        onUpdate: (self) => {
          heroProgress.current = self.progress;
        },
      });
      // the ocean hands over to the globe as slide 3 arrives
      ScrollTrigger.create({
        trigger: secs[2],
        scroller: root,
        start: 'top 35%',
        onEnter: () => { globeOn.current = true; setHeroOn(false); setTimeout(() => { heroActive.current = false; }, 1200); },
        onLeaveBack: () => { globeOn.current = false; heroActive.current = true; setHeroOn(true); },
      });
      // slide 3: the globe turns for a moment, then the camera comes down to the strait
      ScrollTrigger.create({
        trigger: secs[2],
        scroller: root,
        start: 'top 35%',
        end: 'bottom bottom',
        scrub: true,
        onUpdate: (self) => {
          globeP.current = self.progress; // the camera itself is driven by the loop below
        },
      });
      // slide 4: flatten and tilt into 3D
      ScrollTrigger.create({
        trigger: secs[3],
        scroller: root,
        start: 'top bottom',
        end: 'center center',
        scrub: true,
        onUpdate: (self) => {
          flatP.current = self.progress;
          if (self.progress <= 0.02) return; // the globe loop is still in charge
          if (self.progress > 0.02) stage.current?.flat();
          else stage.current?.globe();
          stage.current?.jump(mix(VIEWS.strait, VIEWS.tilted, ease(self.progress)));
        },
      });
      // slide 5: slow orbit while the radar reveals the dark targets
      ScrollTrigger.create({
        trigger: secs[4],
        scroller: root,
        start: 'top bottom',
        end: 'bottom bottom',
        scrub: true,
        onUpdate: (self) => {
          stage.current?.flat();
          stage.current?.jump({ ...VIEWS.tilted, bearing: lerp(VIEWS.tilted.bearing, -40, self.progress) });
        },
      });
    }, root);
    stage.current?.jump({ ...VIEWS.globe, center: [SPIN_START, VIEWS.globe.center[1]] });
    stage.current?.lanes(true);

    // globe loop: keeps turning slowly until the visitor scrolls, then flies to the strait
    let raf;
    let last = performance.now();
    let spinLon = SPIN_START;
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!globeOn.current || flatP.current > 0.02) return;
      if (globeP.current < 0.12) spinLon += dt * 6 * (1 - globeP.current / 0.12);
      stage.current?.globe();
      stage.current?.jump(globeView(globeP.current, spinLon));
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ctx.revert();
    };
  }, [stage, onPhase]);

  const goTo = (i) => scroller.current?.querySelectorAll('section')[i]?.scrollIntoView({ behavior: 'smooth' });

  // keyboard: next / previous slide (for the presenter)
  useEffect(() => {
    const go = (d) => {
      const secs = scroller.current.querySelectorAll('section');
      const next = Math.max(0, Math.min(secs.length - 1, section + d));
      secs[next].scrollIntoView({ behavior: 'smooth' });
    };
    const onKey = (e) => {
      // presenter shortcuts for the weather: W = next weather, N = day / night
      if (e.key === 'w' || e.key === 'W') {
        setOverride((o) => {
          const base = fitMode(o || real || { condition: 'clear', night: false });
          const list = base.night ? ['clear', ...NIGHT_OPTIONS] : DAY_OPTIONS;
          return { ...base, condition: list[(list.indexOf(base.condition) + 1) % list.length] };
        });
      }
      if (e.key === 'n' || e.key === 'N') {
        setOverride((o) => {
          const base = o || real || { condition: 'clear', night: false };
          return fitMode({ ...base, night: !base.night });
        });
      }
      if (['ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(1); }
      if (['ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [section, real]);

  const [s1, s2, s3, s4, s5] = SLIDES;

  return (
    <>
      {/* cinematic ocean behind slides 1-2 */}
      <div className={`fixed inset-0 transition-opacity duration-1000 ${heroOn ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
        <OceanScene progressRef={heroProgress} activeRef={heroActive} lookRef={lookRef} />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(11,20,38,.55) 0%, rgba(11,20,38,0) 28%, rgba(11,20,38,0) 62%, rgba(11,20,38,.85) 100%), linear-gradient(270deg, rgba(11,20,38,.55) 0%, rgba(11,20,38,0) 45%)',
          }}
        />
      </div>
      <Header section={section} go={goTo} onEnter={onEnter} />
      <HeroControls visible={heroOn} sound={sound} setSound={setSound} soundId={soundId} setSoundId={setSoundId} real={real} override={override} setOverride={setOverride} />

      {/* progress dots */}
      <nav className="fixed left-6 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-3" aria-label="الشرائح">
        {SLIDES.map((sl, i) => (
          <button
            key={sl.id}
            aria-label={`الشريحة ${i + 1}`}
            onClick={() => scroller.current.querySelectorAll('section')[i].scrollIntoView({ behavior: 'smooth' })}
            className={`h-2.5 w-2.5 rounded-full border border-sea/60 transition-all ${
              section === i ? 'h-6 bg-sea' : 'bg-transparent hover:bg-sea/40'
            }`}
          />
        ))}
      </nav>

      <div ref={scroller} className="fixed inset-0 z-10 overflow-y-auto overflow-x-hidden scroll-smooth">
        {/* 1. title */}
        <section className="relative flex min-h-[120vh] flex-col items-center px-6 pt-[16vh] text-center">
          <span className="reveal mb-6 inline-flex items-center gap-2 rounded-full border border-sea/40 bg-abyss/55 px-4 py-1.5 text-sm text-sea backdrop-blur-sm">
            <ShieldCheck size={16} /> {s1.subtitle}
          </span>
          <h1 className="reveal font-display text-5xl font-extrabold tracking-wide text-white drop-shadow-[0_4px_24px_rgba(0,0,0,.45)] sm:text-7xl md:text-8xl" dir="ltr">
            MARITIME <span className="text-sea">SENTINEL</span>
          </h1>
          <p className="reveal mt-5 max-w-2xl text-lg text-white [text-shadow:0_2px_14px_rgba(5,12,25,.85)] sm:text-xl">{s1.lines[0]}</p>
          <div className="reveal absolute top-[calc(100vh-7rem)] flex flex-col items-center gap-1 text-sm text-ink/80">
            مرّر للأسفل
            <ChevronDown className="animate-bounce" />
          </div>
        </section>

        {/* 2. importance */}
        <section className="relative flex min-h-[130vh] items-center px-6 sm:px-16">
          <div className="max-w-3xl">
            <p className="reveal mb-4 font-display text-lg font-bold text-sea">{s2.kicker}</p>
            <p className="reveal font-display text-[22vw] font-extrabold leading-none text-white sm:text-[11rem]" dir="ltr">
              {s2.stat.value}
            </p>
            <p className="reveal mt-2 font-display text-2xl font-bold text-white sm:text-4xl">
              {s2.stat.label}
              <Source k={s2.source} />
            </p>
            <p className="reveal mt-6 max-w-xl text-lg text-ink/80">{s2.lines[0]}</p>
          </div>
        </section>

        {/* 3. problem (globe flies down) */}
        <section className="relative flex min-h-[140vh] items-center px-6 sm:px-16">
          <div className="max-w-xl">
            <p className="reveal mb-6 font-display text-lg font-bold text-amber">{s3.kicker}</p>
            <div className="space-y-4">
              {s3.stats.map((st) => (
                <div key={st.value} className="reveal glass flex items-center gap-5 rounded-2xl p-5">
                  <span className="num min-w-[5.5rem] text-4xl font-semibold text-amber" dir="ltr">{st.value}</span>
                  <span className="text-base text-ink/90 sm:text-lg">
                    {st.label}
                    <Source k={st.source} />
                  </span>
                </div>
              ))}
            </div>
            <p className="reveal mt-5 text-ink/75">{s3.lines[0]}</p>
          </div>
        </section>

        {/* 4. gap */}
        <section className="relative flex min-h-[140vh] items-center px-6 sm:px-16">
          <div className="max-w-xl">
            <p className="reveal mb-3 font-display text-lg font-bold text-sea">{s4.kicker}</p>
            <h2 className="reveal font-display text-3xl font-extrabold leading-snug text-white sm:text-4xl">{s4.title}</h2>
            <div className="mt-6 space-y-3">
              {s4.points.map((pt, i) => {
                const Icon = POINT_ICONS[i];
                return (
                  <div key={pt.title} className="reveal glass flex gap-4 rounded-2xl p-4">
                    <Icon className="mt-1 shrink-0 text-sea" size={22} />
                    <div>
                      <p className="font-display font-bold text-white">{pt.title}</p>
                      <p className="text-sm text-ink/80">{pt.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="reveal mt-4 text-xs text-muted">{DATA_NOTE}</p>
          </div>
        </section>

        {/* 5. solution + enter */}
        <section className="relative flex min-h-[140vh] items-center px-6 sm:px-16">
          <div className="max-w-xl">
            <p className="reveal mb-3 font-display text-lg font-bold text-sea">{s5.kicker}</p>
            <h2 className="reveal font-display text-4xl font-extrabold text-white" dir="ltr">MARITIME <span className="text-sea">SENTINEL</span></h2>
            <p className="reveal mt-2 text-lg text-ink/85">{s5.lead}</p>
            <div className="mt-5 space-y-3">
              {s5.points.map((pt, i) => {
                const Icon = SOLUTION_ICONS[i];
                return (
                  <div key={pt.title} className="reveal glass flex gap-4 rounded-2xl p-4">
                    <Icon className="mt-1 shrink-0 text-teal" size={22} />
                    <div>
                      <p className="font-display font-bold text-white">{pt.title}</p>
                      <p className="text-sm text-ink/80">{pt.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="reveal mt-6 font-display text-xl font-bold text-amber">{s5.motto}</p>
            <button
              onClick={onEnter}
              className="reveal group mt-8 inline-flex items-center gap-3 rounded-xl bg-gradient-to-l from-sea to-teal px-8 py-4 font-display text-lg font-extrabold text-abyss shadow-[0_0_40px_rgba(34,211,238,.35)] transition hover:scale-[1.03] hover:shadow-[0_0_60px_rgba(34,211,238,.55)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sea"
            >
              <Radar className="transition group-hover:rotate-90" />
              {s5.cta}
            </button>
            <ul className="reveal mt-10 space-y-0.5 text-[11px] text-muted" dir="ltr">
              {SOURCES.map((s) => (
                <li key={s.key}>[{s.key}] {s.text}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </>
  );
}
