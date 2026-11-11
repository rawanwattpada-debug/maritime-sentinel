// Main sea trade lanes drawn on the globe as moving streaks of light that all flow into
// the strait: shows why this narrow passage matters, with no names or text.
// Paths are approximate open-sea routes [lon, lat], each ending at the strait.

const STRAIT = [43.4, 12.6];

const LANES = [
  // East Asia -> Malacca -> Indian Ocean
  [[122, 30.5], [121, 25], [116, 18], [110, 10], [105.5, 3], [103.8, 1.2], [100.5, 3.5], [97, 5.8], [88, 5.8], [80.5, 5.6], [72, 9], [62, 12], [52, 12.8], [46, 12.1], STRAIT],
  // Gulf
  [[50.6, 26.8], [53.5, 26.3], [56.4, 26.6], [57.6, 24.6], [60, 22.5], [59.5, 18], [54, 13.8], [48, 12.2], STRAIT],
  // Mediterranean -> Suez -> Red Sea
  [[-5.6, 35.95], [-1, 36.6], [6, 37.6], [12, 37.4], [20, 34.5], [27, 33], [32.3, 31.4], [32.55, 29.9], [33.9, 27.4], [36.5, 23], [39.3, 18.5], [41.6, 15.2], [42.9, 13.4], STRAIT],
  // North Europe -> Atlantic -> Gibraltar -> Med -> Suez
  [[3.5, 51.8], [-1.5, 50.2], [-6, 48.5], [-10, 44], [-10, 38], [-6.5, 36], [-1, 36.6], [6, 37.6], [12, 37.4], [20, 34.5], [27, 33], [32.3, 31.4], [32.55, 29.9], [33.9, 27.4], [36.5, 23], [39.3, 18.5], [41.6, 15.2], [42.9, 13.4], STRAIT],
  // East Africa
  [[39.8, -4.2], [42.5, -1.5], [46, 2.5], [49.5, 7.5], [51.5, 11.5], [48, 12.2], STRAIT],
  // South Asia west coast
  [[72.7, 18.8], [68, 16.5], [60, 14], [52, 12.8], [46, 12.1], STRAIT],
  // Southern route (Australia / Cape)
  [[114.5, -32], [105, -22], [92, -10], [78, -1], [66, 6], [56, 11.5], [48, 12.2], STRAIT],
  [[18.4, -34.4], [32, -30], [41, -20], [44, -11], [50, -2], [52, 6], [51.5, 11.5], [48, 12.2], STRAIT],
];

// a few in-between points so long legs follow the globe's curve smoothly
function densify(path, step = 1.5) {
  const out = [];
  for (let i = 0; i < path.length - 1; i += 1) {
    const [a, b] = [path[i], path[i + 1]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k += 1) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  out.push(path[path.length - 1]);
  return out;
}

const FADE = ['interpolate', ['linear'], ['zoom'], 3.2, 1, 5.2, 0]; // gone before we reach the strait
const CLEAR = 'rgba(34,211,238,0)';

// a bright head at `h` (0..1 along the lane) with a fading tail behind it
function streak(h, tail = 0.22) {
  if (h > 1) return ['interpolate', ['linear'], ['line-progress'], 0, CLEAR, 1, CLEAR]; // pause between streaks
  const stops = [[0, CLEAR]];
  const a = h - tail;
  const push = (x, c) => {
    if (x > stops[stops.length - 1][0] + 1e-4 && x < 1) stops.push([x, c]);
  };
  push(Math.max(a, 1e-3), CLEAR);
  push(h - tail * 0.35, 'rgba(34,211,238,0.55)');
  push(h, 'rgba(210,250,255,1)');
  push(h + 0.004, CLEAR);
  stops.push([1, CLEAR]);
  return ['interpolate', ['linear'], ['line-progress'], ...stops.flat()];
}

export function addLanes(map) {
  map.addSource('lanes', {
    type: 'geojson',
    lineMetrics: true,
    data: {
      type: 'FeatureCollection',
      features: LANES.map((p, i) => ({ type: 'Feature', properties: { id: i }, geometry: { type: 'LineString', coordinates: densify(p) } })),
    },
  });
  map.addSource('strait', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: STRAIT } } });

  map.addLayer({
    id: 'lanes-base',
    type: 'line',
    source: 'lanes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#22d3ee', 'line-width': 1, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 3.2, 0.42, 5.2, 0] },
  });
  LANES.forEach((_, i) => {
    map.addLayer({
      id: `lane-${i}`,
      type: 'line',
      source: 'lanes',
      filter: ['==', ['get', 'id'], i],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-width': 3.5, 'line-blur': 1.5, 'line-opacity': FADE, 'line-gradient': streak(0.5) },
    });
  });
  ['strait-halo', 'strait-dot'].forEach((id) =>
    map.addLayer({
      id,
      type: 'circle',
      source: 'strait',
      paint: {
        'circle-color': id === 'strait-dot' ? '#fbbf24' : 'rgba(251,191,36,0)',
        'circle-radius': id === 'strait-dot' ? 4 : 10,
        'circle-stroke-color': '#fbbf24',
        'circle-stroke-width': id === 'strait-dot' ? 0 : 1.5,
        'circle-opacity': FADE,
        'circle-stroke-opacity': FADE,
        'circle-pitch-alignment': 'map',
      },
    }),
  );
}

// called every frame while the globe is on screen
export function animateLanes(map, t) {
  LANES.forEach((_, i) => {
    const speed = 0.11 + (i % 3) * 0.025;
    const h = (t * speed + i * 0.37) % 1.25; // a short pause between streaks
    map.setPaintProperty(`lane-${i}`, 'line-gradient', streak(h));
  });
  const ph = (t * 0.6) % 1;
  map.setPaintProperty('strait-halo', 'circle-radius', 6 + ph * 22);
  map.setPaintProperty('strait-halo', 'circle-stroke-opacity', ['interpolate', ['linear'], ['zoom'], 3.2, 1 - ph, 5.2, 0]);
}
