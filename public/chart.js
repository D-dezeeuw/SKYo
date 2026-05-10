const SVG_NS = 'http://www.w3.org/2000/svg';

const PALETTES = {
  temp: { rise: '#fb923c', fall: '#a855f7' },
  wind: { rise: '#22c55e', fall: '#38bdf8' },
};

const VALUE_TICKS_PER_BAND = 4; // horizontal divisions inside each series band
const LABEL_EVERY = 4;          // show value labels every N hours (≤ 6 labels per chart)
const TEMP_BAND_FRAC = { top: 0.12, bottom: 0.60 };
const WIND_BAND_FRAC = { top: 0.47, bottom: 0.90 };

/** Pad/truncate a 24-hour series so x = hour index 0..23 always lines up. */
const fillByHour = (hourly) => {
  const slots = new Array(24).fill(null);
  for (const h of hourly) if (h.hour >= 0 && h.hour <= 23) slots[h.hour] = h;
  // Forward/back-fill missing hours so the line stays continuous.
  let last = slots.find(Boolean);
  if (!last) return null;
  for (let i = 0; i < 24; i++) {
    if (slots[i]) last = slots[i];
    else slots[i] = last;
  }
  last = slots[23];
  for (let i = 23; i >= 0; i--) {
    if (slots[i]) last = slots[i];
    else slots[i] = last;
  }
  return slots;
};

/** Catmull-Rom → cubic Bezier. Smooth curve that passes through every point. */
const smoothPath = (pts) => {
  const n = pts.length;
  if (!n) return '';
  if (n === 1) return `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;

  const f = (n) => n.toFixed(2);
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? pts[i + 1];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
};

/** Compute bar geometry for a per-hour precipitation-probability series (0–100).
 *  Returns [{x, y, width, height, opacity}, …] in user-space units. Hours at 0%
 *  are filtered out so dry days don't decorate the chart with phantom bars.
 *  Non-zero values get a `minHeight` floor so a 1–2% forecast still registers
 *  as a visible sliver instead of a sub-pixel artifact. */
export const buildPrecipBars = (vals, { width = 1000, baseY, maxHeight, minHeight = 3 }) => {
  const n = vals?.length ?? 0;
  if (n === 0) return [];
  const barWidth = Math.min(10, (width / n) * 0.55);
  const bars = [];
  for (let i = 0; i < n; i++) {
    const prob = Math.max(0, Math.min(100, vals[i] ?? 0));
    if (prob === 0) continue;
    const cx = n === 1 ? width / 2 : (i / (n - 1)) * width;
    const h = Math.max(minHeight, (prob / 100) * maxHeight);
    bars.push({
      x: cx - barWidth / 2,
      y: baseY - h,
      width: barWidth,
      height: h,
      // Light drizzle stays subtle; heavy rain reads as a vivid spike.
      opacity: 0.35 + (prob / 100) * 0.4,
    });
  }
  return bars;
};

/** Build smooth SVG path-d + gradient stops for a series of numeric values.
 *  Stops alternate rise/fall based on the local trend at each point.
 *  `width` defaults to 1000 so tests stay stable; the renderer passes the live viewport width. */
export const buildSeries = (vals, { yTop, yBottom, palette, width = 1000 }) => {
  const n = vals.length;
  if (!n) return { d: '', stops: [] };

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const xAt = (i) => (n === 1 ? width / 2 : (i / (n - 1)) * width);
  const yAt = (v) => yTop + (1 - (v - min) / range) * (yBottom - yTop);

  const pts = vals.map((v, i) => [xAt(i), yAt(v)]);
  const d = smoothPath(pts);

  const stops = vals.map((_, i) => {
    const before = i > 0 ? vals[i] - vals[i - 1] : 0;
    const after  = i < n - 1 ? vals[i + 1] - vals[i] : 0;
    const trend = before + after;
    const color = trend >= 0 ? palette.rise : palette.fall;
    const offset = n === 1 ? 0 : (i / (n - 1)) * 100;
    return { offset, color };
  });

  return { d, stops };
};

const el = (tag, attrs = {}, parent) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
};

const renderSeries = (defs, root, id, vals, opts) => {
  const { d, stops } = buildSeries(vals, opts);
  if (!d) return;

  const grad = el('linearGradient', {
    id, x1: '0', y1: '0', x2: String(opts.width), y2: '0',
    gradientUnits: 'userSpaceOnUse',
  }, defs);
  for (const s of stops) {
    el('stop', { offset: `${s.offset}%`, 'stop-color': s.color }, grad);
  }

  el('path', {
    d,
    fill: 'none',
    stroke: `url(#${id})`,
    'stroke-width': opts.stroke ?? 3,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    filter: 'url(#neon-glow)',
    opacity: opts.opacity ?? 0.95,
  }, root);
};

const renderGrid = (root, bands, width, height) => {
  const grid = el('g', { class: 'bg-chart-grid' }, root);

  // Vertical hour ticks — one per hour from 01:00 to 23:00 (00:00 = left edge).
  for (let h = 1; h <= 23; h++) {
    const x = (h / 23) * width;
    el('line', {
      x1: x, y1: 0, x2: x, y2: height,
      stroke: '#cbd5ff',
      'stroke-width': 1,
      'stroke-opacity': 0.08,
    }, grid);
  }

  // Horizontal value ticks — one set per series band, scaled to that band's range.
  for (const { yTop, yBottom, color } of bands) {
    for (let i = 0; i <= VALUE_TICKS_PER_BAND; i++) {
      const y = yTop + (i / VALUE_TICKS_PER_BAND) * (yBottom - yTop);
      el('line', {
        x1: 0, y1: y, x2: width, y2: y,
        stroke: color,
        'stroke-width': 1,
        'stroke-opacity': i === 0 || i === VALUE_TICKS_PER_BAND ? 0.1 : 0.06,
        'stroke-dasharray': '2 6',
      }, grid);
    }
  }
};

/** Place faint value labels every LABEL_EVERY hours so the chart stays uncluttered. */
const renderValueLabels = (root, vals, xAt, yAt, opts) => {
  const group = el('g', { class: 'bg-chart-labels' }, root);
  for (let h = LABEL_EVERY; h <= 23; h += LABEL_EVERY) {
    if (vals[h] == null) continue;
    const text = el('text', {
      x: xAt(h),
      y: yAt(vals[h]) + opts.dy,
      'font-size': 11,
      'font-family': 'ui-sans-serif, system-ui, sans-serif',
      'font-weight': '500',
      'text-anchor': 'middle',
      fill: opts.fill,
      'fill-opacity': 0.5,
    }, group);
    text.textContent = opts.format(vals[h]);
  }
};

/** Render a full-viewport synth-wave chart of temp + wind into the given SVG.
 *  viewBox is sized to the live viewport, so 1 user-space unit = 1 CSS pixel — text and
 *  glow stay crisp at every width and the SVG fills edge-to-edge. */
export const renderBgChart = (svg, hourly) => {
  if (!svg) return;
  svg.replaceChildren();

  const filled = fillByHour(hourly ?? []);
  if (!filled) return;

  const W = Math.max(window.innerWidth || 1000, 320);
  const H = Math.max(window.innerHeight || 600, 240);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.removeAttribute('preserveAspectRatio');

  const defs = el('defs', {}, svg);

  // Stacked-blur neon glow: two blur radii merged behind the sharp source.
  const filter = el('filter', {
    id: 'neon-glow',
    x: '-10%', y: '-10%', width: '120%', height: '120%',
  }, defs);
  el('feGaussianBlur', { stdDeviation: '10', in: 'SourceGraphic', result: 'b2' }, filter);
  el('feGaussianBlur', { stdDeviation: '4',  in: 'SourceGraphic', result: 'b1' }, filter);
  const merge = el('feMerge', {}, filter);
  el('feMergeNode', { in: 'b2' }, merge);
  el('feMergeNode', { in: 'b1' }, merge);
  el('feMergeNode', { in: 'SourceGraphic' }, merge);

  const tempBand = { yTop: H * TEMP_BAND_FRAC.top, yBottom: H * TEMP_BAND_FRAC.bottom, color: '#fb923c' };
  const windBand = { yTop: H * WIND_BAND_FRAC.top, yBottom: H * WIND_BAND_FRAC.bottom, color: '#38bdf8' };

  renderGrid(svg, [tempBand, windBand], W, H);

  const temps = filled.map((h) => h.temp);
  const winds = filled.map((h) => h.wind);

  renderSeries(defs, svg, 'grad-temp', temps, {
    yTop: tempBand.yTop, yBottom: tempBand.yBottom,
    palette: PALETTES.temp, width: W, stroke: 3.5, opacity: 0.95,
  });
  renderSeries(defs, svg, 'grad-wind', winds, {
    yTop: windBand.yTop, yBottom: windBand.yBottom,
    palette: PALETTES.wind, width: W, stroke: 3, opacity: 0.85,
  });

  // Precipitation bars across the bottom strip — visible at-a-glance per hour.
  const precipVals = filled.map((h) => h.precipProb ?? 0);
  const precipBars = buildPrecipBars(precipVals, {
    width: W,
    baseY: H * 0.94,
    maxHeight: H * 0.18,
  });
  if (precipBars.length) {
    const group = el('g', { class: 'bg-chart-precip' }, svg);
    for (const bar of precipBars) {
      el('rect', {
        x: bar.x.toFixed(2),
        y: bar.y.toFixed(2),
        width: bar.width.toFixed(2),
        height: bar.height.toFixed(2),
        rx: 2,
        fill: '#67e8f9',
        'fill-opacity': bar.opacity.toFixed(2),
      }, group);
    }
  }

  const xAt = (i) => (i / 23) * W;
  const yAtFor = (vals, yTop, yBottom) => {
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = max - min || 1;
    return (v) => yTop + (1 - (v - min) / range) * (yBottom - yTop);
  };

  renderValueLabels(svg, temps, xAt, yAtFor(temps, tempBand.yTop, tempBand.yBottom), {
    dy: -7, fill: '#fde7c4', format: (v) => `${v}°`,
  });
  renderValueLabels(svg, winds, xAt, yAtFor(winds, windBand.yTop, windBand.yBottom), {
    dy: 13, fill: '#cdf6e0', format: (v) => `${v}`,
  });
};
