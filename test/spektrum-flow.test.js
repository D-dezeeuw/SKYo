import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createSpektrum } from './fixtures/spektrum.js';

/**
 * Mirrors the searchCity → loadForecast write order used in public/app.js.
 * The invariant under test: `checkpoint('search', ...)` is the LAST entry of
 * a successful search, after `loading=false`. Replaying to a checkpoint
 * therefore lands on a settled state — the bug we shipped and fixed when the
 * marker was recorded inside loadForecast (before the finally that cleared
 * loading), causing the submit button to stay stuck in its loading state
 * after clicking a past-search pill.
 */
const recordSearch = (sp, place) => {
  sp.setValue('loading', true);
  sp.setValue('error', null);
  sp.setValue('location', { name: place.name, country: place.country });
  sp.setValue('hourly', [{ time: `${place.name}-h0` }]);
  sp.setValue('loading', false);
  sp.checkpoint('search', { name: place.name, country: place.country });
};

test('replay-to-checkpoint lands on a settled (loading=false) state', () => {
  const sp = createSpektrum();

  recordSearch(sp, { name: 'Rotterdam', country: 'NL' });
  // Start a second search but stop mid-flight (loading still true).
  sp.setValue('loading', true);
  sp.setValue('error', null);

  const [first] = sp.checkpoints;
  sp.replay(first.index + 1);

  assert.equal(sp.appState.loading, false, 'button should not be stuck loading');
  assert.equal(sp.appState.location.name, 'Rotterdam');
});

test('three searches → checkpoints at distinct indices, replay round-trips state', () => {
  const sp = createSpektrum();

  recordSearch(sp, { name: 'Rotterdam', country: 'NL' });
  recordSearch(sp, { name: 'Tokyo',     country: 'JP' });
  recordSearch(sp, { name: 'Reykjavik', country: 'IS' });

  const cps = sp.checkpoints;
  assert.equal(cps.length, 3);
  assert.ok(cps[0].index < cps[1].index && cps[1].index < cps[2].index);

  sp.replay(cps[0].index + 1);
  assert.equal(sp.appState.location.name, 'Rotterdam');

  sp.replay(cps[2].index + 1);
  assert.equal(sp.appState.location.name, 'Reykjavik');
});

test('checkpoint metadata round-trips via spektrum.checkpoints', () => {
  const sp = createSpektrum();
  sp.checkpoint('search', { name: 'Berlin', country: 'DE' });
  const [cp] = sp.checkpoints;
  assert.equal(cp.id, 'search');
  assert.deepEqual(cp.value, { name: 'Berlin', country: 'DE' });
  assert.equal(cp.op, 'checkpoint');
  assert.equal(typeof cp.index, 'number');
});
