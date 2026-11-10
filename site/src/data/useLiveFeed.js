import { useEffect, useRef, useState } from 'react';

const WS_URL = 'ws://localhost:8000/ws?speed=10';
const MAX_HISTORY = 90;

export function useLiveFeed() {
const [points, setPoints] = useState([]);
const [tracks, setTracks] = useState(new Map());
const [status, setStatus] = useState('connecting');
const [playing, setPlaying] = useState(true);
const [sec, setSec] = useState(0);

const playingRef = useRef(true);
const historyRef = useRef(new Map());
const socketRef = useRef(null);
const clockRef = useRef(0);

useEffect(() => {
playingRef.current = playing;
}, [playing]);

useEffect(() => {
let socket;
let reconnectTimer;
let stopped = false;

function connect() {
  if (stopped) return;

  setStatus('connecting');
  socket = new WebSocket(WS_URL);
  socketRef.current = socket;

  socket.onopen = () => {
    setStatus('connected');
  };

  socket.onmessage = (event) => {
    if (!playingRef.current) return;

    try {
      const message = JSON.parse(event.data);
      if (!Array.isArray(message.points)) return;

      const nextPoints = message.points.map((p) => ({
        ...p,
        level: p.level ?? null,
        score: p.score ?? null,
      }));

      const nextTracks = new Map(historyRef.current);
      const currentTime = ++clockRef.current;

      nextPoints.forEach((p) => {
        const old = nextTracks.get(p.track_id);
        const track = old || {
          id: p.track_id,
          source: p.source,
          label: p.label,
          mmsi: p.mmsi,
          path: [],
          times: [],
          events: [],
        };

        track.path = [
          ...track.path,
          [p.lon, p.lat],
        ].slice(-MAX_HISTORY);

        track.times = [
          ...track.times,
          currentTime,
        ].slice(-MAX_HISTORY);

        nextTracks.set(p.track_id, {
          ...track,
          source: p.source,
          label: p.label,
          mmsi: p.mmsi,
        });
      });

      historyRef.current = nextTracks;
      setPoints(nextPoints);
      setTracks(new Map(nextTracks));
      setSec(currentTime);
    } catch (error) {
      console.error('Live feed error:', error);
    }
  };

  socket.onclose = () => {
    if (stopped) return;
    setStatus('disconnected');
    reconnectTimer = setTimeout(connect, 2000);
  };

  socket.onerror = () => {
    setStatus('error');
  };
}

connect();

return () => {
  stopped = true;
  clearTimeout(reconnectTimer);
  socket?.close();
  socketRef.current = null;
};
}, []);

return {
ready: status === 'connected',
status,
points,
tracks,
sec,
playing,
setPlaying,
meta: {
mode: 'LIVE',
risk_engine: 'pending',
scenes: [],
},
loop: Math.max(sec, 1),
};
}