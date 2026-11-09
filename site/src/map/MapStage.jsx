import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl';
// MapLibre 6 runs map work in a separate script; let Vite bundle it with its imports
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ColumnLayer, LineLayer, ScatterplotLayer } from '@deck.gl/layers';
import { TripsLayer } from '@deck.gl/geo-layers';
import { colorOf, LEVEL_COLOR, AIS_COLOR, OWN_COLOR } from '../data/useDemo';

// One map for the whole site: the intro flies over it, then it becomes the dashboard.
// Satellite imagery (Esri) darkened to match the deck; plain dark sea if tiles fail.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const STYLE = {
  version: 8,
  projection: { type: 'globe' },
  sources: {
    imagery: {
      type: 'raster',
      tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 17,
      attribution: 'Imagery © Esri',
    },
    labels: {
      type: 'raster',
      tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 17,
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#061426' } },
    {
      id: 'imagery',
      type: 'raster',
      source: 'imagery',
      paint: { 'raster-brightness-max': 0.55, 'raster-saturation': -0.35, 'raster-contrast': 0.1 },
    },
    { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.55 } },
  ],
  sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 0.4, 9, 0] },
};

const NO_PAD = { top: 0, bottom: 0, left: 0, right: 0 };
const textSide = () => ({ ...NO_PAD, right: Math.round(window.innerWidth * 0.42) }); // intro text is on the right (RTL)

export const VIEWS = {
  globe: { center: [38, 18], zoom: 1.6, pitch: 0, bearing: 0, padding: NO_PAD },
  strait: { center: [43.33, 12.58], zoom: 10.6, pitch: 0, bearing: 0, padding: textSide() },
  tilted: { center: [43.33, 12.6], zoom: 11.6, pitch: 55, bearing: -18, padding: textSide() },
  dashboard: { center: [43.33, 12.62], zoom: 12, pitch: 52, bearing: -22, padding: NO_PAD },
};

// centre the intro and dashboard views on our ship
export function focusViews(lon, lat) {
  ['strait', 'tilted', 'dashboard'].forEach((k) => {
    VIEWS[k].center = [lon, lat];
  });
  VIEWS.strait.padding = textSide();
  VIEWS.tilted.padding = textSide();
}

const MapStage = forwardRef(function MapStage(
  { demo, showShips = true, showDark = true, showTrails = true, showRings = true, selectedId, onSelect, dim = 0 },
  ref,
) {
  const el = useRef(null);
  const map = useRef(null);
  const overlay = useRef(null);
  const ready = useRef(false);

  useImperativeHandle(ref, () => ({
    get map() {
      return map.current;
    },
    jump(view) {
      map.current?.jumpTo(view);
    },
    fly(view, duration = 2500) {
      map.current?.flyTo({ ...view, duration, essential: true });
    },
    follow(lon, lat, padding) {
      map.current?.jumpTo({ center: [lon, lat], padding });
    },
    flat() {
      // deck.gl layers line up with the flat (mercator) map
      if (map.current && map.current.getProjection()?.type !== 'mercator') {
        map.current.setProjection({ type: 'mercator' });
      }
    },
    interactive(on) {
      const m = map.current;
      if (!m) return;
      ['scrollZoom', 'dragPan', 'dragRotate', 'touchZoomRotate', 'doubleClickZoom', 'keyboard', 'boxZoom'].forEach(
        (h) => (on ? m[h].enable() : m[h].disable()),
      );
    },
    globe() {
      if (map.current && map.current.getProjection()?.type !== 'globe') {
        map.current.setProjection({ type: 'globe' });
      }
    },
  }));

  useEffect(() => {
    const m = new MapLibreMap({
      container: el.current,
      style: STYLE,
      ...VIEWS.globe,
      attributionControl: { compact: true },
      maxPitch: 70,
    });
    map.current = m;
    overlay.current = new MapboxOverlay({ interleaved: false, layers: [] });
    m.addControl(overlay.current);
    ['scrollZoom', 'dragPan', 'dragRotate', 'touchZoomRotate', 'doubleClickZoom', 'keyboard', 'boxZoom'].forEach((h) =>
      m[h].disable(),
    );
    m.on('load', () => {
      ready.current = true;
    });
    return () => m.remove();
  }, []);

  const own = demo.points.find((p) => p.track_id === 'own_ship');
  const visible = useMemo(
    () => demo.points.filter((p) => showDark || p.source !== 'radar_sim'),
    [demo.points, showDark],
  );
  const levelById = useMemo(() => new Map(visible.map((p) => [p.track_id, p])), [visible]);
  const trails = useMemo(() => (demo.tracks ? [...demo.tracks.values()] : []), [demo.tracks]);

  useEffect(() => {
    if (!overlay.current) return;
    if (!showShips) {
      overlay.current.setProps({ layers: [] });
      return;
    }
    const t = performance.now() / 1000;
    const layers = [];
    if (own && showRings) {
      layers.push(
        new ScatterplotLayer({
          id: 'rings',
          data: [
            { r: 2000, c: [34, 211, 238, 120] },
            { r: 1000, c: [245, 181, 71, 150] },
            { r: 500, c: [239, 68, 68, 170] },
          ],
          getPosition: () => [own.lon, own.lat],
          getRadius: (d) => d.r,
          getLineColor: (d) => d.c,
          stroked: true,
          filled: false,
          lineWidthMinPixels: 1.5,
          updateTriggers: { getPosition: [own.lon, own.lat] },
        }),
        new ScatterplotLayer({
          id: 'radar-pulse',
          data: [0, 1.25],
          getPosition: () => [own.lon, own.lat],
          getRadius: (o) => ((t + o) % 2.5) * 1400,
          getFillColor: (o) => [34, 211, 238, Math.max(0, 50 - ((t + o) % 2.5) * 20)],
          getLineColor: (o) => [34, 211, 238, Math.max(0, 160 - ((t + o) % 2.5) * 64)],
          stroked: true,
          lineWidthMinPixels: 1,
          updateTriggers: { getRadius: t, getFillColor: t, getLineColor: t, getPosition: [own.lon, own.lat] },
        }),
      );
    }
    if (showTrails) {
      layers.push(
        new TripsLayer({
          id: 'trails',
          data: trails.filter((d) => levelById.has(d.id)),
          getPath: (d) => d.path,
          getTimestamps: (d) => d.times,
          getColor: (d) => colorOf(levelById.get(d.id)),
          currentTime: demo.sec,
          trailLength: 25,
          widthMinPixels: 2,
          fadeTrail: true,
          capRounded: true,
          jointRounded: true,
          updateTriggers: { getColor: [demo.sec] },
        }),
      );
    }
    if (own) {
      layers.push(
        new LineLayer({
          id: 'threat-lines',
          data: visible.filter((p) => p.level === 'HIGH'),
          getSourcePosition: (p) => [p.lon, p.lat],
          getTargetPosition: () => [own.lon, own.lat],
          getColor: [239, 68, 68, 140],
          getWidth: 1.5,
          widthUnits: 'pixels',
        }),
      );
    }
    layers.push(
      new ScatterplotLayer({
        id: 'alarm-halo',
        data: visible.filter((p) => p.level === 'HIGH' || p.track_id === selectedId),
        getPosition: (p) => [p.lon, p.lat],
        getRadius: (p) => (p.track_id === selectedId ? 260 : 180 + Math.sin(t * 5) * 60),
        getFillColor: (p) => (p.track_id === selectedId ? [255, 255, 255, 30] : [239, 68, 68, 50]),
        getLineColor: (p) => (p.track_id === selectedId ? [255, 255, 255, 220] : [239, 68, 68, 200]),
        stroked: true,
        lineWidthMinPixels: 1.5,
        updateTriggers: { getRadius: [t, selectedId], getFillColor: selectedId, getLineColor: selectedId },
      }),
      ...[
        { id: 'own', filter: (p) => p.source === 'own', radius: 170, h: () => 700 },
        { id: 'ais', filter: (p) => p.source === 'ais', radius: 110, h: () => 380 },
        { id: 'dark', filter: (p) => p.source !== 'own' && p.source !== 'ais', radius: 80,
          h: (p) => (p.level === 'HIGH' ? 520 : p.level === 'MEDIUM' ? 360 : 220) },
      ].map(
        (g) =>
          new ColumnLayer({
            id: `ships-${g.id}`,
            data: visible.filter(g.filter),
            diskResolution: 12,
            radius: g.radius,
            extruded: true,
            pickable: true,
            getPosition: (p) => [p.lon, p.lat],
            getElevation: g.h,
            getFillColor: (p) => colorOf(p),
            onClick: ({ object }) => object && onSelect?.(object.track_id),
            updateTriggers: { getFillColor: [demo.sec], getElevation: [demo.sec] },
          }),
      ),
    );
    overlay.current.setProps({ layers });
  });

  return (
    <div className="absolute inset-0">
      <div ref={el} className="h-full w-full" />
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-700"
        style={{ background: 'radial-gradient(ellipse at center, transparent 40%, #030a14 100%)', opacity: 0.9 }}
      />
      <div
        className="pointer-events-none absolute inset-0 bg-abyss transition-opacity duration-700"
        style={{ opacity: dim }}
      />
    </div>
  );
});

export default MapStage;
export { LEVEL_COLOR, AIS_COLOR, OWN_COLOR };
