# Changelog

All notable changes to Skyo. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning is [SemVer](https://semver.org/spec/v2.0.0.html), with the caveat that
0.x minor bumps may include breaking UX or state-shape changes.

## [0.4.7] – 2026-05-10

### Added
- **Map auto-hide on third-party failure** — if any of the services the radar map depends on fails (Leaflet ESM from unpkg, RainViewer manifest from `tilecache.rainviewer.com`, or Leaflet's own `L.map()` constructor), the catch block in `ensureMap()` now sets a `mapAvailable` state flag to `false` and the entire `.weather-map-section` is gated on `(mapAvailable ?? true)` — the section disappears cleanly instead of showing a half-broken or empty map. A successful mount on a later page load flips the flag back to `true`, so transient outages self-correct without intervention.
- **Forecast retry button** — the error banner gets a small `Retry` pill that calls `refetchForecast()` (addAsync's run handle), gated on the existing `loading` state. Lets users recover from transient Open-Meteo / network failures without reloading the page.

### Notes
- Other failure modes (broken individual map tiles, partial CDN slowness) are silent at the network layer — Leaflet shows placeholder tiles and there's no JS error to hook into. Those are accepted as graceful-degradation cases (visible-but-incomplete) rather than auto-hidden, since hiding the map for a single bad tile would be over-aggressive.

## [0.4.6] – 2026-05-10

### Added
- **iOS Add-to-Home-Screen hint modal** — iOS Safari/Chrome have no programmatic API for triggering the install dialog (`beforeinstallprompt` is Chromium-only). Tapping the home button on an iOS device that isn't already running standalone now surfaces a custom in-page modal with the manual three-tap flow (Share → scroll → Add to Home Screen). Reload at `?city=` is deferred until the user dismisses the modal so the home save promise stays honoured. Android / desktop Chromium continue to get the OS install dialog via the captured `beforeinstallprompt`.

## [0.4.5] – 2026-05-10

### Added
- **Home button** — a small house-outline icon at the trailing edge of the search bar saves the current city to `localStorage['skyo:home']` and reloads the page with `?city=<city>` so the URL is bookmark/share-friendly.
- **PWA install trigger** — same Home button now also offers the OS Add-to-Home-Screen dialog on Android Chrome / desktop Chrome (via `beforeinstallprompt`). iOS Safari has no programmatic API; iOS users still get the manifest + apple-touch-icons and can use Share → Add to Home Screen manually.
- **`?city=` URL parameter** — initial location can be set via a query string. Priority chain on init: `?city=` (always wins) > `localStorage['skyo:home']` (fresh installs only) > spektrum-restored `searchQuery` > `'Rotterdam, NL'` fallback.
- **Precipitation badge on the map** — top-right `L.Control` shows `💧 NN%` for the radar frame's matching hour. Frame match uses a city-local hour key (`Intl.DateTimeFormat` with the searched location's timezone), so it works for past frames, "now", and nowcast/forecast frames alike.
- **Forecast frame labels** — RainViewer nowcast frames (when present) now display as `15:30 · forecast` instead of being indistinguishable from past frames. `isForecast` flag on the frame object for future styling hooks.
- **Always-visible precip%** on hour cards — even at 0% (formerly hidden). Single-digit values are zero-padded to two digits via a new `precipLabel` derivation in `mapHourly`, so `00%`, `05%`, `90%` all render with consistent width.

### Changed
- **Map base map** — initial zoom 8 → 6 (wider regional view). RainViewer radar tiles are still capped at `maxNativeZoom: 7` and upscale cleanly.
- **Map marker** — half-size of Leaflet's default (25×41 → 13×21) for less visual noise on the new wider zoom.
- **Map style toggle (sun/moon)** — moved from the radar-controls bar (gated on `mapVisible`) to the map header, so the toggle is always reachable regardless of expansion state. Uses `(mapDark ?? true)` defaulting so older restored sessions without `mapDark` render correctly.
- **Map timestamps** — switched from `Date.getHours()` (browser timezone) to `Intl.DateTimeFormat` with the searched city's timezone (DST-aware, robust to misconfigured browsers / VPNs / containers). New `setTimezone()` method on the map handle, fed by Open-Meteo's `data.timezone`.
- **Tomorrow tab** — hides the radar section entirely (RainViewer has no real forecast tiles for tomorrow). Animation pauses while hidden; `invalidateSize()` runs on switch back so the now-visible container repaints.
- **Mobile home-button position** — pinned to the top-right corner of `.card-head` via absolute positioning instead of flex-positioned in the search-bar, so it never clips off-screen on narrow viewports.

### Fixed
- **`?city=` ignored on returning sessions** — the override on restored history now normalises whitespace before the equality check, so `Rotterdam,NL` and `Rotterdam, NL` don't trigger a needless re-fetch and an explicit URL change always wins over the localStorage home.
- **Test fixture timezone** — `nowKey` test was using the non-existent `Europe/Rotterdam` IANA zone; restored to the canonical `Europe/Amsterdam` (the IANA tz database uses Amsterdam for the entire NL).

## [0.4.4] – 2026-05-10

### Added
- **Home-screen / PWA icons** — full apple-touch-icon set (180/167/152/120) and 192/512 manifest icons under `public/icons/` (sips-converted from the JPEG-content-with-PNG-extension source files in `public/AppIcons/`).
- **Web manifest** (`public/manifest.webmanifest`) declaring Skyo as a `display: standalone` PWA with the synthwave background colour.
- **Apple-mobile-web-app meta tags** so iOS launches the installed app full-screen with a translucent dark status bar.

### Changed
- `build.js` copies the `icons/` directory + `manifest.webmanifest` to `dist/`. Path-rewrite (`/` → `./`) keeps the manifest reachable under the GitHub Pages subpath.

## [0.4.3] – 2026-05-09

### Fixed
- **Concurrent map mount race** — `ensureMap()` could be called concurrently by both the explicit init at module bottom and the `watch(['location'])` system fired by addAsync's first resolved fetch. Both passed the `if (mapInstance) return` guard before either's `await mountMap()` completed, then the second tried to attach Leaflet to the same DOM node and threw "Map container is already initialized." Added a `mapMounting` promise lock so concurrent calls share the same in-flight mount.
- **Stale checkpoint read** — `searchCity` was reading `appState.forecast.data` immediately after `await refetchForecast()`, but addAsync's `set('data', ...)` writes go to the delta and aren't committed until the next rAF tick. Added an explicit `spektrum.tick()` between the refetch and the read; checkpoint is also gated on `!appState.forecast.error` so failed searches don't get pinned to the time-travel pills.
- **Map error path** — switched the `ensureMap` catch from `setValue('forecast.error', ...)` (which interfered with addAsync's lifecycle) to `console.error`. Map errors aren't forecast errors.

## [0.4.2] – 2026-05-09

### Changed
- **Radar time label centred** — `.map-frame` now uses `margin: 0 auto` so it sits centred between the playback buttons (left) and the dark/satellite toggle (right) instead of pushed to the right edge.

## [0.4.1] – 2026-05-09

### Added
- **Dark / satellite map style toggle** — sun/moon button next to the radar time label cycles between CartoDB Dark Matter and Esri World Imagery satellite. Choice persists via spektrum history. Icon follows the destination convention (☀ when dark = "click for light"). Layer swap uses Leaflet's `bringToBack()` so the radar overlay stays visible during transition.

## [0.4.0] – 2026-05-09

### Added
- **PWA-like display fixes for precip** — hour cards always render the `💧 X%` indicator (formerly hidden when 0%). New `precipLabel` field in `mapHourly` zero-pads single-digit values.

### Changed
- **Migrated to spektrum 0.5** —
  - Eager `computed` lets us drop the manual priming pass for `selectedHours` / `hoursAM` / `hoursPM` / `summary` / `hoursPreview`. Computed values now prime synchronously on registration.
  - `data-cloak` directive replaces the body-class FOUC dance + ~12 lines of CSS+JS. CDN-failure keyframe stays as a safety net.
  - `watch(deps, fn)` alias used in place of `addSystem` for readability.
  - **`addAsync('forecast', buildForecast)`** owns `forecast.{loading,data,error}`. The hand-rolled try/catch/finally + 5 setValue calls in `loadForecast` and the ad-hoc auto-load IIFE collapsed into one `return` from `buildForecast`. `searchCity`: `setValue('searchQuery', raw)` + `tick()` + `await refetchForecast()` + `checkpoint`.
  - **Bridge `computed`s** keep templates unchanged: `location` / `hourly` / `currentTemp` / `currentIcon` / `loading` / `error` derive from `forecast.{data,…}`.

## [0.3.1] – 2026-05-09

### Changed
- **Search row + title share a row on desktop** via a new `.card-head` flex wrapper. Search button positioned absolutely inside the input (4px inset, rounded) so the form reads as a single compact pill.
- **Mobile** keeps the previous stacked layout — `.card-head` flips to flex-column.
- **Footer credits** split into two spans with a `·` separator span. Mobile hides the separator and stacks the credits in a flex-column at the right edge; social icons stay left.

## [0.3.0] – 2026-05-09

### Added
- **Radar map** — a CartoDB-Dark base map centred on the searched city, with animated RainViewer precipitation overlay (past 2h + nowcast frames, ~650 ms playback). Collapses to a 90 px sliver by default; expand for the 320 px full view.
- **`public/map.js`** — self-contained Leaflet wrapper, lazy-loaded from unpkg. Pre-builds one tile layer per radar frame at zero opacity and animates by toggling opacities (smooth playback, tiles cache after first paint).
- **Frame timestamp** in actual clock time (`HH:MM`) with `· now` on the live frame.

### Fixed
- **RainViewer "Zoom level not supported" placeholder** — verified empirically that RainViewer's free public radar tiles only exist up to z=7. Capped the radar layer with `maxNativeZoom: 7` so Leaflet upscales z=7 tiles for higher map zooms instead of fetching the placeholder PNG.

## [0.2.0] – 2026-05-09

### Added
- **Background SVG chart** with two synthwave-neon flowing curves (temp, wind) following the selected day. Catmull-Rom smoothing, neon-glow filter, rise/fall gradient stops, viewport-sized viewBox so labels stay crisp at any width. Faint grid + sparse value labels.
- **Day tabs** (Today / Tomorrow) via `forecast_days=2` from Open-Meteo, splitting the 48-hour response into per-day buckets.
- **Hourly section header + collapse/expand** — collapses by default to a 3-card preview (current + next two hours).
- **Site footer** with social links + open-meteo + spektrum credits.

### Changed
- **Rebrand**: "Hourly Weather" → **Skyo · your sky, instantly**. New gradient title.
- **Zero npm dependencies**:
  - Removed Express + `server.js`. `npm start` now shells `npx http-server`.
  - Spektrum loads at runtime from unpkg (`spektrum@0`).
  - `spektrum/devtools` is dynamic-imported only on `?dev`.
- **Test fixture** — `test/fixtures/spektrum.js` vendored so node tests run against the same engine as the browser.
- **Migrated to spektrum 0.4 APIs** — `_searchMarker` synthetic state path retired in favour of `checkpoint()`; manual derived setValues replaced with `computed`.
- **FOUC fix** — `.card` starts at `opacity: 0`; revealed once `bindDOM()` has filled templates. Keyframe fallback ensures the card still appears if the JS module fails to load.

## [0.1.0] – 2026-05-06

### Added
- Initial release: hourly weather app powered by spektrum time-travel.
- Open-Meteo geocoding + forecast integration (temp, weather code, precipitation probability, wind speed/direction).
- Search-history pills with replay-to-checkpoint time-travel.
- Synthwave horizon grid + glowing sun visual treatment.
- Hourly grid with WMO-code emoji icons.
