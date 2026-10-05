// Core unit tests for js/engine.js (synthetic, hand-computed) + two real-data sweeps + the sparkline thinning of js/charts.js.
// Run from the project folder:  node tests/engine.test.cjs      (plain assert, no dependencies)
'use strict';
const assert = require('assert');
const path = require('path');

const ENGINE = path.join(__dirname, '..', 'js', 'engine.js');
const E = require(ENGINE);
const F = E.fmt;
const C = require(path.join(__dirname, '..', 'js', 'charts.js')).PFCharts;   // string builders only (no DOM needed)

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (err) { failed++; console.log('FAIL  ' + name + '\n      ' + String(err && err.message || err).split('\n').join('\n      ')); }
}
function approx(a, b, tol, label) {
  tol = tol == null ? 1e-12 : tol;
  assert.ok(typeof a === 'number' && Number.isFinite(a) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)),
    `${label || 'value'}: got ${a}, expected ${b}`);
}
function approxArr(a, b, tol, label) {
  assert.strictEqual(a.length, b.length, `${label || 'array'} length`);
  a.forEach((x, i) => approx(x, b[i], tol, `${label || 'array'}[${i}]`));
}
const S252 = Math.sqrt(252);

// ---------- synthetic data helpers
function calendar(from, to, weekdaysOnly) {
  const out = [];
  const [y0, m0, d0] = from.split('-').map(Number), [y1, m1, d1] = to.split('-').map(Number);
  for (let t = Date.UTC(y0, m0 - 1, d0); t <= Date.UTC(y1, m1 - 1, d1); t += 86400000) {
    const wd = new Date(t).getUTCDay();
    if (!weekdaysOnly || (wd > 0 && wd < 6)) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
function dataOf(dates, opts) {
  opts = opts || {};
  const prices = opts.prices || { FLAT: dates.map(() => 1) };
  const positions = opts.positions || [{ isin: 'FLAT', name: 'Flat', short: 'Flat', group: 'G1', shares: 1, cost_basis: 1 }];
  return {
    meta: { last_date: dates[dates.length - 1], last_status: (opts.status || [])[dates.length - 1] || 'final' },
    dates, status: opts.status || dates.map(() => 'final'),
    groups: opts.groups || ['G1'], positions, benchmarks: opts.benchmarks || [], prices,
  };
}
const ctxOf = (dates, opts) => E.prepare(dataOf(dates, opts));
const mkSeries = (dates, value, start) => ({ start: start || 0, end: (start || 0) + value.length - 1, dates, value, ret: E.util.returnsOf(value) });
function fromReturns(r, v0) { const v = [v0 == null ? 100 : v0]; r.forEach((x) => v.push(v[v.length - 1] * (1 + x))); return v; }

// Small portfolio used by several tests (dates Mon..Thu)
const S_DATES = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'];
const S_DATA = {
  meta: { last_date: '2026-03-05', last_status: 'final' },
  dates: S_DATES, status: ['final', 'final', 'final', 'final'],
  groups: ['G1', 'G2', 'G3'],
  positions: [
    { isin: 'A', name: 'Alpha AG', short: 'Alpha', group: 'G1', shares: 2, cost_basis: 15, first_date: '2026-03-02' },
    { isin: 'B', name: 'Beta SE', short: 'Beta', group: 'G1', shares: 1, cost_basis: 25, first_date: '2026-03-02' },
    { isin: 'C', name: 'Gamma Inc', short: 'Gamma', group: 'G2', shares: 4, cost_basis: 10, first_date: '2026-03-03' },
  ],
  benchmarks: [
    { id: 'b1', name: 'Bench AB', holdings: { A: 1, B: 0.5 } },
    { id: 'bx', name: 'Bench X', holdings: { X: 1 } },
  ],
  prices: { A: [10, 11, 12.1, 11], B: [20, 20, 22, 24], C: [null, 5, 5.5, 6], X: [100, null, 110, 99] },
};
const S = E.prepare(S_DATA);

// ======================================================================= prepare / fill rules

test('prepare: forward-fill gaps, back-fill before first quote, no mutation', () => {
  const dates = calendar('2026-01-05', '2026-01-12', true);   // 6 weekdays
  const raw = { P: [null, null, 10, null, 12, null], Q: [5, null, null, 6, null, 7], Z: [null, null, null, null, null, null] };
  const copy = JSON.parse(JSON.stringify(raw));
  const ctx = ctxOf(dates, { prices: raw, positions: [{ isin: 'P', group: 'G1', shares: 1 }, { isin: 'Q', group: 'G1', shares: 1 }] });
  assert.deepStrictEqual(ctx.px.P, [10, 10, 10, 10, 12, 12]);
  assert.deepStrictEqual(ctx.px.Q, [5, 5, 5, 6, 6, 7]);
  assert.strictEqual(ctx.firstIdx.P, 2);
  assert.strictEqual(ctx.firstIdx.Q, 0);
  assert.deepStrictEqual(ctx.px.Z, [0, 0, 0, 0, 0, 0]);          // never quoted -> 0, "listed" after the end
  assert.strictEqual(ctx.firstIdx.Z, 6);
  assert.deepStrictEqual(raw, copy, 'input prices must not be mutated');
  const s = E.portfolio(ctx, { selected: ['P'], start: 0, end: 5 });
  approxArr(s.ret, [0, 0, 0, 0.2, 0], 1e-15, 'flat before listing, zero return');
});

test('prepare: packed price series (-k = k dates without a quote, build_data.py) fill exactly like plain arrays', () => {
  const dates = calendar('2026-01-05', '2026-01-16', true);   // 10 weekdays
  const plain = { P: [null, null, 10, null, 12, null, null, 13, 14, null], Q: [5, null, null, 6, null, 7, 7, null, null, 8],
    Z: [null, null, null, null, null, null, null, null, null, null], S: [null, 3, 4] };   // S: shorter than the dates
  const packed = { P: [-2, 10, -1, 12, -2, 13, 14, -1], Q: [5, -2, 6, -1, 7, 7, -2, 8], Z: [-10], S: [-1, 3, 4] };
  const positions = Object.keys(plain).map((i) => ({ isin: i, group: 'G1', shares: 1 }));
  const a = ctxOf(dates, { prices: plain, positions }), b = ctxOf(dates, { prices: packed, positions });
  for (const i of Object.keys(plain)) {
    assert.deepStrictEqual(b.px[i], a.px[i], 'px ' + i);
    assert.strictEqual(b.firstIdx[i], a.firstIdx[i], 'firstIdx ' + i);
  }
  assert.deepStrictEqual(b.px.P, [10, 10, 10, 10, 12, 12, 12, 13, 14, 14]);
  assert.deepStrictEqual(b.px.Z, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); assert.strictEqual(b.firstIdx.Z, 10);
  assert.deepStrictEqual(b.px.S, [3, 3, 4, 4, 4, 4, 4, 4, 4, 4], 'flat after the last cell');
  const c = ctxOf(dates, { prices: { R: [-3, 1, -20] }, positions: [{ isin: 'R', group: 'G1', shares: 1 }] });
  assert.deepStrictEqual(c.px.R, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 'a run beyond the end is cut');
  assert.strictEqual(c.firstIdx.R, 3);
});

// ======================================================================= presetRange
test('presetRange: dense calendar ending 2026-03-31 (month-end clamping)', () => {
  const dates = calendar('2025-01-01', '2026-03-31');
  const ctx = ctxOf(dates);
  const at = (p) => { const r = E.presetRange(ctx, p); assert.strictEqual(r.end, ctx.n - 1); return dates[r.start]; };
  assert.strictEqual(E.presetRange(ctx, '1T').start, ctx.n - 2);
  assert.strictEqual(at('1W'), '2026-03-24');
  assert.strictEqual(at('1M'), '2026-02-28');   // 03-31 minus 1 month, day clamped (not 03-03)
  assert.strictEqual(at('3M'), '2025-12-31');
  assert.strictEqual(at('6M'), '2025-09-30');   // 09-31 does not exist -> 09-30
  assert.strictEqual(at('1J'), '2025-03-31');
  assert.strictEqual(at('YTD'), '2025-12-31');   // from the previous year's last price (user 28.09.)
  assert.strictEqual(E.presetRange(ctx, 'MAX').start, 0);
});

// ======================================================================= customRange

// ======================================================================= portfolio
test('portfolio: raw, scale, value, pl, ret, sub-range', () => {
  let s = E.portfolio(S, { selected: ['A', 'B'], start: 0, end: 3, startValue: null });
  approxArr(s.raw, [40, 42, 46.2, 46]);
  assert.strictEqual(s.scale, 1);
  approxArr(s.value, [40, 42, 46.2, 46]);
  approxArr(s.pl, [0, 2, 6.2, 6]);
  approxArr(s.ret, [0.05, 0.1, 46 / 46.2 - 1]);
  assert.deepStrictEqual(s.dates, S_DATES);
  assert.deepStrictEqual(s.idx, [0, 1, 2, 3]);
  assert.strictEqual(s.start, 0); assert.strictEqual(s.end, 3); assert.strictEqual(s.startValue, 40);

  s = E.portfolio(S, { selected: new Set(['A', 'B', 'UNKNOWN']), start: 0, end: 3, startValue: 80 });
  assert.strictEqual(s.scale, 2);
  approxArr(s.value, [80, 84, 92.4, 92]);
  approxArr(s.pl, [0, 4, 12.4, 12]);
  approx(s.startValue, 80);
  approxArr(s.ret, [0.05, 0.1, 46 / 46.2 - 1], 1e-12, 'ret is scale invariant');

  s = E.portfolio(S, { selected: ['A', 'B'], start: 1, end: 3, startValue: 0 });
  assert.strictEqual(s.scale, 1, 'startValue 0 -> no scaling');
  approxArr(s.raw, [42, 46.2, 46]);
  assert.deepStrictEqual(s.dates, S_DATES.slice(1));
  assert.deepStrictEqual(s.idx, [1, 2, 3]);
  assert.strictEqual(E.portfolio(S, { selected: ['A', 'B'], start: 0, end: 3, startValue: -5 }).scale, 1);

  s = E.portfolio(S, { selected: ['A', 'B', 'C'], start: 0, end: 3 });
  approxArr(s.raw, [60, 62, 68.2, 70], 1e-12, 'C back-filled at 5 on day 0');
});

// ======================================================================= benchmark
test('benchmark: normalized to baseValue, id/name, forward-filled constituent', () => {
  let b = E.benchmark(S, S.benchmarks[0], 0, 3, 80);
  approxArr(b.raw, [20, 21, 23.1, 23]);
  approxArr(b.value, [80, 84, 92.4, 92]);
  approxArr(b.pl, [0, 4, 12.4, 12]);
  approxArr(b.ret, [0.05, 0.1, 23 / 23.1 - 1]);
  assert.strictEqual(b.value[0], 80, 'value[0] is exactly the base value');
  assert.strictEqual(b.pl[0], 0);
  approx(b.scale, 4);
  assert.strictEqual(b.id, 'b1'); assert.strictEqual(b.name, 'Bench AB');
  assert.deepStrictEqual(b.dates, S_DATES); assert.deepStrictEqual(b.idx, [0, 1, 2, 3]);
  b = E.benchmark(S, S.benchmarks[1], 1, 3, 1000);
  approxArr(b.value, [1000, 1100, 990]);
  approxArr(b.pl, [0, 100, -10]);
  assert.deepStrictEqual(E.benchmark(S, 'bx', 1, 3, 1000).value, b.value, 'lookup by id');
});

// ======================================================================= drawdown
test('drawdown: with recovery', () => {
  const d = E.drawdown([100, 120, 90, 110, 130, 125]);
  approxArr(d.dd, [0, 0, -0.25, 110 / 120 - 1, 0, 125 / 130 - 1]);
  assert.strictEqual(d.maxDD, -0.25);
  assert.strictEqual(d.peak, 1); assert.strictEqual(d.trough, 2); assert.strictEqual(d.recovery, 4);
  approx(d.current, 125 / 130 - 1);
});

// ======================================================================= stats
const T_DATES = ['2025-01-01', '2025-03-01', '2025-06-01', '2025-09-01', '2025-12-01', '2026-01-01'];   // 365 days
const T_R = [0.02, -0.01, 0.03, -0.02, 0.01];                // mean 0.006, sample var 0.00043
const T_V = fromReturns(T_R, 100);                           // ..., 102.94850412
test('stats: hand-computed metrics (rf = 0)', () => {
  const st = E.stats(mkSeries(T_DATES, T_V), { rf: 0 });
  approx(st.startValue, 100); approx(st.endValue, 102.94850412); approx(st.pl, 2.94850412);
  approx(st.totalReturn, 0.0294850412);
  assert.strictEqual(st.days, 365);
  approx(st.cagr, 0.0294850412, 1e-12, 'cagr = TR over 365 days');
  assert.strictEqual(st.cagrReliable, true);
  approx(st.volAnn, Math.sqrt(0.00043 * 252));
  approx(st.sharpe, 0.006 / Math.sqrt(0.00043) * S252);
  approx(st.maxDD, -0.02);
  assert.strictEqual(st.maxDDPeakDate, '2025-09-01'); assert.strictEqual(st.maxDDTroughDate, '2025-12-01');
  assert.strictEqual(st.maxDDRecoveryDate, null);
  approx(st.currentDD, -0.0102);
  approx(st.calmar, 0.0294850412 / 0.02);
  approx(st.bestDay.ret, 0.03); assert.strictEqual(st.bestDay.date, '2025-09-01');
  approx(st.worstDay.ret, -0.02); assert.strictEqual(st.worstDay.date, '2025-12-01');
  approx(st.pctPositive, 0.6);
  approx(st.var95, 0.018);                                  // h = 4 * 0.05 = 0.2: -0.02 + 0.2 * 0.01
  approx(st.cvar95, 0.02);
  approx(st.var95EUR, 0.018 * 102.94850412);
  approx(st.cvar95EUR, 0.02 * 102.94850412);
  const noRet = E.stats({ dates: T_DATES, value: T_V }, { rf: 0 });
  approx(noRet.sharpe, st.sharpe, 1e-15, 'ret recomputed when missing');
});

// ======================================================================= benchmarkHoldings

test('absolute amounts (user 30.09.): a card not totalling 100 % starts at Σ w / 100 × the start value, returns unchanged', () => {
  const rel = { id: 'r', name: 'r', weights: { A: 60, C: 40 } };
  for (const f of [1.96, 0.5, 1]) {
    const abs = { id: 'x', name: 'x', absolute: true, weights: { A: 60 * f, C: 40 * f } };
    const r = E.benchmark(S, rel, 0, 3, 5000), x = E.benchmark(S, abs, 0, 3, 5000);
    approx(x.value[0], 5000 * f, 1e-9, 'starts at ' + f + ' × start value');
    x.value.forEach((v, k) => approx(v, r.value[k] * f, 1e-9, 'line = ' + f + ' × the normalized line'));
    const h = E.benchmarkHoldings(S, abs, 0, 3, 5000);
    approx(h[0].weight, 0.6 * f, 1e-12, 'weight as typed'); approx(h[1].weight, 0.4 * f, 1e-12);
    approx(h.reduce((t, y) => t + y.v0, 0), 5000 * f, 1e-9, 'Σ v0');
    approx(h.reduce((t, y) => t + y.v1, 0), x.value[x.value.length - 1], 1e-9, 'Σ v1 = last value');
  }
  // an unpriced row keeps its amount out (not re-spread over the others)
  const x = E.benchmark(S, { id: 'x', absolute: true, weights: { A: 80, ZZZ: 50 } }, 0, 3, 100);
  approx(x.value[0], 80, 1e-9, 'only the priced 80 %');
  assert.strictEqual(E.benchmark(S, { id: 'z', absolute: true, weights: { A: 0 } }, 0, 3, 100), null, '0 % -> no line');
});

// ======================================================================= assets / groupSummary
function rowsAC(start, end) {
  const s = E.portfolio(S, { selected: ['A', 'C'], start, end, startValue: 80 });
  return { s, rows: E.assets(S, { selected: ['A', 'C'], start, end, scale: s.scale }) };
}

// ======================================================================= withShares (what-if)

// ======================================================================= formatters
test('fmt.eur / num / pct / ratio', () => {
  const NB = ' ';
  assert.strictEqual(F.eur(260800.05), '260.800,05' + NB + '€');
  assert.strictEqual(F.eur(3982.6, { sign: true }), '+3.982,60' + NB + '€');
  assert.strictEqual(F.eur(-3982.6, { sign: true }), '-3.982,60' + NB + '€');
  assert.strictEqual(F.eur(-3982.6), '-3.982,60' + NB + '€');
  assert.strictEqual(F.eur(0, { sign: true }), '0,00' + NB + '€');
  assert.strictEqual(F.eur(-0.001), '0,00' + NB + '€', 'no "-0,00 €"');
  assert.strictEqual(F.eur(-0), '0,00' + NB + '€');
  assert.strictEqual(F.eur(1234.4, { dec: 0 }), '1.234' + NB + '€');
  for (const bad of [null, undefined, NaN, Infinity, -Infinity, '12']) assert.strictEqual(F.eur(bad), '–');
  assert.strictEqual(F.num(1234.5), '1.234,50');
  assert.strictEqual(F.num(1234.5, 0), '1.235');
  assert.strictEqual(F.num(3.14159, 3), '3,142');
  assert.strictEqual(F.num(5, 2, true), '+5,00');
  assert.strictEqual(F.num(-0.5), '-0,50');
  assert.strictEqual(F.num(null), '–');
  assert.strictEqual(F.pct(0.1798), '+17,98' + NB + '%');
  assert.strictEqual(F.pct(-0.1798), '-17,98' + NB + '%');
  assert.strictEqual(F.pct(0), '0,00' + NB + '%');
  assert.strictEqual(F.pct(0.00001), '0,00' + NB + '%');
  assert.strictEqual(F.pct(-0.00001, { sign: false }), '0,00' + NB + '%');
  assert.strictEqual(F.pct(0.1798, { sign: false }), '17,98' + NB + '%');
  assert.strictEqual(F.pct(-0.2341, { dec: 1 }), '-23,4' + NB + '%');
  assert.strictEqual(F.pct(0.5, { dec: 0 }), '+50' + NB + '%');
  assert.strictEqual(F.pct(NaN), '–');
  assert.strictEqual(F.ratio(-0.5), '-0,50');
  assert.strictEqual(F.ratio(2.239586), '2,24');
  assert.strictEqual(F.ratio(undefined), '–');
});

// ======================================================================= charts: sparkline thinning (js/charts.js)
test('sparkIndices: first, last, off, gaps and the per-column extremes are kept; short series are drawn as they are', () => {
  const n = 5000, v = Array.from({ length: n }, (_, i) => 100 + 10 * Math.sin(i / 37) + (i % 11) * 0.2);
  v[1234] = 150; v[2345] = 50;                                   // the extremes must survive the thinning
  const k = C.sparkIndices(v, 60, 7);
  assert.ok(k.length <= 2 * 60 + 3 && k.length > 60, 'size ' + k.length);
  assert.ok(k.every((x, j) => j === 0 || x > k[j - 1]), 'ascending, unique');
  for (const must of [0, 7, 1234, 2345, n - 1]) assert.ok(k.includes(must), 'keeps ' + must);
  const kept = k.map((i) => v[i]);
  assert.strictEqual(Math.max(...kept), Math.max(...v)); assert.strictEqual(Math.min(...kept), Math.min(...v));
  // a gap (null) stays, so the pen still lifts there
  const g = v.slice(); g[3000] = null;
  assert.ok(C.sparkIndices(g, 60, 0).includes(3000));
  // the SVG: thinned only beyond 4 points per pixel column (64 px wide, 2 px padding -> 60 columns -> > 240 points);
  // a rising series never crosses its baseline, so every drawn point is one path command
  const svg = (vals, o) => C.splitSpark(vals, Object.assign({ w: 64, h: 22 }, o));
  const up = (m) => Array.from({ length: m }, (_, i) => 100 + i);
  assert.strictEqual((svg(up(240)).match(/[ML]/g) || []).length, 240, 'every point drawn');
  assert.ok((svg(up(241)).match(/[ML]/g) || []).length <= 123, 'thinned to at most 2 per column + first/last/off');
  // same baseline and y-extent, same first and last point as the full drawing
  const full = svg(v), thin = C.splitSpark(v, { w: 64, h: 22, pad: 2 });
  assert.strictEqual(full.match(/<line[^>]*>/)[0], thin.match(/<line[^>]*>/)[0], 'baseline unchanged');
  const first = (s) => s.match(/M([\d.]+ [\d.]+)/)[1], last = (s) => { const m = s.match(/([\d.]+ [\d.]+)"\/>\s*(<path class="spk-up"[^>]*>)?<\/svg>$/); return m && m[1]; };
  assert.strictEqual(first(thin), first(full)); assert.strictEqual(last(thin), last(full));
  // the context part (grey) ends exactly at `off` in both drawings
  const ctxPath = (s) => (s.match(/class="spk-ctx" d="([^"]+)"/) || [])[1];
  const fullC = C.splitSpark(v, { w: 64, h: 22, off: 500 }), thinC = C.splitSpark(v, { w: 64, h: 22, off: 500 });
  assert.ok(ctxPath(fullC) && ctxPath(thinC));
  assert.strictEqual(ctxPath(thinC).split('L').pop(), ctxPath(fullC).split('L').pop(), 'context ends at off');
  assert.strictEqual(C.sparkline([1, 2, 3], {}).includes('spk-up'), true, 'tiny series untouched');
  assert.strictEqual(C.splitSpark([], {}), '<svg class="spark" viewBox="0 0 64 22" width="64" height="22" aria-hidden="true" focusable="false"></svg>');
});

// ======================================================================= UMD wrapper (browser global)

// ======================================================================= real data: invariants, sweep, smoke print
require(path.join(__dirname, '..', 'data', 'portfolio-data.js'));
const D = globalThis.PORTFOLIO_DATA;
const ctx = E.prepare(D);
const ALL = ctx.positions.map((p) => p.isin);
const PRESETS = ['1T', '1W', '1M', '3M', '6M', 'YTD', '1J', 'MAX'];
const SELECTIONS = [['all', ALL]].concat(ctx.groups.map((g) => [g, ctx.positions.filter((p) => p.group === g).map((p) => p.isin)]))
  .concat([['every 3rd', ALL.filter((_, i) => i % 3 === 0)]]);

test('real data: sum of contributions = portfolio totalReturn (all presets, selections, scaled)', () => {
  for (const p of PRESETS) for (const [name, sel] of SELECTIONS) for (const sv of [null, 100000]) {
    const r = E.presetRange(ctx, p);
    const s = E.portfolio(ctx, { selected: sel, start: r.start, end: r.end, startValue: sv });
    const rows = E.assets(ctx, { selected: sel, start: r.start, end: r.end, scale: s.scale });
    const sum = rows.filter((x) => x.selected).reduce((a, x) => a + x.contrib, 0);
    approx(sum, E.stats(s).totalReturn, 1e-12, `${p} ${name} ${sv}`);
    approx(rows.filter((x) => x.selected).reduce((a, x) => a + x.w0, 0), 1, 1e-12, 'sum w0');
    approx(rows.filter((x) => x.selected).reduce((a, x) => a + x.w1, 0), 1, 1e-12, 'sum w1');
    const g = E.groupSummary(ctx, rows);
    approx(g.reduce((a, x) => a + x.contrib, 0), sum, 1e-12, 'group contrib sum');
    approx(g.reduce((a, x) => a + x.v1, 0), s.value[s.value.length - 1], 1e-12, 'group v1 sum = end value');
  }
});

// first preset of benchmarks.csv ("Mein Depot", a weighting card since 28.09.)
const PRESET0 = { id: 'p0', name: 'p0', weights: D.card_presets[0].weights };

function assertClean(x, where, seen) {
  if (x === null || x === undefined || typeof x === 'boolean') return;
  if (typeof x === 'number') { assert.ok(Number.isFinite(x), `${where}: ${x}`); return; }
  if (typeof x === 'string') { assert.ok(!/NaN|Infinity|undefined/.test(x), `${where}: "${x}"`); return; }
  if (typeof x !== 'object') return;
  seen = seen || new Set();
  if (seen.has(x)) return;
  seen.add(x);
  if (Array.isArray(x)) x.forEach((v, i) => assertClean(v, `${where}[${i}]`, seen));
  else for (const k of Object.keys(x)) if (k !== 'data' && k !== 'ctx') assertClean(x[k], `${where}.${k}`, seen);
}
function sweep(c, label, selections, ranges) {
  let count = 0;
  for (const [name, sel] of selections) for (const [rname, r] of ranges) for (const sv of [null, 54321]) {
    const s = E.portfolio(c, { selected: sel, start: r.start, end: r.end, startValue: sv });
    const where = `${label} ${name} ${rname} sv=${sv}`;
    const rows = E.assets(c, { selected: sel, start: r.start, end: r.end, scale: s ? s.scale : 1 });
    const out = { s, st: E.stats(s), dd: s && E.drawdown(s.value), rows, g: E.groupSummary(c, rows), t: E.assetsTotal(c, rows),
      b: [] };
    for (const bm of c.benchmarks) {
      const b = E.benchmark(c, bm, r.start, r.end, s ? s.value[0] : 1000);
      out.b.push({ b, st: E.stats(b), dd: E.drawdown(b.value) });
    }
    if (out.st) for (const k of ['startValue', 'endValue', 'pl', 'totalReturn', 'days', 'cagr', 'cagrReliable', 'volAnn', 'sharpe',
      'maxDD', 'maxDDPeakDate', 'maxDDTroughDate', 'maxDDRecoveryDate', 'currentDD', 'calmar', 'bestDay', 'worstDay', 'pctPositive',
      'var95', 'cvar95', 'var95EUR', 'cvar95EUR']) assert.ok(k in out.st && out.st[k] !== undefined, `${where} stats.${k} missing`);
    assertClean(out, where);
    const st = out.st;
    if (st) assertClean([F.eur(st.pl, { sign: true }), F.pct(st.totalReturn), F.ratio(st.sharpe), F.pct(st.cagr), F.date(st.maxDDRecoveryDate, 'long')], where + ' fmt');
    count++;
  }
  return count;
}
test('sweep: no NaN/Infinity anywhere (real data: presets, custom, 1-point ranges, every single position, empty)', () => {
  const ranges = PRESETS.map((p) => [p, E.presetRange(ctx, p)])
    .concat([['custom', E.customRange(ctx, '2026-03-01', '2026-07-31')], ['1pt start', { start: 0, end: 0 }], ['1pt end', { start: ctx.n - 1, end: ctx.n - 1 }],
      ['pre-SpaceX', { start: 0, end: ctx.firstIdx.US84615Q1031 - 1 }]]);
  const sels = SELECTIONS.concat(ALL.map((i) => [i, [i]])).concat([['empty', []]]);
  const count = sweep(ctx, 'real', sels, ranges);
  assert.ok(count > 1000, 'sweep size ' + count);
  const half = Object.fromEntries(ALL.filter((_, i) => i % 2 === 0).map((i) => [i, 0]));      // what-if: every 2nd sold
  const wctx = E.withShares(ctx, Object.assign(half, { [ALL[1]]: 1e6 }));
  sweep(wctx, 'what-if', SELECTIONS.concat(ALL.slice(0, 6).map((i) => [i, [i]])), ranges);
  sweep(E.withShares(ctx, Object.fromEntries(ALL.map((i) => [i, 0]))), 'all sold', SELECTIONS, ranges.slice(0, 3));
});

// ---------- history before the daily data (res 'm' / '2d', user 28.09.)

test('depotNow / depotPeriod: value and G/V exactly as Scalable reports them (no recomputation from our quotes)', () => {
  const d = dataOf(['2026-03-02', '2026-03-03'], { prices: { A: [10, 12], B: [5, 4] } });
  d.depot = { holdings: { A: 3, B: 10 }, asof_utc: '2026-03-03T10:18:00Z', securities_value: 80, total_value: 70, gv_since_buy: 20,
    cost_basis: 60, performance: { '1T': 3, '1M': -5, MAX: 20 }, opened: '2025-12-02' };
  const c = E.prepare(d), r = E.depotNow(c);
  approx(r.value, 80, 1e-12, 'Scalable securities value, not Σ shares × price (76)');
  approx(r.gl, 20); approx(r.costBasis, 60); approx(r.glPct, 20 / 60); approx(r.total, 70);
  assert.strictEqual(r.asof, '2026-03-03T10:18:00Z'); assert.strictEqual(r.opened, '2025-12-02');
  const t = E.depotPeriod(c, '1T');
  approx(t.pl, 3); approx(t.ret, 3 / 77);
  approx(E.depotPeriod(c, '1M').pl, -5); approx(E.depotPeriod(c, '1M').ret, -5 / 85);
  approx(E.depotPeriod(c, 'SK').pl, 20); approx(E.depotPeriod(c, 'MAX').ret, 20 / 60);
  assert.strictEqual(E.depotPeriod(c, '6M'), null, 'no Scalable figure');
  assert.strictEqual(E.depotNow(ctxOf(['2026-03-02'])), null, 'no depot data');
  d.depot.holdings.X = 1;
  approx(E.depotNow(E.prepare(d)).value, 80, 1e-12, 'unknown ISIN does not matter for the Scalable value');
});

test('schedule benchmark: holdings changing over time, flat before the first step, extra € amounts', () => {
  const dates = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'];
  const c = ctxOf(dates, { prices: { A: [10, 11, 12, 13], B: [100, 100, 110, 120] } });
  const bench = { id: 'h', name: 'H', schedule: { steps: [
    { date: '2026-03-03', holdings: { A: 2 }, extra: 0 },
    { date: '2026-03-04', holdings: { A: 2, B: 1 }, extra: 5 },
    { date: '2026-03-05', holdings: { B: 1 }, extra: 0 }] } };
  const raw = [22, 22, 2 * 12 + 110 + 5, 120];                     // flat before 03.03., then holdings × price (+ extra)
  const s = E.benchmark(c, bench, 0, 3, 1000);
  approxArr(s.value, raw.map((x) => 1000 * x / raw[0]), 1e-12, 'normalized to the base');
  approxArr(s.raw, raw, 1e-12, 'raw');
  const s2 = E.benchmark(c, bench, 2, 3);
  approxArr(s2.value, [139, 120], 1e-12, 'range start inside the schedule');
});


// ---------- intraday (1T 30-min grid), hand-computed
const I_DATES = ['2026-03-02', '2026-03-03', '2026-03-04'];
const I_DATA = () => ({
  meta: {}, dates: I_DATES, status: ['final', 'final', 'intraday'], groups: ['G1'],
  positions: [
    { isin: 'A', name: 'A', short: 'A', group: 'G1', shares: 2 },
    { isin: 'B', name: 'B', short: 'B', group: 'G1', shares: 1 },
    { isin: 'C', name: 'C', short: 'C', group: 'G1', shares: 1 },       // no intraday quotes
  ],
  benchmarks: [{ id: 'ab', name: 'AB', holdings: { A: 1, B: 0.5 } }],
  prices: { A: [10, 11, 12], B: [20, 21, 19], C: [5, 6, 7] },
  grids: {
    m30: {
      dates: ['2026-03-03', '2026-03-04'], times: ['07:30', '08:00', '08:30'], asof_utc: '2026-03-04T07:05Z',
      px: { A: [null, 11.5, 11, 12.5, null, null], B: [21.5, null, 21, null, 18, null] },
    },
  },
});

test('intraday: portfolio value, base = 1T start value, pl, ctxEnd, missing, scaling', () => {
  const ctx = E.prepare(I_DATA());
  const s = E.intraday(ctx, { selected: ['A', 'B', 'C'] });
  approxArr(s.value.slice(0, 5), [47.5, 50.5, 49, 53, 50], 1e-12, 'value');
  assert.strictEqual(s.value[5], null);
  approx(s.base, 49, 1e-12, 'base');
  approx(s.base, E.portfolio(ctx, { selected: ['A', 'B', 'C'], start: 1, end: 2 }).startValue, 1e-12, 'base = daily 1T start');
  approxArr(s.pl.slice(0, 5), [-1.5, 1.5, 0, 4, 1], 1e-12, 'pl');
  assert.strictEqual(s.ctxEnd, 2);
  assert.deepStrictEqual(s.missing, ['C']);
  const t = E.intraday(ctx, { selected: ['A', 'B', 'C'], startValue: 98 });
  approx(t.scale, 2, 1e-12, 'scale');
  approx(t.value[3], 106, 1e-12, 'scaled value');
  approx(t.pl[4], 2, 1e-12, 'scaled pl');
  assert.strictEqual(E.intraday(ctx, { selected: [] }), null);
});

test('benchmark with weights: bought at the range start, then held (buy and hold, no rebalancing)', () => {
  // A [10, 11, 12.1, 11], B [20, 20, 22, 24], X [100, 100 (filled), 110, 99]
  const w = { id: 'w', name: 'W', weights: { A: 50, B: 50 } };
  const b = E.benchmark(S, w, 0, 3, 100);
  // q_A = 0.5 / 10, q_B = 0.5 / 20 -> raw = 0.05·A + 0.025·B
  approxArr(b.value, [100, 105, 115.5, 115], 1e-12, 'from index 0');
  assert.strictEqual(b.id, 'w');
  const b1 = E.benchmark(S, w, 1, 3, 100);        // bought again at index 1 (new range = new start): 0.5/11·A + 0.5/20·B
  approxArr(b1.value, [100, 100 * (0.5 * 12.1 / 11 + 0.5 * 22 / 20), 100 * (0.5 * 11 / 11 + 0.5 * 24 / 20)], 1e-12, 'from index 1');
  const f = E.benchmark(S, { id: 'f', weights: { A: 0.5, B: 0.5 } }, 0, 3, 100);
  approxArr(f.value, b.value, 1e-12, 'fractions = percent');
  const g = E.benchmark(S, { id: 'g', weights: { A: 25, B: 25, NOPRICE: 30, X: 0, C: -5 } }, 0, 3, 100);
  approxArr(g.value, b.value, 1e-12, 'ISINs without prices and weights <= 0 are ignored, the rest normalized');
  assert.strictEqual(E.benchmark(S, { id: 'n', weights: { NOPRICE: 100 } }, 0, 3, 100), null);
  assert.strictEqual(E.benchmark(S, { id: 'z', weights: {} }, 0, 3, 100), null);
  const st = E.stats(b);
  approx(st.totalReturn, 0.15, 1e-12, 'stats work on the series');
  // a holdings benchmark is unchanged: fixed quantities, independent of the start
  const h = E.benchmark(S, 'b1', 1, 3, 1);
  approxArr(h.raw, [21, 23.1, 23], 1e-12, 'holdings raw');
});

// ---------- chart interval (30 min / 2 h / daily) and sub-daily frames, hand-computed
// Mon 02.03. … Mon 09.03.; m30 (3 slots) has 03., 05., 06., 09. (04. missing); h2 (2 slots) has every session 03.–09.
const G_DATES = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-09'];
const G_DATA = (lastStatus) => ({
  meta: {}, dates: G_DATES, status: G_DATES.map((_, k) => (k === 5 && lastStatus) || 'final'), groups: ['G1'],
  positions: [{ isin: 'A', name: 'A', short: 'A', group: 'G1', shares: 2 }, { isin: 'B', name: 'B', short: 'B', group: 'G1', shares: 1 }],
  benchmarks: [{ id: 'ab', name: 'AB', holdings: { A: 1, B: 0.5 } }, { id: 'bb', name: 'BB', holdings: { B: 1 } }],
  prices: { A: [10, 11, 12, 11, 13, 14], B: [20, 21, 19, 22, 20, 21] },
  grids: {
    m30: {
      dates: ['2026-03-03', '2026-03-05', '2026-03-06', '2026-03-09'], times: ['09:00', '13:00', '23:00'], asof_utc: '2026-03-09T08:10Z',
      px: {
        A: [10.5, null, null, 11.5, 12.5, 11, null, 12, 13, 13.5, null, null],
        B: [null, 20.5, 21, 19.5, null, 22.5, 21, 20.5, 20, null, null, null],     // 05.03. 23:00 = 22.5 ≠ close 22 -> pinned
      },
    },
    h2: {
      dates: ['2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-09'], times: ['09:00', '23:00'], asof_utc: '2026-03-09T08:10Z',
      px: { A: [10.8, 11, 11.8, 12, 11.4, 11, 12.2, 13, 13.6, null], B: [20.4, 21, 19.6, 19, 20.8, 22, 21.2, 20, 20.6, null] },
    },
  },
});

test('chartInterval: presets, custom by calendar days, step-down 30 min -> 2 h -> daily when a session is missing', () => {
  const c = E.prepare(G_DATA());
  const iv = (p, r) => E.chartInterval(c, r || E.presetRange(c, p), p);
  assert.deepStrictEqual(iv('1T'), { key: 'm30', want: 'm30', stepped: false, skipped: [], days: 3 });
  assert.deepStrictEqual(iv('1W'), { key: 'h2', want: 'm30', stepped: true, skipped: ['m30'], days: 7 }, '1W needs 04.03. -> 2 h');
  assert.strictEqual(iv('1M').key, 'h2');
  for (const p of ['3M', '6M', 'YTD', '1J', 'MAX']) assert.deepStrictEqual(iv(p), { key: 'day', want: 'day', stepped: false, skipped: [], days: 7 }, p);
  assert.strictEqual(iv('1D').key, 'm30', 'alias');
  assert.strictEqual(E.chartInterval(c, { start: 2, end: 4 }, 'custom').key, 'm30', 'sessions 05./06. collected');
  assert.deepStrictEqual(E.chartInterval(c, { start: 1, end: 3 }, 'custom'), { key: 'h2', want: 'm30', stepped: true, skipped: ['m30'], days: 2 });
  assert.strictEqual(E.chartInterval(c, { start: 0, end: 1 }, 'custom').key, 'm30', 'the start session need not be collected');
  const noH2 = G_DATA(); delete noH2.grids.h2;
  assert.deepStrictEqual(E.chartInterval(E.prepare(noH2), { start: 1, end: 3 }, 'custom'),
    { key: 'day', want: 'm30', stepped: true, skipped: ['m30', 'h2'], days: 2 });
  assert.strictEqual(E.chartInterval(c, { start: 4, end: 4 }, 'custom').key, 'day', 'no session in the range');
  // calendar-day thresholds on a long weekday calendar where both grids hold every session
  const days = calendar('2026-01-05', '2026-02-27', true);
  const full = (times) => ({ dates: days, times, px: { A: days.flatMap((_, k) => times.map(() => 10 + k)) } });
  const L = E.prepare(Object.assign(dataOf(days, { prices: { A: days.map((_, k) => 10 + k) }, positions: [{ isin: 'A', group: 'G1', shares: 1 }] }),
    { grids: { m30: full(['09:00', '13:00', '23:00']), h2: full(['09:00', '23:00']) } }));
  const cu = (a, b) => E.chartInterval(L, E.customRange(L, a, b), 'custom');
  assert.deepStrictEqual([cu('2026-01-05', '2026-01-12'), cu('2026-01-05', '2026-01-13'), cu('2026-01-05', '2026-02-05'), cu('2026-01-05', '2026-02-06')]
    .map((x) => x.key + ' ' + x.days), ['m30 7', 'h2 8', 'h2 31', 'day 32']);
  assert.strictEqual(E.chartInterval(L, E.presetRange(L, '1W'), '1W').key, 'm30');
  assert.strictEqual(E.chartInterval(L, E.presetRange(L, '1M'), '1M').key, 'h2');
});

test('thinIndices: 2 days from the end, last point per week / month, first and last point always kept', () => {
  const c = ctxOf(calendar('2026-01-26', '2026-03-04', true));          // Mon 26.01. … Wed 04.03., 28 weekdays
  const L = c.n - 1;
  assert.deepStrictEqual(E.thinIndices(c, 0, L, 'd').length, c.n);
  const d2 = E.thinIndices(c, 0, L, '2d');
  assert.deepStrictEqual(d2.slice(0, 3), [0, 1, 3]); assert.strictEqual(d2[d2.length - 1], L);
  assert.ok(d2.slice(1).every((k, j) => k - d2[j] === (j === 0 ? 1 : 2)));
  const w = E.thinIndices(c, 0, L, 'w').map((k) => c.dates[k]);
  assert.deepStrictEqual(w, ['2026-01-26', '2026-01-30', '2026-02-06', '2026-02-13', '2026-02-20', '2026-02-27', '2026-03-04']);
  const m = E.thinIndices(c, 0, L, 'm').map((k) => c.dates[k]);
  assert.deepStrictEqual(m, ['2026-01-26', '2026-01-30', '2026-02-27', '2026-03-04']);
  assert.deepStrictEqual(E.thinIndices(c, 5, 5, 'w'), [0]);
  assert.deepStrictEqual(E.thinIndices(c, 5, 6, '2d'), [0, 1]);
});

console.log(`\nengine tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
