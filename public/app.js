import spektrum, {
  setValue, defineFn, addSystem, bindDOM, run, appState,
} from 'spektrum';
import { autoSave, loadHistory } from 'spektrum/persist';
import { mount as mountDevtools } from 'spektrum/devtools';
import { formatDate, mapHourly, nowKey, parseQuery } from './lib.js';

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
  url.searchParams.set('hourly', 'temperature_2m,weather_code,precipitation_probability,wind_speed_10m');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '1');
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

  return {
    id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: place.name,
    country,
  };
};

/** Marker must be the last setValue of a successful search so replay-to-marker lands on a settled state (loading=false). */
defineFn('searchCity', async () => {
  // searchInput is a data-ref (not data-model) so keystrokes don't enter history — typing while rewound can't fork it.
  const input = spektrum.refs.searchInput;
  const raw = (input?.value || '').trim();
  if (!raw) return;

  // Fast-forward to head before mutating; mutating from a rewound cursor would fork history and invalidate stored marker indices.
  if (spektrum.cursor < spektrum.history.length) {
    spektrum.replay(spektrum.history.length);
    if (input) input.value = raw;
  }

  setValue('loading', true);
  setValue('error', null);
  let marker = null;
  try {
    const place = await geocode(parseQuery(raw));
    marker = await loadForecast(place);
  } catch (err) {
    setValue('error', err.message || String(err));
  } finally {
    setValue('loading', false);
  }
  if (marker) setValue('_searchMarker', marker);
});

/** Rendered imperatively because the list itself must not time-travel — only the `.current` highlight does, driven by the `_searchMarker` system. */
const renderSearches = () => {
  const list = spektrum.refs.searchList;
  if (!list) return;

  const markers = [];
  for (let i = 0; i < spektrum.history.length; i++) {
    const e = spektrum.history[i];
    if (e.op === 'set' && e.path === '_searchMarker' && e.value) {
      markers.push({ idx: i, ...e.value });
    }
  }

  const currentId = appState._searchMarker?.id;

  list.replaceChildren(...markers.map((m) => {
    const li = document.createElement('li');
    li.className = 'search-pill' + (m.id === currentId ? ' current' : '');
    li.dataset.idx = String(m.idx);
    li.title = `Rewind to ${m.name}${m.country ? ', ' + m.country : ''}`;
    li.innerHTML = `<span class="pill-name">${m.name}</span>` +
      (m.country ? `<span class="pill-cc">${m.country}</span>` : '');
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
  setValue('_searchMarker', null);
}

// Systems must be registered AFTER loadHistory: spektrum.reset() (called
// inside loadHistory) wipes the systems array, so anything subscribed
// before this point would be silently detached on a returning visit.
addSystem(['_searchMarker'], renderSearches);
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

spektrum.refs.searchList?.addEventListener('click', (ev) => {
  const li = ev.target.closest('.search-pill');
  if (!li) return;
  const idx = Number(li.dataset.idx);
  if (Number.isFinite(idx)) spektrum.replay(idx + 1);
});

autoSave(spektrum, { debounce: 500 });

if (new URL(location.href).searchParams.has('dev')) {
  mountDevtools(spektrum);
}

if (!restored) {
  (async () => {
    setValue('loading', true);
    let marker = null;
    try {
      marker = await loadForecast({
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
    if (marker) setValue('_searchMarker', marker);
  })();
}
