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

/** Build an Intl formatter that prints `HH:MM` in the given timezone (DST-aware).
 *  Falls back to the user's browser timezone if `timezone` is missing or invalid. */
const makeTimeFormatter = (timezone) => {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: timezone || undefined,
    });
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }
};

/** Build an Intl formatter that produces the YYYY-MM-DDTHH key in the given
 *  timezone. Used to match radar frames (UTC unix seconds) against Open-Meteo's
 *  city-local hourly forecast (which prefixes each entry with that key). */
const cityHourFormatters = new Map();
const cityHourKey = (timezone, date) => {
  if (!timezone) return null;
  let fmt = cityHourFormatters.get(timezone);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', hour12: false,
      });
    } catch { return null; }
    cityHourFormatters.set(timezone, fmt);
  }
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour.padStart(2, '0')}`;
};

const makeBaseLayer = (L, name) => {
  const cfg = STYLES[name] ?? STYLES.dark;
  return L.tileLayer(cfg.url, cfg);
};

/** Mount a map at `el`, centered on (lat, lon), with the latest radar overlay.
 *  Returns a handle for panning, stepping frames, play/pause, swapping base
 *  styles, and tearing down. */
export const mountMap = async (el, { lat, lon, style = 'dark', timezone, hourly }) => {
  const L = await ensureLeaflet();
  const manifest = await fetchRadarManifest();

  const map = L.map(el, {
    zoomControl: true,
    attributionControl: true,
    minZoom: 4,
    maxZoom: 12,
    worldCopyJump: true,
  }).setView([lat, lon], 6);

  let baseLayer = makeBaseLayer(L, style).addTo(map);

  // Half-size of Leaflet's default marker (25×41 → 13×21). Default's image
  // auto-detection breaks when Leaflet is loaded as ESM from a CDN, so the
  // image URLs are pinned to the same unpkg version we imported the lib from.
  const markerIcon = L.icon({
    iconUrl: `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/images/marker-icon.png`,
    iconRetinaUrl: `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/images/marker-icon-2x.png`,
    shadowUrl: `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/images/marker-shadow.png`,
    iconSize:    [13, 21],
    iconAnchor:  [6, 21],
    popupAnchor: [1, -17],
    shadowSize:  [21, 21],
  });
  const marker = L.marker([lat, lon], { icon: markerIcon }).addTo(map);

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
  // The radar shows weather over the searched region — labelling timestamps in
  // *that* region's wall-clock time (DST-aware via Intl) is what users expect,
  // not the user's browser timezone (which can differ for travellers / VPNs).
  let timeFormatter = makeTimeFormatter(timezone);
  let mapTimezone = timezone;
  let hourlyForecast = Array.isArray(hourly) ? hourly : [];

  // Precip indicator: a small badge in the map's top-right corner that
  // shows the Open-Meteo hourly precipitation probability for the hour
  // matching the current radar frame (city-local timezone, DST-aware).
  const PrecipControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const div = L.DomUtil.create('div', 'leaflet-control-precip');
      div.innerHTML = '<span class="precip-icon" aria-hidden="true">💧</span><span class="precip-value">—</span>';
      return div;
    },
  });
  const precipControl = new PrecipControl().addTo(map);

  const updatePrecip = () => {
    const valueEl = precipControl.getContainer()?.querySelector('.precip-value');
    if (!valueEl) return;
    const frame = manifest.frames[frameIdx];
    if (!frame || !hourlyForecast.length || !mapTimezone) {
      valueEl.textContent = '—';
      return;
    }
    const key = cityHourKey(mapTimezone, new Date(frame.time * 1000));
    if (!key) { valueEl.textContent = '—'; return; }
    const hour = hourlyForecast.find((h) => h.time?.slice(0, 13) === key);
    if (!hour) { valueEl.textContent = '—'; return; }
    const prob = hour.precipProb ?? 0;
    valueEl.textContent = `${String(prob).padStart(2, '0')}%`;
  };

  const showFrame = (idx) => {
    if (idx < 0 || idx >= radarLayers.length) return;
    radarLayers[frameIdx]?.setOpacity(0);
    radarLayers[idx].setOpacity(0.7);
    frameIdx = idx;
    onFrameChange?.(getFrame());
    updatePrecip();
  };

  const getFrame = () => {
    const frame = manifest.frames[frameIdx];
    const time = timeFormatter.format(new Date(frame.time * 1000));
    const isNow = frameIdx === manifest.nowIndex;
    const isForecast = frameIdx > manifest.nowIndex;
    let label = time;
    if (isNow) label = `${time} · now`;
    else if (isForecast) label = `${time} · forecast`;
    return { idx: frameIdx, total: manifest.frames.length, label, isNow, isForecast };
  };

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
  updatePrecip();

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
    setTimezone: (tz) => {
      mapTimezone = tz;
      timeFormatter = makeTimeFormatter(tz);
      onFrameChange?.(getFrame());
      updatePrecip();
    },
    setHourly: (arr) => {
      hourlyForecast = Array.isArray(arr) ? arr : [];
      updatePrecip();
    },
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
