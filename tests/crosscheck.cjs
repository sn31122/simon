// Compares PFEngine with the independent Python reference (tests/reference.json).
// Run from the project folder:  python tests/crosscheck.py && node tests/crosscheck.cjs
const path = require('path'), fs = require('fs');
require(path.join(__dirname, '..', 'data', 'portfolio-data.js'));
const E = require(path.join(__dirname, '..', 'js', 'engine.js'));
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference.json'), 'utf8'));
const ctx = E.prepare(globalThis.PORTFOLIO_DATA);
let fails = 0, checks = 0;

function cmp(label, a, b) {
  checks++;
  const ok = (b === null || typeof b === 'string')
    ? a === b
    : typeof a === 'number' && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
  if (!ok) { fails++; console.log('MISMATCH', label, 'engine:', a, 'reference:', b); }
}

const STATS = ['startValue', 'endValue', 'pl', 'totalReturn', 'days', 'cagr', 'volAnn', 'sharpe', 'maxDD',
  'maxDDPeakDate', 'maxDDTroughDate', 'maxDDRecoveryDate', 'currentDD', 'calmar', 'pctPositive', 'var95', 'cvar95'];

/** reference definition -> engine benchmark object (quantities, or a weights card bought at the range start) */
function benchDef(id, d) { return d.kind === 'weights' ? { id, name: id, weights: d.h } : { id, name: id, holdings: d.h }; }

function checkStats(label, st, r) {
  for (const k of STATS) cmp(`${label}.${k}`, st[k], r[k]);
  cmp(`${label}.bestDay`, st.bestDay && st.bestDay.ret, r.bestDay);
  cmp(`${label}.worstDay`, st.worstDay && st.worstDay.ret, r.worstDay);
}

for (const c of ref.cases) {
  const preset = c.name.match(/^all_(\w+)$/);
  const rng = preset ? E.presetRange(ctx, preset[1]) : E.customRange(ctx, '2026-03-01', '2026-07-31');
  cmp(`${c.name} range.start`, rng.start, c.start);
  cmp(`${c.name} range.end`, rng.end, c.end);
  const s = E.portfolio(ctx, { selected: c.isins, start: c.start, end: c.end, startValue: c.startValueInput });
  cmp(`${c.name} scale`, s.scale, c.scale);
  checkStats(`${c.name} stats`, E.stats(s, { rf: 0.02 }), c.stats);
  for (const [id, rb] of Object.entries(c.bench)) {
    const b = E.benchmark(ctx, benchDef(id, rb.defn), c.start, c.end, s.value[0]);
    checkStats(`${c.name} ${id} stats`, E.stats(b, { rf: 0.02 }), rb.stats);
    if (rb.holdings) {                                // single holdings of a weights card (Benchmark-Positionen): start / end value
      const hs = E.benchmarkHoldings(ctx, benchDef(id, rb.defn), c.start, c.end, s.value[0]);
      cmp(`${c.name} ${id} holdings n`, hs.length, Object.keys(rb.holdings).length);
      hs.forEach((h) => { cmp(`${c.name} ${id} ${h.isin} v0`, h.v0, rb.holdings[h.isin][0]); cmp(`${c.name} ${id} ${h.isin} v1`, h.v1, rb.holdings[h.isin][1]); });
    }
  }
  const rows = E.assets(ctx, { selected: c.isins, start: c.start, end: c.end, scale: s.scale });
  cmp(`${c.name} rows`, rows.length, ctx.positions.length);
  cmp(`${c.name} contrib sum`, rows.filter(r => r.selected).reduce((a, r) => a + r.contrib, 0), c.contrib_sum);
  const top = rows.filter(r => r.selected).sort((a, b) => b.contrib - a.contrib).slice(0, 5);
  top.forEach((r, k) => { cmp(`${c.name} top${k + 1} isin`, r.isin, c.top_contrib[k][0]); cmp(`${c.name} top${k + 1} contrib`, r.contrib, c.top_contrib[k][1]); });
}

const all = ctx.positions.map(p => p.isin);
const full = E.portfolio(ctx, { selected: all, start: 0, end: ctx.n - 1, startValue: null });
if (ref.coverage) {                                   // long ranges start where >= 90 % of today's value has real quotes
  const all0 = ctx.positions.map((p) => p.isin);
  cmp('coverage daily_from', ctx.dailyFrom, ref.coverage.daily_from);
  cmp('coverage all 90 %', E.coverageStart(ctx, { selected: all0, share: 0.9 }), ref.coverage.all_90);
  cmp('coverage all 50 %', E.coverageStart(ctx, { selected: all0, share: 0.5 }), ref.coverage.all_50);
  cmp('coverage semis 90 %', E.coverageStart(ctx, { selected: ref.cases.find((c) => c.name === 'semis_custom_100k').isins, share: 0.9 }), ref.coverage.semis_90);
}
cmp('empty selection -> null', E.portfolio(ctx, { selected: [], start: 0, end: ctx.n - 1, startValue: null }), null);

// withShares
if (typeof E.withShares === 'function') {
  const w = ref.whatif, wctx = E.withShares(ctx, w.overrides);
  const ws = E.portfolio(wctx, { selected: all, start: 0, end: ctx.n - 1, startValue: null });
  checkStats('whatif stats', E.stats(ws, { rf: 0.02 }), w.stats);
  const rows = E.assets(wctx, { selected: all, start: 0, end: ctx.n - 1, scale: 1 });
  for (const [isin, cb] of Object.entries(w.cost_basis)) {
    const row = rows.find(x => x.isin === isin);
    cmp(`whatif ${isin} costBasis`, row && row.costBasis, cb);
    cmp(`whatif ${isin} glSinceBuy`, row && row.glSinceBuy, w.gl_since_buy[isin]);
  }
  cmp('whatif leaves base ctx untouched', E.portfolio(ctx, { selected: all, start: 0, end: ctx.n - 1, startValue: null }).value.at(-1), full.value.at(-1));
  const zero = E.withShares(ctx, Object.fromEntries(all.map(i => [i, 0])));
  cmp('all shares 0 -> portfolio null', E.portfolio(zero, { selected: all, start: 0, end: ctx.n - 1, startValue: null }), null);
} else console.log('SKIP withShares (not in engine yet)');

// intraday (1T 30-min grid)
if (ref.intraday && typeof E.intraday === 'function') {
  const R = ref.intraday, all = ctx.positions.map(p => p.isin);
  const s = E.intraday(ctx, { selected: all });
  cmp('intraday available', s ? 'yes' : 'no', 'yes');
  if (s) {
    cmp('intraday dates', s.dates.join(','), R.days.join(','));
    cmp('intraday last', s.last, R.last);
    cmp('intraday base', s.base, R.base_all);
    R.value_all.forEach((v, k) => cmp(`intraday all slot ${k}`, s.value[k], v));
    cmp('intraday after last = null', s.value[R.last + 1] === undefined ? null : s.value[R.last + 1], null);
    const sub = E.intraday(ctx, { selected: R.sub_isins });
    cmp('intraday sub base', sub.base, R.sub_base);
    R.value_sub.forEach((v, k) => cmp(`intraday sub slot ${k}`, sub.value[k], v));
    for (const [id, vals] of Object.entries(R.bench)) {
      const b = E.intradayBenchmark(ctx, benchDef(id, R.bench_defs[id]), s.base);
      vals.forEach((v, k) => cmp(`intraday ${id} slot ${k}`, b.value[k], v));
    }
  }
} else console.log('SKIP intraday (no data/intraday.csv or engine without intraday)');

// sub-daily frames of the chart interval (1W 30 min, 1M 2 h, a custom week on 2 h) + the interval choice
if (ref.grid_cases && typeof E.gridFrame === 'function') {
  const all = ctx.positions.map(p => p.isin);
  for (const g of ref.grid_cases) {
    const f = E.gridFrame(ctx, g.key, g.start, g.end, { trim: true });
    cmp(`${g.name} frame available`, f ? 'yes' : 'no', 'yes');
    if (!f) continue;
    cmp(`${g.name} points`, f.m, g.m);
    cmp(`${g.name} sessions`, f.sessions.map(x => x.date).join(','), g.days.join(','));
    const s = E.intraday(ctx, { selected: all, frame: f });
    cmp(`${g.name} base`, s.base, g.base_all);
    g.value_all.forEach((v, k) => cmp(`${g.name} all point ${k}`, s.value[k], v));
    const sub = E.intraday(ctx, { selected: g.sub_isins, frame: f });
    cmp(`${g.name} sub base`, sub.base, g.sub_base);
    g.value_sub.forEach((v, k) => cmp(`${g.name} sub point ${k}`, sub.value[k], v));
    for (const [id, vals] of Object.entries(g.bench)) {
      const b = E.intradayBenchmark(ctx, benchDef(id, g.bench_defs[id]), s.base, f);
      vals.forEach((v, k) => cmp(`${g.name} ${id} point ${k}`, b.value[k], v));
    }
    for (const [a, b, v] of g.realpl) cmp(`${g.name} depot_qty real pl ${a}..${b}`, E.benchmarkRealPl(ctx, { id: 'depot_qty', holdings: g.realpl_def }, a, b, { frame: f }), v);
    const daily = ref.cases.find(c => c.start === g.start && c.end === g.end && c.isins.length === all.length);
    if (daily) cmp(`${g.name} end = daily reference end`, s.value[s.last], daily.stats.endValue);
  }
  for (const iv of ref.intervals || []) {
    if (iv.preset === 'custom') {
      const r = E.customRange(ctx, iv.frm, iv.to);
      cmp(`interval ${iv.label} range`, r && r.start + '-' + r.end, iv.start + '-' + iv.end);
    } else cmp(`interval ${iv.label} range`, Object.values(E.presetRange(ctx, iv.preset)).join('-'), iv.start + '-' + iv.end);
    cmp(`interval ${iv.label}`, E.chartInterval(ctx, { start: iv.start, end: iv.end }, iv.preset).key, iv.key);
  }
} else console.log('SKIP grids (no sub-daily data or engine without gridFrame)');

console.log(`crosscheck: ${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
