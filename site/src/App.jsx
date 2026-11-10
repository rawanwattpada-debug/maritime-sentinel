import { useCallback, useEffect, useRef, useState } from 'react';
import MapStage, { VIEWS, focusViews } from './map/MapStage';
import Intro from './intro/Intro';
import Dashboard from './dashboard/Dashboard';
import { useDemo } from './data/useDemo';
import { useLiveFeed } from './data/useLiveFeed';
// Moment of the loop shown behind the intro: attackers closing in, fishing boats nearby
const INTRO_SECOND = 82;

export default function App() {
  const demo = useDemo();
 const live = useLiveFeed();

 const [dataMode, setDataMode] = useState('replay');
 const activeData = dataMode === 'live' ? live : demo;
  
 const stage = useRef(null);
 const [mode, setMode]= useState('intro'); // intro | dashboard
 const [phase, setPhase] = useState('title');
 const [selectedId, setSelectedId] = useState(null);
 const [dim, setDim] = useState(0);

  const enter = useCallback(() => {
    setMode('dashboard');
stage.current?.flat();

const own = demo.frames[0].points.find(
  (p) => p.track_id === 'own_ship'
);

stage.current?.fly({
  ...VIEWS.dashboard,
  center: own
    ? [own.lon, own.lat]
    : VIEWS.dashboard.center,
}, 2600);

stage.current?.interactive(true);
demo.seek(0);
demo.setRate(1);
  }, [demo]);

  const backToIntro = useCallback(() => {
    stage.current?.interactive(false);
    setSelectedId(null);
    setDim(0);
    setMode('intro');
  }, []);

  if (demo.error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-muted">
        تعذّر تحميل بيانات العرض (data/demo.json). شغّلي <code className="num mx-1">python export_demo.py</code> ثم أعيدي التحميل.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <MapStage
        ref={stage}
        demo={activeData}
        showShips={mode === 'dashboard' || phase === 'gap' || phase === 'solution'}
        showDark={mode === 'dashboard' || phase === 'solution'}
        showRings={mode === 'dashboard' || phase === 'solution' || phase === 'gap'}
        selectedId={selectedId}
        onSelect={setSelectedId}
        dim={dim}
      />
      {!demo.ready && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-abyss text-muted">جارٍ التحميل…</div>
      )}
      {mode === 'intro' && <Intro stage={stage} onPhase={setPhase} onEnter={enter} />}
      {mode === 'dashboard' && demo.ready && (
        <Dashboard
         demo={activeData}
         dataMode={dataMode}
         setDataMode={setDataMode}
          stage={stage}
          selectedId={selectedId}
          onSelect={setSelectedId}
          setDim={setDim}
          onExit={backToIntro}
        />
      )}
    </div>
  );
}
