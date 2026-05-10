import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  codeMeta, mapHourly, nowKey, parseQuery,
  partitionDay, partitionByDay, summarizeDay, windCompass,
} from '../public/lib.js';

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

test('mapHourly: precipLabel pads single-digit values to two digits', () => {
  const f = { ...fixture, precipitation_probability: [0, 5, 90] };
  const out = mapHourly(f, '2026-05-06T13');
  assert.equal(out[0].precipLabel, '00');
  assert.equal(out[1].precipLabel, '05');
  assert.equal(out[2].precipLabel, '90');
});

test('mapHourly: missing wind_direction_10m → windDir is empty string', () => {
  const out = mapHourly(fixture, '2026-05-06T13');
  assert.equal(out[0].windDir, '');
});

test('mapHourly: wind_direction_10m → compass label', () => {
  const withDir = { ...fixture, wind_direction_10m: [0, 90, 225] };
  const out = mapHourly(withDir, '2026-05-06T13');
  assert.equal(out[0].windDir, 'N');
  assert.equal(out[1].windDir, 'E');
  assert.equal(out[2].windDir, 'SW');
});

test('mapHourly: exposes numeric `hour` derived from label', () => {
  const out = mapHourly(fixture, '2026-05-06T13');
  assert.deepEqual(out.map((h) => h.hour), [12, 13, 14]);
});

test('mapHourly: exposes YYYY-MM-DD `date` for multi-day grouping', () => {
  const out = mapHourly(fixture, '2026-05-06T13');
  assert.deepEqual(out.map((h) => h.date), ['2026-05-06', '2026-05-06', '2026-05-06']);
});

// --- windCompass --------------------------------------------------------

test('windCompass: cardinals at exact angles', () => {
  assert.equal(windCompass(0),   'N');
  assert.equal(windCompass(90),  'E');
  assert.equal(windCompass(180), 'S');
  assert.equal(windCompass(270), 'W');
});

test('windCompass: intercardinals', () => {
  assert.equal(windCompass(45),  'NE');
  assert.equal(windCompass(135), 'SE');
  assert.equal(windCompass(225), 'SW');
  assert.equal(windCompass(315), 'NW');
});

test('windCompass: 360 wraps to N, negative degrees normalize', () => {
  assert.equal(windCompass(360), 'N');
  assert.equal(windCompass(-45), 'NW');
});

test('windCompass: undefined / null / NaN → empty string', () => {
  assert.equal(windCompass(undefined), '');
  assert.equal(windCompass(null), '');
  assert.equal(windCompass(NaN), '');
});

// --- partitionDay -------------------------------------------------------

const make = (hour, overrides = {}) => ({
  time: `2026-05-06T${String(hour).padStart(2, '0')}:00`,
  label: `${String(hour).padStart(2, '0')}:00`,
  hour,
  temp: 15, icon: '☀️', desc: 'Clear sky',
  precipProb: 0, wind: 5, windDir: 'N',
  isNow: false, isPast: false,
  ...overrides,
});

test('partitionDay: splits at noon — AM is 0–11, PM is 12–23', () => {
  const day = Array.from({ length: 24 }, (_, h) => make(h));
  const { am, pm } = partitionDay(day);
  assert.equal(am.length, 12);
  assert.equal(pm.length, 12);
  assert.deepEqual(am.map((h) => h.hour), [0,1,2,3,4,5,6,7,8,9,10,11]);
  assert.deepEqual(pm.map((h) => h.hour), [12,13,14,15,16,17,18,19,20,21,22,23]);
});

test('partitionDay: empty input returns empty buckets', () => {
  assert.deepEqual(partitionDay([]), { am: [], pm: [] });
});

// --- partitionByDay ----------------------------------------------------

const dayHour = (date, hour) => ({
  time: `${date}T${String(hour).padStart(2, '0')}:00`,
  date, hour,
});

test('partitionByDay: groups consecutive hours by date string, preserves order', () => {
  const flat = [
    ...Array.from({ length: 24 }, (_, h) => dayHour('2026-05-09', h)),
    ...Array.from({ length: 24 }, (_, h) => dayHour('2026-05-10', h)),
  ];
  const days = partitionByDay(flat);
  assert.equal(days.length, 2);
  assert.equal(days[0].date, '2026-05-09');
  assert.equal(days[1].date, '2026-05-10');
  assert.equal(days[0].hours.length, 24);
  assert.equal(days[1].hours.length, 24);
});

test('partitionByDay: empty / null input → empty array', () => {
  assert.deepEqual(partitionByDay([]),    []);
  assert.deepEqual(partitionByDay(null),  []);
});

test('partitionByDay: keeps day insertion order even if dates appear non-monotonically', () => {
  const days = partitionByDay([
    dayHour('2026-05-09', 22),
    dayHour('2026-05-09', 23),
    dayHour('2026-05-10', 0),
    dayHour('2026-05-10', 1),
  ]);
  assert.deepEqual(days.map((d) => d.date), ['2026-05-09', '2026-05-10']);
});

// --- summarizeDay -------------------------------------------------------

test('summarizeDay: empty input → null', () => {
  assert.equal(summarizeDay([]), null);
  assert.equal(summarizeDay(null), null);
});

test('summarizeDay: tracks high/low with their hour labels', () => {
  const day = [
    make(0, { temp: 10 }),
    make(14, { temp: 22 }),
    make(20, { temp: 16 }),
  ];
  const s = summarizeDay(day);
  assert.equal(s.tempHigh, 22);
  assert.equal(s.tempHighLabel, '14:00');
  assert.equal(s.tempLow, 10);
  assert.equal(s.tempLowLabel, '00:00');
});

test('summarizeDay: peak precip + rainy hour count (>=50%)', () => {
  const day = [
    make(8,  { precipProb: 30 }),
    make(12, { precipProb: 80 }),
    make(15, { precipProb: 50 }),
    make(18, { precipProb: 10 }),
  ];
  const s = summarizeDay(day);
  assert.equal(s.peakPrecipProb, 80);
  assert.equal(s.peakPrecipLabel, '12:00');
  assert.equal(s.rainyHours, 2);
});

test('summarizeDay: peak wind exposes speed, label, and direction', () => {
  const day = [
    make(6,  { wind: 8,  windDir: 'N' }),
    make(15, { wind: 22, windDir: 'SW' }),
    make(22, { wind: 14, windDir: 'W' }),
  ];
  const s = summarizeDay(day);
  assert.equal(s.peakWind, 22);
  assert.equal(s.peakWindLabel, '15:00');
  assert.equal(s.peakWindDir, 'SW');
});

test('summarizeDay: dominant condition is the most-frequent icon', () => {
  const day = [
    make(0, { icon: '☀️', desc: 'Clear sky' }),
    make(1, { icon: '☀️', desc: 'Clear sky' }),
    make(2, { icon: '⛅',  desc: 'Partly cloudy' }),
    make(3, { icon: '☁️', desc: 'Overcast' }),
  ];
  const s = summarizeDay(day);
  assert.equal(s.dominantIcon, '☀️');
  assert.equal(s.dominantDesc, 'Clear sky');
});
