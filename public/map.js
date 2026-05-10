/**
 * Lazy-loaded Leaflet wrapper. Mounts a satellite map with an animated
 * RainViewer precipitation overlay. Self-contained — talks to the rest
 * of the app only via the small handle returned from `mountMap()`.
 */

const LEAFLET_VERSION = '1.9.4';
const LEAFLET_CSS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
const LEAFLET_JS  = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet-src.esm.js`;

const RAINVIEWER_MANIFEST = 'https://api.rainviewer.com/public/weather-maps.json';
const FRAME_INTERVAL_MS = 650;

const STYLES = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>',
    maxZoom: 18,
  },
};

let leafletModule = null;

const ensureLeaflet = async () => {
  if (leafletModule) return leafletModule;
  // Inject CSS once.
  if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = LEAFLET_CSS;
    document.head.appendChild(css);
  }
  const mod = await import(LEAFLET_JS);
  // Leaflet's ESM build exposes the namespace as `default`, but some bundlers flatten it.
  leafletModule = mod.default ?? mod;
  return leafletModule;
};

const fetchRadarManifest = async () => {
  const res = await fetch(RAINVIEWER_MANIFEST);
  if (!res.ok) throw new Error('RainViewer manifest fetch failed');
  const data = await res.json();
  const past = data.radar?.past ?? [];
  const nowcast = data.radar?.nowcast ?? [];
  return {
    host: data.host,
    frames: [...past, ...nowcast],
    nowIndex: Math.max(0, past.length - 1),
  };
};

const labelForFrame = (frame, nowIndex, idx) => {
  const d = new Date(frame.time * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const time = `${hh}:${mm}`;
  return idx === nowIndex ? `${time} · now` : time;
};

const makeBaseLayer = (L, name) => {
  const cfg = STYLES[name] ?? STYLES.dark;
  return L.tileLayer(cfg.url, cfg);
};

/** Mount a map at `el`, centered on (lat, lon), with the latest radar overlay.
 *  Returns a handle for panning, stepping frames, play/pause, swapping base
 *  styles, and tearing down. */
export const mountMap = async (el, { lat, lon, style = 'dark' }) => {
  const L = await ensureLeaflet();
  const manifest = await fetchRadarManifest();

  const map = L.map(el, {
    zoomControl: true,
    attributionControl: true,
    minZoom: 4,
    maxZoom: 12,
    worldCopyJump: true,
  }).setView([lat, lon], 8);

  let baseLayer = makeBaseLayer(L, style).addTo(map);

  const marker = L.marker([lat, lon]).addTo(map);

  // Pre-create a tile layer per frame at zero opacity. Cycling animation just
  // toggles opacity instead of recreating layers — buttery-smooth playback
  // and tiles stay cached after first paint.
  // RainViewer's public radar tiles only exist up to z=7 — at z=8+ the API
  // returns a "Zoom level not supported" placeholder PNG. `maxNativeZoom` caps
  // tile requests at z=7 and lets Leaflet upscale those for higher map zooms.
  const radarLayers = manifest.frames.map((frame) =>
    L.tileLayer(`${manifest.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, {
      opacity: 0,
      maxNativeZoom: 7,
      maxZoom: 12,
      attribution: 'Radar &copy; <a href="https://www.rainviewer.com" target="_blank" rel="noopener">RainViewer</a>',
    }).addTo(map),
  );

  let frameIdx = manifest.nowIndex;
  let playing = false;
  let intervalId = 0;
  let onFrameChange = null;

  const showFrame = (idx) => {
    if (idx < 0 || idx >= radarLayers.length) return;
    radarLayers[frameIdx]?.setOpacity(0);
    radarLayers[idx].setOpacity(0.7);
    frameIdx = idx;
    onFrameChange?.(getFrame());
  };

  const getFrame = () => ({
    idx: frameIdx,
    total: manifest.frames.length,
    label: labelForFrame(manifest.frames[frameIdx], manifest.nowIndex, frameIdx),
    isNow: frameIdx === manifest.nowIndex,
  });

  const next = () => showFrame((frameIdx + 1) % manifest.frames.length);
  const prev = () => showFrame((frameIdx - 1 + manifest.frames.length) % manifest.frames.length);

  const play = () => {
    if (playing) return;
    playing = true;
    intervalId = setInterval(next, FRAME_INTERVAL_MS);
    onFrameChange?.(getFrame());
  };
  const pause = () => {
    if (!playing) return;
    playing = false;
    clearInterval(intervalId);
    intervalId = 0;
    onFrameChange?.(getFrame());
  };
  const togglePlay = () => (playing ? pause() : play());

  // Show the "now" frame on load so the radar overlay is visible immediately.
  radarLayers[frameIdx].setOpacity(0.7);

  return {
    panTo: (newLat, newLon) => {
      map.setView([newLat, newLon], map.getZoom());
      marker.setLatLng([newLat, newLon]);
    },
    next, prev, play, pause, togglePlay,
    isPlaying: () => playing,
    getFrame,
    onFrame: (fn) => { onFrameChange = fn; },
    invalidateSize: () => map.invalidateSize(),
    setStyle: (name) => {
      if (!STYLES[name]) return;
      // Add the replacement first, push it to the back so it doesn't paint over
      // the radar layers, then drop the previous base. Avoids a flash of empty map.
      const next = makeBaseLayer(L, name).addTo(map);
      next.bringToBack();
      map.removeLayer(baseLayer);
      baseLayer = next;
    },
    destroy: () => { pause(); map.remove(); },
  };
};
