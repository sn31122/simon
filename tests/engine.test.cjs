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
  assert.strictEqual(F.date('2026-09-23', 'weekdayDayMonth'), 'Mi 23.09.', 'weekday without dot');
  assert.strictEqual(F.date('2026-09-18', 'weekdayDayMonth'), 'Fr 18.09.');
  assert.deepStrictEqual(calendar('2026-09-21', '2026-09-27').map((d) => F.date(d, 'weekdayDayMonth').slice(0, 2)), ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
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
    'withShares', 'correlationMatrix', 'riskContribution', 'chartInterval', 'gridCovers', 'gridFrame', 'intraday', 'intradayBenchmark',
    'intradayAsset', 'intradayWindow', 'equalValueWindow', 'benchmarkValueNow', 'benchmarkRealPl',
    'benchmarkRealValue', 'benchmarkWeights', 'holdingsFromWeights'])
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
  grids: {
    m30: {
      dates: ['2026-03-03', '2026-03-04'], times: ['07:30', '08:00', '08:30'], asof_utc: '2026-03-04T07:05Z',
      px: { A: [null, 11.5, 11, 12.5, null, null], B: [21.5, null, 21, null, 18, null] },
    },
  },
});

test('intraday: fill rules (previous close before the first quote, forward-fill, flat daily price without quotes, null after the last slot)', () => {
  const ctx = E.prepare(I_DATA());
  const G = ctx.grids.m30;
  assert.ok(G, 'm30 grid');
  assert.strictEqual(ctx.grids.h2, null, 'no h2 data');
  assert.deepStrictEqual(G.dates, ['2026-03-03', '2026-03-04']);
  assert.deepStrictEqual(G.idx, [1, 2]);
  assert.deepStrictEqual(G.last, [2, 1], 'final session complete, open session up to its latest point');
  assert.deepStrictEqual(G.px.A, [10, 11.5, 11, 12.5, 12.5, null]);
  assert.deepStrictEqual(G.px.B, [21.5, 21.5, 21, 21, 18, null]);
  assert.deepStrictEqual(G.px.C, [6, 6, 6, 7, 7, null]);
  assert.deepStrictEqual(G.seen.C, [false, false]);
  assert.deepStrictEqual(G.seen.A, [true, true]);
  // the old data.intraday shape is read as the 30-min grid
  const legacy = I_DATA();
  legacy.intraday = legacy.grids.m30;
  delete legacy.grids;
  assert.deepStrictEqual(E.prepare(legacy).grids.m30.px.B, G.px.B, 'legacy data.intraday');
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

test('benchmarkWeights / holdingsFromWeights: today\'s value shares <-> constant quantities', () => {
  const ctx = E.prepare(I_DATA());                              // ab = A:1 + B:0.5; daily A [10,11,12], B [20,21,19]
  const w = E.benchmarkWeights(ctx, 'ab');                      // last day: 12 and 9.5 of 21.5
  approx(w.A, 12 / 21.5, 1e-12, 'weight A today');
  approx(w.B, 9.5 / 21.5, 1e-12, 'weight B today');
  approx(E.benchmarkWeights(ctx, 'ab', 0).A, 10 / 20, 1e-12, 'weight A on day 0');
  // round trip: the weights of today give the real quantities, scaled to a value of 1 today
  const h = E.holdingsFromWeights(ctx, w);
  approx(h.A, 1 / 21.5, 1e-12, 'qty A');
  approx(h.B, 0.5 / 21.5, 1e-12, 'qty B');
  approxArr(E.benchmark(ctx, { id: 'h', holdings: h }, 0, 2, 100).value, E.benchmark(ctx, 'ab', 0, 2, 100).value, 1e-12, 'same line as the real holdings');
  approx(E.benchmarkRealPl(ctx, { id: 'h', holdings: h }, 0, 2, { target: 43 }), E.benchmarkRealPl(ctx, 'ab', 0, 2, { target: 43 }), 1e-12, 'same real pl');
  // percent, ISINs without prices and weights <= 0 are ignored; at = the day whose shares they are
  const p = E.holdingsFromWeights(ctx, { A: 60, B: 40, NOPRICE: 10, C: 0 }, 1);
  approx(p.A, 0.6 / 11, 1e-12, 'qty A at day 1');
  approx(p.B, 0.4 / 21, 1e-12, 'qty B at day 1');
  assert.strictEqual('NOPRICE' in p || 'C' in p, false);
  assert.strictEqual(E.holdingsFromWeights(ctx, { NOPRICE: 100 }), null);
  assert.strictEqual(E.holdingsFromWeights(ctx, null), null);
  assert.strictEqual(E.benchmarkWeights(ctx, 'nope'), null);
});

test('benchmarkRealPl / benchmarkValueNow with weights: bought at buyAt, then held', () => {
  const ctx = E.prepare(I_DATA());                              // daily A [10,11,12], B [20,21,19]
  const w = { id: 'w', weights: { A: 50, B: 50 } };
  assert.strictEqual(E.benchmarkValueNow(ctx, w), null, 'needs buyAt');
  assert.strictEqual(E.benchmarkRealPl(ctx, w, 0, 2), null, 'needs buyAt');
  // bought at day 1: q_A = 0.5/11, q_B = 0.5/21 -> value today = 0.5·12/11 + 0.5·19/21
  const now = 0.5 * 12 / 11 + 0.5 * 19 / 21, q = (a, b) => 0.5 * a / 11 + 0.5 * b / 21;
  approx(E.benchmarkValueNow(ctx, w, 1), now, 1e-12, 'value now per 1 invested');
  approx(E.benchmarkRealPl(ctx, w, 1, 2, { buyAt: 1 }), q(12, 19) - 1, 1e-12, 'untargeted');
  approx(E.benchmarkRealPl(ctx, w, 2, 1, { buyAt: 1, target: 1000 }), (q(12, 19) - 1) * 1000 / now, 1e-12, 'scaled: worth 1000 today');
  // on the 1T frame (bought at the previous close = day 1): A [10,11.5,11,12.5,12.5], B [21.5,21.5,21,21,18]
  approx(E.benchmarkRealPl(ctx, w, 1, 4, { intraday: true, buyAt: 1 }), q(12.5, 18) - q(11.5, 21.5), 1e-12, 'intraday');
});

test('benchmarkRealValue: holdings value at a daily index, scaled to a target; value(b) − value(a) = benchmarkRealPl(a, b)', () => {
  const ctx = E.prepare(I_DATA());                              // ab = A:1 + B:0.5; daily A [10,11,12], B [20,21,19]
  approx(E.benchmarkRealValue(ctx, 'ab', 2), 21.5, 1e-12, 'last day untargeted = benchmarkValueNow');
  approx(E.benchmarkRealValue(ctx, 'ab', 0), 20, 1e-12, 'day 0 untargeted');
  approx(E.benchmarkRealValue(ctx, 'ab', 1), 11 + 10.5, 1e-12, 'day 1 untargeted');
  approx(E.benchmarkRealValue(ctx, 'ab', 2, { target: 43 }), 43, 1e-12, 'last day = target');
  approx(E.benchmarkRealValue(ctx, 'ab', 0, { target: 43 }), 40, 1e-12, 'day 0 scaled (20 · 43 / 21.5)');
  approx(E.benchmarkRealValue(ctx, { id: 'ab', holdings: { A: 1, B: 0.5 } }, 1.4, {}), 21.5, 1e-12, 'bench object, index rounded');
  for (const t of [undefined, 43, 1000])
    for (const [a, b] of [[0, 2], [0, 1], [1, 2], [1, 1]])
      approx(E.benchmarkRealValue(ctx, 'ab', b, { target: t }) - E.benchmarkRealValue(ctx, 'ab', a, { target: t }),
        E.benchmarkRealPl(ctx, 'ab', a, b, { target: t }), 1e-12, 'identity holdings ' + t + ' ' + a + '-' + b);
  // weights: bought at buyAt, value per 1 invested there, target = worth that much on the last day
  const w = { id: 'w', weights: { A: 50, B: 50 } }, now = 0.5 * 12 / 11 + 0.5 * 19 / 21;
  assert.strictEqual(E.benchmarkRealValue(ctx, w, 2), null, 'weights need buyAt');
  approx(E.benchmarkRealValue(ctx, w, 1, { buyAt: 1 }), 1, 1e-12, 'worth 1 at the purchase');
  approx(E.benchmarkRealValue(ctx, w, 2, { buyAt: 1 }), now, 1e-12, 'value now per 1 invested');
  approx(E.benchmarkRealValue(ctx, w, 2, { buyAt: 1, target: 1000 }), 1000, 1e-12, 'last day = target');
  approx(E.benchmarkRealValue(ctx, w, 1, { buyAt: 1, target: 1000 }), 1000 / now, 1e-12, 'purchase day scaled');
  approx(E.benchmarkRealValue(ctx, w, 0, { buyAt: 1 }), 0.5 * 10 / 11 + 0.5 * 20 / 21, 1e-12, 'before the purchase: the same quantities');
  for (const t of [undefined, 1000])
    for (const [a, b] of [[1, 2], [0, 2]])
      approx(E.benchmarkRealValue(ctx, w, b, { buyAt: 1, target: t }) - E.benchmarkRealValue(ctx, w, a, { buyAt: 1, target: t }),
        E.benchmarkRealPl(ctx, w, a, b, { buyAt: 1, target: t }), 1e-12, 'identity weights ' + t + ' ' + a + '-' + b);
  // null-safe, never NaN
  assert.strictEqual(E.benchmarkRealValue(ctx, 'nope', 1), null);
  assert.strictEqual(E.benchmarkRealValue(ctx, 'ab', -1), null);
  assert.strictEqual(E.benchmarkRealValue(ctx, 'ab', 3), null);
  assert.strictEqual(E.benchmarkRealValue(ctx, 'ab', NaN), null);
  assert.strictEqual(E.benchmarkRealValue(ctx, 'ab', null), null);
  assert.strictEqual(E.benchmarkRealValue(ctx, { id: 'e', holdings: {} }, 1), null, 'no holdings');
  assert.strictEqual(E.benchmarkRealValue(ctx, { id: 'z', weights: { NOPRICE: 100 } }, 1, { buyAt: 0 }), null, 'no valid weight');
  approx(E.benchmarkRealValue(ctx, 'ab', 2, { target: -5 }), 21.5, 1e-12, 'invalid target = untargeted');
});

test('real data: benchmarkRealValue of Mein Depot and the Energie preset (identity with benchmarkRealPl over every preset)', () => {
  const n = ctx.n, now = E.benchmarkValueNow(ctx, 'my_depot');
  approx(E.benchmarkRealValue(ctx, 'my_depot', n - 1), now, 1e-9, 'Mein Depot today = its real value');
  const en = (D.card_presets || []).find((c) => c.id === 'energie');
  for (const pr of PRESETS) {
    const R = E.presetRange(ctx, pr);
    for (const [b, opts] of [['my_depot', {}], ['my_depot', { target: 100000 }]].concat(en ? [[{ id: 'energie', weights: en.weights }, { target: 298811.25 }]] : [])) {
      const o = Object.assign({ buyAt: R.start }, opts);
      const v0 = E.benchmarkRealValue(ctx, b, R.start, o), v1 = E.benchmarkRealValue(ctx, b, R.end, o);
      assert.ok(Number.isFinite(v0) && Number.isFinite(v1), pr + ' finite');
      approx(v1 - v0, E.benchmarkRealPl(ctx, b, R.start, R.end, o), 1e-6, pr + ' identity');
      if (opts.target) approx(v1, opts.target, 1e-6, pr + ' ends on the target on the last day');
    }
  }
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
  d.grids.m30.dates = ['2026-03-02', '2026-03-03'];            // older than the last daily date
  assert.strictEqual(E.intraday(E.prepare(d), { selected: ['A'] }), null);
  assert.strictEqual(E.chartInterval(E.prepare(d), E.presetRange(E.prepare(d), '1T'), '1T').key, 'day', '1T steps down to daily');
  const e = I_DATA();
  delete e.grids;
  const ctx = E.prepare(e);
  assert.deepStrictEqual(ctx.grids, { m30: null, h2: null });
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

test('grids: fill per session, final sessions end on the daily close (pinned), not-seen session flat, gaps allowed', () => {
  const G = E.prepare(G_DATA()).grids.m30;
  assert.deepStrictEqual(G.dates, ['2026-03-03', '2026-03-05', '2026-03-06', '2026-03-09']);
  assert.deepStrictEqual(G.pos, { 1: 0, 3: 1, 4: 2, 5: 3 });
  assert.deepStrictEqual(G.px.A, [10.5, 10.5, 11, 11.5, 12.5, 11, 11, 12, 13, 13.5, 13.5, 14]);
  assert.deepStrictEqual(G.px.B, [20, 20.5, 21, 19.5, 19.5, 22, 21, 20.5, 20, 21, 21, 21]);
  assert.deepStrictEqual(G.seen.B, [true, true, true, false]);
  const O = E.prepare(G_DATA('intraday')).grids.m30;         // open last session: ends after its latest point (A 09:00)
  assert.deepStrictEqual(O.last, [2, 2, 2, 0]);
  assert.deepStrictEqual(O.px.A.slice(9), [13.5, null, null]);
  assert.deepStrictEqual(O.px.B.slice(9), [21, null, null], 'no point that day: flat at the daily price');
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

test('gridFrame: point 0 = daily close of the start, sessions concatenated, context (1T), trim, null without coverage', () => {
  const c = E.prepare(G_DATA());
  const f = E.gridFrame(c, 'm30', 2, 4);
  assert.deepStrictEqual([f.m, f.last, f.ctxEnd, f.context], [7, 6, -1, false]);
  assert.deepStrictEqual(f.src, [-1, 3, 4, 5, 6, 7, 8]);
  assert.deepStrictEqual(f.day, [2, 3, 3, 3, 4, 4, 4]);
  assert.deepStrictEqual(f.slot, [-1, 0, 1, 2, 0, 1, 2]);
  assert.deepStrictEqual(f.sessions.map((x) => [x.date, x.from, x.to]), [['2026-03-05', 1, 3], ['2026-03-06', 4, 6]]);
  assert.strictEqual(E.gridFrame(c, 'm30', 1, 3), null, '04.03. not collected');
  assert.strictEqual(E.gridFrame(c, 'm30', 3, 3), null, 'empty range');
  const k = E.gridFrame(c, 'm30', 4, 5, { context: true });
  assert.deepStrictEqual([k.m, k.ctxEnd, k.context, k.segs.length, k.sessions.length], [6, 2, true, 2, 1]);
  assert.deepStrictEqual(k.src, [6, 7, 8, 9, 10, 11]);
  const n = E.gridFrame(c, 'm30', 2, 3, { context: true });   // start session 04.03. not collected: point 0 = its close
  assert.deepStrictEqual([n.context, n.ctxEnd, n.src[0], n.m], [false, -1, -1, 4]);
  const o = E.prepare(G_DATA('intraday'));
  const t = E.gridFrame(o, 'm30', 3, 5, { trim: true }), u = E.gridFrame(o, 'm30', 3, 5);
  assert.deepStrictEqual([t.m, t.last, u.m, u.last], [5, 4, 7, 4], 'trim cuts the open session after its latest point');
  assert.strictEqual(t.sessions[1].to, 4);
});

test('intraday on a multi-day frame: values, base = daily start, end = daily end, Startwert scale, what-if', () => {
  const c = E.prepare(G_DATA()), f = E.gridFrame(c, 'm30', 2, 4);
  const s = E.intraday(c, { selected: ['A', 'B'], frame: f });
  approxArr(s.value, [43, 42.5, 44.5, 44, 43, 44.5, 46], 1e-12, 'value (2 A + B)');
  const d = E.portfolio(c, { selected: ['A', 'B'], start: 2, end: 4 });
  approx(s.base, d.startValue, 1e-12, 'base = daily start value');
  approx(s.value[s.last], d.value[d.value.length - 1], 1e-12, 'end = daily end (final sessions)');
  approxArr(s.pl, [0, -0.5, 1.5, 1, 0, 1.5, 3], 1e-12, 'pl');
  assert.deepStrictEqual([s.key, s.m, s.last, s.ctxEnd], ['m30', 7, 6, -1]);
  assert.deepStrictEqual(s.dates, ['2026-03-05', '2026-03-06']);
  const sc = E.intraday(c, { selected: ['A', 'B'], frame: f, startValue: 86 });
  approx(sc.scale, 2, 1e-12, 'scale');
  approx(sc.value[6], 92, 1e-12, 'scaled end');
  approx(sc.base, E.portfolio(c, { selected: ['A', 'B'], start: 2, end: 4, startValue: 86 }).startValue, 1e-12, 'scaled base = daily');
  const w = E.withShares(c, { A: 0 });
  approxArr(E.intraday(w, { selected: ['A', 'B'], frame: f }).value, [19, 19.5, 19.5, 22, 21, 20.5, 20], 1e-12, 'what-if on the same frame');
  const dd = E.drawdown(s.value);
  assert.deepStrictEqual([dd.peak, dd.trough], [2, 4]);
  approx(dd.maxDD, 43 / 44.5 - 1, 1e-12, 'drawdown on the grid');
  assert.strictEqual(E.intraday(c, { selected: [], frame: f }), null);
  // 2-h grid, range 03.–05.03. (m30 lacks 04.03.): A [11, 11.8, 12, 11.4, 11], B [21, 19.6, 19, 20.8, 22]
  const h = E.intraday(c, { selected: ['A', 'B'], frame: E.gridFrame(c, 'h2', 1, 3) });
  approxArr(h.value, [43, 43.2, 43, 43.6, 44], 1e-12, 'h2 value');
  approx(h.value[h.last], E.portfolio(c, { selected: ['A', 'B'], start: 1, end: 3 }).value[2], 1e-12, 'h2 end = daily end');
});

test('intradayBenchmark on a frame: holdings normalized to the base, weights bought at the start close and held; real P/L', () => {
  const c = E.prepare(G_DATA()), f = E.gridFrame(c, 'm30', 2, 4);
  const B = [19, 19.5, 19.5, 22, 21, 20.5, 20], A = [12, 11.5, 12.5, 11, 11, 12, 13];
  const hb = E.intradayBenchmark(c, 'bb', 43, f);
  approxArr(hb.value, B.map((x) => 43 * x / 19), 1e-12, 'holdings');
  approx(hb.value[6], E.benchmark(c, 'bb', 2, 4, 43).value[2], 1e-12, 'end = daily benchmark end');
  approxArr(hb.ret, B.map((x) => x / 19 - 1), 1e-12, 'ret since the range start');
  const wb = { id: 'w', name: 'W', weights: { A: 50, B: 50 } };
  const wv = E.intradayBenchmark(c, wb, 43, f);
  approxArr(wv.value, A.map((a, k) => 43 * (0.5 * a / 12 + 0.5 * B[k] / 19)), 1e-12, 'weights: bought at the close of the start, held');
  approx(wv.value[6], E.benchmark(c, wb, 2, 4, 43).value[2], 1e-12, 'weights end = daily buy-and-hold end');
  // real € change of AB = A + 0.5 B between points 1 and 5: 21.25 -> 22.25; now = 14 + 10.5 = 24.5
  approx(E.benchmarkRealPl(c, 'ab', 1, 5, { frame: f }), 1, 1e-12, 'real pl on the frame');
  approx(E.benchmarkRealPl(c, 'ab', 5, 1, { frame: f, target: 49 }), 2, 1e-12, 'order-independent, scaled to target');
  assert.strictEqual(E.benchmarkRealPl(c, 'ab', 1, 7, { frame: f }), null, 'beyond the frame');
  const eq = E.equalValueWindow(E.intraday(c, { selected: ['A', 'B'], frame: f }).value, hb.value, 1, 5);
  approx(eq.pl, 42.5 * (20.5 / 19.5 - 1), 1e-12, 'Gleicher Wert on the frame');
  const a = E.intradayAsset(c, 'A', f);
  assert.deepStrictEqual(a.px, A);
  assert.strictEqual(a.prevClose, 12);
});

test('real data: chart interval per range and multi-day grids end on the daily values', () => {
  const D = globalThis.PORTFOLIO_DATA;
  const c = E.prepare(D), all = c.positions.map((p) => p.isin);
  const G = c.grids;
  if (!G.m30 || !G.h2) return;                                  // no sub-daily data: nothing to check
  const iv = (p) => E.chartInterval(c, E.presetRange(c, p), p).key;
  const cu = (a, b) => E.chartInterval(c, E.customRange(c, a, b), 'custom');
  if (G.m30.dates[G.m30.D - 1] === c.dates[c.n - 1]) { assert.strictEqual(iv('1T'), 'm30'); }
  for (const p of ['3M', '6M', 'YTD', '1J', 'MAX']) assert.strictEqual(iv(p), 'day', p);
  const inM30 = cu(G.m30.dates[0], G.m30.dates[G.m30.D - 1]);
  if (G.m30.D > 1) assert.strictEqual(inM30.key, inM30.days <= 7 ? 'm30' : inM30.days <= 31 ? 'h2' : 'day', 'custom inside m30');
  const before = c.dates.filter((d) => d < G.h2.dates[0]);
  if (before.length > 6) {
    const r = cu(before[before.length - 6], before[before.length - 1]);
    assert.deepStrictEqual([r.key, r.want, r.skipped.join()], ['day', 'm30', 'm30,h2'], 'custom week before the 2-h data');
  }
  for (const [key, p] of [['m30', '1W'], ['h2', '1M']]) {
    const R = E.presetRange(c, p);
    if (!E.gridCovers(c, key, R.start, R.end)) continue;
    const f = E.gridFrame(c, key, R.start, R.end, { trim: true }), s = E.intraday(c, { selected: all, frame: f });
    const d = E.portfolio(c, { selected: all, start: R.start, end: R.end });
    approx(s.base, d.startValue, 1e-9, `${p} base`);
    assert.strictEqual(s.m, 1 + (R.end - R.start) * c.grids[key].S - (c.status[R.end] === 'final' ? 0 : c.grids[key].S - 1 - c.grids[key].last[c.grids[key].D - 1]), `${p} frame length`);
    s.value.forEach((v, k) => assert.ok(Number.isFinite(v) && v > 0, `${p} point ${k}`));
    if (c.status[R.end] === 'final') {
      approx(s.value[s.last], d.value[d.value.length - 1], 1e-9, `${p} end = daily end`);
      for (const b of [c.benchmarks[0], { id: 'w', name: 'W', weights: { IE00B4L5Y983: 40, US5949181045: 60 } }]) {
        const ib = E.intradayBenchmark(c, b, s.base, f), db = E.benchmark(c, b, R.start, R.end, s.base);
        approx(ib.value[ib.last], db.value[db.value.length - 1], 1e-9, `${p} ${b.id} end`);
      }
    }
  }
});

// ---------- transactions benchmark (Depot-Historie, user 27.09.): replayed holdings, time-weighted return, real €
test('transactions benchmark: TWR and real € (buy after an empty day, partial sell, same-day round trip, unpriced holding)', () => {
  const dates = calendar('2026-03-02', '2026-03-06', true);               // Mon..Fri, indices 0..4
  const tx = [
    { date: '2026-03-03', time: '10:00:00', isin: 'A', shares: 10, price: 10.5 },   // V_0 = 0 -> r_1 = 0, the index starts here
    { date: '2026-03-04', time: '11:00:00', isin: 'B', shares: 5, price: 21 },
    { date: '2026-03-04', time: '12:00:00', isin: 'X', shares: 4, price: 5 },       // X has no prices: flat at 5 while held
    { date: '2026-03-05', time: '09:00:00', isin: 'A', shares: -4, price: 12.5 },   // partial sale
    { date: '2026-03-05', time: '15:00:00', isin: 'C', shares: -3, price: 8 },      // same-day round trip (listed out of order)
    { date: '2026-03-05', time: '13:00:00', isin: 'C', shares: 3, price: 7 },
    { date: '2026-03-06', time: '14:00:00', isin: 'X', shares: -4, price: 6 },      // X's gain shows on the sale day
    { date: '2026-03-07', time: '10:00:00', isin: 'A', shares: 1, price: 15 },      // after the data: not counted
  ];
  const c = ctxOf(dates, { prices: { A: [10, 11, 12, 12, 15], B: [20, 20, 22, 24, 24], C: [7, 7, 7, 7, 7] },
    benchmarks: [{ id: 't', name: 'T', transactions: tx }] });
  const H = E.transactionHistory(c, 't');
  approxArr(H.value, [0, 110, 250, 212, 210], 1e-12, 'V');
  approxArr(H.flow, [0, 105, 125, -53, -24], 1e-12, 'F');
  const I = [1, 1, 125 / 110, 125 / 110 * 265 / 250, 125 / 110 * 265 / 250 * 234 / 212];
  approxArr(H.index, I, 1e-12, 'I');
  assert.deepStrictEqual(H.holdings[4], { A: 6, B: 5 });
  assert.deepStrictEqual(H.unpriced, { X: [2, 3] });
  assert.strictEqual(H.after, 1);
  const s = E.benchmark(c, 't', 1, 4, 1000);
  approxArr(s.value, [1000, 1000 * I[2], 1000 * I[3], 1000 * I[4]], 1e-12, 'series = base · I / I_start');
  approx(E.stats(s).totalReturn, I[4] - 1, 1e-12, 'TWR');
  // real €: V_b − V_a − Σ F in (a, b] = A 30 + B 15 + X 4 + C 3 = 52; scaled by target / V(last day)
  approx(E.benchmarkRealPl(c, 't', 1, 4), 52, 1e-12, 'real € 1..4');
  approx(E.benchmarkRealPl(c, 't', 4, 1, { target: 420 }), 104, 1e-12, 'scaled, order-independent');
  approx(E.benchmarkRealPl(c, 't', 2, 3), 212 - 250 + 53, 1e-12, 'real € 2..3');
  approx(E.benchmarkValueNow(c, 't'), 210, 1e-12, 'value now');
  approx(E.benchmarkRealValue(c, 't', 2), 250, 1e-12, 'value day 2');
  approx(E.benchmarkRealValue(c, 't', 2, { target: 420 }), 500, 1e-12, 'value day 2 scaled');
  assert.strictEqual(E.benchmarkWeights(c, 't'), null, 'no constant holdings');
});

test('transactions benchmark on a 30-min frame: trades at their nearest slot, TWR chained over the points', () => {
  const d = I_DATA();                  // daily A [10, 11, 12], B [20, 21, 19]; 1T frame: context 03.03. (points 0-2), 04.03. (3-4)
  d.benchmarks = [{ id: 't', name: 'T', transactions: [
    { date: '2026-03-02', time: '12:00', isin: 'A', shares: 2, price: 10 },
    { date: '2026-03-03', time: '08:05', isin: 'B', shares: 1, price: 21.4 },       // -> 08:00 (point 1)
    { date: '2026-03-04', time: '07:40', isin: 'A', shares: -1, price: 12.2 },      // -> 07:30 (point 3)
    { date: '2026-03-04', time: '07:50', isin: 'X', shares: 2, price: 3 },          // -> 08:00 (point 4), unpriced
  ] }];
  const c = E.prepare(d);
  // points: A [10, 11.5, 11, 12.5, 12.5], B [21.5, 21.5, 21, 21, 18]; V = [20, 44.5, 43, 33.5, 36.5]
  const I = [1, 23.1 / 20, 23.1 / 20 * 43 / 44.5, 23.1 / 20 * 43 / 44.5 * 45.7 / 43, 23.1 / 20 * 43 / 44.5 * 45.7 / 43 * 30.5 / 33.5];
  const b = E.intradayBenchmark(c, 't', 100);
  approxArr(b.value.slice(0, 5), I.map((x) => 100 * x / I[2]), 1e-12, '100 at the close of the range start (point 2)');
  assert.strictEqual(b.value[5], null);
  approx(E.benchmarkRealPl(c, 't', 2, 4, { intraday: true }), -0.3, 1e-12, 'real € on the frame');
  approx(E.benchmarkRealPl(c, 't', 2, 4, { intraday: true, target: 74 }), -0.6, 1e-12, 'scaled by target / V(last day) = 74 / 37');
  approx(E.transactionHistory(c, 't').index[2], 21.6 / 20 * (37 + 6.2) / 43, 1e-12, 'daily TWR of the same trades (V = 20, 43, 37)');
});

test('real data: Depot-Historie replay ends on the Mein Depot holdings and value', () => {
  const b = ctx.benchmarks.find((x) => x.id === 'depot_historie');
  if (!b) return;                                              // no transactions imported
  const H = E.transactionHistory(ctx, b), md = ctx.benchmarks.find((x) => x.id === 'my_depot');
  assert.deepStrictEqual(H.holdings[ctx.n - 1], md.holdings, 'holdings on the last day = my_depot');
  approx(H.value[ctx.n - 1], E.benchmarkValueNow(ctx, 'my_depot'), 1e-9, 'V(last day) = Mein Depot value');
  assert.deepStrictEqual(Object.keys(H.unpriced), ['DE000PK3XT09'], 'only the Broadcom warrant is valued at its trade price');
  const R = E.presetRange(ctx, 'YTD'), s = E.benchmark(ctx, b, R.start, R.end, 1);
  assert.ok(s.value.every((v) => Number.isFinite(v) && v > 0), 'finite, positive index');
  console.log(`  Depot-Historie YTD: TWR ${F.pct(E.stats(s).totalReturn)}, real ${F.eur(E.benchmarkRealPl(ctx, b, R.start, R.end), { sign: true })}`);
});

console.log(`\nengine tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
