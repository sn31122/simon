/*
 * Yacht-Portfolio - calculation engine + German formatters (see SPEC.md, section "Engine API").
 * Pure functions, no DOM, no dependencies, classic script (no ES modules).
 * Browser: window.PFEngine      Node: const PFEngine = require('./js/engine.js')
 *
 * Conventions: index arguments are indices into data.dates; series are plain arrays;
 * undefined metrics are null (never NaN/Infinity); calendar math uses Date.UTC only.
 */
(function (root) {
  'use strict';

  const ANN = 252;                      // trading days per year (annualization)
  const SQRT_ANN = Math.sqrt(ANN);
  const DAY_MS = 86400000;
  const EPS = 1e-14;                    // a daily standard deviation below this is floating-point noise -> treated as 0
  const DEFAULT_RF = 0.02;
  const PRESETS = ['1T', '1W', '1M', '3M', '6M', 'YTD', '1J', 'MAX'];
  const PRESET_ALIAS = { '1D': '1T', '1Y': '1J', 'ALL': 'MAX' };
  const PRESET_MONTHS = { '1M': 1, '3M': 3, '6M': 6, '1J': 12 };
  const DASH = '–';                // placeholder for null / NaN / undefined

  // ------------------------------------------------------------------ numeric helpers
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
  const fin = (x) => (isNum(x) ? x : null);
  const div = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? fin(a / b) : null);
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const neg = (x) => (x === null ? null : 0 - x);          // 0 - x avoids -0

  function sum(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
  function mean(a) { return a && a.length ? sum(a) / a.length : null; }
  /** sample covariance (n-1), two-pass; null if fewer than 2 points */
  function sampleCov(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 2) return null;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let s = 0;
    for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
    return s / (n - 1);
  }
  /** sample standard deviation (n-1); null if fewer than 2 points */
  function sampleSd(a) { const v = sampleCov(a, a); return v === null ? null : Math.sqrt(Math.max(0, v)); }
  /** quantile with linear interpolation like numpy's default: h = (n-1)p */
  function quantile(a, p) {
    if (!a || !a.length) return null;
    const x = a.slice().sort((u, v) => u - v);
    const h = (x.length - 1) * p, lo = Math.floor(h);
    return lo + 1 >= x.length ? x[lo] : x[lo] + (h - lo) * (x[lo + 1] - x[lo]);
  }
  /** simple returns v[k]/v[k-1]-1 (length m-1); a zero previous value gives 0 instead of Infinity */
  function returnsOf(v) {
    const r = new Array(Math.max(0, v.length - 1));
    for (let k = 1; k < v.length; k++) r[k - 1] = v[k - 1] !== 0 ? v[k] / v[k - 1] - 1 : 0;
    return r;
  }
  function argExt(a, better) {           // first index of the extreme value
    let best = -1;
    for (let i = 0; i < a.length; i++) if (best < 0 || better(a[i], a[best])) best = i;
    return best;
  }

  // ------------------------------------------------------------------ calendar helpers (Date.UTC only)
  const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})/;
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }     // m = 1..12
  function isoParts(iso) {
    const m = typeof iso === 'string' ? ISO_RE.exec(iso) : null;
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo) ? [y, mo, d] : null;
  }
  /** 'YYYY-MM-DD' -> days since 1970-01-01 (UTC), null if invalid */
  function dayNumber(iso) { const p = isoParts(iso); return p ? Date.UTC(p[0], p[1] - 1, p[2]) / DAY_MS : null; }
  function dayToISO(t) { return new Date(t * DAY_MS).toISOString().slice(0, 10); }
  /** date minus k calendar months, day-of-month clamped (2026-03-31 - 1 month = 2026-02-28); day number */
  function minusMonthsDay(iso, k) {
    const p = isoParts(iso);
    if (!p) return null;
    const t = p[0] * 12 + (p[1] - 1) - k, y = Math.floor(t / 12), mo = t - y * 12 + 1;
    return Date.UTC(y, mo - 1, Math.min(p[2], daysInMonth(y, mo))) / DAY_MS;
  }
  function minusMonths(iso, k) { const t = minusMonthsDay(iso, k); return t === null ? null : dayToISO(t); }
  function daysBetween(a, b) { const x = dayNumber(a), y = dayNumber(b); return x === null || y === null ? null : y - x; }
  // Weekday that the German exchanges close on and that can end a month (approximation, no full calendar).
  function isExchangeDay(y, mo, d) {
    const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    if (wd === 0 || wd === 6) return false;
    return !((mo === 12 && (d === 24 || d === 25 || d === 26 || d === 31)) || (mo === 1 && d === 1) || (mo === 5 && d === 1));
  }
  /** true if no further trading day follows iso within its month */
  function isMonthComplete(iso) {
    const p = isoParts(iso);
    if (!p) return false;
    for (let d = p[2] + 1, last = daysInMonth(p[0], p[1]); d <= last; d++) if (isExchangeDay(p[0], p[1], d)) return false;
    return true;
  }

  // ------------------------------------------------------------------ prepare
  function fillPrices(raw, n) {
    const out = new Array(n);
    let first = -1;
    if (Array.isArray(raw)) for (let k = 0; k < n; k++) if (isNum(raw[k]) && raw[k] > 0) { first = k; break; }
    if (first < 0) { out.fill(0); return { px: out, first: n }; }         // never quoted: value 0, "listed after the end"
    let last = raw[first];                                                 // back-fill before the first quote (flat)
    for (let k = 0; k < n; k++) { const v = raw[k]; if (isNum(v) && v > 0) last = v; out[k] = last; }   // forward-fill gaps
    return { px: out, first };
  }

  /** prepare(data) -> ctx with filled price arrays (forward-fill, back-fill before the first quote). */
  function prepare(data) {
    data = data || {};
    const dates = Array.isArray(data.dates) ? data.dates : [];
    const n = dates.length;
    const status = dates.map((_, k) => (Array.isArray(data.status) && data.status[k]) || 'final');
    const positions = Array.isArray(data.positions) ? data.positions : [];
    const benchmarks = Array.isArray(data.benchmarks) ? data.benchmarks : [];
    const groups = (Array.isArray(data.groups) ? data.groups : []).slice();
    positions.forEach((p) => { if (p.group != null && groups.indexOf(p.group) < 0) groups.push(p.group); });
    const prices = data.prices || {};
    const isins = new Set(Object.keys(prices));
    positions.forEach((p) => isins.add(p.isin));
    benchmarks.forEach((b) => Object.keys(b.holdings || {}).forEach((i) => isins.add(i)));
    const px = {}, firstIdx = {};
    isins.forEach((isin) => { const f = fillPrices(prices[isin], n); px[isin] = f.px; firstIdx[isin] = f.first; });
    const ctx = {
      data, meta: data.meta || {}, dates, n, status, positions, benchmarks, groups, px, firstIdx, lastIdx: n - 1,
      day: dates.map(dayNumber),                                           // extra: day numbers for calendar math
    };
    ctx.intraday = prepareIntraday(data.intraday, ctx);
    return ctx;
  }

  // ------------------------------------------------------------------ intraday (1T chart, 30-min grid)
  /**
   * data.intraday = { dates: [iso…] (consecutive trading days, last = last daily date), times: ['07:30'…'23:00'],
   *                   px: { ISIN: [price|null per (date, slot), date-major] }, asof_utc }
   * -> { dates, times, D, S, m, idx (daily index per date), last (last slot index with any quote; later = future),
   *      px: { ISIN: filled array | null after `last` }, has: { ISIN: bool }, ok, asof }
   * Fill rule per session: before the first quote of the day the previous daily close, then forward-fill.
   * An instrument without any intraday quote is flat at its daily price of that date.
   */
  function prepareIntraday(raw, ctx) {
    if (!raw || !Array.isArray(raw.dates) || !Array.isArray(raw.times) || !raw.px) return null;
    const dates = raw.dates, D = dates.length, S = raw.times.length, m = D * S;
    if (D < 2 || S < 2) return null;
    const idx = dates.map((d) => ctx.dates.indexOf(d));
    const ok = idx.every((k, j) => k >= 0 && (j === 0 || k === idx[j - 1] + 1)) && idx[D - 1] === ctx.n - 1 && idx[0] >= 1;
    let last = -1;
    Object.keys(raw.px).forEach((i) => { const a = raw.px[i]; if (Array.isArray(a)) for (let k = 0; k < Math.min(m, a.length); k++) if (isNum(a[k]) && a[k] > 0 && k > last) last = k; });
    const px = {}, has = {};
    Object.keys(ctx.px).forEach((isin) => {
      const r = raw.px[isin], out = new Array(m).fill(null), daily = ctx.px[isin];
      has[isin] = Array.isArray(r) && r.some((v) => isNum(v) && v > 0);
      for (let d = 0; d < D; d++) {
        const di = idx[d];
        if (di < 0) continue;
        let cur = has[isin] ? (di > 0 ? daily[di - 1] : daily[di]) : daily[di];
        for (let s = 0; s < S; s++) {
          const k = d * S + s;
          if (k > last) break;
          const v = has[isin] ? r[k] : null;
          if (isNum(v) && v > 0) cur = v;
          out[k] = cur;
        }
      }
      px[isin] = out;
    });
    return { dates, times: raw.times, D, S, m, idx, last, px, has, ok, asof: raw.asof_utc || null };
  }

  function intradayBaseIdx(ctx) { const I = ctx.intraday; return I && I.ok && I.last >= 0 ? I.idx[I.D - 1] - 1 : -1; }

  /**
   * intraday(ctx, {selected, startValue}) -> 1T series on the 30-min grid | null (no/old intraday data, empty selection)
   * { dates, times, S, m, last, ctxEnd (last slot of the earlier sessions = grey context), base (value at the previous
   *   daily close = the 1T start value), scale, raw, value, pl (value - base), ret (value / base - 1), missing: [selected ISINs without quotes] }
   * value/pl are null after `last` (the rest of today). base equals portfolio(1T).startValue, value[last] its end value.
   */
  function intraday(ctx, opts) {
    opts = opts || {};
    const I = ctx.intraday, bi = intradayBaseIdx(ctx);
    if (bi < 0) return null;
    const sel = selectionSet(ctx, opts.selected);
    const list = ctx.positions.filter((p) => sel.has(p.isin));
    if (!list.length) return null;
    let baseRaw = 0;
    list.forEach((p) => { baseRaw += sharesOf(p) * ctx.px[p.isin][bi]; });
    if (!(baseRaw > 0)) return null;
    const raw = new Array(I.m).fill(null);
    for (let k = 0; k <= I.last; k++) {
      let t = 0;
      for (let j = 0; j < list.length; j++) t += sharesOf(list[j]) * I.px[list[j].isin][k];
      raw[k] = t;
    }
    const sv = typeof opts.startValue === 'string' ? parseDE(opts.startValue) : opts.startValue;
    const scale = isNum(sv) && sv > 0 ? sv / baseRaw : 1;
    const base = baseRaw * scale;
    const value = raw.map((x) => (x === null ? null : x * scale));
    return {
      dates: I.dates, times: I.times, S: I.S, m: I.m, last: I.last, ctxEnd: (I.D - 1) * I.S - 1, asof: I.asof,
      base, scale, raw, value, pl: value.map((x) => (x === null ? null : x - base)),
      ret: value.map((x) => (x === null ? null : x / base - 1)),
      missing: list.filter((p) => !I.has[p.isin]).map((p) => p.isin),
    };
  }

  /**
   * Quantities [[isin, qty]] of a benchmark, bought at daily index `at`:
   *   { holdings: {ISIN: qty} }            fixed quantities (e.g. the real depot "Mein Depot") – `at` is not used;
   *   { weights: {ISIN: % or fraction} }   custom allocation (benchmark cards): normalized by the sum of the valid weights
   *                                         and bought at `at` (q = w / Σw / px[at]), then held – buy and hold, no rebalancing.
   * Only ISINs with prices count; weights must be > 0 and the price at `at` > 0. -> null when a weights benchmark has
   * nothing valid left (a holdings benchmark keeps its old behaviour: a flat series).
   */
  function benchQty(ctx, bench, at) {
    if (bench && bench.weights) {
      const w = Object.keys(bench.weights).map((i) => [i, Number(bench.weights[i])])
        .filter((h) => ctx.px[h[0]] && isNum(h[1]) && h[1] > 0 && ctx.px[h[0]][at] > 0);
      const tot = sum(w.map((h) => h[1]));
      return tot > 0 ? w.map((h) => [h[0], h[1] / tot / ctx.px[h[0]][at]]) : null;
    }
    return Object.keys((bench && bench.holdings) || {}).map((i) => [i, Number(bench.holdings[i])])
      .filter((h) => ctx.px[h[0]] && isNum(h[1]));
  }

  /**
   * intradayBenchmark(ctx, bench|id, baseValue) -> { id, name, value, pl, ret, base, missing } normalized to baseValue at the
   * previous close (a weights benchmark is bought at that close, i.e. at the 1T start, then held)
   */
  function intradayBenchmark(ctx, bench, baseValue) {
    if (typeof bench === 'string') bench = ctx.benchmarks.find((b) => b.id === bench);
    const I = ctx.intraday, bi = intradayBaseIdx(ctx);
    if (!bench || bi < 0) return null;
    const q = benchQty(ctx, bench, bi);
    if (!q) return null;
    const hold = q.filter((h) => I.px[h[0]]);
    let r0 = 0;
    hold.forEach((h) => { r0 += h[1] * ctx.px[h[0]][bi]; });
    if (!(r0 > 0)) return null;
    const base = isNum(baseValue) ? baseValue : r0;
    const value = new Array(I.m).fill(null);
    for (let k = 0; k <= I.last; k++) {
      let t = 0;
      for (let j = 0; j < hold.length; j++) t += hold[j][1] * I.px[hold[j][0]][k];
      value[k] = base * (t / r0);
    }
    return { id: bench.id, name: bench.name, value, pl: value.map((x) => (x === null ? null : x - base)), base,
      ret: value.map((x) => (x === null ? null : x / base - 1)),
      missing: hold.filter((h) => !I.has[h[0]]).map((h) => h[0]) };
  }

  /** intradayAsset(ctx, isin) -> { px (price per slot, null after last), prevClose, has } | null */
  function intradayAsset(ctx, isin) {
    const I = ctx.intraday, bi = intradayBaseIdx(ctx);
    if (bi < 0 || !I.px[isin]) return null;
    return { px: I.px[isin].slice(), prevClose: ctx.px[isin][bi], has: !!I.has[isin], ctxEnd: (I.D - 1) * I.S - 1, last: I.last };
  }

  function benchHoldings(ctx, bench) {
    if (typeof bench === 'string') bench = ctx.benchmarks.find((b) => b.id === bench);
    if (!bench) return null;
    return Object.keys(bench.holdings || {}).map((i) => [i, Number(bench.holdings[i])]).filter((h) => ctx.px[h[0]] && isNum(h[1]));
  }

  /** benchmarkValueNow(ctx, bench|id) -> Σ quantity × latest price (e.g. the real value of "Mein Depot" today) | null */
  function benchmarkValueNow(ctx, bench) {
    const h = benchHoldings(ctx, bench);
    if (!h || ctx.n < 1) return null;
    let t = 0;
    h.forEach((x) => { t += x[1] * ctx.px[x[0]][ctx.n - 1]; });
    return t > 0 ? t : null;
  }

  /**
   * benchmarkRealPl(ctx, bench|id, a, b, {target, intraday}) -> real € change of the benchmark's own holdings between
   * a and b (daily indices into ctx, or intraday slots with intraday: true), scaled by target / benchmarkValueNow
   * (target omitted = the holdings as they are). Independent of the chart's normalization / Startwert.
   */
  function benchmarkRealPl(ctx, bench, a, b, opts) {
    opts = opts || {};
    const h = benchHoldings(ctx, bench), now = benchmarkValueNow(ctx, bench);
    if (!h || now === null) return null;
    const i = Math.min(a, b), j = Math.max(a, b);
    let src;
    if (opts.intraday) {
      const I = ctx.intraday;
      if (!I || !I.ok || i < 0 || j > I.last) return null;
      src = (isin) => I.px[isin];
    } else {
      if (!isNum(i) || i < 0 || j > ctx.n - 1) return null;
      src = (isin) => ctx.px[isin];
    }
    let va = 0, vb = 0;
    h.forEach((x) => { va += x[1] * src(x[0])[i]; vb += x[1] * src(x[0])[j]; });
    const target = isNum(opts.target) && opts.target > 0 ? opts.target : now;
    return fin((vb - va) * target / now);
  }

  /** intradayWindow(values, a, b) -> { pl, ret } between two slots (order-independent) | null */
  function intradayWindow(values, a, b) {
    if (!Array.isArray(values)) return null;
    const i = Math.min(a, b), j = Math.max(a, b), va = fin(values[i]), vb = fin(values[j]);
    if (va === null || vb === null) return null;
    const q = div(vb, va);
    return { pl: vb - va, ret: q === null ? null : q - 1 };
  }

  /**
   * equalValueWindow(portfolioValues, benchValues, a, b) -> { base, ret, pl } | null   ("Gleicher Wert" in the measure box)
   * The benchmark as if it had the portfolio's size at the start of the span: base = portfolio value at min(a, b),
   * ret = benchmark return over the span, pl = base × ret. Works for daily series and intraday slots; order-independent.
   */
  function equalValueWindow(pValues, bValues, a, b) {
    if (!Array.isArray(pValues)) return null;
    const base = fin(pValues[Math.min(a, b)]), w = intradayWindow(bValues, a, b);
    if (base === null || !w || w.ret === null) return null;
    return { base, ret: w.ret, pl: fin(base * w.ret) };
  }

  // ------------------------------------------------------------------ ranges
  /** presetRange(ctx, '1T'|'1W'|'1M'|'3M'|'6M'|'YTD'|'1J'|'MAX') -> {start, end}; unknown preset -> MAX */
  function presetRange(ctx, preset) {
    const end = ctx.n - 1;
    let p = String(preset == null ? 'MAX' : preset).toUpperCase();
    p = PRESET_ALIAS[p] || p;
    if (end < 1 || p === 'MAX') return { start: 0, end };
    if (p === '1T') return { start: end - 1, end };
    if (p === 'YTD') {
      const y = String(ctx.dates[end]).slice(0, 4);
      let s = 0;
      while (s < end && String(ctx.dates[s]).slice(0, 4) !== y) s++;
      return { start: s, end };
    }
    let lim;
    if (p === '1W') lim = ctx.day[end] - 7;
    else if (PRESET_MONTHS[p]) lim = minusMonthsDay(ctx.dates[end], PRESET_MONTHS[p]);
    else return { start: 0, end };
    let s = 0;                                                             // none found -> 0
    for (let k = end; k >= 0; k--) if (ctx.day[k] !== null && ctx.day[k] <= lim) { s = k; break; }
    return { start: s, end };
  }

  /** customRange(ctx, fromISO, toISO) -> {start, end} | null (null if invalid or end - start < 1) */
  function customRange(ctx, fromISO, toISO) {
    const a = dayNumber(fromISO), b = dayNumber(toISO);
    if (a === null || b === null) return null;
    let start = -1, end = -1;
    for (let k = 0; k < ctx.n; k++) if (ctx.day[k] >= a) { start = k; break; }
    for (let k = ctx.n - 1; k >= 0; k--) if (ctx.day[k] !== null && ctx.day[k] <= b) { end = k; break; }
    if (start < 0 || end < 0 || end - start < 1) return null;
    return { start, end };
  }

  function normRange(ctx, start, end) {
    const last = ctx.n - 1;
    let s = isNum(start) ? Math.round(start) : 0, e = isNum(end) ? Math.round(end) : last;
    s = clamp(s, 0, last); e = clamp(e, 0, last);
    return s <= e ? [s, e] : [e, s];
  }

  // ------------------------------------------------------------------ series
  function selectionSet(ctx, selected) {
    if (selected == null) return new Set(ctx.positions.map((p) => p.isin));   // extra: no selection given = all
    if (Array.isArray(selected)) return new Set(selected);
    if (typeof selected.has === 'function') return selected;                   // Set (also from another realm/frame)
    if (typeof selected === 'string') return new Set([selected]);
    if (typeof selected === 'object') return new Set(Object.keys(selected).filter((k) => selected[k]));
    return new Set();
  }
  function sharesOf(p) { const q = Number(p.shares); return isNum(q) ? q : 0; }

  function makeSeries(ctx, s, e, raw, scale, value, base) {
    const idx = [], dates = [];
    for (let k = s; k <= e; k++) { idx.push(k); dates.push(ctx.dates[k]); }
    return { start: s, end: e, dates, idx, raw, scale, value, pl: value.map((v) => v - base), ret: returnsOf(value), startValue: value[0] };
  }

  /** portfolio(ctx, {selected, start, end, startValue}) -> series | null (null if nothing selected) */
  function portfolio(ctx, opts) {
    opts = opts || {};
    const sel = selectionSet(ctx, opts.selected);
    const list = ctx.positions.filter((p) => sel.has(p.isin));
    if (!list.length || ctx.n < 1) return null;
    const [s, e] = normRange(ctx, opts.start, opts.end);
    const m = e - s + 1, raw = new Array(m);
    for (let k = 0; k < m; k++) {
      let t = 0;
      for (let j = 0; j < list.length; j++) t += sharesOf(list[j]) * ctx.px[list[j].isin][s + k];
      raw[k] = t;
    }
    if (!(raw[0] > 0)) return null;                                            // start value 0 (e.g. all shares 0) = empty
    const sv = typeof opts.startValue === 'string' ? parseDE(opts.startValue) : opts.startValue;
    const scale = isNum(sv) && sv > 0 ? sv / raw[0] : 1;
    const value = raw.map((x) => x * scale);
    return makeSeries(ctx, s, e, raw, scale, value, value[0]);
  }

  /**
   * benchmark(ctx, bench|id, start, end, baseValue) -> series (+ id, name); value = baseValue * raw/raw[0]
   * bench = { holdings: {ISIN: qty} } (fixed quantities) or { weights: {ISIN: % or fraction} } (bought at `start`, then
   * held); null for a weights benchmark without any valid ISIN.
   */
  function benchmark(ctx, bench, start, end, baseValue) {
    if (typeof bench === 'string') bench = ctx.benchmarks.find((b) => b.id === bench);
    if (!bench || ctx.n < 1) return null;
    const [s, e] = normRange(ctx, start, end);
    const hold = benchQty(ctx, bench, s);
    if (!hold) return null;
    const m = e - s + 1, raw = new Array(m);
    for (let k = 0; k < m; k++) {
      let t = 0;
      for (let j = 0; j < hold.length; j++) t += hold[j][1] * ctx.px[hold[j][0]][s + k];
      raw[k] = t;
    }
    const base = isNum(baseValue) ? baseValue : raw[0];
    const ok = raw[0] > 0;
    const value = raw.map((x) => (ok ? base * (x / raw[0]) : base));
    const series = makeSeries(ctx, s, e, raw, ok ? base / raw[0] : 1, value, base);
    series.id = bench.id;
    series.name = bench.name;
    return series;
  }

  // ------------------------------------------------------------------ metrics
  function cleanValues(values) {
    const src = Array.isArray(values) ? values : (values && Array.isArray(values.value) ? values.value : []);
    const out = new Array(src.length);
    let last = null;
    for (let k = 0; k < src.length; k++) if (isNum(src[k])) { last = src[k]; break; }
    for (let k = 0; k < src.length; k++) { if (isNum(src[k])) last = src[k]; out[k] = last === null ? 0 : last; }
    return out;
  }

  /** drawdown(values) -> { dd, maxDD, peak, trough, recovery, current } (indices relative to values) */
  function drawdown(values) {
    const v = cleanValues(values), n = v.length, dd = new Array(n);
    let runMax = -Infinity, runIdx = 0, maxDD = 0;
    let trough = n ? 0 : null, peak = n ? 0 : null;
    for (let k = 0; k < n; k++) {
      if (v[k] > runMax) { runMax = v[k]; runIdx = k; }                   // strict: first index of the running max
      dd[k] = runMax > 0 ? v[k] / runMax - 1 : 0;
      if (dd[k] < maxDD) { maxDD = dd[k]; trough = k; peak = runIdx; }     // strict: first argmin
    }
    let recovery = null;
    if (maxDD < 0) for (let k = trough + 1; k < n; k++) if (v[k] >= v[peak]) { recovery = k; break; }
    return { dd, maxDD, peak, trough, recovery, current: n ? dd[n - 1] : null };
  }

  function rfDaily(opts) {
    const rf = opts && isNum(opts.rf) ? opts.rf : DEFAULT_RF;
    return { rf, rfd: Math.pow(1 + rf, 1 / ANN) - 1 };
  }
  function retsOf(series) {
    const v = series.value || [];
    return Array.isArray(series.ret) && series.ret.length === Math.max(0, v.length - 1) ? series.ret : returnsOf(v);
  }

  /** stats(series, {rf}) -> performance/risk metrics of one series; null for a missing series */
  function stats(series, opts) {
    if (!series || !Array.isArray(series.value) || !series.value.length) return null;
    const { rf, rfd } = rfDaily(opts);
    const v = series.value, ds = Array.isArray(series.dates) ? series.dates : [];
    const r = retsOf(series), n = r.length;
    const startValue = fin(v[0]), endValue = fin(v[v.length - 1]);
    const q = div(endValue, startValue);
    const totalReturn = q === null ? null : q - 1;
    const days = ds.length ? daysBetween(ds[0], ds[ds.length - 1]) : null;
    const cagr = totalReturn !== null && days > 0 && 1 + totalReturn >= 0 ? fin(Math.pow(1 + totalReturn, 365 / days) - 1) : null;

    const sd = sampleSd(r);
    const ex = r.map((x) => x - rfd);
    const mex = mean(ex);
    const volAnn = sd === null ? null : fin(sd * SQRT_ANN);
    const sharpe = sd !== null && sd > EPS ? fin(mex / sd * SQRT_ANN) : null;
    let down = null;
    if (n) { let s2 = 0; for (let i = 0; i < n; i++) { const m = Math.min(0, ex[i]); s2 += m * m; } down = Math.sqrt(s2 / n); }
    const sortino = down !== null && down > EPS ? fin(mex / down * SQRT_ANN) : null;

    const d = drawdown(v);
    const dateAt = (k) => (k === null || k === undefined || ds[k] === undefined ? null : ds[k]);
    const iBest = argExt(r, (a, b) => a > b), iWorst = argExt(r, (a, b) => a < b);
    const q05 = quantile(r, 0.05);
    const tail = q05 === null ? [] : r.filter((x) => x <= q05);
    const var95 = neg(fin(q05)), cvar95 = neg(fin(mean(tail)));
    let pos = 0;
    for (let i = 0; i < n; i++) if (r[i] > 0) pos++;

    return {
      startValue, endValue, pl: startValue === null || endValue === null ? null : fin(endValue - startValue),
      totalReturn: fin(totalReturn), days, cagr, cagrReliable: days !== null && days >= 90,
      volAnn, sharpe, sortino,
      maxDD: d.maxDD, maxDDPeakDate: dateAt(d.peak), maxDDTroughDate: dateAt(d.trough), maxDDRecoveryDate: dateAt(d.recovery),
      currentDD: fin(d.current),
      calmar: d.maxDD < 0 && cagr !== null ? fin(cagr / Math.abs(d.maxDD)) : null,
      bestDay: iBest < 0 ? { ret: null, date: null } : { ret: fin(r[iBest]), date: dateAt(iBest + 1) },
      worstDay: iWorst < 0 ? { ret: null, date: null } : { ret: fin(r[iWorst]), date: dateAt(iWorst + 1) },
      pctPositive: n ? pos / n : null,
      var95, cvar95,
      var95EUR: var95 === null || endValue === null ? null : fin(var95 * endValue),
      cvar95EUR: cvar95 === null || endValue === null ? null : fin(cvar95 * endValue),
      n, rf,                                                               // extras: number of daily returns, rf used
    };
  }

  /** relative(pSeries, bSeries, {rf}) -> portfolio vs benchmark metrics over the common index range */
  function relative(pSeries, bSeries, opts) {
    const out = { beta: null, alpha: null, corr: null, r2: null, trackingError: null, infoRatio: null,
      excessReturn: null, upCapture: null, downCapture: null, n: 0 };
    if (!pSeries || !bSeries || !Array.isArray(pSeries.value) || !Array.isArray(bSeries.value)) return out;
    const { rfd } = rfDaily(opts);
    const P = pSeries.value, B = bSeries.value, RP = retsOf(pSeries), RB = retsOf(bSeries);
    let op = 0, ob = 0, len;                                               // align on the common index range
    if (isNum(pSeries.start) && isNum(bSeries.start)) {
      const s = Math.max(pSeries.start, bSeries.start);
      const e = Math.min(pSeries.start + P.length - 1, bSeries.start + B.length - 1);
      op = s - pSeries.start; ob = s - bSeries.start; len = e - s + 1;
    } else len = Math.min(P.length, B.length);
    if (!(len >= 1)) return out;
    const rp = RP.slice(op, op + len - 1), rb = RB.slice(ob, ob + len - 1), n = rp.length;
    out.n = n;
    const trP = div(P[op + len - 1], P[op]), trB = div(B[ob + len - 1], B[ob]);
    out.excessReturn = trP === null || trB === null ? null : fin((trP - 1) - (trB - 1));
    if (n >= 2) {
      const cov = sampleCov(rp, rb), varB = sampleCov(rb, rb), sdP = sampleSd(rp), sdB = sampleSd(rb);
      if (sdB > EPS) {
        out.beta = fin(cov / varB);
        const mp = mean(rp.map((x) => x - rfd)), mb = mean(rb.map((x) => x - rfd));
        out.alpha = out.beta === null ? null : fin((mp - out.beta * mb) * ANN);
      }
      if (sdP > EPS && sdB > EPS) {
        const c = fin(cov / (sdP * sdB));
        out.corr = c === null ? null : clamp(c, -1, 1);
        out.r2 = out.corr === null ? null : out.corr * out.corr;
      }
      const diff = rp.map((x, i) => x - rb[i]);
      const sdD = sampleSd(diff);
      out.trackingError = sdD > EPS ? fin(sdD * SQRT_ANN) : 0;
      out.infoRatio = out.trackingError > 0 ? fin(mean(diff) * ANN / out.trackingError) : null;
    }
    const upP = [], upB = [], dnP = [], dnB = [];
    for (let i = 0; i < n; i++) {
      if (rb[i] > 0) { upP.push(rp[i]); upB.push(rb[i]); } else if (rb[i] < 0) { dnP.push(rp[i]); dnB.push(rb[i]); }
    }
    out.upCapture = upB.length ? div(mean(upP), mean(upB)) : null;
    out.downCapture = dnB.length ? div(mean(dnP), mean(dnB)) : null;
    return out;
  }

  /**
   * monthly(ctx, values) -> [{ month: 'YYYY-MM', ret, partial }]
   * values: full-length array (index 0..n-1); extra: a series object ({value, idx|start}) works too.
   * First month anchored at its first value (partial). Last month partial if it ends on the last data date and
   * that date is intraday or further trading days of the month are still to come.
   */
  function monthly(ctx, values) {
    let vals, idxOf;
    if (Array.isArray(values)) { vals = values.slice(0, ctx.n); idxOf = (k) => k; }
    else if (values && Array.isArray(values.value)) {
      vals = values.value;
      const st = isNum(values.start) ? values.start : 0;
      idxOf = Array.isArray(values.idx) ? (k) => values.idx[k] : (k) => st + k;
    } else return null;                                                        // no series (e.g. empty selection)
    const m = vals.length;
    if (!m) return [];
    const dataMonthEnd = {};                                               // last data index per month
    for (let k = 0; k < ctx.n; k++) dataMonthEnd[String(ctx.dates[k]).slice(0, 7)] = k;
    const out = [];
    let anchor = vals[0], cur = null, lastVal = null, lastIdx = -1;
    const close = () => {
      out.push({ month: cur, ret: (() => { const q = div(lastVal, anchor); return q === null ? null : q - 1; })(), partial: false, endIdx: lastIdx });
      anchor = lastVal;
    };
    for (let k = 0; k < m; k++) {
      const i = idxOf(k), key = String(ctx.dates[i]).slice(0, 7);
      if (cur !== null && key !== cur) close();
      cur = key; lastVal = vals[k]; lastIdx = i;
    }
    close();
    out[0].partial = true;
    const last = out[out.length - 1], lastData = ctx.n - 1;
    if (last.endIdx < dataMonthEnd[last.month]) last.partial = true;        // series stops before the month's last data day
    else if (last.endIdx === lastData && (ctx.status[lastData] === 'intraday' || !isMonthComplete(ctx.dates[lastData]))) last.partial = true;
    return out;
  }

  /** assets(ctx, {selected, start, end, scale}) -> one row per position (selected or not) */
  function assets(ctx, opts) {
    opts = opts || {};
    const sel = selectionSet(ctx, opts.selected);
    const [s, e] = normRange(ctx, opts.start, opts.end);
    const scale = isNum(opts.scale) && opts.scale > 0 ? opts.scale : 1;
    const lastData = ctx.n - 1;
    const rows = ctx.positions.map((p) => {
      const px = ctx.px[p.isin] || [], shares = sharesOf(p);
      const spark = px.slice(s, e + 1);
      const p0 = fin(px[s]), p1 = fin(px[e]);
      const v0 = p0 === null ? null : shares * p0 * scale, v1 = p1 === null ? null : shares * p1 * scale;
      const q = div(p1, p0);
      const r = returnsOf(spark), sd = sampleSd(r);
      const fi = ctx.firstIdx[p.isin];
      const cost = isNum(Number(p.cost_basis)) && p.cost_basis !== null && p.cost_basis !== '' ? Number(p.cost_basis) : null;
      const pNow = fin(px[lastData]);
      const gl = cost === null || pNow === null ? null : fin(shares * pNow - cost);
      return {
        isin: p.isin, name: p.name, short: p.short, group: p.group, selected: sel.has(p.isin),
        shares, sharesScaled: shares * scale, p0, p1, v0, v1,
        ret: q === null ? null : q - 1, pl: v0 === null || v1 === null ? null : v1 - v0,
        contrib: null, w0: null, w1: null,
        vol: sd === null ? null : fin(sd * SQRT_ANN), maxDD: drawdown(spark).maxDD,
        listedAfterStart: isNum(fi) ? fi > s : false,
        firstDate: isNum(fi) && fi < ctx.n ? ctx.dates[fi] : (p.first_date || null),
        costBasis: cost, glSinceBuy: gl, glSinceBuyPct: gl === null ? null : div(gl, cost),
        spark,
      };
    });
    let V0 = 0, V1 = 0;
    rows.forEach((r) => { if (r.selected) { V0 += r.v0 || 0; V1 += r.v1 || 0; } });
    rows.forEach((r) => {
      if (!r.selected) return;
      r.contrib = div(r.pl, V0);
      r.w0 = div(r.v0, V0);
      r.w1 = div(r.v1, V1);
    });
    return rows;
  }

  // T = totals of the whole selection; contrib/w1 are null when the selection is worth 0 (empty or all shares 0)
  function summarize(rows, T) {
    const sel = rows.filter((r) => r.selected);
    let v0 = 0, v1 = 0, pl = 0, contrib = 0;
    sel.forEach((r) => { v0 += r.v0 || 0; v1 += r.v1 || 0; pl += r.pl || 0; contrib += r.contrib || 0; });
    const q = sel.length ? div(v1, v0) : null;
    return { n: rows.length, nSelected: sel.length, v0, v1, pl, ret: q === null ? null : q - 1,
      contrib: T.V0 > 0 ? contrib : null, w1: T.V1 > 0 ? v1 / T.V1 : null };
  }
  function selectionTotals(rows) {
    let V0 = 0, V1 = 0;
    rows.forEach((r) => { if (r.selected) { V0 += r.v0 || 0; V1 += r.v1 || 0; } });
    return { V0, V1 };
  }

  /** groupSummary(ctx, assetsRows) -> [{ group, n, nSelected, v0, v1, pl, ret, contrib, w1 }] in ctx.groups order */
  function groupSummary(ctx, rows) {
    rows = Array.isArray(rows) ? rows : [];
    const order = ctx.groups.slice();
    rows.forEach((r) => { if (r.group != null && order.indexOf(r.group) < 0) order.push(r.group); });
    const T = selectionTotals(rows);
    return order.map((g) => {
      const rs = rows.filter((r) => r.group === g);
      return Object.assign({ group: g }, summarize(rs, T), { isins: rs.map((r) => r.isin) });   // isins: extra
    });
  }

  /** extra: totals over the selected rows of assets() (for the table's totals row) */
  function assetsTotal(ctx, rows) {
    rows = Array.isArray(rows) ? rows : [];
    return summarize(rows, selectionTotals(rows));
  }

  // ------------------------------------------------------------------ what-if, correlation, risk contribution
  function numOrNull(x) { if (x === null || x === undefined || x === '') return null; const v = Number(x); return isNum(v) ? v : null; }
  function overrideMap(overrides) {
    const out = new Map();
    if (!overrides || typeof overrides !== 'object') return out;
    const put = (isin, v) => { const x = typeof v === 'string' ? parseDE(v) : v; if (isNum(x) && x >= 0) out.set(isin, x === 0 ? 0 : x); };
    if (typeof overrides.forEach === 'function' && typeof overrides.get === 'function') overrides.forEach((v, k) => put(k, v));
    else Object.keys(overrides).forEach((k) => put(k, overrides[k]));
    return out;
  }

  /**
   * withShares(ctx, {ISIN: shares >= 0}) -> what-if ctx. Shares px/dates/benchmarks with ctx; positions are clones with
   * the new shares, cost_basis (and gv_ref) scaled proportionally (average cost unchanged, 0 shares -> 0).
   * whatIf = {ISIN: {from, to}} for changed positions only, base = the original (unmodified) ctx.
   * Chaining is relative to the original: withShares(withShares(ctx, a), b) == withShares(ctx, {...a, ...b}).
   * Invalid values (negative, NaN) and ISINs that are not positions are ignored.
   */
  function withShares(ctx, overrides) {
    const root = ctx.base || ctx;
    const ov = overrideMap(overrides);
    const cur = new Map(ctx.positions.map((p) => [p.isin, sharesOf(p)]));
    const whatIf = {};
    const positions = root.positions.map((p0) => {
      const from = sharesOf(p0);
      let to = cur.has(p0.isin) ? cur.get(p0.isin) : from;
      if (ov.has(p0.isin)) to = ov.get(p0.isin);
      const q = Object.assign({}, p0, { shares: to });
      if (to !== from) {
        whatIf[p0.isin] = { from, to };
        const f = from > 0 ? to / from : null;
        const cost = numOrNull(p0.cost_basis), gv = numOrNull(p0.gv_ref);
        const pNow = root.px[p0.isin] ? root.px[p0.isin][root.n - 1] : 0;
        // no original shares -> no average cost: a what-if purchase is valued at the latest price
        if (cost !== null) q.cost_basis = to === 0 ? 0 : (f !== null ? cost * f : to * (pNow || 0));
        if (gv !== null) q.gv_ref = f !== null ? gv * f : 0;
      }
      return q;
    });
    return Object.assign({}, ctx, { positions, whatIf, base: root });
  }

  function isinList(ctx, isins) {
    let list;
    if (isins == null) list = ctx.positions.map((p) => p.isin);
    else if (Array.isArray(isins)) list = isins;
    else if (typeof isins === 'string') list = [isins];
    else if (typeof isins.forEach === 'function') { list = []; isins.forEach((x) => list.push(x)); }
    else list = [];
    const seen = new Set();
    return list.filter((i) => { if (!ctx.px[i] || seen.has(i)) return false; seen.add(i); return true; });
  }
  // sample Pearson correlation of x[from..], y[from..]; null for zero variance
  function pearsonFrom(x, y, from) {
    const len = x.length - from;
    if (len < 2) return null;
    let mx = 0, my = 0;
    for (let i = from; i < x.length; i++) { mx += x[i]; my += y[i]; }
    mx /= len; my /= len;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = from; i < x.length; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    const sdx = Math.sqrt(sxx / (len - 1)), sdy = Math.sqrt(syy / (len - 1));
    if (!(sdx > EPS) || !(sdy > EPS)) return null;
    const c = fin(sxy / (len - 1) / (sdx * sdy));
    return c === null ? null : clamp(c, -1, 1);
  }

  /**
   * correlationMatrix(ctx, {isins, start, end}) -> { isins, m, n } : sample Pearson correlation of daily returns over
   * (start, end], pairwise on real quotes only (return k counts for i only if k-1 >= firstIdx_i). n[a][b] = overlapping
   * returns; m[a][a] = 1; m[a][b] = null if n < 3 or zero variance. isins: given order, duplicates/unknown dropped
   * (default: all positions). Extras: start, end, avg (mean off-diagonal correlation), pairs (count used in avg).
   */
  function correlationMatrix(ctx, opts) {
    opts = opts || {};
    const isins = isinList(ctx, opts.isins), k = isins.length;
    const [s, e] = ctx.n ? normRange(ctx, opts.start, opts.end) : [0, -1];
    const R = isins.map((i) => returnsOf(ctx.px[i].slice(s, e + 1)));        // R[a][j] = return at index s+1+j
    const j0 = isins.map((i) => { const f = ctx.firstIdx[i]; return Math.max(0, (isNum(f) ? f : 0) - s); });
    const m = [], n = [];
    for (let a = 0; a < k; a++) { m.push(new Array(k).fill(null)); n.push(new Array(k).fill(0)); }
    let sumC = 0, pairs = 0;
    for (let a = 0; a < k; a++) {
      m[a][a] = 1;
      n[a][a] = Math.max(0, R[a].length - j0[a]);
      for (let b = a + 1; b < k; b++) {
        const from = Math.max(j0[a], j0[b]), cnt = Math.max(0, R[a].length - from);
        const c = cnt >= 3 ? pearsonFrom(R[a], R[b], from) : null;
        n[a][b] = n[b][a] = cnt;
        m[a][b] = m[b][a] = c;
        if (c !== null) { sumC += c; pairs++; }
      }
    }
    return { isins, m, n, start: s, end: e, avg: pairs ? sumC / pairs : null, pairs };
  }

  /**
   * riskContribution(ctx, {selected, start, end}) -> { volAnn, diversificationRatio, rows } | null
   * w = current weights at end; Σ = sample covariance of the filled daily returns over (start, end];
   * volAnn = sqrt(wᵀΣw·252); mctr = (Σw)_i/sqrt(wᵀΣw)·√252; ctr = w·mctr; pctr = ctr/volAnn (Σ = 1);
   * vol_i = sqrt(Σ_ii·252); diversificationRatio = Σ w_i·vol_i / volAnn. Rows: selected positions in ctx order.
   * null if nothing selected, fewer than 2 returns, V(end) = 0 or volAnn = 0.
   * Extras: n (returns), value (V(end)), start, end, top3Pctr (sum of the 3 largest pctr); rows also carry short/name/group.
   */
  function riskContribution(ctx, opts) {
    opts = opts || {};
    const sel = selectionSet(ctx, opts.selected);
    const list = ctx.positions.filter((p) => sel.has(p.isin));
    if (!list.length || ctx.n < 2) return null;
    const [s, e] = normRange(ctx, opts.start, opts.end);
    const T = e - s;
    if (T < 2) return null;
    const vEnd = list.map((p) => sharesOf(p) * ctx.px[p.isin][e]);
    const V = sum(vEnd);
    if (!(V > 0)) return null;
    const k = list.length, w = vEnd.map((v) => v / V);
    const R = list.map((p) => returnsOf(ctx.px[p.isin].slice(s, e + 1)));
    const mu = R.map(mean), C = [];
    for (let a = 0; a < k; a++) C.push(new Array(k));
    for (let a = 0; a < k; a++) for (let b = a; b < k; b++) {
      let t = 0;
      for (let j = 0; j < T; j++) t += (R[a][j] - mu[a]) * (R[b][j] - mu[b]);
      C[a][b] = C[b][a] = t / (T - 1);
    }
    const Sw = C.map((row) => { let t = 0; for (let b = 0; b < k; b++) t += row[b] * w[b]; return t; });
    let q = 0;
    for (let a = 0; a < k; a++) q += w[a] * Sw[a];
    if (!(q > EPS * EPS)) return null;
    const sdP = Math.sqrt(q), volAnn = sdP * SQRT_ANN;
    let wv = 0;
    const rows = list.map((p, a) => {
      const vol = Math.sqrt(Math.max(0, C[a][a]) * ANN), mctr = Sw[a] / sdP * SQRT_ANN, ctr = w[a] * mctr;
      wv += w[a] * vol;
      return { isin: p.isin, short: p.short, name: p.name, group: p.group, weight: w[a], vol, mctr, ctr, pctr: ctr / volAnn };
    });
    const top = rows.map((r) => r.pctr).sort((x, y) => y - x).slice(0, 3);
    return { volAnn, diversificationRatio: wv / volAnn, rows, n: T, value: V, start: s, end: e, top3Pctr: sum(top) };
  }

  // ------------------------------------------------------------------ formatters (de-DE)
  const nfCache = new Map(), dfCache = new Map(), dateMemo = new Map();
  function nf(key, opts) { let f = nfCache.get(key); if (!f) { f = new Intl.NumberFormat('de-DE', opts); nfCache.set(key, f); } return f; }
  function dtf(key, opts) { let f = dfCache.get(key); if (!f) { f = new Intl.DateTimeFormat('de-DE', opts); dfCache.set(key, f); } return f; }

  // accepts (opts) | (dec) | (dec, sign)
  function fmtOpts(a, b, defSign, defDec) {
    let dec = defDec, sign = defSign;
    if (typeof a === 'number') { dec = a; if (typeof b === 'boolean') sign = b; }
    else if (a && typeof a === 'object') { if (a.dec != null) dec = a.dec; if (a.sign != null) sign = !!a.sign; }
    dec = clamp(Math.round(isNum(Number(dec)) ? Number(dec) : defDec), 0, 10);
    return { dec, sign };
  }
  // values that display as zero lose their sign ("0,00 €", never "-0,00 €")
  function tidy(x, dec) { return Math.abs(x) < 0.5 * Math.pow(10, -dec) ? 0 : x; }

  function numberFmt(kind, x, o, extraDec) {
    if (!isNum(x)) return DASH;
    const d = o.dec, sd = o.sign ? 'exceptZero' : 'auto';
    const base = { minimumFractionDigits: d, maximumFractionDigits: d, signDisplay: sd };
    if (kind === 'eur') Object.assign(base, { style: 'currency', currency: 'EUR' });
    if (kind === 'pct') base.style = 'percent';
    return nf(kind + '|' + d + '|' + sd, base).format(tidy(x, d + (extraDec || 0)));
  }
  /** eur(x, {sign=false, dec=2}) -> "260.800,05 €" / "+3.982,60 €" */
  function eur(x, o, b) { return numberFmt('eur', x, fmtOpts(o, b, false, 2)); }
  /** num(x, dec=2, sign=false) -> "1.234,50" */
  function num(x, dec, sign) { return numberFmt('num', x, fmtOpts(dec, sign, false, 2)); }
  /** pct(x, {sign=true, dec=2}); x is a fraction: 0.1798 -> "+17,98 %" */
  function pct(x, o, b) { return numberFmt('pct', x, fmtOpts(o, b, true, 2), 2); }
  /** ratio(x) -> 2 decimals, "-0,50" */
  function ratio(x, o, b) { return numberFmt('num', x, fmtOpts(o, b, false, 2)); }

  const DATE_STYLES = {
    long: { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' },          // "21. Apr. 2026"
    short: { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' },       // "21.04.2026"
    month: { month: 'short', year: 'numeric', timeZone: 'UTC' },                         // "Apr." (format form, year stripped)
    monthYear: { month: 'short', year: 'numeric', timeZone: 'UTC' },                     // "Apr. 2026"
    dayMonthShort: { day: '2-digit', month: '2-digit', timeZone: 'UTC' },                // "21.04."
  };
  /** date(iso, 'long'|'short'|'month'|'monthYear'|'dayMonthShort'), default 'short' */
  function date(iso, style) {
    style = Object.prototype.hasOwnProperty.call(DATE_STYLES, style) ? style : 'short';
    let t;
    if (iso instanceof Date) t = iso.getTime();
    else { const dn = dayNumber(iso); t = dn === null ? NaN : dn * DAY_MS; }
    if (!isNum(t)) return DASH;
    const key = style + '|' + t;
    let s = dateMemo.get(key);
    if (s === undefined) {
      s = dtf(style, DATE_STYLES[style]).format(new Date(t));
      if (style === 'month') s = s.replace(/\s*\d{4}$/, '');
      if (dateMemo.size > 5000) dateMemo.clear();
      dateMemo.set(key, s);
    }
    return s;
  }

  // 'YYYY-MM-DDTHH:MM[:SS[.fff]][Z|+HH:MM]' -> epoch ms (no zone = UTC)
  function parseUtcMs(s) {
    if (s instanceof Date) return isNum(s.getTime()) ? s.getTime() : null;
    if (typeof s !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(s.trim());
    if (!m || !isoParts(m[1] + '-' + m[2] + '-' + m[3]) || +m[4] > 23 || +m[5] > 59) return null;
    let ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    if (m[7] && m[7].toUpperCase() !== 'Z') {
      const z = /^([+-])(\d{2}):?(\d{2})$/.exec(m[7]);
      ms -= (z[1] === '-' ? -1 : 1) * (+z[2] * 60 + +z[3]) * 60000;
    }
    return ms;
  }
  function lastSundayUTC(y, mo) { const d = daysInMonth(y, mo); return d - new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); }
  /** asofBerlin('2026-09-25T09:20Z') -> "11:20" (Europe/Berlin) */
  function asofBerlin(isoUtc) {
    const t = parseUtcMs(isoUtc);
    if (t === null) return DASH;
    try {
      return dtf('hm', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Berlin' }).format(new Date(t));
    } catch (err) {                                                        // no tz data: CET/CEST rule (EU, since 1996)
      const y = new Date(t).getUTCFullYear();
      const dst = t >= Date.UTC(y, 2, lastSundayUTC(y, 3), 1) && t < Date.UTC(y, 9, lastSundayUTC(y, 10), 1);
      const b = new Date(t + (dst ? 2 : 1) * 3600000);
      return String(b.getUTCHours()).padStart(2, '0') + ':' + String(b.getUTCMinutes()).padStart(2, '0');
    }
  }

  /** parseDE("100.000" | "100000" | "100.000,50" | "1,5") -> number | null */
  function parseDE(str) {
    if (isNum(str)) return str;
    if (typeof str !== 'string') return null;
    let s = str.replace(/[\s  €%]/g, '').replace(/−/g, '-');
    let sign = 1;
    if (s[0] === '+' || s[0] === '-') { if (s[0] === '-') sign = -1; s = s.slice(1); }
    if (!s) return null;
    let intPart, frac = '';
    if (s.indexOf(',') >= 0) {
      const parts = s.split(',');
      if (parts.length !== 2 || !/^\d*$/.test(parts[1])) return null;
      intPart = parts[0]; frac = parts[1];
      if (/^\d{1,3}(\.\d{3})+$/.test(intPart)) intPart = intPart.replace(/\./g, '');
      else if (!/^\d*$/.test(intPart)) return null;
      if (!intPart && !frac) return null;
    } else if (/^\d+$/.test(s)) intPart = s;
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) intPart = s.replace(/\./g, '');     // German thousands separators
    else if (/^\d*\.\d+$/.test(s)) { const p = s.split('.'); intPart = p[0]; frac = p[1]; }   // "1.5" -> 1.5
    else return null;
    const v = sign * Number((intPart || '0') + (frac ? '.' + frac : ''));
    return isNum(v) ? (v === 0 ? 0 : v) : null;
  }

  const PFEngine = {
    version: '1.0.0',
    PRESETS, ANN, DEFAULT_RF,
    prepare, presetRange, customRange, portfolio, benchmark, drawdown, stats, relative, monthly, assets, groupSummary,
    withShares, correlationMatrix, riskContribution,
    assetsTotal, intraday, intradayBenchmark, intradayAsset, intradayWindow, equalValueWindow, benchmarkValueNow, benchmarkRealPl,
    fmt: { eur, num, pct, ratio, date, asofBerlin, parseDE, DASH },
    util: { mean, sampleSd, sampleCov, quantile, returnsOf, minusMonths, daysBetween, dayNumber, isMonthComplete },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PFEngine; else root.PFEngine = PFEngine;
})(typeof window !== 'undefined' ? window : globalThis);
