import spektrum, {
  setValue, defineFn, watch, bindDOM, run, appState,
  checkpoint, computed, addAsync,
} from 'spektrum';
import { autoSave, loadHistory } from 'spektrum/persist';
import {
  formatDate, mapHourly, nowKey, parseQuery,
  partitionDay, partitionByDay, summarizeDay,
} from './lib.js';
import { renderBgChart } from './chart.js';
import { mountMap } from './map.js';

const geocode = async ({ name, country }) => {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', name);
  url.searchParams.set('count', '5');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');
  const res = await fetch(url);
  if (!res.ok) throw new Error('Geocoding failed');
  const { results } = await res.json();
  if (!results || results.length === 0) throw new Error(`No matches for "${name}"`);
  if (country) {
    const filtered = results.filter((r) => r.country_code === country);
    if (filtered.length) return filtered[0];
  }
  return results[0];
};

/** addAsync fn: takes no args, reads `searchQuery` from state, returns the full forecast bundle. */
const buildForecast = async () => {
  const raw = appState.searchQuery;
  if (!raw) return null;
  const place = await geocode(parseQuery(raw));

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', place.latitude);
  url.searchParams.set('longitude', place.longitude);
  url.searchParams.set('hourly', 'temperature_2m,weather_code,precipitation_probability,wind_speed_10m,wind_direction_10m');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '2');
  const res = await fetch(url);
  if (!res.ok) throw new Error('Forecast fetch failed');
  const data = await res.json();

  const hourly = mapHourly(data.hourly, nowKey(data.timezone));
  const todayDate = new Date(data.hourly.time[0]);
  const current = hourly.find((h) => h.isNow) ?? hourly[0];
  const country = place.country_code || place.country || '';

  return {
    location: {
      name: place.name,
      country,
      latitude: place.latitude,
      longitude: place.longitude,
      date: formatDate(todayDate),
    },
    hourly,
    current: { temp: current.temp, icon: current.icon },
  };
};

defineFn('toggleHours', () => {
  setValue('hoursCollapsed', !appState.hoursCollapsed);
});

defineFn('selectDay', (_el, _state, _delta, value) => {
  setValue('selectedDay', value);
});

// --- Map (lazy-loaded Leaflet + RainViewer radar) ---

let mapInstance = null;

// Animation state lives in module scope, NOT spektrum state: scrubbing through
// frames at 650ms each would otherwise produce a setValue per frame, polluting
// history and writing to localStorage on every tick.
const refreshMapUI = () => {
  const playBtn = spektrum.refs.mapPlayBtn;
  const label = spektrum.refs.mapFrameLabel;
  if (playBtn) playBtn.textContent = mapInstance?.isPlaying() ? '⏸' : '▶';
  if (label) label.textContent = mapInstance?.getFrame()?.label ?? '—';
};

// Concurrent-mount lock. Without this, the explicit init at module bottom and
// the `watch(['location'])` system can both call `ensureMap()` while the first
// `mountMap()` is still awaiting Leaflet/manifest — both then try to attach
// Leaflet to the same DOM node and the second throws "Map container is
// already initialized."
let mapMounting = null;

const ensureMap = () => {
  if (mapInstance) return Promise.resolve();
  if (mapMounting) return mapMounting;
  const el = spektrum.refs.weatherMap;
  if (!el) return Promise.resolve();
  const lat = appState.location?.latitude;
  const lon = appState.location?.longitude;
  if (lat == null || lon == null) return Promise.resolve();
  mapMounting = (async () => {
    try {
      mapInstance = await mountMap(el, { lat, lon, style: appState.mapDark ? 'dark' : 'satellite' });
      mapInstance.onFrame(refreshMapUI);
      refreshMapUI();
      if (appState.mapVisible) {
        mapInstance.play();
        refreshMapUI();
      }
    } catch (err) {
      console.error('[skyo] map mount failed:', err);
    } finally {
      mapMounting = null;
    }
  })();
  return mapMounting;
};

defineFn('toggleMap',       () => { setValue('mapVisible', !appState.mapVisible); });
defineFn('toggleMapStyle',  () => { setValue('mapDark', !appState.mapDark); });
defineFn('mapPlayPause',    () => { mapInstance?.togglePlay(); refreshMapUI(); });
defineFn('mapPrev',         () => { mapInstance?.pause(); mapInstance?.prev(); refreshMapUI(); });
defineFn('mapNext',         () => { mapInstance?.pause(); mapInstance?.next(); refreshMapUI(); });

/** searchCity flow: write the new query, force a tick so addAsync's fn sees it,
 *  then refetch. The checkpoint is recorded after the fetch settles so replay-to-
 *  checkpoint lands on a settled (loading=false, data populated) state. */
defineFn('searchCity', async () => {
  // searchInput is a data-ref (not data-model) so keystrokes don't enter history — typing while rewound can't fork it.
  const input = spektrum.refs.searchInput;
  const raw = (input?.value || '').trim();
  if (!raw) return;

  // Fast-forward to head before mutating; mutating from a rewound cursor would fork history and invalidate stored checkpoint indices.
  if (spektrum.cursor < spektrum.history.length) {
    spektrum.replay(spektrum.history.length);
    if (input) input.value = raw;
  }

  setValue('searchQuery', raw);
  // tick() commits the delta synchronously so buildForecast reads the fresh searchQuery.
  // Without it, fn() would run with the previous value (rAF hasn't ticked yet).
  spektrum.tick();
  await refetchForecast();
  // refetchForecast's set('data', ...) writes to the delta; another tick
  // commits it so we read the fresh forecast.data (instead of stale) below.
  spektrum.tick();
  if (appState.forecast?.data && !appState.forecast.error) {
    const { name, country } = appState.forecast.data.location;
    checkpoint('search', { name, country });
  }
});

/** Rendered imperatively because the list itself must not time-travel — only the `.current` highlight does. */
const renderSearches = () => {
  const list = spektrum.refs.searchList;
  if (!list) return;

  const cps = spektrum.checkpoints;
  // "Current" = the latest checkpoint at-or-before the cursor. After replay(idx + 1) the cursor sits one past the checkpoint we replayed to.
  let currentIdx = -1;
  for (const cp of cps) {
    if (cp.index < spektrum.cursor) currentIdx = cp.index;
  }

  list.replaceChildren(...cps.map((cp) => {
    const { name = '', country = '' } = cp.value ?? {};
    const li = document.createElement('li');
    li.className = 'search-pill' + (cp.index === currentIdx ? ' current' : '');
    li.dataset.idx = String(cp.index);
    li.title = `Rewind to ${name}${country ? ', ' + country : ''}`;
    li.innerHTML = `<span class="pill-name">${name}</span>` +
      (country ? `<span class="pill-cc">${country}</span>` : '');
    return li;
  }));
};

const restored = loadHistory(spektrum);

if (!restored) {
  setValue('searchQuery', 'Amsterdam, NL');
  setValue('hoursCollapsed', true);
  setValue('selectedDay', 0);
  setValue('mapVisible', false);
  setValue('mapDark', true);
  // Commit defaults to appState before addAsync registers — its auto-run-on-register
  // calls fn() synchronously and reads `searchQuery` from appState.
  spektrum.tick();
}

// addAsync owns `forecast.{loading,data,error}` and auto-runs once on registration,
// fetching for whatever `searchQuery` is in state (restored or default Amsterdam).
const refetchForecast = addAsync('forecast', buildForecast);

// Bridge `forecast.{data,loading,error}` back to the flat paths the templates use.
// Keeps the migration zero-template-change. Eager `computed` (0.5+) primes these
// synchronously so the very first paint reads sane values.
computed('location', ['forecast.data'], (s) =>
  s.forecast?.data?.location ?? { name: '', country: '', date: '' });
computed('hourly',      ['forecast.data'],    (s) => s.forecast?.data?.hourly ?? []);
computed('currentTemp', ['forecast.data'],    (s) => s.forecast?.data?.current?.temp ?? '');
computed('currentIcon', ['forecast.data'],    (s) => s.forecast?.data?.current?.icon ?? '');
computed('loading',     ['forecast.loading'], (s) => s.forecast?.loading ?? false);
computed('error',       ['forecast.error'],   (s) => s.forecast?.error ?? null);

// Existing day-bucket / summary derivations.
const selectedHoursOf = (s) => {
  const days = partitionByDay(s.hourly ?? []);
  return days[s.selectedDay ?? 0]?.hours ?? [];
};
const hoursPreviewOf = (selected, day) => {
  const all = selected ?? [];
  // Today: anchor on the current hour. Other days: show the first three hours of that day.
  if ((day ?? 0) === 0) {
    const nowIdx = all.findIndex((h) => h.isNow);
    const start = nowIdx >= 0 ? nowIdx : 0;
    return all.slice(start, start + 3);
  }
  return all.slice(0, 3);
};

computed('selectedHours', ['hourly', 'selectedDay'], selectedHoursOf);
computed('hoursAM',  ['selectedHours'], (s) => partitionDay(s.selectedHours ?? []).am);
computed('hoursPM',  ['selectedHours'], (s) => partitionDay(s.selectedHours ?? []).pm);
computed('summary',  ['selectedHours'], (s) => summarizeDay(s.selectedHours ?? []));
computed('hoursPreview', ['selectedHours', 'selectedDay'], (s) => hoursPreviewOf(s.selectedHours, s.selectedDay));

const drawChart = () => renderBgChart(spektrum.refs.bgChart, appState.selectedHours);
watch(['selectedHours'], drawChart);
// `hourly` changes on every search and on every replay, which is exactly when the pill list's "current" highlight needs to refresh.
watch(['hourly'], renderSearches);
// The map renders persistently (sliver when collapsed, full when expanded), so
// it mounts on the first location we have and pans on subsequent searches.
watch(['location'], () => {
  if (appState.location?.latitude == null) return;
  if (!mapInstance) ensureMap();
  else mapInstance.panTo(appState.location.latitude, appState.location.longitude);
});
// Toggling visibility: pause the radar when collapsed (saves tile fetches),
// play when expanded, and let Leaflet recompute tile layout after the height
// CSS transition finishes.
watch(['mapDark'], () => {
  mapInstance?.setStyle(appState.mapDark ? 'dark' : 'satellite');
});
watch(['mapVisible'], () => {
  if (!mapInstance) return;
  if (appState.mapVisible) {
    mapInstance.play();
    setTimeout(() => mapInstance?.invalidateSize(), 320);
  } else {
    mapInstance.pause();
    setTimeout(() => mapInstance?.invalidateSize(), 320);
  }
  refreshMapUI();
});
watch(['location'], () => {
  const input = spektrum.refs.searchInput;
  if (!input) return;
  if (document.activeElement === input) return;
  const loc = appState.location;
  if (!loc?.name) return;
  const display = loc.country ? `${loc.name}, ${loc.country}` : loc.name;
  if (input.value !== display) input.value = display;
});

bindDOM();
run();
renderSearches();
drawChart();
// addSystem doesn't fire on registration, so a restored `location` from a
// previous session wouldn't trigger the map mount. Mount it explicitly here.
if (appState.location?.latitude != null) ensureMap();

let resizeRAF = 0;
window.addEventListener('resize', () => {
  if (resizeRAF) cancelAnimationFrame(resizeRAF);
  resizeRAF = requestAnimationFrame(drawChart);
});

spektrum.refs.searchList?.addEventListener('click', (ev) => {
  const li = ev.target.closest('.search-pill');
  if (!li) return;
  const idx = Number(li.dataset.idx);
  if (Number.isFinite(idx)) spektrum.replay(idx + 1);
});

autoSave(spektrum, { debounce: 500 });

if (new URL(location.href).searchParams.has('dev')) {
  const { mount } = await import('spektrum/devtools');
  mount(spektrum);
}
