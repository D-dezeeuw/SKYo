import spektrum, {
  setValue, defineFn, addSystem, bindDOM, run, appState,
  checkpoint, computed,
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

const loadForecast = async (place) => {
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

  setValue('location', {
    name: place.name,
    country,
    latitude: place.latitude,
    longitude: place.longitude,
    date: formatDate(todayDate),
  });
  setValue('hourly', hourly);
  setValue('currentTemp', current.temp);
  setValue('currentIcon', current.icon);
  setValue('error', null);

  return { name: place.name, country };
};

// The built-in `toggle` data-fn is a DOM class toggler, not a state-path toggler.
// We need a state-path toggle for the hourly-forecast collapse, so define our own.
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

const ensureMap = async () => {
  if (mapInstance) return;
  const el = spektrum.refs.weatherMap;
  if (!el) return;
  const lat = appState.location?.latitude;
  const lon = appState.location?.longitude;
  if (lat == null || lon == null) return;
  try {
    mapInstance = await mountMap(el, { lat, lon });
    mapInstance.onFrame(refreshMapUI);
    // Animation off by default; the mapVisible system below starts it on expand.
    refreshMapUI();
    if (appState.mapVisible) {
      mapInstance.play();
      refreshMapUI();
    }
  } catch (err) {
    setValue('error', `Radar map failed: ${err.message ?? err}`);
  }
};

defineFn('toggleMap', () => {
  setValue('mapVisible', !appState.mapVisible);
});
defineFn('mapPlayPause', () => { mapInstance?.togglePlay(); refreshMapUI(); });
defineFn('mapPrev',     () => { mapInstance?.pause(); mapInstance?.prev(); refreshMapUI(); });
defineFn('mapNext',     () => { mapInstance?.pause(); mapInstance?.next(); refreshMapUI(); });

/** Checkpoint must be recorded after `loading=false` so replay-to-checkpoint lands on a settled state. */
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

  setValue('loading', true);
  setValue('error', null);
  let place = null;
  try {
    place = await loadForecast(await geocode(parseQuery(raw)));
  } catch (err) {
    setValue('error', err.message || String(err));
  } finally {
    setValue('loading', false);
  }
  if (place) checkpoint('search', place);
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
  setValue('location', { name: '', country: '', date: '' });
  setValue('hourly', []);
  setValue('loading', false);
  setValue('error', null);
  setValue('currentTemp', '');
  setValue('currentIcon', '');
  setValue('hoursCollapsed', true);
  setValue('selectedDay', 0);
  setValue('mapVisible', false);
}

// Systems + computed must be registered AFTER loadHistory: spektrum.reset() (called
// inside loadHistory) wipes them, so anything subscribed before this point would
// be silently detached on a returning visit.
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

// `computed()` is a thin wrapper over `addSystem`, which only fires when its deps
// CHANGE — not on registration. On refresh, loadHistory already restored `hourly`
// + `selectedDay`, so the computed values would stay undefined until the next
// mutation, leaving the hourly grid blank until the user clicks something.
// Prime the derived state once, synchronously, before bindDOM reads it.
const _selected = selectedHoursOf(appState);
appState.selectedHours = _selected;
appState.hoursAM       = partitionDay(_selected).am;
appState.hoursPM       = partitionDay(_selected).pm;
appState.summary       = summarizeDay(_selected);
appState.hoursPreview  = hoursPreviewOf(_selected, appState.selectedDay);

const drawChart = () => renderBgChart(spektrum.refs.bgChart, appState.selectedHours);
addSystem(['selectedHours'], drawChart);
// `hourly` changes on every search and on every replay, which is exactly when the pill list's "current" highlight needs to refresh.
addSystem(['hourly'], renderSearches);
// The map renders persistently (sliver when collapsed, full when expanded), so
// it mounts on the first location we have and pans on subsequent searches.
addSystem(['location'], () => {
  if (appState.location?.latitude == null) return;
  if (!mapInstance) ensureMap();
  else mapInstance.panTo(appState.location.latitude, appState.location.longitude);
});
// Toggling visibility: pause the radar when collapsed (saves tile fetches),
// play when expanded, and let Leaflet recompute tile layout after the height
// CSS transition finishes.
addSystem(['mapVisible'], () => {
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
addSystem(['location'], () => {
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
// Reveal the card now that templates are filled in — see `.card` opacity rule for the FOUC story.
document.body.classList.add('bound');

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

if (!restored) {
  (async () => {
    setValue('loading', true);
    let place = null;
    try {
      place = await loadForecast({
        name: 'Amsterdam',
        country_code: 'NL',
        latitude: 52.3676,
        longitude: 4.9041,
      });
    } catch (err) {
      setValue('error', err.message || String(err));
    } finally {
      setValue('loading', false);
    }
    if (place) checkpoint('search', place);
  })();
}
