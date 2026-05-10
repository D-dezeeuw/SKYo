import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildSeries, buildPrecipBars } from '../public/chart.js';

const PALETTE = { rise: '#ff2d95', fall: '#22d3ee' };
const opts = { yTop: 0, yBottom: 100, palette: PALETTE };

test('buildSeries: empty input → empty path + no stops', () => {
  const out = buildSeries([], opts);
  assert.equal(out.d, '');
  assert.deepEqual(out.stops, []);
});

test('buildSeries: monotone-rising series → all stops are rise color', () => {
  const { stops } = buildSeries([10, 12, 14, 16, 18], opts);
  assert.equal(stops.length, 5);
  for (const s of stops) assert.equal(s.color, PALETTE.rise);
});

test('buildSeries: monotone-falling series → all stops are fall color', () => {
  const { stops } = buildSeries([18, 16, 14, 12, 10], opts);
  for (const s of stops) assert.equal(s.color, PALETTE.fall);
});

test('buildSeries: stop colors flip at trend reversal', () => {
  // up, up, down, down → at index 2 (the peak) the local trend (before+after) is 0 → tie-break to rise.
  // index 3 has before=down, after=down → fall.
  const { stops } = buildSeries([10, 12, 14, 12, 10], opts);
  assert.equal(stops[0].color, PALETTE.rise);
  assert.equal(stops[1].color, PALETTE.rise);
  assert.equal(stops[3].color, PALETTE.fall);
  assert.equal(stops[4].color, PALETTE.fall);
});

test('buildSeries: stop offsets are evenly spaced 0..100', () => {
  const { stops } = buildSeries([1, 2, 3, 4, 5], opts);
  assert.deepEqual(stops.map((s) => s.offset), [0, 25, 50, 75, 100]);
});

test('buildSeries: flat series — range collapses, every y at yBottom, no NaN', () => {
  const { d } = buildSeries([5, 5, 5], opts);
  assert.doesNotMatch(d, /NaN|Infinity/);
  // Endpoints sit at y=100 (yBottom) since the series is flat.
  assert.match(d, /^M 0\.00 100\.00/);
  assert.match(d, /1000\.00 100\.00$/);
});

test('buildSeries: smooth curve uses M then one C per segment', () => {
  const { d } = buildSeries([0, 10, 20, 5], opts);
  assert.match(d, /^M /);
  assert.equal((d.match(/ C /g) ?? []).length, 3); // n-1 cubic segments for n points
  assert.equal((d.match(/ L /g) ?? []).length, 0);
});

test('buildSeries: 2-point input still produces a valid M+C path', () => {
  const { d } = buildSeries([0, 10], opts);
  assert.match(d, /^M /);
  assert.equal((d.match(/ C /g) ?? []).length, 1);
});

// --- buildPrecipBars ----------------------------------------------------

const barOpts = { width: 1000, baseY: 600, maxHeight: 100 };

test('buildPrecipBars: empty / null input → empty array', () => {
  assert.deepEqual(buildPrecipBars([], barOpts),    []);
  assert.deepEqual(buildPrecipBars(null,  barOpts), []);
});

test('buildPrecipBars: skips 0% hours so dry days produce no bars', () => {
  const bars = buildPrecipBars([0, 0, 0, 0], barOpts);
  assert.equal(bars.length, 0);
});

test('buildPrecipBars: bar count matches the non-zero hour count', () => {
  const bars = buildPrecipBars([0, 30, 0, 60, 0, 0], barOpts);
  assert.equal(bars.length, 2);
});

test('buildPrecipBars: bar height scales linearly with probability above the floor', () => {
  const bars = buildPrecipBars([100, 50, 25], { ...barOpts, minHeight: 0 });
  assert.equal(bars[0].height, 100);
  assert.equal(bars[1].height, 50);
  assert.equal(bars[2].height, 25);
  assert.equal(bars[0].y, 500);
  assert.equal(bars[1].y, 550);
  assert.equal(bars[2].y, 575);
});

test('buildPrecipBars: small probabilities are floored to minHeight so 1% is still visible', () => {
  const bars = buildPrecipBars([1, 2, 50], { width: 1000, baseY: 600, maxHeight: 100, minHeight: 3 });
  // 1% → 1px raw, floored to 3; 2% → 2px raw, floored to 3; 50% above floor → 50.
  assert.equal(bars[0].height, 3);
  assert.equal(bars[1].height, 3);
  assert.equal(bars[2].height, 50);
});

test('buildPrecipBars: out-of-range probabilities are clamped to 0..100', () => {
  const bars = buildPrecipBars([-10, 200], barOpts);
  // -10 clamps to 0 → skipped; 200 clamps to 100 → max-height bar.
  assert.equal(bars.length, 1);
  assert.equal(bars[0].height, 100);
});

test('buildPrecipBars: opacity grows with probability', () => {
  const bars = buildPrecipBars([10, 100], barOpts);
  assert.ok(bars[0].opacity < bars[1].opacity);
  // Heaviest rain caps below 1 (we want to stay translucent).
  assert.ok(bars[1].opacity <= 0.8);
});
