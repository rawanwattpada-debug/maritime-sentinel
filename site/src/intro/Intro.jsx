import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ChevronDown, ShieldCheck, Radar, Eye, Ship, Route, BrainCircuit } from 'lucide-react';
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

function Video({ src, active }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`fixed inset-0 transition-opacity duration-1000 ${active ? 'opacity-100' : 'opacity-0'}`}>
      {!failed && (
        <video
          className="h-full w-full object-cover"
          src={src}
          autoPlay
          muted
          loop
          playsInline
          onError={() => setFailed(true)}
        />
      )}
      {/* tint so text stays readable; also the fallback when a video is missing */}
      <div
        className="absolute inset-0"
        style={{
          background: failed
            ? 'radial-gradient(ellipse at 70% 30%, #0b2a4a 0%, #061426 55%, #030a14 100%)'
            : 'linear-gradient(180deg, rgba(3,10,20,.55) 0%, rgba(3,10,20,.35) 45%, rgba(3,10,20,.9) 100%)',
        }}
      />
    </div>
  );
}

function Source({ k }) {
  return <span className="num ms-2 align-super text-[11px] text-muted">[{k}]</span>;
}

export default function Intro({ stage, onPhase, onEnter }) {
  const scroller = useRef(null);
  const [videoIdx, setVideoIdx] = useState(0);
  const [section, setSection] = useState(0);

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
              setVideoIdx(SLIDES[i].media === 'video' ? i : -1);
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

      // slide 3: globe -> strait
      ScrollTrigger.create({
        trigger: secs[2],
        scroller: root,
        start: 'top bottom',
        end: 'bottom center',
        scrub: true,
        onUpdate: (self) => {
          stage.current?.globe();
          stage.current?.jump(mix(VIEWS.globe, VIEWS.strait, ease(self.progress)));
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
    stage.current?.jump(VIEWS.globe);
    return () => ctx.revert();
  }, [stage, onPhase]);

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
      {SLIDES.map((sl, i) =>
        sl.media === 'video' ? <Video key={sl.id} src={sl.video} active={videoIdx === i} /> : null,
      )}

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
        <section className="relative flex min-h-screen flex-col items-center justify-center px-6 text-center">
          <span className="reveal mb-6 inline-flex items-center gap-2 rounded-full border border-sea/40 bg-sea/10 px-4 py-1.5 text-sm text-sea">
            <ShieldCheck size={16} /> {s1.subtitle}
          </span>
          <h1 className="reveal font-display text-5xl font-extrabold tracking-wide text-white sm:text-7xl md:text-8xl" dir="ltr">
            MARITIME <span className="text-sea">SENTINEL</span>
          </h1>
          <p className="reveal mt-6 max-w-2xl text-lg text-ink/85 sm:text-xl">{s1.lines[0]}</p>
          <div className="reveal absolute bottom-10 flex flex-col items-center gap-1 text-sm text-muted">
            مرّر للأسفل
            <ChevronDown className="animate-bounce" />
          </div>
        </section>

        {/* 2. importance */}
        <section className="relative flex min-h-screen items-center px-6 sm:px-16">
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
