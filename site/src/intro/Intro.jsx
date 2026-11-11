import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ChevronDown, ShieldCheck, Radar, Eye, Ship, Route, BrainCircuit } from 'lucide-react';
import OceanScene from './OceanScene';
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
        onEnter: () => { setHeroOn(false); setTimeout(() => { heroActive.current = false; }, 1200); },
        onLeaveBack: () => { heroActive.current = true; setHeroOn(true); },
      });
      // slide 3: the globe turns for a moment, then the camera comes down to the strait
      ScrollTrigger.create({
        trigger: secs[2],
        scroller: root,
        start: 'top 35%',
        end: 'bottom center',
        scrub: true,
        onUpdate: (self) => {
          stage.current?.globe();
          const p = self.progress;
          if (p < 0.3) {
            const spin = p / 0.3;
            stage.current?.jump({ ...VIEWS.globe, center: [VIEWS.globe.center[0] - 70 + spin * 70, VIEWS.globe.center[1]] });
          } else {
            stage.current?.jump(mix(VIEWS.globe, VIEWS.strait, ease((p - 0.3) / 0.7)));
          }
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
    stage.current?.jump({ ...VIEWS.globe, center: [VIEWS.globe.center[0] - 70, VIEWS.globe.center[1]] });
    return () => ctx.revert();
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
      if (['ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(1); }
      if (['ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [section]);

  const [s1, s2, s3, s4, s5] = SLIDES;

  return (
    <>
      {/* cinematic ocean behind slides 1-2 */}
      <div className={`fixed inset-0 transition-opacity duration-1000 ${heroOn ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
        <OceanScene progressRef={heroProgress} activeRef={heroActive} />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(11,20,38,.55) 0%, rgba(11,20,38,0) 28%, rgba(11,20,38,0) 62%, rgba(11,20,38,.85) 100%), linear-gradient(270deg, rgba(11,20,38,.55) 0%, rgba(11,20,38,0) 45%)',
          }}
        />
      </div>
      <Header section={section} go={goTo} onEnter={onEnter} />

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
          <span className="reveal mb-6 inline-flex items-center gap-2 rounded-full border border-sea/40 bg-sea/10 px-4 py-1.5 text-sm text-sea">
            <ShieldCheck size={16} /> {s1.subtitle}
          </span>
          <h1 className="reveal font-display text-5xl font-extrabold tracking-wide text-white drop-shadow-[0_4px_24px_rgba(0,0,0,.45)] sm:text-7xl md:text-8xl" dir="ltr">
            MARITIME <span className="text-sea">SENTINEL</span>
          </h1>
          <p className="reveal mt-5 max-w-2xl text-lg text-ink/90 drop-shadow sm:text-xl">{s1.lines[0]}</p>
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
