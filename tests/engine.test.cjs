// Unit tests for js/engine.js (synthetic, hand-computed) + real-data smoke test.
// Run from the project folder:  node tests/engine.test.cjs      (plain assert, no dependencies)
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ENGINE = path.join(__dirname, '..', 'js', 'engine.js');
const E = require(ENGINE);
const F = E.fmt;

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
const sdRef = (a) => { const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const S252 = Math.sqrt(252);
const RFD = Math.pow(1.02, 1 / 252) - 1;

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
test('prepare: ctx shape', () => {
  assert.strictEqual(S.n, 4);
  assert.strictEqual(S.lastIdx, 3);
  assert.deepStrictEqual(S.dates, S_DATES);
  assert.deepStrictEqual(S.status, ['final', 'final', 'final', 'final']);
  assert.deepStrictEqual(S.groups, ['G1', 'G2', 'G3']);
  assert.strictEqual(S.positions.length, 3);
  assert.strictEqual(S.benchmarks.length, 2);
  assert.strictEqual(S.data, S_DATA);
  assert.deepStrictEqual(Object.keys(S.px).sort(), ['A', 'B', 'C', 'X']);
});

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

test('prepare: groups extended by unknown position groups, status defaults', () => {
  const ctx = E.prepare({ dates: ['2026-01-02', '2026-01-05'], groups: ['G1'], positions: [{ isin: 'A', group: 'Neu', shares: 1 }], prices: { A: [1, 2] } });
  assert.deepStrictEqual(ctx.groups, ['G1', 'Neu']);
  assert.deepStrictEqual(ctx.status, ['final', 'final']);
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
  assert.strictEqual(at('YTD'), '2026-01-01');
  assert.strictEqual(E.presetRange(ctx, 'MAX').start, 0);
});

test('presetRange: trading days only, target on weekend, none found -> 0', () => {
  const dates = calendar('2026-01-02', '2026-03-31', true);
  const ctx = ctxOf(dates);
  const at = (p) => dates[E.presetRange(ctx, p).start];
  assert.strictEqual(at('1M'), '2026-02-27');   // target 2026-02-28 is a Saturday
  assert.strictEqual(at('1W'), '2026-03-24');
  for (const p of ['3M', '6M', '1J']) assert.strictEqual(E.presetRange(ctx, p).start, 0, p + ' none found -> 0');
  assert.strictEqual(E.presetRange(ctx, 'YTD').start, 0);
  assert.deepStrictEqual(E.presetRange(ctx, '1T'), { start: ctx.n - 2, end: ctx.n - 1 });
});

test('presetRange: leap year, year wrap, week across month end, YTD across years', () => {
  let d = calendar('2023-01-01', '2024-03-31'), c = ctxOf(d);
  assert.strictEqual(d[E.presetRange(c, '1M').start], '2024-02-29');
  assert.strictEqual(d[E.presetRange(c, '1J').start], '2023-03-31');
  d = calendar('2023-01-01', '2024-02-29'); c = ctxOf(d);
  assert.strictEqual(d[E.presetRange(c, '1J').start], '2023-02-28');
  assert.strictEqual(d[E.presetRange(c, '1M').start], '2024-01-29');
  d = calendar('2025-11-01', '2026-01-15'); c = ctxOf(d);
  assert.strictEqual(d[E.presetRange(c, '1M').start], '2025-12-15');
  assert.strictEqual(d[E.presetRange(c, 'YTD').start], '2026-01-01');
  assert.strictEqual(d[E.presetRange(c, '1W').start], '2026-01-08');
  d = calendar('2025-12-01', '2026-05-31'); c = ctxOf(d);
  assert.strictEqual(d[E.presetRange(c, '3M').start], '2026-02-28');
  d = calendar('2026-02-01', '2026-03-03'); c = ctxOf(d);
  assert.strictEqual(d[E.presetRange(c, '1W').start], '2026-02-24');
  d = ['2025-12-30', '2025-12-31', '2026-01-02', '2026-01-05']; c = ctxOf(d);
  assert.strictEqual(E.presetRange(c, 'YTD').start, 2);
  assert.strictEqual(E.presetRange(c, 'unknown').start, 0, 'unknown preset -> MAX');
});

test('util.minusMonths clamps the day of month', () => {
  const m = E.util.minusMonths;
  assert.strictEqual(m('2026-03-31', 1), '2026-02-28');
  assert.strictEqual(m('2024-03-31', 1), '2024-02-29');
  assert.strictEqual(m('2026-01-31', 1), '2025-12-31');
  assert.strictEqual(m('2026-08-31', 6), '2026-02-28');
  assert.strictEqual(m('2026-12-31', 12), '2025-12-31');
  assert.strictEqual(m('2026-05-15', 3), '2026-02-15');
});

// ======================================================================= customRange
test('customRange: snapping, validity, null cases', () => {
  const dates = calendar('2026-01-02', '2026-03-31', true), ctx = ctxOf(dates);
  const ix = (d) => dates.indexOf(d);
  assert.deepStrictEqual(E.customRange(ctx, '2026-03-01', '2026-03-08'), { start: ix('2026-03-02'), end: ix('2026-03-06') });
  assert.deepStrictEqual(E.customRange(ctx, '2026-03-02', '2026-03-03'), { start: ix('2026-03-02'), end: ix('2026-03-03') });
  assert.deepStrictEqual(E.customRange(ctx, '2020-01-01', '2030-01-01'), { start: 0, end: ctx.n - 1 });
  assert.strictEqual(E.customRange(ctx, '2026-03-02', '2026-03-02'), null, 'same day');
  assert.strictEqual(E.customRange(ctx, '2026-03-07', '2026-03-08'), null, 'weekend only');
  assert.strictEqual(E.customRange(ctx, '2026-03-10', '2026-03-05'), null, 'from > to');
  assert.strictEqual(E.customRange(ctx, '2025-01-01', '2025-12-31'), null, 'before data');
  assert.strictEqual(E.customRange(ctx, '2026-04-01', '2026-05-01'), null, 'after data');
  assert.strictEqual(E.customRange(ctx, '', '2026-03-31'), null, 'empty input');
  assert.strictEqual(E.customRange(ctx, 'abc', '2026-03-31'), null, 'garbage');
  assert.strictEqual(E.customRange(ctx, '2026-02-30', '2026-03-31'), null, 'impossible date');
});

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

test('portfolio: empty selection -> null', () => {
  assert.strictEqual(E.portfolio(S, { selected: [], start: 0, end: 3 }), null);
  assert.strictEqual(E.portfolio(S, { selected: new Set(), start: 0, end: 3 }), null);
  assert.strictEqual(E.portfolio(S, { selected: ['NOPE'], start: 0, end: 3 }), null);
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
test('drawdown: without recovery, running max at the trough, ties', () => {
  let d = E.drawdown([100, 80, 90]);
  approx(d.maxDD, -0.2); assert.strictEqual(d.peak, 0); assert.strictEqual(d.trough, 1); assert.strictEqual(d.recovery, null);
  approx(d.current, -0.1);
  d = E.drawdown([100, 90, 150, 120]);
  approx(d.maxDD, -0.2); assert.strictEqual(d.peak, 2, 'peak = running max at the trough'); assert.strictEqual(d.trough, 3);
  assert.strictEqual(d.recovery, null);
  d = E.drawdown([100, 100, 50, 100]);
  assert.strictEqual(d.peak, 0, 'first index of the running max'); assert.strictEqual(d.trough, 2);
  assert.strictEqual(d.recovery, 3, 'v >= v_peak counts as recovered');
  d = E.drawdown([100, 50, 100, 50, 80]);
  assert.strictEqual(d.trough, 1, 'first argmin'); assert.strictEqual(d.peak, 0); assert.strictEqual(d.recovery, 2);
});
test('drawdown: none, empty', () => {
  let d = E.drawdown([1, 2, 3]);
  assert.deepStrictEqual(d.dd, [0, 0, 0]);
  assert.strictEqual(d.maxDD, 0); assert.strictEqual(d.peak, 0); assert.strictEqual(d.trough, 0);
  assert.strictEqual(d.recovery, null); assert.strictEqual(d.current, 0);
  d = E.drawdown([]);
  assert.deepStrictEqual(d, { dd: [], maxDD: 0, peak: null, trough: null, recovery: null, current: null });
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
  approx(st.sortino, 0.006 / 0.01 * S252);                 // downside: sqrt((0.01^2 + 0.02^2) / 5) = 0.01
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
test('stats: risk-free rate (daily compounding), default 2 %', () => {
  const st = E.stats(mkSeries(T_DATES, T_V), { rf: 0.02 });
  approx(st.sharpe, (0.006 - RFD) / Math.sqrt(0.00043) * S252);
  approx(st.sortino, (0.006 - RFD) / Math.sqrt(((0.01 + RFD) ** 2 + (0.02 + RFD) ** 2) / 5) * S252);
  const def = E.stats(mkSeries(T_DATES, T_V));
  assert.strictEqual(def.sharpe, st.sharpe); assert.strictEqual(def.sortino, st.sortino);
  approx(E.stats(mkSeries(T_DATES, T_V), { rf: 0.05 }).volAnn, st.volAnn, 1e-15, 'vol independent of rf');
});
test('stats: VaR/CVaR linear interpolation', () => {
  const r11 = [0.01, 0.01, -0.03, 0.01, 0.01, -0.05, 0.01, 0.01, 0.01, 0.01, 0.01];   // h = 0.5
  let st = E.stats(mkSeries(calendar('2026-01-01', '2026-01-12'), fromReturns(r11)));
  approx(st.var95, 0.04, 1e-12); approx(st.cvar95, 0.05, 1e-12);
  const r21 = [-0.04, -0.02].concat(Array(19).fill(0.01));                                // h = 1 exactly
  st = E.stats(mkSeries(calendar('2026-01-01', '2026-01-22'), fromReturns(r21)));
  approx(st.var95, 0.02, 1e-12); approx(st.cvar95, 0.03, 1e-12);
  const q = E.util.quantile;
  approx(q([4, 3, 2, 1], 0.05), 1.15); assert.strictEqual(q([5], 0.05), 5); assert.strictEqual(q([3, 1, 2], 0.5), 2);
  assert.strictEqual(q([1, 2], 1), 2); assert.strictEqual(q([], 0.05), null);
});
test('stats: CAGR day count, reliability threshold, short series', () => {
  let st = E.stats(mkSeries(['2026-01-01', '2026-03-15'], [100, 110]));
  assert.strictEqual(st.days, 73); approx(st.cagr, Math.pow(1.1, 5) - 1); assert.strictEqual(st.cagrReliable, false);
  assert.strictEqual(st.volAnn, null, 'n < 2 -> vol null'); assert.strictEqual(st.sharpe, null);
  approx(st.var95, -0.1); approx(st.pctPositive, 1);
  assert.strictEqual(E.stats(mkSeries(['2026-01-01', '2026-04-01'], [100, 101])).cagrReliable, true, '90 days');
  assert.strictEqual(E.stats(mkSeries(['2026-01-01', '2026-03-31'], [100, 101])).cagrReliable, false, '89 days');
  st = E.stats(mkSeries(['2026-01-01'], [100]));
  assert.strictEqual(st.days, 0); assert.strictEqual(st.cagr, null); assert.strictEqual(st.totalReturn, 0);
  assert.strictEqual(st.volAnn, null); assert.strictEqual(st.sortino, null); assert.strictEqual(st.pctPositive, null);
  assert.deepStrictEqual(st.bestDay, { ret: null, date: null }); assert.deepStrictEqual(st.worstDay, { ret: null, date: null });
  assert.strictEqual(st.var95, null); assert.strictEqual(st.cvar95EUR, null); assert.strictEqual(st.calmar, null);
  assert.strictEqual(E.stats(null), null);
});
test('stats: flat series -> zero vol, undefined ratios are null (not NaN), no -0', () => {
  const flat = mkSeries(calendar('2026-01-01', '2026-01-04'), [100, 100, 100, 100]);
  let st = E.stats(flat, { rf: 0 });
  assert.strictEqual(st.volAnn, 0); assert.strictEqual(st.sharpe, null); assert.strictEqual(st.sortino, null);
  assert.strictEqual(st.calmar, null); assert.strictEqual(st.maxDD, 0); assert.strictEqual(st.pctPositive, 0);
  assert.ok(Object.is(st.var95, 0) && Object.is(st.cvar95, 0), 'var95/cvar95 are +0');
  st = E.stats(flat, { rf: 0.02 });
  approx(st.sortino, -S252, 1e-9, 'all excess returns = -rf_d');
});

// ======================================================================= relative
const RP = [0.02, -0.01, 0.01, 0], RB = [0.01, -0.02, 0.03, -0.01];
const R_DATES = calendar('2026-01-05', '2026-01-09');
test('relative: hand-computed tiny series', () => {
  const p = mkSeries(R_DATES, fromReturns(RP)), b = mkSeries(R_DATES, fromReturns(RB));
  let rel = E.relative(p, b, { rf: 0 });
  const beta = 0.00065 / 0.001475, corr = 0.00065 / Math.sqrt(0.0005 * 0.001475);
  approx(rel.beta, beta); approx(rel.corr, corr); approx(rel.r2, corr * corr);
  approx(rel.alpha, (0.005 - beta * 0.0025) * 252);
  approx(rel.trackingError, 0.015 * S252);
  approx(rel.infoRatio, 0.0025 * 252 / (0.015 * S252));
  approx(rel.excessReturn, 0.019898 - 0.00929906);
  approx(rel.upCapture, 0.75); approx(rel.downCapture, 1 / 3);
  rel = E.relative(p, b, { rf: 0.02 });
  approx(rel.alpha, ((0.005 - RFD) - beta * (0.0025 - RFD)) * 252);
  approx(rel.beta, beta);
});
test('relative: identical, flat benchmark, missing series, misaligned ranges', () => {
  const p = mkSeries(R_DATES, fromReturns(RP));
  let rel = E.relative(p, p);
  approx(rel.beta, 1); approx(rel.corr, 1); approx(rel.r2, 1); approx(rel.alpha, 0, 1e-12);
  assert.strictEqual(rel.trackingError, 0); assert.strictEqual(rel.infoRatio, null);
  approx(rel.excessReturn, 0); approx(rel.upCapture, 1); approx(rel.downCapture, 1);
  rel = E.relative(p, mkSeries(R_DATES, [100, 100, 100, 100, 100]));
  assert.strictEqual(rel.beta, null); assert.strictEqual(rel.corr, null); assert.strictEqual(rel.alpha, null);
  assert.strictEqual(rel.upCapture, null); assert.strictEqual(rel.downCapture, null);
  approx(rel.trackingError, sdRef(RP) * S252);
  const nul = E.relative(null, p);
  for (const k of ['beta', 'alpha', 'corr', 'r2', 'trackingError', 'infoRatio', 'excessReturn', 'upCapture', 'downCapture']) assert.strictEqual(nul[k], null, k);
  const pFull = E.portfolio(S, { selected: ['A', 'B', 'C'], start: 0, end: 3 });
  const pSub = E.portfolio(S, { selected: ['A', 'B', 'C'], start: 1, end: 3 });
  const bSub = E.benchmark(S, 'bx', 1, 3, pSub.value[0]);
  const a = E.relative(pFull, bSub), c = E.relative(pSub, bSub);
  approx(a.beta, c.beta, 1e-12); approx(a.excessReturn, c.excessReturn, 1e-12);
});

// ======================================================================= monthly
const M_DATES = ['2026-01-29', '2026-01-30', '2026-02-02', '2026-02-27', '2026-03-02', '2026-03-31'];
const M_VALS = [100, 110, 105, 121, 120, 133.1];
test('monthly: returns, first month anchored, complete last month', () => {
  const m = E.monthly(ctxOf(M_DATES), M_VALS);
  assert.deepStrictEqual(m.map((x) => x.month), ['2026-01', '2026-02', '2026-03']);
  approxArr(m.map((x) => x.ret), [0.1, 0.1, 0.1]);
  assert.deepStrictEqual(m.map((x) => x.partial), [true, false, false], '03-31 final = month complete');
});
test('monthly: partial last month (intraday / month not over), single month, series input', () => {
  let st = M_DATES.map(() => 'final'); st[5] = 'intraday';
  assert.strictEqual(E.monthly(ctxOf(M_DATES, { status: st }), M_VALS)[2].partial, true, 'intraday');
  const d2 = M_DATES.slice(0, 5).concat(['2026-03-27']);
  assert.strictEqual(E.monthly(ctxOf(d2), M_VALS)[2].partial, true, 'final, but 30./31.03. still to come');
  const d3 = ['2026-01-29', '2026-01-30', '2026-02-02', '2026-02-27'];
  assert.strictEqual(E.monthly(ctxOf(d3), [100, 110, 105, 121])[1].partial, false, '02-27 Fri = last trading day');
  const d4 = ['2026-11-27', '2026-11-30', '2026-12-01', '2026-12-30'];
  assert.strictEqual(E.monthly(ctxOf(d4), [1, 2, 3, 4])[1].partial, false, 'Dec 31 is an exchange holiday');
  const one = E.monthly(ctxOf(['2026-03-02', '2026-03-03']), [100, 90]);
  assert.strictEqual(one.length, 1); approx(one[0].ret, -0.1); assert.strictEqual(one[0].partial, true);
  const ctx = ctxOf(M_DATES, { prices: { P: M_VALS }, positions: [{ isin: 'P', group: 'G1', shares: 1 }] });
  const s = E.portfolio(ctx, { selected: ['P'] });
  assert.deepStrictEqual(E.monthly(ctx, s).map((x) => [x.month, x.ret, x.partial]), E.monthly(ctx, s.value).map((x) => [x.month, x.ret, x.partial]));
  const sub = E.monthly(ctx, E.portfolio(ctx, { selected: ['P'], start: 2, end: 3 }));
  assert.deepStrictEqual(sub.map((x) => [x.month, x.partial]), [['2026-02', true]]);
  approx(sub[0].ret, 121 / 105 - 1);
  const u = E.util.isMonthComplete;
  assert.deepStrictEqual(['2026-03-31', '2026-03-27', '2026-02-27', '2026-12-30', '2026-12-23', '2026-10-30'].map(u), [true, false, true, true, false, true]);
});

// ======================================================================= assets / groupSummary
function rowsAC(start, end) {
  const s = E.portfolio(S, { selected: ['A', 'C'], start, end, startValue: 80 });
  return { s, rows: E.assets(S, { selected: ['A', 'C'], start, end, scale: s.scale }) };
}
test('assets: one row per position, hand-computed fields', () => {
  const { s, rows } = rowsAC(0, 3);
  assert.strictEqual(s.scale, 2);
  assert.deepStrictEqual(rows.map((r) => r.isin), ['A', 'B', 'C']);
  const [A, B, C] = rows;
  assert.strictEqual(A.selected, true); assert.strictEqual(B.selected, false); assert.strictEqual(C.selected, true);
  assert.strictEqual(A.name, 'Alpha AG'); assert.strictEqual(A.short, 'Alpha'); assert.strictEqual(A.group, 'G1');
  assert.strictEqual(A.shares, 2); assert.strictEqual(A.sharesScaled, 4);
  assert.strictEqual(A.p0, 10); assert.strictEqual(A.p1, 11);
  approx(A.v0, 40); approx(A.v1, 44); approx(A.ret, 0.1); approx(A.pl, 4);
  approx(A.contrib, 0.05); approx(A.w0, 0.5); approx(A.w1, 44 / 92);
  approx(C.v0, 40); approx(C.v1, 48); approx(C.ret, 0.2); approx(C.pl, 8);
  approx(C.contrib, 0.1); approx(C.w0, 0.5); approx(C.w1, 48 / 92);
  approx(B.v0, 40); approx(B.v1, 48); approx(B.ret, 0.2); approx(B.pl, 8);
  assert.strictEqual(B.contrib, null); assert.strictEqual(B.w0, null); assert.strictEqual(B.w1, null);
  approx(A.vol, sdRef([0.1, 0.1, 11 / 12.1 - 1]) * S252);
  approx(A.maxDD, 11 / 12.1 - 1); assert.strictEqual(B.maxDD, 0);
  assert.deepStrictEqual(A.spark, [10, 11, 12.1, 11]); assert.deepStrictEqual(C.spark, [5, 5, 5.5, 6]);
  assert.strictEqual(A.listedAfterStart, false); assert.strictEqual(C.listedAfterStart, true);
  assert.strictEqual(C.firstDate, '2026-03-03'); assert.strictEqual(A.firstDate, '2026-03-02');
  assert.strictEqual(A.costBasis, 15);
  approx(A.glSinceBuy, 7); approx(A.glSinceBuyPct, 7 / 15);
  approx(B.glSinceBuy, -1); approx(B.glSinceBuyPct, -0.04);
  approx(C.glSinceBuy, 14); approx(C.glSinceBuyPct, 1.4);
  const sumC = rows.filter((r) => r.selected).reduce((a, r) => a + r.contrib, 0);
  approx(sumC, E.stats(s).totalReturn, 1e-12, 'sum contrib = totalReturn');
  approx(sumC, 0.15);
  assert.strictEqual(E.assets(S, { selected: ['A', 'C'], start: 1, end: 3, scale: 1 })[2].listedAfterStart, false);
});
test('groupSummary: order, counts, sums, empty groups', () => {
  const { rows } = rowsAC(0, 3);
  const g = E.groupSummary(S, rows);
  assert.deepStrictEqual(g.map((x) => x.group), ['G1', 'G2', 'G3']);
  const [g1, g2, g3] = g;
  assert.strictEqual(g1.n, 2); assert.strictEqual(g1.nSelected, 1);
  approx(g1.v0, 40); approx(g1.v1, 44); approx(g1.pl, 4); approx(g1.ret, 0.1); approx(g1.contrib, 0.05); approx(g1.w1, 44 / 92);
  assert.strictEqual(g2.n, 1); assert.strictEqual(g2.nSelected, 1);
  approx(g2.v1, 48); approx(g2.ret, 0.2); approx(g2.contrib, 0.1); approx(g2.w1, 48 / 92);
  assert.deepStrictEqual([g3.n, g3.nSelected, g3.v0, g3.v1, g3.pl, g3.ret, g3.contrib, g3.w1], [0, 0, 0, 0, 0, null, 0, 0]);
  approx(g.reduce((a, x) => a + x.contrib, 0), 0.15);
  approx(g.reduce((a, x) => a + x.w1, 0), 1);
  const onlyC = E.groupSummary(S, E.assets(S, { selected: ['C'], start: 0, end: 3, scale: 1 }));
  assert.strictEqual(onlyC[0].nSelected, 0); assert.strictEqual(onlyC[0].ret, null, 'nothing selected in group -> ret null');
  assert.strictEqual(onlyC[0].v1, 0); approx(onlyC[1].w1, 1);
  const tot = E.assetsTotal(S, rows);
  approx(tot.v0, 80); approx(tot.v1, 92); approx(tot.pl, 12); approx(tot.ret, 0.15); approx(tot.contrib, 0.15); approx(tot.w1, 1);
});
test('empty selection: assets rows unselected, groupSummary ret/w1 null', () => {
  const rows = E.assets(S, { selected: [], start: 0, end: 3, scale: 1 });
  assert.strictEqual(rows.length, 3);
  assert.ok(rows.every((r) => !r.selected && r.contrib === null && r.w0 === null && r.w1 === null && r.ret !== null));
  const g = E.groupSummary(S, rows);
  assert.ok(g.every((x) => x.nSelected === 0 && x.ret === null && x.w1 === null && x.contrib === null));
  assert.strictEqual(E.stats(E.portfolio(S, { selected: [] })), null);
  assert.strictEqual(E.monthly(S, null), null);
  assert.strictEqual(E.riskContribution(S, { selected: [], start: 0, end: 3 }), null);
});

// ======================================================================= withShares (what-if)
test('withShares: new ctx sharing prices, cloned positions, proportional cost basis, whatIf/base', () => {
  const W = E.withShares(S, { A: 3, C: 0, B: 1, X: 5, NOPE: 1, Z: -1 });
  for (const k of ['px', 'dates', 'firstIdx', 'status', 'benchmarks', 'groups', 'data', 'day']) assert.strictEqual(W[k], S[k], 'shares ' + k);
  assert.strictEqual(W.n, S.n); assert.strictEqual(W.lastIdx, S.lastIdx);
  assert.strictEqual(W.base, S);
  assert.deepStrictEqual(W.whatIf, { A: { from: 2, to: 3 }, C: { from: 4, to: 0 } }, 'changed positions only; X/NOPE/Z ignored');
  assert.notStrictEqual(W.positions, S.positions);
  W.positions.forEach((p, i) => assert.notStrictEqual(p, S.positions[i], 'cloned'));
  const [A, B, C] = W.positions;
  assert.strictEqual(A.shares, 3); approx(A.cost_basis, 22.5, 1e-12, 'avg cost 7,50 unchanged');
  assert.strictEqual(B.shares, 1); assert.strictEqual(B.cost_basis, 25);
  assert.strictEqual(C.shares, 0); assert.strictEqual(C.cost_basis, 0, '0 shares -> cost 0');
  assert.strictEqual(A.name, 'Alpha AG'); assert.strictEqual(A.group, 'G1');
  assert.deepStrictEqual(S.positions.map((p) => [p.shares, p.cost_basis]), [[2, 15], [1, 25], [4, 10]], 'original untouched');
  approxArr(E.portfolio(W, { selected: ['A', 'B', 'C'] }).raw, [50, 53, 58.3, 57]);        // 3A + B + 0C
  approxArr(E.portfolio(S, { selected: ['A', 'B', 'C'] }).raw, [60, 62, 68.2, 70], 1e-12, 'original ctx unchanged');
  const rows = E.assets(W, { selected: ['A', 'B', 'C'], start: 0, end: 3, scale: 1 });
  approx(rows[0].glSinceBuy, 10.5, 1e-12, '3*11 - 22.5'); approx(rows[0].glSinceBuyPct, 7 / 15, 1e-12, 'G/V % unchanged');
  assert.strictEqual(rows[2].glSinceBuy, 0); assert.strictEqual(rows[2].glSinceBuyPct, null);
  assert.strictEqual(rows[2].contrib, 0); assert.strictEqual(rows[2].w1, 0);
});
test('withShares: chaining relative to the original, reset, Map and string input', () => {
  const W1 = E.withShares(S, { A: 3, C: 0 });
  const W2 = E.withShares(W1, { C: 2 });
  assert.strictEqual(W2.base, S, 'base stays the original ctx');
  assert.deepStrictEqual(W2.whatIf, { A: { from: 2, to: 3 }, C: { from: 4, to: 2 } });
  approx(W2.positions[2].cost_basis, 5, 1e-12, 'average cost 2,50 restored from the original after 0 shares');
  const R = E.withShares(W1, { A: 2, C: 4 });
  assert.deepStrictEqual(R.whatIf, {});
  assert.deepStrictEqual(R.positions.map((p) => [p.shares, p.cost_basis]), [[2, 15], [1, 25], [4, 10]]);
  assert.deepStrictEqual(E.withShares(S, new Map([['A', 1]])).whatIf, { A: { from: 2, to: 1 } });
  assert.strictEqual(E.withShares(S, { A: '1,5' }).positions[0].shares, 1.5);
  assert.deepStrictEqual(E.withShares(S, null).whatIf, {});
  const Z = E.withShares(E.withShares(E.prepare(Object.assign({}, S_DATA, {
    positions: S_DATA.positions.map((p) => (p.isin === 'B' ? Object.assign({}, p, { shares: 0, cost_basis: 0 }) : p)) })), {}), { B: 2 });
  approx(Z.positions[1].cost_basis, 2 * 24, 1e-12, 'no original shares: bought at the latest price');
});

test('start value 0 (all selected shares 0) behaves like an empty selection: null, never NaN', () => {
  const Z = E.withShares(S, { A: 0, C: 0 }), sel = ['A', 'C'];
  const s = E.portfolio(Z, { selected: sel, start: 0, end: 3, startValue: 1000 });
  assert.strictEqual(s, null, 'portfolio');
  assert.strictEqual(E.stats(s), null, 'stats');
  const rows = E.assets(Z, { selected: sel, start: 0, end: 3, scale: 1 });
  const [A, B, C] = rows;
  for (const r of [A, C]) {
    assert.strictEqual(r.selected, true);
    assert.deepStrictEqual([r.v0, r.v1, r.pl, r.contrib, r.w0, r.w1], [0, 0, 0, null, null, null], r.isin);
  }
  approx(A.ret, 0.1, 1e-12, 'price return still shown'); assert.strictEqual(B.selected, false);
  const g = E.groupSummary(Z, rows);
  assert.ok(g.every((x) => x.ret === null && x.contrib === null && x.w1 === null), 'groupSummary');
  const t = E.assetsTotal(Z, rows);
  assert.deepStrictEqual([t.ret, t.contrib, t.w1], [null, null, null], 'assetsTotal');
  assert.strictEqual(E.monthly(Z, s), null, 'monthly of a null series');
  assert.ok(E.monthly(Z, [0, 0, 0, 0]).every((x) => x.ret === null), 'monthly of a zero series');
  assert.strictEqual(E.riskContribution(Z, { selected: sel, start: 0, end: 3 }), null, 'riskContribution');
  const nul = E.relative(s, E.benchmark(Z, 'b1', 0, 3, 100));
  assert.ok(Object.keys(nul).every((k) => k === 'n' || nul[k] === null), 'relative');
  assertClean({ s, rows, g, t, m: E.monthly(Z, [0, 0, 0, 0]) }, 'zero selection');
  const part = E.withShares(S, { A: 0 });                                     // partly zero: still a real portfolio
  const pr = E.assets(part, { selected: ['A', 'C'], start: 0, end: 3, scale: 1 });
  assert.deepStrictEqual([pr[0].contrib, pr[0].w0, pr[0].w1], [0, 0, 0]);
  approx(pr[2].contrib, E.stats(E.portfolio(part, { selected: ['A', 'C'] })).totalReturn, 1e-12);
});

// ======================================================================= correlationMatrix
const CM_DATES = calendar('2026-01-05', '2026-01-12', true);               // 6 days -> returns k = 1..5
const CM_RA = [0.01, 0.02, -0.01, 0.03, 0.00];
const CM = E.prepare(dataOf(CM_DATES, {
  prices: {
    A: fromReturns(CM_RA, 100), B: fromReturns(CM_RA.map((x) => 2 * x), 50), C: fromReturns(CM_RA.map((x) => -x), 80),
    D: [null, null].concat(fromReturns([0.01, -0.01, 0.02], 50)),           // first quote idx 2 -> real returns k = 3..5
    E: [null, null, null, 10, 11, 10.5],                                     // first quote idx 3 -> only 2 real returns
    F: [7, 7, 7, 7, 7, 7],                                                   // zero variance
  },
  positions: ['A', 'B', 'C', 'D', 'E', 'F'].map((i) => ({ isin: i, short: i, group: 'G1', shares: 1 })),
}));
test('correlationMatrix: hand-computed, pairwise real-quote overlap, null rules, diagonal 1', () => {
  const c = E.correlationMatrix(CM, { isins: ['A', 'B', 'C', 'D', 'E', 'F'], start: 0, end: 5 });
  assert.deepStrictEqual(c.isins, ['A', 'B', 'C', 'D', 'E', 'F']);
  const ix = (i) => c.isins.indexOf(i), M = (a, b) => c.m[ix(a)][ix(b)], N = (a, b) => c.n[ix(a)][ix(b)];
  approx(M('A', 'B'), 1, 1e-12); approx(M('A', 'C'), -1, 1e-12); approx(M('B', 'C'), -1, 1e-12);
  const rAD = -48 / Math.sqrt(78 * 42);                                      // over k = 3..5 only (pre-listing excluded)
  approx(M('A', 'D'), rAD, 1e-12); approx(M('B', 'D'), rAD, 1e-12); approx(M('C', 'D'), -rAD, 1e-12);
  assert.strictEqual(N('A', 'B'), 5); assert.strictEqual(N('A', 'D'), 3); assert.strictEqual(N('D', 'E'), 2);
  assert.strictEqual(N('A', 'E'), 2); assert.strictEqual(M('A', 'E'), null, 'n < 3 -> null');
  assert.strictEqual(M('D', 'E'), null);
  assert.strictEqual(N('A', 'F'), 5); assert.strictEqual(M('A', 'F'), null, 'zero variance -> null');
  for (let a = 0; a < 6; a++) {
    assert.strictEqual(c.m[a][a], 1, 'diagonal 1');
    for (let b = 0; b < 6; b++) { assert.strictEqual(c.m[a][b], c.m[b][a], 'symmetric m'); assert.strictEqual(c.n[a][b], c.n[b][a], 'symmetric n'); }
  }
  assert.deepStrictEqual([N('A', 'A'), N('D', 'D'), N('E', 'E')], [5, 3, 2]);
  const r = E.correlationMatrix(CM, { isins: ['D', 'A', 'NOPE', 'A'], start: 2, end: 5 });
  assert.deepStrictEqual(r.isins, ['D', 'A'], 'order kept, unknown/duplicates dropped');
  assert.strictEqual(r.n[0][1], 3); approx(r.m[0][1], rAD, 1e-12);
  assert.strictEqual(E.correlationMatrix(CM, { isins: ['A', 'D'], start: 3, end: 5 }).m[0][1], null, 'only 2 returns');
  const three = E.correlationMatrix(CM, { isins: new Set(['A', 'B', 'C']), start: 0, end: 5 });
  approx(three.avg, -1 / 3, 1e-12); assert.strictEqual(three.pairs, 3);
  assert.deepStrictEqual(E.correlationMatrix(CM, { isins: [] }), { isins: [], m: [], n: [], start: 0, end: 5, avg: null, pairs: 0 });
});

// ======================================================================= riskContribution
const RC_DATES = calendar('2026-01-05', '2026-01-09', true);               // 5 days -> T = 4 returns
const RC_R = { A: [0.01, -0.01, 0.02, 0.00], B: [0.00, 0.02, -0.01, 0.03], C: [0.02, 0.01, 0.00, -0.01] };
const RC_PX = { A: fromReturns(RC_R.A, 100), B: fromReturns(RC_R.B, 100), C: fromReturns(RC_R.C, 40), FL: [5, 5, 5, 5, 5] };
function rcCtx(valueAtEnd) {                                                 // shares chosen so that v_i(end) = valueAtEnd[i]
  return E.prepare(dataOf(RC_DATES, {
    prices: RC_PX, groups: ['G1'],
    positions: Object.keys(valueAtEnd).map((i) => ({ isin: i, short: 'S' + i, name: 'N' + i, group: 'G1', shares: valueAtEnd[i] / RC_PX[i][4] })),
  }));
}
test('riskContribution: 2 assets, hand-computed (negative correlation, hedge with negative pctr)', () => {
  // Sigma: AA = 0.0005/3, BB = 0.001/3, AB = -0.0002; w = 0.5/0.5 -> w'Sw = 0.000025, sd_p = 0.005
  const rc = E.riskContribution(rcCtx({ A: 1, B: 1 }), { selected: ['A', 'B'], start: 0, end: 4 });
  approx(rc.volAnn, 0.005 * S252);
  const [A, B] = rc.rows;
  assert.deepStrictEqual(rc.rows.map((r) => r.isin), ['A', 'B']);
  approx(A.weight, 0.5); approx(B.weight, 0.5);
  approx(A.vol, Math.sqrt(0.042)); approx(B.vol, Math.sqrt(0.084));
  approx(A.mctr, -S252 / 300); approx(B.mctr, S252 / 75);
  approx(A.ctr, -S252 / 600); approx(B.ctr, S252 / 150);
  approx(A.pctr, -1 / 3); approx(B.pctr, 4 / 3);
  approx(A.pctr + B.pctr, 1, 1e-12, 'sum pctr = 1');
  approx(rc.diversificationRatio, 0.5 * (Math.sqrt(0.042) + Math.sqrt(0.084)) / (0.005 * S252));
  assert.ok(rc.diversificationRatio >= 1);
  assert.strictEqual(A.short, 'SA'); assert.strictEqual(rc.n, 4); approx(rc.value, 2);
});
test('riskContribution: 3 assets hand-computed, identities, null cases', () => {
  // w = 0.2/0.3/0.5; Sigma adds CC = 0.0005/3, AC = 0, BC = -0.0001 -> 300000*w'Sw = 7.3, pctr = [-1.6, 0.9, 8]/7.3
  const ctx3 = rcCtx({ A: 2, B: 3, C: 5, FL: 0 });
  const rc = E.riskContribution(ctx3, { selected: ['C', 'A', 'B'], start: 0, end: 4 });
  assert.deepStrictEqual(rc.rows.map((r) => r.isin), ['A', 'B', 'C'], 'ctx.positions order');
  approxArr(rc.rows.map((r) => r.weight), [0.2, 0.3, 0.5]);
  approx(rc.volAnn, Math.sqrt(7.3 / 300000 * 252));
  approxArr(rc.rows.map((r) => r.pctr), [-1.6 / 7.3, 0.9 / 7.3, 8 / 7.3]);
  approx(rc.rows.reduce((a, r) => a + r.pctr, 0), 1, 1e-12, 'sum pctr = 1');
  approx(rc.rows.reduce((a, r) => a + r.ctr, 0), rc.volAnn, 1e-12, 'sum ctr = volAnn');
  const volA = Math.sqrt(0.0005 / 3 * 252), volB = Math.sqrt(0.001 / 3 * 252);
  approx(rc.diversificationRatio, (0.2 * volA + 0.3 * volB + 0.5 * volA) / rc.volAnn);
  approx(rc.top3Pctr, 1, 1e-12);
  const z = E.riskContribution(ctx3, { selected: ['A', 'B', 'C', 'FL'], start: 0, end: 4 });
  assert.strictEqual(z.rows[3].weight, 0); assert.strictEqual(z.rows[3].pctr, 0); assert.strictEqual(z.rows[3].vol, 0);
  approx(z.volAnn, rc.volAnn, 1e-12, 'zero-weight row does not change the risk');
  const flat = E.riskContribution(rcCtx({ FL: 1 }), { selected: ['FL'], start: 0, end: 4 });
  assert.strictEqual(flat, null, 'volAnn = 0 -> null');
  assert.strictEqual(E.riskContribution(ctx3, { selected: ['FL'], start: 0, end: 4 }), null, 'V(end) = 0 -> null');
  assert.strictEqual(E.riskContribution(ctx3, { selected: ['A', 'B'], start: 3, end: 4 }), null, '1 return -> null');
  assert.strictEqual(E.riskContribution(ctx3, { selected: [], start: 0, end: 4 }), null, 'nothing selected');
});

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
test('fmt.date / asofBerlin', () => {
  assert.strictEqual(F.date('2026-04-21', 'long'), '21. Apr. 2026');
  assert.strictEqual(F.date('2026-01-02', 'long'), '2. Jan. 2026');
  assert.strictEqual(F.date('2026-04-21', 'short'), '21.04.2026');
  assert.strictEqual(F.date('2026-01-02'), '02.01.2026', 'default short');
  assert.strictEqual(F.date('2026-04-21', 'monthYear'), 'Apr. 2026');
  assert.strictEqual(F.date('2026-09-25', 'monthYear'), 'Sept. 2026');
  assert.strictEqual(F.date('2026-04-21', 'dayMonthShort'), '21.04.');
  assert.strictEqual(F.date('2026-01-02', 'dayMonthShort'), '02.01.');
  const months = Array.from({ length: 12 }, (_, m) => F.date(`2026-${String(m + 1).padStart(2, '0')}-15`, 'month'));
  assert.deepStrictEqual(months, ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.']);
  for (const bad of [null, undefined, '', 'garbage', '2026-02-30', 20260421]) assert.strictEqual(F.date(bad, 'long'), '–');
  assert.strictEqual(F.asofBerlin('2026-09-25T09:20Z'), '11:20');
  assert.strictEqual(F.asofBerlin('2026-09-25T09:20:30Z'), '11:20');
  assert.strictEqual(F.asofBerlin('2026-09-25T11:20+02:00'), '11:20');
  assert.strictEqual(F.asofBerlin('2026-01-15T09:20Z'), '10:20', 'CET in winter');
  assert.strictEqual(F.asofBerlin('2026-09-24T22:05Z'), '00:05');
  for (const bad of ['', null, undefined, 'x']) assert.strictEqual(F.asofBerlin(bad), '–');
  assert.strictEqual(F.DASH, '–');
});
test('fmt.parseDE', () => {
  const p = F.parseDE;
  assert.strictEqual(p('100.000'), 100000); assert.strictEqual(p('100000'), 100000);
  assert.strictEqual(p('100.000,50'), 100000.5); assert.strictEqual(p('1,5'), 1.5);
  assert.strictEqual(p('2,0'), 2); assert.strictEqual(p(' 1.234.567,89 € '), 1234567.89);
  assert.strictEqual(p('-1,5'), -1.5); assert.strictEqual(p('−1,5'), -1.5); assert.strictEqual(p('1.5'), 1.5);
  assert.strictEqual(p('1.234'), 1234); assert.strictEqual(p('12,'), 12); assert.strictEqual(p(',5'), 0.5);
  assert.strictEqual(p(42), 42); assert.ok(Object.is(p('-0'), 0));
  for (const bad of ['', '  ', 'abc', '1,2,3', '1.23.4', '12.34,5', '1e5', null, undefined, NaN, {}]) assert.strictEqual(p(bad), null, String(bad));
});

// ======================================================================= UMD wrapper (browser global)
test('UMD: classic script sets window.PFEngine without module', () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(ENGINE, 'utf8'), sandbox);
  const W = sandbox.window.PFEngine;
  assert.ok(W && typeof W.prepare === 'function' && typeof W.fmt.eur === 'function');
  assert.strictEqual(W.fmt.pct(0.1798), '+17,98 %');
  const foreignSet = new Set(['A', 'B']);                                   // Set from another realm (e.g. an iframe)
  const ws = W.portfolio(W.prepare(S_DATA), { selected: foreignSet, start: 0, end: 3 });
  assert.ok(ws && ws.raw.length === 4 && Math.abs(ws.raw[0] - 40) < 1e-12, 'cross-realm Set selection');
  for (const k of ['prepare', 'presetRange', 'customRange', 'portfolio', 'benchmark', 'drawdown', 'stats', 'relative', 'monthly', 'assets', 'groupSummary',
    'withShares', 'correlationMatrix', 'riskContribution'])
    assert.strictEqual(typeof E[k], 'function', k);
  for (const k of ['eur', 'num', 'pct', 'ratio', 'date', 'asofBerlin', 'parseDE']) assert.strictEqual(typeof E.fmt[k], 'function', 'fmt.' + k);
});

// ======================================================================= real data: invariants, sweep, smoke print
require(path.join(__dirname, '..', 'data', 'portfolio-data.js'));
const D = globalThis.PORTFOLIO_DATA;
const ctx = E.prepare(D);
const ALL = ctx.positions.map((p) => p.isin);
const PRESETS = ['1T', '1W', '1M', '3M', '6M', 'YTD', '1J', 'MAX'];
const SELECTIONS = [['all', ALL]].concat(ctx.groups.map((g) => [g, ctx.positions.filter((p) => p.group === g).map((p) => p.isin)]))
  .concat([['every 3rd', ALL.filter((_, i) => i % 3 === 0)]]);

test('real data: shape and fill (SpaceX back-filled before 2026-06-12)', () => {
  assert.strictEqual(ctx.n, D.dates.length);
  assert.strictEqual(ctx.positions.length, D.positions.length);
  assert.strictEqual(ctx.benchmarks.length, D.benchmarks.length);
  const sx = 'US84615Q1031', k = ctx.firstIdx[sx];
  assert.strictEqual(D.dates[k], '2026-06-12');
  assert.ok(ctx.px[sx].slice(0, k).every((x) => x === D.prices[sx][k]));
  for (const isin of Object.keys(ctx.px)) assert.ok(ctx.px[isin].every((x) => Number.isFinite(x) && x > 0), isin);
  const m = E.monthly(ctx, E.portfolio(ctx, { selected: ALL }).value);
  assert.strictEqual(m[0].partial, true);
  assert.strictEqual(m[m.length - 1].partial, ctx.status[ctx.n - 1] === 'intraday' || !E.util.isMonthComplete(ctx.dates[ctx.n - 1]));
  assert.ok(m.slice(1, -1).every((x) => !x.partial));
});

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

test('real data: %-metrics invariant to startValue scaling, EUR metrics scale', () => {
  const PCT = ['totalReturn', 'days', 'cagr', 'volAnn', 'sharpe', 'sortino', 'maxDD', 'currentDD', 'calmar', 'pctPositive', 'var95', 'cvar95'];
  const EUR = ['startValue', 'endValue', 'pl', 'var95EUR', 'cvar95EUR'];
  for (const p of ['1M', '6M', 'MAX']) {
    const r = E.presetRange(ctx, p);
    const base = E.portfolio(ctx, { selected: ALL, start: r.start, end: r.end });
    const st0 = E.stats(base);
    const b0 = E.benchmark(ctx, ctx.benchmarks[0], r.start, r.end, base.value[0]);
    const rel0 = E.relative(base, b0), rows0 = E.assets(ctx, { selected: ALL, start: r.start, end: r.end, scale: base.scale });
    for (const sv of [12345.67, 5e6]) {
      const s = E.portfolio(ctx, { selected: ALL, start: r.start, end: r.end, startValue: sv });
      const k = sv / base.value[0];
      approx(s.scale, k, 1e-12, 'scale');
      const st = E.stats(s);
      for (const key of PCT) approx(st[key], st0[key], 1e-9, `${p} ${key}`);
      for (const key of EUR) approx(st[key], st0[key] * k, 1e-9, `${p} ${key}`);
      approx(st.bestDay.ret, st0.bestDay.ret, 1e-9); approx(st.worstDay.ret, st0.worstDay.ret, 1e-9);
      for (const key of ['maxDDPeakDate', 'maxDDTroughDate', 'maxDDRecoveryDate']) assert.strictEqual(st[key], st0[key], key);
      const b = E.benchmark(ctx, ctx.benchmarks[0], r.start, r.end, s.value[0]);
      const rel = E.relative(s, b);
      for (const key of Object.keys(rel0)) if (rel0[key] !== null) approx(rel[key], rel0[key], 1e-9, `${p} relative.${key}`);
      approx(E.stats(b).totalReturn, E.stats(b0).totalReturn, 1e-12);
      const rows = E.assets(ctx, { selected: ALL, start: r.start, end: r.end, scale: s.scale });
      rows.forEach((row, i) => {
        for (const key of ['ret', 'contrib', 'w0', 'w1', 'vol', 'maxDD', 'glSinceBuy']) approx(row[key], rows0[i][key], 1e-9, `${row.isin} ${key}`);
        for (const key of ['v0', 'v1', 'pl', 'sharesScaled']) approx(row[key], rows0[i][key] * k, 1e-9, `${row.isin} ${key}`);
      });
    }
  }
});

test('real data: riskContribution identities (sum pctr = 1, DR >= 1, vol_i = assets vol) and correlation matrix', () => {
  for (const p of PRESETS) for (const [name, sel] of SELECTIONS) {
    const r = E.presetRange(ctx, p);
    const rc = E.riskContribution(ctx, { selected: sel, start: r.start, end: r.end });
    if (r.end - r.start < 2) { assert.strictEqual(rc, null, `${p} too short`); continue; }
    const where = `${p} ${name}`;
    approx(rc.rows.reduce((a, x) => a + x.pctr, 0), 1, 1e-9, where + ' sum pctr');
    approx(rc.rows.reduce((a, x) => a + x.ctr, 0), rc.volAnn, 1e-9, where + ' sum ctr');
    approx(rc.rows.reduce((a, x) => a + x.weight, 0), 1, 1e-12, where + ' sum w');
    assert.ok(rc.diversificationRatio >= 1 - 1e-12, `${where} DR ${rc.diversificationRatio}`);
    const vols = Object.fromEntries(E.assets(ctx, { selected: sel, start: r.start, end: r.end }).map((x) => [x.isin, x.vol]));
    rc.rows.forEach((x) => approx(x.vol, vols[x.isin], 1e-9, `${where} ${x.isin} vol`));
  }
  const sx = 'US84615Q1031', c = E.correlationMatrix(ctx, { isins: ALL, start: 0, end: ctx.n - 1 });
  const a = c.isins.indexOf(sx), b = c.isins.indexOf(ALL.find((i) => i !== sx));
  assert.strictEqual(c.n[a][b], ctx.n - 1 - ctx.firstIdx[sx], 'SpaceX pairs only after its listing');
  const full0 = c.isins.map((_, x) => x).filter((x) => ctx.firstIdx[c.isins[x]] === 0);
  assert.strictEqual(c.n[full0[0]][full0[1]], ctx.n - 1, 'instruments quoted from day 0 use every return');
  c.m.forEach((row, x) => row.forEach((v, y) => {
    assert.ok(v === null || (v >= -1 && v <= 1), 'in [-1, 1]');
    assert.strictEqual(v, c.m[y][x]);
    if (x === y) assert.strictEqual(v, 1);
  }));
  assert.ok(c.avg > 0 && c.avg < 1 && c.pairs === ALL.length * (ALL.length - 1) / 2);
});

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
      m: s ? E.monthly(c, E.portfolio(c, { selected: sel, startValue: sv }).value) : [], b: [],
      rc: E.riskContribution(c, { selected: sel, start: r.start, end: r.end }),
      cm: sv === null ? E.correlationMatrix(c, { isins: sel, start: r.start, end: r.end }) : null };
    for (const bm of c.benchmarks) {
      const b = E.benchmark(c, bm, r.start, r.end, s ? s.value[0] : 1000);
      out.b.push({ b, st: E.stats(b), rel: E.relative(s, b), dd: E.drawdown(b.value) });
    }
    if (out.st) for (const k of ['startValue', 'endValue', 'pl', 'totalReturn', 'days', 'cagr', 'cagrReliable', 'volAnn', 'sharpe', 'sortino',
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
test('sweep: degenerate synthetic data (flat prices, never-quoted instrument, zero-share position)', () => {
  const dates = calendar('2026-01-26', '2026-02-06', true);
  const c = E.prepare(dataOf(dates, {
    prices: { F: dates.map(() => 7), N: dates.map(() => null), U: dates.map((_, i) => (i < 5 ? null : 2 + i)) },
    positions: [{ isin: 'F', group: 'G1', shares: 3, cost_basis: 0 }, { isin: 'N', group: 'G1', shares: 5, cost_basis: 10 },
      { isin: 'U', group: 'G2', shares: 0, cost_basis: null }],
    groups: ['G1', 'G2'], benchmarks: [{ id: 'f', name: 'Flat', holdings: { F: 1 } }, { id: 'n', name: 'Never', holdings: { N: 1 } }],
  }));
  const ranges = [['max', { start: 0, end: c.n - 1 }], ['1pt', { start: 3, end: 3 }], ['2pt', { start: 3, end: 4 }]];
  sweep(c, 'degenerate', [['F', ['F']], ['N', ['N']], ['U', ['U']], ['all', ['F', 'N', 'U']], ['none', []]], ranges);
});

// ---------- real-data smoke print
(function smoke() {
  const s = E.portfolio(ctx, { selected: ALL, start: 0, end: ctx.n - 1 });
  const rows = [['Portfolio', E.stats(s)]].concat(ctx.benchmarks.map((b) => [b.name, E.stats(E.benchmark(ctx, b, 0, ctx.n - 1, s.value[0]))]));
  const pad = (x, n) => String(x).padStart(n);
  console.log(`\nReal data ${ctx.dates[0]}..${ctx.dates[ctx.n - 1]} (${ctx.status[ctx.n - 1]}), ${ctx.positions.length} positions, full range:`);
  console.log(`  ${'Serie'.padEnd(16)}${pad('Rendite', 11)}${pad('p.a.', 11)}${pad('Vol. p.a.', 11)}${pad('Sharpe', 8)}${pad('Max. DD', 11)}`);
  for (const [name, st] of rows) {
    console.log(`  ${name.padEnd(16)}${pad(F.pct(st.totalReturn), 11)}${pad(F.pct(st.cagr), 11)}${pad(F.pct(st.volAnn, { sign: false }), 11)}${pad(F.ratio(st.sharpe), 8)}${pad(F.pct(st.maxDD), 11)}`);
  }
  const top = E.assets(ctx, { selected: ALL, start: 0, end: ctx.n - 1, scale: 1 }).sort((a, b) => b.contrib - a.contrib).slice(0, 5);
  console.log(`  Portfolio ${F.eur(s.value[0])} -> ${F.eur(s.value[s.value.length - 1])}; top 5 Beitrag:`);
  top.forEach((r) => console.log(`    ${r.short.padEnd(22)} ${pad(F.pct(r.contrib), 9)}  (Rendite ${F.pct(r.ret)})`));
  const rc = E.riskContribution(ctx, { selected: ALL, start: 0, end: ctx.n - 1 });
  const cm = E.correlationMatrix(ctx, { isins: ALL, start: 0, end: ctx.n - 1 });
  const top3 = rc.rows.slice().sort((a, b) => b.pctr - a.pctr).slice(0, 3).map((r) => `${r.short} ${F.pct(r.pctr, { sign: false, dec: 1 })}`);
  console.log(`  Risiko (aktuelle Gewichte): Vol. p.a. ${F.pct(rc.volAnn, { sign: false })}, Div.-Ratio ${F.ratio(rc.diversificationRatio)}, ` +
    `Top 3 = ${F.pct(rc.top3Pctr, { sign: false, dec: 1 })} (${top3.join(', ')}); Ø Korrelation ${F.ratio(cm.avg)}`);
})();

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
  intraday: {
    dates: ['2026-03-03', '2026-03-04'], times: ['07:30', '08:00', '08:30'], asof_utc: '2026-03-04T07:05Z',
    px: { A: [null, 11.5, 11, 12.5, null, null], B: [21.5, null, 21, null, 18, null] },
  },
});

test('intraday: fill rules (previous close before the first quote, forward-fill, flat daily price without quotes, null after the last slot)', () => {
  const ctx = E.prepare(I_DATA());
  const I = ctx.intraday;
  assert.ok(I && I.ok, 'intraday ok');
  assert.strictEqual(I.last, 4);
  assert.deepStrictEqual(I.px.A, [10, 11.5, 11, 12.5, 12.5, null]);
  assert.deepStrictEqual(I.px.B, [21.5, 21.5, 21, 21, 18, null]);
  assert.deepStrictEqual(I.px.C, [6, 6, 6, 7, 7, null]);
  assert.strictEqual(I.has.C, false);
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

test('intraday: benchmark normalized to the base, asset series, window', () => {
  const ctx = E.prepare(I_DATA());
  const b = E.intradayBenchmark(ctx, 'ab', 49);
  approx(b.value[3], 49 * 23 / 21.5, 1e-12, 'bench k3');
  approx(b.value[4], 49, 1e-12, 'bench k4');
  assert.strictEqual(b.value[5], null);
  const a = E.intradayAsset(ctx, 'B');
  assert.deepStrictEqual(a.px, [21.5, 21.5, 21, 21, 18, null]);
  approx(a.prevClose, 21, 1e-12, 'prevClose');
  const s = E.intraday(ctx, { selected: ['A', 'B', 'C'] });
  const w = E.intradayWindow(s.value, 4, 1);
  approx(w.pl, -0.5, 1e-12, 'window pl');
  approx(w.ret, 50 / 50.5 - 1, 1e-12, 'window ret');
  assert.strictEqual(E.intradayWindow(s.value, 1, 5), null);
});

test('benchmarkValueNow / benchmarkRealPl: real € change of the holdings, scaled to a target value', () => {
  const ctx = E.prepare(I_DATA());                              // ab = A:1 + B:0.5; daily A [10,11,12], B [20,21,19]
  approx(E.benchmarkValueNow(ctx, 'ab'), 12 + 9.5, 1e-12, 'value now');
  approx(E.benchmarkRealPl(ctx, 'ab', 0, 2), 21.5 - 20, 1e-12, 'daily real pl');
  approx(E.benchmarkRealPl(ctx, 'ab', 2, 0), 1.5, 1e-12, 'order-independent');
  approx(E.benchmarkRealPl(ctx, 'ab', 0, 2, { target: 43 }), 1.5 * 2, 1e-12, 'scaled to target');
  // intraday slots: A [10,11.5,11,12.5,12.5], B [21.5,21.5,21,21,18] -> k1 = 22.25, k4 = 21.5
  approx(E.benchmarkRealPl(ctx, 'ab', 1, 4, { intraday: true }), 21.5 - 22.25, 1e-12, 'intraday real pl');
  assert.strictEqual(E.benchmarkRealPl(ctx, 'ab', 1, 5, { intraday: true }), null);
  assert.strictEqual(E.benchmarkRealPl(ctx, 'nope', 0, 1), null);
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

test('intradayBenchmark with weights: bought at the previous close (1T start)', () => {
  const ctx = E.prepare(I_DATA());                              // daily A [10, 11, 12], B [20, 21, 19]; 1T base index 1
  const b = E.intradayBenchmark(ctx, { id: 'w', name: 'W', weights: { A: 60, B: 40 } }, 49);
  // intraday A [10, 11.5, 11, 12.5, 12.5], B [21.5, 21.5, 21, 21, 18]; bought at A 11, B 21
  const ref = (k) => 49 * (0.6 * [10, 11.5, 11, 12.5, 12.5][k] / 11 + 0.4 * [21.5, 21.5, 21, 21, 18][k] / 21);
  for (let k = 0; k < 5; k++) approx(b.value[k], ref(k), 1e-12, 'slot ' + k);
  assert.strictEqual(b.value[5], null);
  assert.strictEqual(E.intradayBenchmark(ctx, { id: 'n', weights: { NOPRICE: 1 } }, 49), null);
  // equals the daily buy-and-hold series of the 1T range at the end of the day
  const d = E.benchmark(ctx, { id: 'w', weights: { A: 60, B: 40 } }, 1, 2, 49);
  approx(E.intradayBenchmark(ctx, { id: 'w', weights: { A: 60, B: 40 } }, 49).value[4], 49 * (0.6 * 12.5 / 11 + 0.4 * 18 / 21), 1e-12, 'k4');
  approx(d.value[0], 49, 1e-12, 'daily 1T start');
});

test('equalValueWindow: benchmark return over the span × portfolio value at the span start', () => {
  const p = [100, 110, 121, null], bv = [50, 55, 44, 60];
  const w = E.equalValueWindow(p, bv, 1, 2);
  approx(w.base, 110, 1e-12, 'base = portfolio value at the span start');
  approx(w.ret, 44 / 55 - 1, 1e-12, 'benchmark return');
  approx(w.pl, 110 * (44 / 55 - 1), 1e-12, 'pl = base × ret');
  const r = E.equalValueWindow(p, bv, 2, 1);
  approx(r.pl, w.pl, 1e-12, 'order-independent');
  approx(E.equalValueWindow(p, bv, 0, 3).pl, 100 * (60 / 50 - 1), 1e-12, 'end value of the portfolio is not needed');
  assert.strictEqual(E.equalValueWindow(p, bv, 3, 3 + 1), null);        // bench value missing
  assert.strictEqual(E.equalValueWindow([null, 1], bv, 0, 1), null);     // portfolio start missing
  assert.strictEqual(E.equalValueWindow(null, bv, 0, 1), null);
});

test('intraday: stale or missing data -> null (1T falls back to daily)', () => {
  const d = I_DATA();
  d.intraday.dates = ['2026-03-02', '2026-03-03'];            // older than the last daily date
  assert.strictEqual(E.intraday(E.prepare(d), { selected: ['A'] }), null);
  const e = I_DATA();
  delete e.intraday;
  const ctx = E.prepare(e);
  assert.strictEqual(ctx.intraday, null);
  assert.strictEqual(E.intraday(ctx, { selected: ['A'] }), null);
  assert.strictEqual(E.intradayAsset(ctx, 'A'), null);
  const w = E.withShares(E.prepare(I_DATA()), { A: 0 });      // what-if keeps the intraday grid
  approx(E.intraday(w, { selected: ['A', 'B', 'C'] }).value[4], 25, 1e-12, 'what-if value');
});

test('real data: intraday (if present and current) ends at the daily 1T end value', () => {
  const D = globalThis.PORTFOLIO_DATA || (require(path.join(__dirname, '..', 'data', 'portfolio-data.js')), globalThis.PORTFOLIO_DATA);
  const ctx = E.prepare(D);
  const all = ctx.positions.map((p) => p.isin);
  const s = E.intraday(ctx, { selected: all });
  if (!s) return;                                               // no or stale intraday data: nothing to compare
  const d = E.portfolio(ctx, { selected: all, start: ctx.n - 2, end: ctx.n - 1 });
  approx(s.base, d.startValue, 1e-9, 'base = 1T start');
  assert.ok(Math.abs(s.value[s.last] / d.value[1] - 1) < 0.01, `intraday end ${s.value[s.last]} vs daily ${d.value[1]}`);
  s.value.forEach((v, k) => assert.ok(k > s.last ? v === null : Number.isFinite(v) && v > 0, `slot ${k}`));
});

console.log(`\nengine tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
