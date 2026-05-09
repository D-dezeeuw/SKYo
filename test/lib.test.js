import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { codeMeta, mapHourly, nowKey, parseQuery } from '../public/lib.js';

// --- parseQuery ---------------------------------------------------------

test('parseQuery: "City, CC" → split + uppercase country', () => {
  assert.deepEqual(parseQuery('Amsterdam, NL'), { name: 'Amsterdam', country: 'NL' });
});

test('parseQuery: "City" alone → no country', () => {
  assert.deepEqual(parseQuery('Amsterdam'), { name: 'Amsterdam', country: undefined });
});

test('parseQuery: trims whitespace, uppercases lowercased country', () => {
  assert.deepEqual(parseQuery('  amsterdam  ,  nl  '), { name: 'amsterdam', country: 'NL' });
});

test('parseQuery: leading/trailing comma — empty parts dropped', () => {
  assert.deepEqual(parseQuery(', NL'), { name: 'NL', country: undefined });
  assert.deepEqual(parseQuery('Amsterdam,'), { name: 'Amsterdam', country: undefined });
});

test('parseQuery: empty / null / undefined are safe', () => {
  assert.deepEqual(parseQuery(''), { name: undefined, country: undefined });
  assert.deepEqual(parseQuery(null), { name: undefined, country: undefined });
  assert.deepEqual(parseQuery(undefined), { name: undefined, country: undefined });
});

test('parseQuery: extra commas — keeps first two parts only', () => {
  assert.deepEqual(parseQuery('Saint-Tropez, France, EU'), { name: 'Saint-Tropez', country: 'FRANCE' });
});

// --- codeMeta -----------------------------------------------------------

test('codeMeta: known codes map to their icon + desc', () => {
  assert.deepEqual(codeMeta(0),  { icon: '☀️',   desc: 'Clear sky' });
  assert.deepEqual(codeMeta(95), { icon: '⛈️', desc: 'Thunderstorm' });
});

test('codeMeta: unknown code falls back to a non-empty placeholder', () => {
  const fallback = codeMeta(999);
  assert.equal(typeof fallback.icon, 'string');
  assert.equal(typeof fallback.desc, 'string');
  assert.notEqual(fallback.icon, '');
});

test('codeMeta: undefined / null don\'t throw', () => {
  assert.doesNotThrow(() => codeMeta(undefined));
  assert.doesNotThrow(() => codeMeta(null));
});

// --- nowKey -------------------------------------------------------------

test('nowKey: Amsterdam summer (CEST, UTC+2)', () => {
  // 2026-05-06T13:30Z = 15:30 in Europe/Amsterdam during summer time
  const at = new Date('2026-05-06T13:30:00Z');
  assert.equal(nowKey('Europe/Amsterdam', at), '2026-05-06T15');
});

test('nowKey: Los Angeles same instant (UTC-7 in May)', () => {
  const at = new Date('2026-05-06T13:30:00Z');
  assert.equal(nowKey('America/Los_Angeles', at), '2026-05-06T06');
});

test('nowKey: rolls back across the date line for tz behind UTC', () => {
  // 01:00Z = 18:00 the day before in LA
  const at = new Date('2026-05-06T01:00:00Z');
  assert.equal(nowKey('America/Los_Angeles', at), '2026-05-05T18');
});

test('nowKey: returns a 13-char key shaped YYYY-MM-DDTHH', () => {
  const k = nowKey('UTC', new Date('2026-01-02T03:04:05Z'));
  assert.match(k, /^\d{4}-\d{2}-\d{2}T\d{2}$/);
  assert.equal(k.length, 13);
});

// --- mapHourly ----------------------------------------------------------

const fixture = {
  time: ['2026-05-06T12:00', '2026-05-06T13:00', '2026-05-06T14:00'],
  temperature_2m: [18.2, 19.7, 20.1],
  weather_code: [0, 1, 95],
  precipitation_probability: [10, 20, 90],
  wind_speed_10m: [5.4, 7.8, 12.3],
};

test('mapHourly: preserves length', () => {
  assert.equal(mapHourly(fixture, '2026-05-06T13').length, 3);
});

test('mapHourly: flags exactly one isNow, isPast for earlier hours only', () => {
  const out = mapHourly(fixture, '2026-05-06T13');
  assert.equal(out.filter((h) => h.isNow).length, 1);
  assert.deepEqual(out.map((h) => h.isNow),  [false, true,  false]);
  assert.deepEqual(out.map((h) => h.isPast), [true,  false, false]);
});

test('mapHourly: rounds temp + wind, formats label, fills icon/desc via codeMeta', () => {
  const [first, , third] = mapHourly(fixture, '2026-05-06T13');
  assert.equal(first.temp, 18);
  assert.equal(first.wind, 5);
  assert.equal(first.label, '12:00');
  assert.equal(first.icon, '☀️');
  assert.equal(third.icon, '⛈️');
});

test('mapHourly: missing precipitation_probability → defaults to 0', () => {
  const noProb = { ...fixture, precipitation_probability: undefined };
  const out = mapHourly(noProb, '2026-05-06T13');
  assert.equal(out[0].precipProb, 0);
  assert.equal(out[1].precipProb, 0);
});
