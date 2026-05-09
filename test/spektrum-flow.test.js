import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createSpektrum } from 'spektrum';

/**
 * Mirrors the searchCity → loadForecast write order used in public/app.js.
 * The invariant under test: the `_searchMarker` setValue is the LAST entry
 * in a successful search, after `loading=false`. Replaying to a marker
 * therefore lands on a settled state — the bug we shipped and fixed when
 * the marker was set inside loadForecast (before the finally that cleared
 * loading), causing the submit button to stay stuck in its loading state
 * after clicking a past-search pill.
 */
const recordSearch = (sp, place) => {
  sp.setValue('loading', true);
  sp.setValue('error', null);
  sp.setValue('location', { name: place.name, country: place.country });
  sp.setValue('hourly', [{ time: `${place.name}-h0` }]);
  sp.setValue('loading', false);
  const marker = { id: `m_${place.name}`, name: place.name, country: place.country };
  sp.setValue('_searchMarker', marker);
  return marker;
};

const markerIndices = (sp) =>
  sp.history
    .map((e, i) => (e.op === 'set' && e.path === '_searchMarker' ? i : -1))
    .filter((i) => i !== -1);

test('replay-to-marker lands on a settled (loading=false) state', () => {
  const sp = createSpektrum();

  recordSearch(sp, { name: 'Amsterdam', country: 'NL' });
  // Start a second search but stop mid-flight (loading still true).
  sp.setValue('loading', true);
  sp.setValue('error', null);

  const [firstMarkerIdx] = markerIndices(sp);
  sp.replay(firstMarkerIdx + 1);

  assert.equal(sp.appState.loading, false, 'button should not be stuck loading');
  assert.equal(sp.appState._searchMarker.id, 'm_Amsterdam');
  assert.equal(sp.appState.location.name, 'Amsterdam');
});

test('three searches → markers at distinct indices, replay round-trips state', () => {
  const sp = createSpektrum();

  recordSearch(sp, { name: 'Amsterdam', country: 'NL' });
  recordSearch(sp, { name: 'Tokyo',     country: 'JP' });
  recordSearch(sp, { name: 'Reykjavik', country: 'IS' });

  const idxs = markerIndices(sp);
  assert.equal(idxs.length, 3);
  assert.ok(idxs[0] < idxs[1] && idxs[1] < idxs[2]);

  sp.replay(idxs[0] + 1);
  assert.equal(sp.appState.location.name, 'Amsterdam');

  sp.replay(idxs[2] + 1);
  assert.equal(sp.appState.location.name, 'Reykjavik');
});
