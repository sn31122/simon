/* Yacht-Portfolio Dashboard – state, controls and rendering (classic script, no modules).
 *
 * Every financial number comes from PFEngine. This file only picks inputs, formats and lays out;
 * the only arithmetic on engine outputs are plain sums for list/table totals (see renderHoldings,
 * renderAssets) and colour scaling for display.
 */
(function () {
  'use strict';

  var D = window.PORTFOLIO_DATA, E = window.PFEngine, C = window.PFCharts;
  function $(id) { return document.getElementById(id); }

  function fail(msg) {
    var box = document.createElement('div');
    box.className = 'fatal';
    box.textContent = msg;
    var page = $('app') || document.body;
    page.insertBefore(box, page.firstChild);
  }
  if (!D || !E || !E.fmt || !C) {
    fail('Dashboard kann nicht starten: ' + (!D ? 'data/portfolio-data.js' : (!E || !E.fmt) ? 'js/engine.js' : 'js/charts.js') +
      ' fehlt oder ist fehlerhaft.');
    return;
  }

  var F = E.fmt, META = D.meta || {};
  var ctx;         // active context: the original, or PFEngine.withShares(original, overrides) in what-if mode
  try { ctx = E.prepare(D); } catch (err) { fail('Daten konnten nicht vorbereitet werden: ' + (err && err.message)); return; }
  var ctx0 = ctx;  // original context (never changes) – used for the dashed "Original" line and the banner
  var HAS_WHATIF = typeof E.withShares === 'function';
  var HAS_RISK = typeof E.riskContribution === 'function' && typeof E.correlationMatrix === 'function';
  var ORIG_SHARES = {};
  ctx0.positions.forEach(function (p) { ORIG_SHARES[p.isin] = Number(p.shares); });

  // ------------------------------------------------------------------ constants
  // benchmark cards get the first free colour in this order (creation order; a deleted card's colour is reused).
  // Chosen by OKLab distance (ΔE × 100): the first five differ by ≥ 14 from each other and from --accent #28ebcf,
  // --neg #e78e78 (the portfolio line below its start value) and the white "Mein Depot"; all twelve by ≥ 9.
  var BENCH_COLORS = ['#6ea8ff', '#ffb300', '#ba68c8', '#aeea00', '#ec407a', '#81d4fa',
    '#4caf50', '#a1887f', '#fff176', '#7986cb', '#e040fb', '#ff80ab'];
  var DEPOT_ID = 'my_depot', DEPOT_COLOR = '#f2f3f4';          // "Mein Depot" (the real depot) is always white
  var CONTEXT_DAYS = 21;                       // holdings list, period 1T: grey history shown before the last day
  var ALL = ctx.positions.map(function (p) { return p.isin; });
  var BIDX = {};                               // locked benchmarks of data/benchmarks.csv other than Mein Depot -> colour slot
  ctx.benchmarks.filter(function (b) { return b.id !== DEPOT_ID; }).forEach(function (b, k) { BIDX[b.id] = k; });
  function colorOf(id) { return id === DEPOT_ID ? DEPOT_COLOR : BENCH_COLORS[(BIDX[id] || 0) % BENCH_COLORS.length]; }
  var ASOF = META.last_asof_utc ? F.asofBerlin(META.last_asof_utc) : '';

  // ------------------------------------------------------------------ state
  var state = {
    preset: 'YTD', custom: null, mode: 'value', startValue: null, rf: 0.02,
    depotValue: null,                          // "Benchmark (€)" field: € value behind "Echt" in every benchmark box (null = real Mein Depot value)
    cards: [],                                 // benchmark cards {id, name, defName, color, show, rows: [{id, isin, q, pct}]} – first the holdings
                                               // presets (hold: true, "Mein Depot": base, def), then the own cards; not persisted
    benchmarks: [],                            // derived in compute(): ids of the benchmarks drawn (shown + valid), in card order
    selected: new Set(ALL), sort: { key: 'contrib', dir: -1 }, measure: null, hover: null,
    sinceBuy: false, holdSort: 'value-desc',   // sinceBuy: pill "Seit Kauf" (chart shows MAX)
    showHold: true, showAssets: false,         // list section toggles "Portfolio" / "Einzelwerte" (independent; not persisted)
    whatIf: HAS_WHATIF, overrides: {}                // Stück are always editable (what-if): {ISIN: shares}; not persisted
  };
  function hasOverrides() { return Object.keys(state.overrides).length > 0; }
  /** Switches the active context between the original and the what-if context. */
  function applyWhatIf() {
    ctx = state.whatIf && HAS_WHATIF && hasOverrides() ? E.withShares(ctx0, state.overrides) || ctx0 : ctx0;
  }
  var cur = null;          // last computed model
  var cache = {};          // per-model cache for tooltip windows (cleared on every update)

  // ------------------------------------------------------------------ helpers
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function nv(v) { return isNum(v) ? v : null; }
  function get(o, k) { return o && isNum(o[k]) ? o[k] : null; }
  function sgn(v) { return !isNum(v) || v === 0 ? '' : v > 0 ? 'pos' : 'neg'; }
  function eur(v, o) { return F.eur(nv(v), o); }
  function eurS(v, dec) { return F.eur(nv(v), { sign: true, dec: dec == null ? 2 : dec }); }
  function pct(v, dec) { return F.pct(nv(v), { sign: true, dec: dec == null ? 2 : dec }); }
  function pctU(v, dec) { return F.pct(nv(v), { sign: false, dec: dec == null ? 2 : dec }); }
  function num(v, dec, sign) { return F.num(nv(v), dec == null ? 2 : dec, !!sign); }
  function ratio(v) { return F.ratio(nv(v)); }
  function int(v) { return isNum(v) ? String(Math.round(v)) : '–'; }
  function pp(v) { return isNum(v) ? F.num(v * 100, 2, true) : '–'; }       // fraction -> %-points
  function dshort(iso) { return iso ? F.date(iso, 'short') : '–'; }
  function colored(v, text) { var c = sgn(v); return c ? '<span class="' + c + '">' + text + '</span>' : text; }
  function extend(a, b) { for (var k in b) if (Object.prototype.hasOwnProperty.call(b, k)) a[k] = b[k]; return a; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function monthLabel(iso, withYear) { return F.date(iso, withYear ? 'monthYear' : 'month'); }
  function dayLabel(iso) { return F.date(iso, 'dayMonthShort'); }
  /** Tooltip date like the app ("08.09.2026"; the open intraday day gets its time: "25.09.2026, 11:20"). */
  function dateLabel(k) {
    return F.date(ctx.dates[k], 'short') + (ctx.status[k] === 'intraday' ? (ASOF ? ', ' + ASOF : '') + ' (intraday)' : '');
  }
  /** Berlin calendar date of "now" (for "Heute" / "Gestern"). */
  function berlinToday() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
    catch (e) { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  }
  /** "Heute" / "Gestern" like the app, otherwise the weekday ("Freitag"). */
  function dayWord(iso) {
    var t = berlinToday(), y = new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10) - 1)).toISOString().slice(0, 10);
    if (iso === t) return 'Heute';
    if (iso === y) return 'Gestern';
    try { return new Intl.DateTimeFormat('de-DE', { weekday: 'long', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z')); }
    catch (e) { return F.date(iso, 'dayMonthShort'); }
  }
  /**
   * Point k of a sub-daily chart -> label. 1T (one session): "Gestern, 20:00" (the start close: "Gestern, Schluss");
   * several sessions: "Mi 23.09., 14:30", the start point = the daily close of the range start: "Fr 18.09., Schluss".
   */
  function slotLabel(I, k) {
    var fr = I.frame, s = fr.slot[k], iso = ctx.dates[fr.day[k]];
    return (I.oneDay ? dayWord(iso) : F.date(iso, 'weekdayDayMonth')) + ', ' + (s < 0 ? 'Schluss' : fr.times[s]);
  }
  /** 1T axis like the app: "Gestern · 15:15 · Heute · 15:15" (session start + middle of the session). */
  function intraTicks(I) {
    var fr = I.frame, t0 = fr.times[0], t1 = fr.times[fr.S - 1];
    var mid = ((+t0.slice(0, 2) * 60 + +t0.slice(3)) + (+t1.slice(0, 2) * 60 + +t1.slice(3))) / 2;
    var midTxt = pad2(Math.floor(mid / 60)) + ':' + pad2(Math.round(mid % 60)), out = [];
    fr.segs.forEach(function (g) {
      out.push({ i: g.from, text: dayWord(g.date), anchor: 'start' });
      out.push({ i: g.from + (fr.S - 1) / 2, text: midTxt, anchor: 'middle' });
    });
    return out;
  }
  /**
   * Axis of a multi-day grid (1W, 1M, custom), as a function of the plot width: up to 7 sessions one label per session
   * in its middle ("Mo 21.09.", narrow: "21.09."); more sessions: the first session of each week like the daily charts
   * ("26. Aug.", "31", "7. Sept.", "14"). MainChart drops labels that would overlap.
   */
  function gridTicks(I) {
    var segs = I.frame.sessions;
    return function (plotW) {
      var out = [], per = plotW / Math.max(1, segs.length), prevWeek = null, prevMonth = null;
      segs.forEach(function (g, k) {
        var mid = (g.from + g.to) / 2;
        if (segs.length <= 7) { out.push({ i: mid, text: F.date(g.date, per >= 76 ? 'weekdayDayMonth' : 'dayMonthShort'), anchor: 'middle' }); return; }
        var week = Math.floor((Date.UTC(+g.date.slice(0, 4), +g.date.slice(5, 7) - 1, +g.date.slice(8, 10)) / 864e5 + 3) / 7), mon = g.date.slice(0, 7);
        if (week === prevWeek) return;
        prevWeek = week;
        out.push({ i: mid, text: weekLabel(g.date, k === 0 || (prevMonth !== null && mon !== prevMonth)), anchor: 'middle' });
        prevMonth = mon;
      });
      return out;
    };
  }
  function padNull(a, m) { var out = a.slice(); while (out.length < m) out.push(null); return out; }

  /** Short-range x labels like the app: "24", "31", "7. Sept." */
  function weekLabel(iso, withMonth) {
    var d = String(+iso.slice(8, 10));
    return withMonth ? d + '. ' + F.date(iso, 'month') : d;
  }
  function periodText(R) {
    var a = ctx.dates[R.start], b = ctx.dates[R.end];
    return (a.slice(0, 4) === b.slice(0, 4) ? F.date(a, 'dayMonthShort') : F.date(a, 'short')) + '–' + F.date(b, 'short');
  }
  /** Calendar target of a preset (end date minus period) – only used to say "Daten ab …". */
  function presetTarget(endIso, preset) {
    var y = +endIso.slice(0, 4), m = +endIso.slice(5, 7), d = +endIso.slice(8, 10);
    if (preset === '1W') return new Date(Date.UTC(y, m - 1, d - 7)).toISOString().slice(0, 10);
    var months = { '1M': 1, '3M': 3, '6M': 6, '1J': 12 }[preset];
    if (!months) return null;
    var mm = m - 1 - months, yy = y + Math.floor(mm / 12);
    mm = ((mm % 12) + 12) % 12;
    var last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    return yy + '-' + pad2(mm + 1) + '-' + pad2(Math.min(d, last));
  }
  /** Hint text when a preset reaches before the first data point (e.g. 1J) or YTD lacks a year-end close. */
  function clipNote(preset, R) {
    if (!preset || !R) return '';
    var first = ctx.dates[0];
    if (preset === 'YTD' && R.start === 0) return 'YTD ab Schlusskurs ' + F.date(first, 'short') + ', kein Jahresschluss ' + (+first.slice(0, 4) - 1);
    var t = presetTarget(ctx.dates[R.end], preset);
    if (t && R.start === 0 && t < first) return preset + ': Daten erst ab ' + F.date(first, 'short');
    return '';
  }
  /** Keeps keyboard focus on the "same" control when a container is re-rendered via innerHTML. */
  function keepFocus(container, fn) {
    var a = document.activeElement, attrs = ['data-isin', 'data-wi', 'data-wireset', 'data-group', 'data-sort'], sel = null;
    if (a && a !== document.body && container.contains(a)) {
      for (var k = 0; k < attrs.length && !sel; k++) {
        var host = a.closest('[' + attrs[k] + ']');
        if (host && container.contains(host)) {
          var v = host.getAttribute(attrs[k]).replace(/["\\]/g, '\\$&');
          sel = '[' + attrs[k] + '="' + v + '"]' + (host === a ? '' : ' ' + a.tagName.toLowerCase());
        }
      }
    }
    fn();
    if (sel) {
      var el = container.querySelector(sel);
      if (el && el.focus) {
        el.focus({ preventScroll: true });
        if (el.tagName === 'INPUT' && el.type === 'text' && el.select) el.select();
      }
    }
  }

  // ------------------------------------------------------------------ model
  function currentRange() {
    if (state.custom) {
      var r = E.customRange(ctx, state.custom.from, state.custom.to);
      if (r) return r;
    }
    return E.presetRange(ctx, state.preset || 'YTD');
  }
  /** What picks the chart interval: 'custom' (valid Von/Bis range, by its length), 'MAX' for Seit Kauf, else the preset. */
  function intervalPreset() {
    if (state.custom && E.customRange(ctx, state.custom.from, state.custom.to)) return 'custom';
    return state.sinceBuy ? 'MAX' : (state.preset || 'YTD');
  }
  var IV_SHORT = { m30: '30 Min.', h2: '2 Std.', day: '1 Tag' };
  var IV_KURSE = { m30: '30-Min-Kurse', h2: '2-Std-Kurse' };
  var IV_LONG = { m30: '30-Minuten-Kurse', h2: '2-Stunden-Kurse' };

  function compute() {
    var R = currentRange(), rf = state.rf, sel = state.selected, n = ctx.n;
    var p = sel.size ? E.portfolio(ctx, { selected: sel, start: R.start, end: R.end, startValue: state.startValue }) : null;
    var ps = p ? E.stats(p, { rf: rf }) : null;
    var pdd = p ? E.drawdown(p.value) : null;
    var base = p && isNum(p.startValue) && p.startValue > 0 ? p.startValue : 1;
    // every locked benchmark + every valid card (their returns show on the cards); selB = the ones shown in the chart
    var benches = benchDefs().map(function (d) {
      var s = E.benchmark(ctx, d.b, R.start, R.end, base);
      return { b: d.b, id: d.id, name: d.name, color: d.color, show: d.show, hold: d.hold, real: d.real, s: s, st: s ? E.stats(s, { rf: rf }) : null };
    });
    var byId = {};
    benches.forEach(function (x) { byId[x.id] = x; });
    var selB = benches.filter(function (x) { return x.show && x.s; });
    state.benchmarks = selB.map(function (x) { return x.id; });
    selB.forEach(function (x) {
      x.rel = p && x.s ? E.relative(p, x.s, { rf: rf }) : null;
      x.dd = x.s ? E.drawdown(x.s.value) : null;
      var fs = E.benchmark(ctx, x.b, 0, n - 1, 1);
      x.monthly = fs ? E.monthly(ctx, fs.value) : null;
    });
    var full = sel.size ? E.portfolio(ctx, { selected: sel, start: 0, end: n - 1, startValue: null }) : null;
    var monthlyP = full ? E.monthly(ctx, full.value) : null;
    var monthsRef = monthlyP || (selB[0] && selB[0].monthly) || null;
    if (!monthsRef && ctx.benchmarks.length) {
      var fb = E.benchmark(ctx, ctx.benchmarks[0], 0, n - 1, 1);
      monthsRef = fb ? E.monthly(ctx, fb.value) : null;
    }
    var assets = E.assets(ctx, { selected: sel, start: R.start, end: R.end, scale: p && isNum(p.scale) ? p.scale : 1 }) || [];
    var groups = E.groupSummary(ctx, assets) || [];
    // what-if: the original portfolio (same selection, range and Startwert) for the dashed comparison line
    var orig = ctx !== ctx0 && sel.size ? E.portfolio(ctx0, { selected: sel, start: R.start, end: R.end, startValue: state.startValue }) : null;
    // chart interval (engine.chartInterval): 1T/1W 30 min, 1M 2 h, custom by length, stepping down where the finer grid
    // lacks a session; main chart + drawdown then run on the sub-daily frame (1T: previous session grey as context,
    // x spans the whole day; several sessions: trimmed at the last point). Everything else stays daily.
    var ivp = intervalPreset();
    var iv = E.chartInterval ? E.chartInterval(ctx, R, ivp) : { key: 'day', want: 'day', stepped: false, skipped: [] };
    var intra = null;
    if (iv.key !== 'day' && sel.size) {
      var fr = E.gridFrame(ctx, iv.key, R.start, R.end, { context: ivp === '1T', trim: R.end - R.start > 1 });
      intra = fr ? E.intraday(ctx, { selected: sel, startValue: state.startValue, frame: fr }) : null;
      if (intra) {
        intra.oneDay = fr.sessions.length === 1;          // labels "Gestern, 20:00" / axis "Gestern · 15:15 · Heute …"
        intra.oneT = ivp === '1T';
        intra.benches = selB.map(function (x) { return { x: x, s: E.intradayBenchmark(ctx, x.b, intra.base, fr) }; })
          .filter(function (o) { return o.s; });
        intra.benches.forEach(function (o) { o.dd = E.drawdown(o.s.value.slice(0, intra.last + 1)); });
        intra.orig = ctx !== ctx0 ? E.intraday(ctx0, { selected: sel, startValue: state.startValue, frame: fr }) : null;
        intra.dd = E.drawdown(intra.value.slice(0, intra.last + 1));
      }
    }
    return {
      R: R, p: p, ps: ps, pdd: pdd, benches: benches, byId: byId, selB: selB,
      monthlyP: monthlyP, monthsRef: monthsRef || [], assets: assets, groups: groups,
      orig: orig, origStats: orig ? E.stats(orig, { rf: rf }) : null, iv: iv, intra: intra
    };
  }

  /** Portfolio over [a, b] (indices into the current range) in the current scale -> stats. */
  function win(a, b) {
    var key = 'p|' + a + '|' + b;
    if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
    var M = cur, p = M && M.p, st = null;
    if (p && b > a) {
      var s = E.portfolio(ctx, { selected: state.selected, start: M.R.start + a, end: M.R.start + b, startValue: p.value[a] });
      st = s ? E.stats(s, { rf: state.rf }) : null;
    }
    return (cache[key] = st);
  }
  /** What-if: return of the original portfolio over [a, b] (indices into the current range). */
  function origWin(a, b) {
    var key = 'o|' + a + '|' + b;
    if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
    var M = cur, o = M && M.orig, r = null;
    if (o && b > a) {
      var s = E.portfolio(ctx0, { selected: state.selected, start: M.R.start + a, end: M.R.start + b, startValue: o.value[a] });
      var st = s ? E.stats(s, { rf: state.rf }) : null;
      r = st ? nv(st.totalReturn) : null;
    }
    return (cache[key] = r);
  }
  /**
   * Benchmark return over [a, b] (indices into the current range), read off the period series (value[b] / value[a] − 1):
   * a card is bought once at the period start and held, so it must not be re-bought at a.
   */
  function benchWin(x, a, b) {
    var key = 'b|' + x.id + '|' + a + '|' + b;
    if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
    var w = b > a && x.s ? E.intradayWindow(x.s.value, a, b) : null;
    return (cache[key] = w ? nv(w.ret) : null);
  }

  // ------------------------------------------------------------------ charts
  var sync = new C.Sync({
    onMeasure: function (pin) { state.measure = pin; renderMeasureBar(); },       // (pinned, following)
    onHover: function (i) { state.hover = i; }
  });
  var mainChart = new C.MainChart($('mainChart'), { sync: sync });
  var ddChart = new C.DrawdownChart($('ddChart'), { sync: sync, readout: $('ddReadout') });

  // ------------------------------------------------------------------ date fields (TT.MM.JJJJ)
  /**
   * Own date entry instead of <input type="date">: three segments, a click into any segment selects it,
   * typed digits replace it and jump on (day -> month -> year) as soon as the segment is complete.
   * Nothing is applied while typing; onCommit(iso) fires when the year is complete, on Enter, arrow keys,
   * the calendar picker or when focus leaves the field. An incomplete / impossible date is reverted.
   */
  function DateField(el, onCommit, onInvalid) {
    var segs = Array.prototype.slice.call(el.querySelectorAll('.dseg'));
    var nat = el.querySelector('.dnative'), cal = el.querySelector('.dcal');
    var LEN = [2, 2, 4], self = this;
    this.el = el;
    this.value = null;                     // last committed / rendered ISO date
    function focusSeg(k) { var s = segs[k]; if (s) { s.focus(); s._fresh = true; s.select(); } }
    function padSeg(k) { var s = segs[k]; if (k < 2 && s.value.length === 1) s.value = '0' + s.value; }
    function step(k, d) {
      var iso = self.iso() || self.value;
      if (!iso) return;
      var y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1, day = +iso.slice(8, 10);
      var t = k === 0 ? new Date(Date.UTC(y, m, day + d)) : k === 1 ? new Date(Date.UTC(y, m + d, 1)) : new Date(Date.UTC(y + d, m, 1));
      if (k > 0) t.setUTCDate(Math.min(day, new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()));
      self.show(t.toISOString().slice(0, 10));
      focusSeg(k);
      self.commit();
    }
    function advance(s, k) {
      var v = s.value;
      if (!v) return;
      var done = v.length === LEN[k] || (k === 0 && +v > 3) || (k === 1 && +v > 1);
      if (!done) return;
      if (k < 2) { padSeg(k); focusSeg(k + 1); } else self.commit();
    }
    segs.forEach(function (s, k) {
      // the first digit after entering a segment replaces its content, further digits append
      s.addEventListener('focus', function () { s._fresh = true; s.select(); });
      s.addEventListener('pointerdown', function () { s._fresh = true; });
      s.addEventListener('mouseup', function (ev) { ev.preventDefault(); s.select(); });
      s.addEventListener('input', function () {             // fallback (mobile keyboards send no usable keydown)
        var v = s.value.replace(/\D/g, '').slice(0, LEN[k]);
        if (v !== s.value) s.value = v;
        s._fresh = false;
        advance(s, k);
      });
      s.addEventListener('keydown', function (ev) {
        var key = ev.key;
        if (self._last !== s) s._fresh = true;             // came here by Tab / click without a focus event
        self._last = s;
        if (/^\d$/.test(key) && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
          ev.preventDefault();
          s.value = ((s._fresh ? '' : s.value) + key).slice(-LEN[k]);
          s._fresh = false;
          advance(s, k);
          return;
        }
        if (key === 'Backspace' && s.value) { ev.preventDefault(); s.value = s._fresh ? '' : s.value.slice(0, -1); s._fresh = false; return; }
        if (key === '.' || key === ',' || key === '/' || key === '-' || key === ' ') {
          ev.preventDefault();
          if (k < 2 && s.value) { padSeg(k); focusSeg(k + 1); }
        } else if (key === 'ArrowRight' && k < 2) { ev.preventDefault(); padSeg(k); focusSeg(k + 1); }
        else if (key === 'ArrowLeft' && k > 0) { ev.preventDefault(); focusSeg(k - 1); }
        else if (key === 'Backspace' && !s.value && k > 0) { ev.preventDefault(); focusSeg(k - 1); }
        else if (key === 'ArrowUp' || key === 'ArrowDown') { ev.preventDefault(); step(k, key === 'ArrowUp' ? 1 : -1); }
        else if (key === 'Enter') { ev.preventDefault(); self.commit(); }
        else if (key === 'Escape' || key === 'Esc') { if (self.value) { self.show(self.value); focusSeg(k); ev.stopPropagation(); } }
      });
      s.addEventListener('paste', function (ev) {
        var t = ((ev.clipboardData || window.clipboardData) || { getData: function () { return ''; } }).getData('text');
        var iso = parseDateText(t);
        if (!iso) return;
        ev.preventDefault();
        self.show(iso);
        self.commit();
      });
    });
    el.addEventListener('focusout', function (ev) {
      if (ev.relatedTarget && el.contains(ev.relatedTarget)) return;
      self._last = null;
      setTimeout(function () { if (!el.contains(document.activeElement)) self.leave(); }, 0);
    });
    // the page area of the field focuses the day segment (clicks on the dots / padding)
    el.addEventListener('mousedown', function (ev) {
      if (ev.target === el || ev.target.classList.contains('dsep')) { ev.preventDefault(); focusSeg(ev.target.classList.contains('dsep') ? segs.indexOf(ev.target.nextElementSibling) : 0); }
    });
    cal.addEventListener('click', function () {
      nat.value = self.iso() || self.value || '';
      try { nat.showPicker(); } catch (e) { nat.focus(); nat.click(); }
    });
    nat.addEventListener('change', function () { if (nat.value) { self.show(nat.value); self.commit(); } });
    this.segs = segs;
    this.nat = nat;
    this.onCommit = onCommit;
    this.onInvalid = onInvalid;
    this.onRestore = function () { setRangeHint(''); };
  }
  function parseDateText(t) {
    var m = String(t || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/) ||
      String(t || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    var iso = m[1].length === 4 ? m[1] + '-' + m[2] + '-' + m[3] :
      (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + pad2(+m[2]) + '-' + pad2(+m[1]);
    return validIso(iso) ? iso : null;
  }
  function validIso(iso) {
    var y = +iso.slice(0, 4), mo = +iso.slice(5, 7), d = +iso.slice(8, 10), t = new Date(Date.UTC(y, mo - 1, d));
    return y >= 1900 && t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
  }
  DateField.prototype.editing = function () { return this.el.contains(document.activeElement); };
  DateField.prototype.show = function (iso) {
    this.segs[0].value = iso ? iso.slice(8, 10) : '';
    this.segs[1].value = iso ? iso.slice(5, 7) : '';
    this.segs[2].value = iso ? iso.slice(0, 4) : '';
  };
  /** Rendered value from the app; ignored while the user is typing in the field. */
  DateField.prototype.set = function (iso) {
    this.value = iso;
    if (!this.editing()) this.show(iso);
  };
  DateField.prototype.limits = function (min, max) {
    if (this.nat.min !== min) this.nat.min = min;
    if (this.nat.max !== max) this.nat.max = max;
  };
  /** ISO date of the typed segments, or null when incomplete / impossible (2-digit years mean 20xx). */
  DateField.prototype.iso = function () {
    var d = this.segs[0].value, m = this.segs[1].value, y = this.segs[2].value;
    if (!d || !m || !(y.length === 4 || y.length === 2)) return null;
    var iso = (y.length === 2 ? '20' + y : y) + '-' + pad2(+m) + '-' + pad2(+d);
    return validIso(iso) ? iso : null;
  };
  DateField.prototype.commit = function () {
    var iso = this.iso();
    if (!iso) { if (this.onInvalid) this.onInvalid(); return false; }
    this.show(iso);
    if (iso !== this.value) this.onCommit(iso);
    return true;
  };
  /** Focus left the field: apply a complete date, otherwise restore the last one. */
  DateField.prototype.leave = function () {
    var complete = this.segs.every(function (s) { return !!s.value; });
    if (complete && this.iso()) { if (this.iso() !== this.value) this.onCommit(this.iso()); this.show(this.iso()); return; }
    if (complete && this.onInvalid) this.onInvalid(); else if (this.onRestore) this.onRestore();
    this.show(this.value);
  };

  var dfFrom = new DateField($('dateFrom'), function () { onDateChange(); }, function () { setRangeHint('Ungültiges Datum (TT.MM.JJJJ).'); });
  var dfTo = new DateField($('dateTo'), function () { onDateChange(); }, function () { setRangeHint('Ungültiges Datum (TT.MM.JJJJ).'); });

  function ttRow(name, color, val, r) {
    return '<span class="tt-name" style="--c:' + color + '"><i></i><span class="tt-nm">' + esc(name) + '</span></span>' +
      '<span class="tt-num">' + val + '</span><span class="tt-pct ' + sgn(r) + '">' + pct(r) + '</span>';
  }

  /** Measure box exactly as in the app: dates · start value, € change, end value · % change (nothing else). */
  function measureBox(la, lb, va, vb, delta, ret) {
    return '<div class="tt-m">' +
      '<div class="tt-date l1">' + esc(la) + '</div>' +
      '<div class="tt-date r1">' + esc(lb) + '</div>' +
      '<div class="tt-val l2">' + va + '</div>' +
      '<div class="tt-delta c2 ' + sgn(delta) + '">' + eurS(delta) + '</div>' +
      '<div class="tt-val r2">' + vb + '</div>' +
      '<div class="tt-sub c3">' + colored(ret, pct(ret)) + '</div>' +
      '</div>';
  }
  var REAL_ID = DEPOT_ID;                        // the benchmark that is the user's real depot
  /** Default of „Benchmark (€)“: the real value of "Mein Depot" today (its fetched quantities, also while its card is edited). */
  function depotDefault() { return E.benchmarkValueNow ? E.benchmarkValueNow(ctx0, REAL_ID) : null; }
  function depotTarget() { return state.depotValue != null ? state.depotValue : depotDefault(); }
  /**
   * One box per shown benchmark beside the measure box (user, 27.09.: every shown benchmark, not only "Mein Depot").
   * x: its selB entry; pValues/bValues: portfolio and benchmark VALUE series (also in Gesamtrendite); a/b: chart indices;
   * i/j: daily indices into ctx, or points of the sub-daily frame `frame`, for the real change. % and "Gleicher Wert" =
   * the benchmark at the portfolio's size at the start of the span; "Echt" = its € change had it been worth
   * „Benchmark (€)“ today (unedited "Mein Depot": your real depot's change); cards are bought at the period start.
   */
  function benchBoxHTML(x, pValues, bValues, a, b, i, j, frame) {
    var w = E.equalValueWindow ? E.equalValueWindow(pValues, bValues, a, b) : null;
    var ret = get(w, 'ret'), eq = get(w, 'pl'), tgt = depotTarget();
    var real = E.benchmarkRealPl ? nv(E.benchmarkRealPl(ctx0, x.b, i, j, { frame: frame || null, target: tgt, buyAt: cur.R.start })) : null;
    var tgtTxt = isNum(tgt) ? eur(tgt, { dec: 0 }) : '', tgtNote = tgtTxt ? ' (' + tgtTxt + (state.depotValue == null ? ' = Wert von „Mein Depot“ heute' : '') + ')' : '';
    var today = F.date(ctx0.dates[ctx0.n - 1], 'short');
    function row(label, v, text, title) {
      return '<div class="tt-dr" title="' + esc(title) + '">' + label + '<span class="tt-dv ' + sgn(v) + '">' + text + '</span></div>';
    }
    return '<div class="tt-d">' +
      row('<span class="tt-dn" style="--c:' + x.color + '"><i></i>' + esc(x.name) + '</span>', ret, pct(ret),
        'Veränderung von „' + x.name + '“ im gemessenen Zeitraum') +
      row('<span class="tt-dl">Gleicher Wert</span>', eq, eurS(eq),
        'Gleicher Wert: Veränderung von „' + x.name + '“, wenn es zu Beginn der Messung genauso groß gewesen wäre wie das Portfolio' +
        (get(w, 'base') !== null ? ' (' + eur(w.base) + ')' : '')) +
      row('<span class="tt-dl">Echt' + (tgtTxt ? ' (' + tgtTxt + ')' : '') + '</span>', real, eurS(real),
        (x.real ? 'Echt: tatsächliche Veränderung deines Depots, hochgerechnet auf den Wert aus „Benchmark (€)“' + tgtNote :
          'Echt: Veränderung von „' + x.name + '“, wenn es heute (' + today + ') so viel wert wäre wie „Benchmark (€)“' + tgtNote +
          (x.hold ? '' : ' – gekauft am ' + F.date(ctx.dates[cur.R.start], 'short') + ', dann gehalten'))) +
      '</div>';
  }

  function intraHoverHTML(i, maxBench) {
    var I = cur.intra, pl = state.mode === 'pl', v = pl ? I.pl[i] : I.value[i];
    var main = '<div class="tt-date">' + esc(slotLabel(I, i)) + '</div>' +
      '<div class="tt-main ' + (pl ? sgn(v) : '') + '">' + (pl ? eurS(v) : eur(v)) + '</div>';
    var rows = '';
    if (I.orig) rows += ttRow('Original', 'var(--ghost)', pl ? eurS(I.orig.pl[i]) : eur(I.orig.value[i]), I.orig.ret[i]);
    I.benches.slice(0, maxBench).forEach(function (o) { rows += ttRow(o.x.name, o.x.color, pl ? eurS(o.s.pl[i]) : eur(o.s.value[i]), o.s.ret[i]); });
    return '<div class="tt-one">' + main + '</div>' + (rows ? '<div class="tt-h">' + rows + '</div>' : '');
  }
  /** Sub-daily chart: measure box + one box per shown benchmark ({ main, side } for MainChart); a/b are points of the frame. */
  function intraMeasureHTML(a, b) {
    var I = cur.intra, pl = state.mode === 'pl';
    var w = E.intradayWindow(I.value, a, b);
    return {
      main: measureBox(slotLabel(I, a), slotLabel(I, b), pl ? eurS(I.pl[a]) : eur(I.value[a]), pl ? eurS(I.pl[b]) : eur(I.value[b]),
        get(w, 'pl'), get(w, 'ret')),
      side: I.benches.filter(function (o) { return o.s; }).map(function (o) {
        return benchBoxHTML(o.x, I.value, o.s.value, a, b, Math.min(a, b), Math.max(a, b), I.frame);
      }).join('')
    };
  }

  /** Single-point hover box; maxBench (optional) caps the benchmark rows – MainChart sizes the band above the plot with it. */
  function hoverHTML(i, maxBench) {
    var M = cur, p = M && M.p;
    if (!p) return '';
    if (M.intra) return intraHoverHTML(i, maxBench);
    var pl = state.mode === 'pl';
    // as in the app: date, then the value (Gesamtrendite coloured by sign); benchmarks as small rows below
    var main = '<div class="tt-date">' + esc(dateLabel(M.R.start + i)) + '</div>' +
      '<div class="tt-main ' + (pl ? sgn(p.pl[i]) : '') + '">' + (pl ? eurS(p.pl[i]) : eur(p.value[i])) + '</div>';
    var rows = '';
    if (M.orig) rows += ttRow('Original', 'var(--ghost)', pl ? eurS(M.orig.pl[i]) : eur(M.orig.value[i]), i > 0 ? origWin(0, i) : 0);
    M.selB.filter(function (x) { return x.s; }).slice(0, maxBench).forEach(function (x) {
      rows += ttRow(x.name, x.color, pl ? eurS(x.s.pl[i]) : eur(x.s.value[i]), i > 0 ? benchWin(x, 0, i) : 0);
    });
    return '<div class="tt-one">' + main + '</div>' + (rows ? '<div class="tt-h">' + rows + '</div>' : '');
  }

  /** Measurement over [a, b] (indices into the range): { main: measure box, side: one box per shown benchmark, or '' }. */
  function measureHTML(a, b) {
    var M = cur, p = M && M.p;
    if (!p) return '';
    if (M.intra) return intraMeasureHTML(a, b);
    var pl = state.mode === 'pl';
    var w = win(a, b);
    return {
      main: measureBox(dateLabel(M.R.start + a), dateLabel(M.R.start + b), pl ? eurS(p.pl[a]) : eur(p.value[a]), pl ? eurS(p.pl[b]) : eur(p.value[b]),
        get(w, 'pl'), get(w, 'totalReturn')),
      side: M.selB.filter(function (x) { return x.s; }).map(function (x) {
        return benchBoxHTML(x, p.value, x.s.value, a, b, M.R.start + Math.min(a, b), M.R.start + Math.max(a, b), null);
      }).join('')
    };
  }

  function ddReadout(i) {
    var M = cur;
    if (!M || !M.p || !M.pdd) return '';
    if (M.intra) {
      var I = M.intra, d = I.dd;
      if (i == null) return 'Aktuell <b class="' + sgn(d.current) + '">' + pctU(d.current) + '</b> · Max. <b class="neg">' + pctU(d.maxDD) + '</b>';
      var o = esc(slotLabel(I, i)) + ': <b class="' + sgn(d.dd[i]) + '">' + pctU(d.dd[i]) + '</b>';
      I.benches.forEach(function (b) { o += ' · <span class="sw" style="background:' + b.x.color + '"></span>' + esc(b.x.name) + ' ' + pctU(b.dd.dd[i]); });
      return o;
    }
    if (i == null) {
      var s = M.ps;
      return 'Aktuell <b class="' + sgn(get(s, 'currentDD')) + '">' + pctU(get(s, 'currentDD')) + '</b> · Max. <b class="neg">' +
        pctU(get(s, 'maxDD')) + '</b>';
    }
    var out = esc(F.date(ctx.dates[M.R.start + i], 'long')) + ': <b class="' + sgn(M.pdd.dd[i]) + '">' + pctU(M.pdd.dd[i]) + '</b>';
    M.selB.forEach(function (x) {
      if (x.dd && x.dd.dd) out += ' · <span class="sw" style="background:' + x.color + '"></span>' + esc(x.name) + ' ' + pctU(x.dd.dd[i]);
    });
    return out;
  }

  /** Empty state: nothing selected, or (what-if) every selected position set to 0 Stück. */
  function emptyText() {
    return state.selected.size && ctx !== ctx0 ? 'Keine Bestände in der Auswahl (alle auf 0 Stück gesetzt)' : 'Keine Position ausgewählt';
  }

  function intraChartModels(M) {
    var I = M.intra, pl = state.mode === 'pl', ticks = I.oneDay ? intraTicks(I) : gridTicks(I);
    var common = { dates: [], xTicks: ticks, last: I.last, emptyText: emptyText() };
    var main = extend({
      series: { values: pl ? I.pl : I.value },
      ghost: I.orig ? { values: pl ? I.orig.pl : I.orig.value } : null,
      benches: I.benches.map(function (o) { return { id: o.x.id, color: o.x.color, values: pl ? o.s.pl : o.s.value }; }),
      baseline: pl ? 0 : I.base, ctxEnd: I.ctxEnd,
      axisLabel: function (v) { return F.num(v, 2); },
      lastLabel: function (v) { return F.num(v, 2); },
      hoverHTML: hoverHTML, measureHTML: measureHTML
    }, common);
    var d = I.dd, mk = d && d.maxDD < 0 ? { i: d.trough, value: d.maxDD, label: 'Max. ' + pctU(d.maxDD) + (I.oneDay ? ' ' : ' am ') + slotLabel(I, d.trough) } : null;
    var dd = extend({
      dd: padNull(d.dd, I.m),
      benches: I.benches.map(function (o) { return { id: o.x.id, color: o.x.color, dd: padNull(o.dd.dd, I.m) }; }),
      maxMarker: mk,
      axisLabel: function (v, step) { return F.pct(v, { sign: false, dec: step < 0.01 ? 1 : 0 }); },
      readout: ddReadout
    }, common);
    return { main: main, dd: dd };
  }

  function chartModels(M) {
    if (M.intra) return intraChartModels(M);
    var R = M.R, p = M.p, pl = state.mode === 'pl';
    var dates = ctx.dates.slice(R.start, R.end + 1);
    var common = {
      dates: dates,
      firstIsMonthStart: R.start === 0 || ctx.dates[R.start - 1].slice(0, 7) !== ctx.dates[R.start].slice(0, 7),
      monthLabel: monthLabel, dayLabel: dayLabel, emptyText: emptyText()
    };
    var benches = p ? M.selB.filter(function (x) { return x.s; }) : [];
    var main = extend({
      series: p ? { values: pl ? p.pl : p.value } : null,
      ghost: p && M.orig ? { values: pl ? M.orig.pl : M.orig.value } : null,
      benches: benches.map(function (x) { return { id: x.id, color: x.color, values: pl ? x.s.pl : x.s.value }; }),
      baseline: p ? (pl ? 0 : p.startValue) : null,
      axisLabel: function (v) { return F.num(v, 2); },                 // app: "40.000,00"
      lastLabel: function (v) { return F.num(v, 2); },
      weekLabel: weekLabel,
      hoverHTML: hoverHTML,
      measureHTML: measureHTML
    }, common);
    var pdd = M.pdd, mk = null;
    if (pdd && isNum(pdd.maxDD) && pdd.maxDD < 0 && isNum(pdd.trough) && dates[pdd.trough]) {
      mk = { i: pdd.trough, value: pdd.maxDD, label: 'Max. ' + pctU(pdd.maxDD) + ' am ' + F.date(dates[pdd.trough], 'short') };
    }
    var dd = extend({
      dd: pdd ? pdd.dd : null,
      benches: benches.filter(function (x) { return x.dd && x.dd.dd; }).map(function (x) { return { id: x.id, color: x.color, dd: x.dd.dd }; }),
      maxMarker: mk,
      axisLabel: function (v, step) { return F.pct(v, { sign: false, dec: step < 0.01 ? 1 : 0 }); },
      readout: ddReadout,
      weekLabel: weekLabel
    }, common);
    return { main: main, dd: dd };
  }

  function renderCharts(M) {
    var models = chartModels(M);
    mainChart.render(models.main);
    models.dd.padR = mainChart.L ? mainChart.L.padR : 60;
    ddChart.render(models.dd);
  }
  /** Resize: re-render both charts – not when the size change came from the main chart itself (its band, --band-extra). */
  function rerenderChartsOnly() {
    if (!mainChart.model || !mainChart.sizeChanged()) return;
    mainChart.render();
    if (ddChart.model) { ddChart.model.padR = mainChart.L ? mainChart.L.padR : 60; ddChart.render(); }
  }

  var TOUCH = !!(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);   // phone / tablet wording
  function renderMeasureBar() {
    var pin = sync.pinned(), btn = $('applyMeasure'), help = $('chartHelp');
    var end = TOUCH ? ' · Tippen in den Chart hebt sie auf' : ' · Klick in den Chart oder Esc hebt sie auf';
    btn.hidden = !pin || !!(cur && cur.intra);             // "Zeitraum auf Auswahl setzen": daily charts only
    if (pin && cur && cur.intra) {
      help.textContent = 'Messung ' + slotLabel(cur.intra, pin.a) + ' – ' + slotLabel(cur.intra, pin.b) + end;
    } else if (pin && cur && cur.p) {
      var a = ctx.dates[cur.R.start + pin.a], b = ctx.dates[cur.R.start + pin.b];
      btn.title = 'Zeitraum auf ' + F.date(a, 'short') + ' – ' + F.date(b, 'short') + ' setzen';
      help.textContent = 'Messung ' + F.date(a, 'short') + ' – ' + F.date(b, 'short') + end;
    } else if (sync.following()) {
      help.textContent = TOUCH ? 'Startpunkt gesetzt – ziehen zum Messen · erneutes Tippen beendet' :
        'Startpunkt gesetzt – Maus bewegen zum Messen · erneuter Klick oder Esc beendet';
    } else {
      help.textContent = !(cur && cur.p) ? '' : TOUCH ? 'Zum Messen im Chart ziehen oder einen Startpunkt antippen' :
        'In den Chart klicken, um ab diesem Punkt zu messen (oder ziehen)';
    }
  }

  /**
   * Muted note under the chart: the chart's interval ("Intervall: 30 Min." / "2 Std." / "1 Tag") and, when the range
   * stepped down to a coarser grid, why ("keine 30-Min-Kurse für diesen Zeitraum"). The title lists what was collected.
   */
  function renderInterval(M) {
    var el = $('chartIv'), iv = M.iv;
    if (!el) return;
    if (!iv) { el.textContent = ''; return; }
    var why = iv.stepped && iv.skipped.length ? 'keine ' + (iv.skipped.length > 1 ? '30-Min- oder 2-Std-Kurse' : IV_KURSE[iv.skipped[0]]) + ' für diesen Zeitraum' : '';
    el.innerHTML = 'Intervall: <b>' + esc(IV_SHORT[iv.key]) + '</b>' + (why ? '<span class="chart-iv-why"> · ' + esc(why) + '</span>' : '');
    var have = ['m30', 'h2'].map(function (k) {
      var G = ctx.grids && ctx.grids[k];
      return G && G.D ? IV_SHORT[k] + ' für ' + G.D + (G.D === 1 ? ' Handelstag' : ' Handelstage') + ' (' +
        F.date(G.dates[0], 'dayMonthShort') + '–' + F.date(G.dates[G.D - 1], 'short') + ')' : IV_SHORT[k] + ': keine';
    });
    el.title = 'Kursintervall von Chart und Drawdown (Kennzahlen, Tabellen und Listen: Tagesschlusskurse). ' +
      '1T/1W: 30 Min., 1M: 2 Std., länger: 1 Tag; eigener Zeitraum: bis 7 Tage 30 Min., bis 31 Tage 2 Std. – ' +
      'gröber, wo feinere Kurse fehlen. Gesammelt: ' + have.join(', ') + '.';
  }

  // ------------------------------------------------------------------ header / controls
  function renderHeader() {
    var title = META.title || 'Portfolio';
    document.title = title;
    $('title').textContent = title;
    var last = ctx.dates[ctx.n - 1];
    var parts = [ctx.positions.length + ' Positionen'];
    parts.push('Kurse bis ' + F.date(last, 'short') +
      (META.last_status === 'intraday' ? (ASOF ? ', ' + ASOF : '') + ' (intraday)' : ' (Schlusskurs)'));
    parts.push('Tagesschlusskurse in ' + (META.currency || 'EUR'));
    if (META.positions_ref_date) parts.push('Stückzahlen vom ' + F.date(META.positions_ref_date, 'short'));
    $('metaLine').textContent = parts.join(' · ');
    $('metaLine').title = parts.join(' · ');          // full text when the sticky bar cuts it on phones
  }

  function renderRangeBar() {
    var R = cur.R;
    Array.prototype.forEach.call($('rangeTabs').querySelectorAll('[data-preset]'), function (b) {
      var on = !state.custom && state.preset === b.getAttribute('data-preset');
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    dfFrom.limits(ctx.dates[0], ctx.dates[ctx.n - 1]);
    dfTo.limits(ctx.dates[0], ctx.dates[ctx.n - 1]);
    dfFrom.set(state.custom ? state.custom.from : ctx.dates[R.start]);    // skipped while the field is being edited
    dfTo.set(state.custom ? state.custom.to : ctx.dates[R.end]);
    $('dateRange').classList.toggle('is-custom', !!state.custom);
  }

  function renderMode() {
    Array.prototype.forEach.call($('modeToggle').querySelectorAll('[data-mode]'), function (b) {
      var on = b.getAttribute('data-mode') === state.mode;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function renderSettings(M) {
    var inp = $('startValue');
    inp.placeholder = M.p && M.p.raw ? num(M.p.raw[0], 2) : '–';
    var hint = $('scaleHint');
    if (!inp.classList.contains('is-invalid')) {
      hint.classList.remove('is-error');
      hint.textContent = state.startValue != null && M.p && isNum(M.p.scale) ?
        '×' + num(M.p.scale, M.p.scale < 0.1 ? 4 : 2) + ' skaliert' : '';
    }
    $('startReset').hidden = state.startValue == null && !inp.value;
    var dv = $('depotValue'), dd = depotDefault();
    dv.placeholder = isNum(dd) ? num(dd, 2) : '–';
    $('depotReset').hidden = state.depotValue == null && !dv.value;
    renderBenchCards(M);
  }

  // ------------------------------------------------------------------ benchmark builder (cards like testfolio.io)
  /*
   * Locked cards = data/benchmarks.csv (Mein Depot: the real quantities, not editable, can only be shown / hidden).
   * Own cards = instruments with prices (D.instruments) + percentages. The engine buys them on the first day of the
   * selected period (1T: at the previous close) and holds them, no rebalancing. A card is drawn / used anywhere only
   * with a total of 100 % (± 0,01) and at least one instrument. Nothing is persisted.
   * Rendering: a card's DOM is rebuilt only when its rows change (add / remove / clear); typing only patches the
   * derived parts (return, total, hint), so the field being edited keeps its focus and caret.
   */
  var cardSeq = 0, rowSeq = 0, noOpen = false;
  var SVG = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var EYE = '<path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>';
  var ICONS = {
    eye: SVG + EYE + '</svg>',
    eyeOff: SVG + EYE + '<path d="M2.5 13.5l11-11"/></svg>',
    copy: SVG + '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>',
    trash: SVG + '<path d="M2.5 4.5h11M6.5 4.5V3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1.5M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6M6.8 7v4.5M9.2 7v4.5"/></svg>',
    reset: SVG + '<path d="M2.8 7.5a5.2 5.2 0 1 0 1.6-3.6"/><path d="M2.5 1.8v2.9h2.9"/></svg>'
  };

  /** Instruments a card can hold: D.instruments (every price column), only those with at least one quote. */
  var INSTR = (Array.isArray(D.instruments) ? D.instruments : [])
    .filter(function (i) { return i && i.isin && ctx0.firstIdx && ctx0.firstIdx[i.isin] < ctx0.n; })
    .map(function (i) { return { isin: i.isin, name: String(i.name || i.short || i.isin), short: String(i.short || i.name || i.isin), type: i.type || '' }; })
    .sort(function (a, b) { return a.short.localeCompare(b.short, 'de'); });
  var INSTR_BY = {};
  INSTR.forEach(function (i) { INSTR_BY[i.isin] = i; });
  var TODAY = ctx0.dates[ctx0.n - 1];
  /**
   * {ISIN: fraction} -> rows [{isin, pct}] by weight desc, 2 decimals that add up to exactly 100 (largest remainder,
   * a tiny holding keeps at least 0,01 %; display only – the unedited card uses the exact quantities).
   */
  function shareRows(w) {
    var list = Object.keys(w || {}).filter(function (i) { return INSTR_BY[i] && w[i] > 0; })
      .map(function (i) { var c = w[i] * 10000, f = Math.floor(c); return { isin: i, c: Math.max(1, f), rest: f ? c - f : -1, w: w[i] }; })
      .sort(function (a, b) { return b.w - a.w; });
    var left = 10000 - list.reduce(function (s, r) { return s + r.c; }, 0);
    list.slice().sort(function (a, b) { return b.rest - a.rest; }).forEach(function (r) { if (left > 0) { r.c++; left--; } });
    for (var k = 0; left < 0 && list.length; k = (k + 1) % list.length) if (list[k].c > 1) { list[k].c--; left++; }
    return list.map(function (r) { return { isin: r.isin, pct: fmtShare(r.c / 100) }; });
  }
  // holdings presets of data/benchmarks.csv ("Mein Depot"; user 27.09.: editable like the other cards). Their rows are the
  // value shares on the last day and start as the fetched allocation; unedited the card uses the real quantities, edited
  // shares become constant quantities (engine.holdingsFromWeights, backcast like the positions). Not deletable.
  ctx0.benchmarks.forEach(function (b) {
    var def = shareRows(E.benchmarkWeights ? E.benchmarkWeights(ctx0, b) : null);
    if (!def.length) return;
    var name = String(b.name || b.id);
    state.cards.push({ id: b.id, hold: true, base: b, name: name, defName: name, color: colorOf(b.id), show: b.id === DEPOT_ID,
      def: def, rows: def.map(function (r) { return newRow(r.isin, r.pct); }) });
  });
  // weighting presets (data/benchmarks.csv "ISIN:20%|…", e.g. "Energie"; user 27.09.): start as own cards – editable,
  // deletable, hidden in the chart; a reload brings them back as defined
  (Array.isArray(D.card_presets) ? D.card_presets : []).forEach(function (p) {
    var rows = Object.keys(p.weights || {}).filter(function (i) { return INSTR_BY[i]; })
      .map(function (i) { return newRow(i, fmtShare(p.weights[i])); });
    if (!rows.length) return;
    var name = String(p.name || nextName()).slice(0, 40);
    state.cards.push({ id: 'bm' + (++cardSeq), name: name, defName: name, color: nextColor(), show: false, rows: rows });
  });
  function instrSub(i) { return [i.name, i.isin, i.type].filter(Boolean).join(' · '); }
  function insTitle(i) { return i ? i.short + ' · ' + instrSub(i) : 'Name, Kürzel oder ISIN eingeben'; }
  function words(s) { return ' ' + s.replace(/[^a-z0-9äöüß]+/g, ' '); }
  /** Case-insensitive on short name, name and ISIN: prefix matches first, then word starts, then any substring. */
  function searchInstr(q, ex) {
    q = q.trim().toLowerCase();
    var qw = words(q).replace(/\s+$/, ''), rk = [[], [], [], []];
    INSTR.forEach(function (i) {
      if (ex[i.isin]) return;
      var s = i.short.toLowerCase(), n = i.name.toLowerCase(), c = i.isin.toLowerCase();
      if (!q || s.indexOf(q) === 0) rk[0].push(i);
      else if (n.indexOf(q) === 0 || c.indexOf(q) === 0) rk[1].push(i);
      else if (qw.length > 1 && words(s + ' ' + n).indexOf(qw) >= 0) rk[2].push(i);
      else if (s.indexOf(q) >= 0 || n.indexOf(q) >= 0 || c.indexOf(q) >= 0) rk[3].push(i);
    });
    return rk[0].concat(rk[1], rk[2], rk[3]);
  }

  function cardById(id) { for (var k = 0; k < state.cards.length; k++) if (state.cards[k].id === id) return state.cards[k]; return null; }
  function rowById(c, id) { for (var k = 0; k < c.rows.length; k++) if (c.rows[k].id === id) return c.rows[k]; return null; }
  function newRow(isin, pctText) {
    var i = isin ? INSTR_BY[isin] : null;
    return { id: 'r' + (++rowSeq), isin: i ? i.isin : null, q: i ? i.short : '', pct: pctText || '' };
  }
  function nextColor() {
    var used = {};
    ctx.benchmarks.forEach(function (b) { used[colorOf(b.id)] = 1; });
    state.cards.forEach(function (c) { used[c.color] = 1; });
    for (var k = 0; k < BENCH_COLORS.length; k++) if (!used[BENCH_COLORS[k]]) return BENCH_COLORS[k];
    return BENCH_COLORS[cardSeq % BENCH_COLORS.length];          // more cards than colours
  }
  function nextName(except) {
    var taken = {};
    state.cards.forEach(function (c) { if (c !== except) taken[c.name.trim() || c.defName] = 1; });
    for (var k = 1; ; k++) if (!taken['Benchmark ' + k]) return 'Benchmark ' + k;
  }
  /** Name emptied and left: its default name, or the next free "Benchmark N" when another card uses that meanwhile. */
  function defaultName(c) {
    var clash = state.cards.some(function (o) { return o !== c && cardName(o) === c.defName; });
    return clash ? nextName(c) : c.defName;
  }
  function cardName(c) { return c.name.trim() || c.defName; }
  /** Percent field: German decimal ("12,5"), empty = 0; null = invalid. */
  function pctVal(t) {
    t = String(t == null ? '' : t).trim();
    if (!t) return 0;
    var v = F.parseDE(t);
    return isNum(v) && v >= 0 ? v : null;
  }
  /** 100 -> "100", 12.5 -> "12,5", 49.985 -> "49,985" (3 decimals, so a total just outside ± 0,01 never shows as valid) */
  function fmtShare(v) {
    var s = (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '');
    return F.num(+s, (s.split('.')[1] || '').length);
  }
  /** Bookkeeping of a card's inputs: total % (plain sum of the rows), weights {ISIN: %}, validity and the footer hint. */
  function cardInfo(c) {
    var total = 0, weights = {}, nIns = 0, bad = false, orphan = false;
    c.rows.forEach(function (r) {
      var v = pctVal(r.pct);
      if (v === null) { bad = true; return; }
      total += v;
      if (v > 0 && r.isin) { weights[r.isin] = (weights[r.isin] || 0) + v; nIns++; } else if (v > 0) orphan = true;
    });
    var ok100 = !bad && Math.abs(total - 100) <= 0.01 + 1e-9;
    var hint = bad ? 'Ungültige Prozentzahl (z. B. 12,5)' :
      !ok100 ? (total < 100 ? 'Noch ' + fmtShare(100 - total) + ' % verteilen' : fmtShare(total - 100) + ' % zu viel') :
      orphan ? 'Instrument fehlt' : !nIns ? 'Instrument wählen' : '';
    return { total: total, weights: weights, ok100: ok100, valid: !hint, hint: hint };
  }
  /** A holdings card still holds its fetched allocation (same instruments, same shares as its default rows). */
  function isDefault(c, info) {
    if (!c.hold) return false;
    var w = (info || cardInfo(c)).weights, d = {};
    c.def.forEach(function (r) { if (pctVal(r.pct) > 0) d[r.isin] = pctVal(r.pct); });
    var ks = Object.keys(w);
    return ks.length === Object.keys(d).length && ks.every(function (i) { return isNum(d[i]) && Math.abs(d[i] - w[i]) < 1e-9; });
  }
  /**
   * What compute() hands the engine: every valid card; invalid cards are left out everywhere. Own cards as {id, name,
   * weights} (bought at the period start); holdings cards unedited as their preset (the real quantities), edited as
   * constant quantities from today's shares.
   */
  function benchDefs() {
    var out = [];
    state.cards.forEach(function (c) {
      var info = cardInfo(c);
      if (!info.valid) return;
      var desc = c.rows.filter(function (r) { return r.isin && pctVal(r.pct) > 0; }).map(function (r) {
        return fmtShare(pctVal(r.pct)) + ' % ' + INSTR_BY[r.isin].short;
      }).join(' · ');
      var b, real = false;
      if (c.hold) {
        real = isDefault(c, info);
        var h = real ? null : E.holdingsFromWeights(ctx0, info.weights);
        if (!real && !h) return;
        b = real ? c.base : { id: c.id, name: cardName(c), holdings: h,
          description: desc + ' – Anteile am ' + F.date(TODAY, 'short') + ', Stückzahlen konstant' };
      } else {
        b = { id: c.id, name: cardName(c), weights: info.weights, description: desc + ' – am ersten Tag des Zeitraums gekauft, dann gehalten' };
      }
      out.push({ b: b, id: c.id, name: cardName(c), color: c.color, show: c.show, hold: !!c.hold, real: real && c.id === REAL_ID });
    });
    return out;
  }

  function iconBtn(act, icon, label, extra) {
    return '<button type="button" class="bb-ico" data-act="' + act + '" title="' + esc(label) + '" aria-label="' + esc(label) + '"' +
      (extra || '') + '>' + ICONS[icon] + '</button>';
  }
  function showBtn() { return iconBtn('show', 'eye', 'Im Chart ausblenden', ' aria-pressed="true"'); }
  function barHTML() {
    return '<div class="bb-bar"><button type="button" class="bb-mini" data-act="addrow" title="Zeile hinzufügen" aria-label="Zeile hinzufügen">+</button>' +
      '<button type="button" class="bb-mini" data-act="clear" title="Alle Zeilen leeren" aria-label="Alle Zeilen leeren">×</button></div>';
  }
  /** "Mein Depot" (holdings preset): like an own card, but fixed name, rows = today's shares, reset to the fetched allocation instead of duplicate / delete. */
  function holdCardHTML(c) {
    return '<div class="bb-card bb-card--hold" role="group" data-card="' + esc(c.id) + '" style="--c:' + c.color + '">' +
      '<div class="bb-top"><span class="bb-lbl"><i class="bb-dot"></i><span class="bb-kind"></span></span><span class="bb-icons">' +
      iconBtn('reset', 'reset', 'Echte Aufteilung wiederherstellen') + showBtn() + '</span></div>' +
      '<div class="bb-namerow"><span class="bb-fixname">' + esc(c.name) + '</span><b class="bb-ret"></b></div>' +
      '<div class="bb-meta"></div>' + barHTML() +
      '<div class="bb-rows">' + c.rows.map(rowHTML).join('') + '</div>' +
      '<div class="bb-foot"><span class="bb-hint" aria-live="polite"></span><span class="bb-total"></span></div></div>';
  }
  function rowHTML(r, k) {
    var i = r.isin ? INSTR_BY[r.isin] : null;
    return '<div class="bb-row" data-row="' + r.id + '">' +
      '<input type="text" class="bb-ins" data-f="ins" value="' + esc(r.q) + '" placeholder="Instrument suchen" autocomplete="off" spellcheck="false"' +
      ' role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="bbDrop" aria-label="Instrument ' + (k + 1) + '" title="' + esc(insTitle(i)) + '">' +
      '<span class="bb-pctw"><input type="text" class="bb-pct" data-f="pct" value="' + esc(r.pct) + '" placeholder="0" inputmode="decimal" autocomplete="off"' +
      ' spellcheck="false" aria-label="Anteil ' + (k + 1) + ' in Prozent"><span class="bb-pcts" aria-hidden="true">%</span></span>' +
      '<button type="button" class="bb-x" data-act="delrow" title="Zeile entfernen" aria-label="Zeile ' + (k + 1) + ' entfernen">×</button></div>';
  }
  function cardHTML(c) {
    return '<div class="bb-card" role="group" data-card="' + c.id + '" style="--c:' + c.color + '">' +
      '<div class="bb-top"><label class="bb-lbl" for="bbn-' + c.id + '"><i class="bb-dot"></i>Name</label><span class="bb-icons">' +
      showBtn() + iconBtn('dup', 'copy', 'Duplizieren') + iconBtn('del', 'trash', 'Löschen') + '</span></div>' +
      '<div class="bb-namerow"><input type="text" class="bb-name" id="bbn-' + c.id + '" data-f="name" value="' + esc(c.name) + '" placeholder="' +
      esc(c.defName) + '" maxlength="40" autocomplete="off" spellcheck="false"><b class="bb-ret"></b></div>' + barHTML() +
      '<div class="bb-rows">' + c.rows.map(rowHTML).join('') + '</div>' +
      '<div class="bb-foot"><span class="bb-hint" aria-live="polite"></span><span class="bb-total"></span></div></div>';
  }
  function makeEl(html) { var t = document.createElement('div'); t.innerHTML = html; return t.firstChild; }
  function cardSig(c) { return c.rows.map(function (r) { return r.id; }).join(','); }

  /** Builds missing / structurally changed cards (every other card and the field being typed in stay), then patches the derived parts. */
  function renderBenchCards(M) {
    var box = $('benchCards'), old = {}, prev = null;
    Array.prototype.forEach.call(box.children, function (el) { if (el.hasAttribute('data-card')) old[el.getAttribute('data-card')] = el; });
    var list = state.cards.map(function (c) { return { id: c.id, c: c }; });
    list.forEach(function (o) {
      var el = old[o.id], sig = cardSig(o.c);
      if (!el || el._sig !== sig) {
        var nu = makeEl(o.c.hold ? holdCardHTML(o.c) : cardHTML(o.c));
        nu._sig = sig;
        if (el) box.replaceChild(nu, el);
        el = nu;
      }
      delete old[o.id];
      var at = prev ? prev.nextSibling : box.firstChild;
      if (el !== at) box.insertBefore(el, at);
      prev = el;
      patchCard(el, o, M);
    });
    Object.keys(old).forEach(function (id) { box.removeChild(old[id]); });
    var add = box.querySelector('.bb-add') ||
      makeEl('<button type="button" class="bb-add" data-act="new" title="Eigene Benchmark aus Instrumenten und Anteilen anlegen">' +
        '<span aria-hidden="true">+</span>Benchmark</button>');
    if (box.lastChild !== add) box.appendChild(add);
    if (drop) {
      if (!drop.inp.isConnected) closeDrop();
      else { placeDrop(); requestAnimationFrame(placeDrop); }     // again once the rest of update() (legend above the chart) may have moved the cards
    }
  }
  function patchCard(el, o, M) {
    var c = o.c, x = M && M.byId[o.id], shown = c.show, r = x ? get(x.st, 'totalReturn') : null;
    el.classList.toggle('is-hidden', !shown);
    el.setAttribute('aria-label', 'Benchmark ' + cardName(c));
    var sb = el.querySelector('[data-act="show"]');
    if (sb.getAttribute('aria-pressed') !== String(shown)) {
      var lbl = shown ? 'Im Chart ausblenden' : 'Im Chart einblenden';
      sb.setAttribute('aria-pressed', String(shown));
      sb.setAttribute('aria-label', lbl);
      sb.title = lbl;
      sb.innerHTML = ICONS[shown ? 'eye' : 'eyeOff'];
    }
    var rb = el.querySelector('.bb-ret');
    rb.className = 'bb-ret ' + sgn(r);
    rb.textContent = pct(r);
    rb.title = x ? 'Rendite im Zeitraum ' + periodText(M.R) + (shown ? '' : ' (im Chart ausgeblendet)') : 'wird erst bei 100 % berechnet';
    var info = cardInfo(c), tot = el.querySelector('.bb-total'), hint = el.querySelector('.bb-hint');
    el.classList.toggle('is-invalid', !info.valid);
    tot.textContent = fmtShare(info.total) + ' %';
    tot.className = 'bb-total ' + (info.ok100 ? 'is-ok' : 'is-bad');
    hint.className = 'bb-hint' + (info.valid ? '' : ' is-bad');
    hint.textContent = !info.valid ? info.hint : c.hold ? 'Anteile am ' + F.date(TODAY, 'dayMonthShort') + ', Stückzahlen konstant' :
      'Kauf am ' + F.date(ctx.dates[M.R.start], 'short') + ', dann gehalten';
    if (c.hold) patchHold(el, c, info);
    c.rows.forEach(function (rw) {
      var p = el.querySelector('[data-row="' + rw.id + '"] .bb-pct');
      if (!p) return;
      var bad = pctVal(rw.pct) === null;
      p.classList.toggle('is-invalid', bad);
      if (bad) p.setAttribute('aria-invalid', 'true'); else p.removeAttribute('aria-invalid');
    });
    var ni = el.querySelector('.bb-name');
    if (ni && document.activeElement !== ni && ni.value !== c.name) ni.value = c.name;
  }
  /** Holdings card: kind label, value line and the reset button follow whether the fetched allocation was edited. */
  function patchHold(el, c, info) {
    var dflt = isDefault(c, info), depot = c.id === DEPOT_ID, meta = el.querySelector('.bb-meta'), rs = el.querySelector('[data-act="reset"]');
    var now = dflt && E.benchmarkValueNow ? nv(E.benchmarkValueNow(ctx0, c.base)) : null, day = F.date(TODAY, 'short');
    el.querySelector('.bb-kind').textContent = (depot ? 'Echtes Depot' : 'Feste Stückzahlen') + (dflt ? '' : ' · geändert');
    meta.innerHTML = dflt ? (depot ? 'Echte' : 'Feste') + ' Stückzahlen' + (now !== null ? ' · Wert <b>' + eur(now) + '</b> am ' + esc(day) : '') :
      'Geändert: Stückzahlen aus den Anteilen am ' + esc(day) + ', rückwirkend konstant';
    meta.title = dflt ? 'Stückzahlen × letzter Kurs, ohne Cash' : 'Wie beim Portfolio: die Stückzahlen, die heute diese Anteile ergeben, gelten für den ganzen Zeitraum';
    if (rs.hidden !== dflt) rs.hidden = dflt;
  }

  // card actions (structure changes re-render the card, then the focus goes to the matching control)
  function benchChanged() { update({ keepMeasure: true }); }
  function focusCard(id, sel, open, select) {
    var el = $('benchCards').querySelector('[data-card="' + id + '"]'), t = el && el.querySelector(sel);
    if (!t) return;
    noOpen = !open;                     // an empty instrument field opens its list on focus – only when asked for
    t.focus();
    noOpen = false;
    if (select && t.select) t.select();
  }
  function addCard() {
    var name = nextName(), c = { id: 'bm' + (++cardSeq), name: name, defName: name, color: nextColor(), show: true, rows: [newRow()] };
    state.cards.push(c);
    benchChanged();
    focusCard(c.id, '.bb-ins', true);
  }
  function dupCard(c) {
    var d = { id: 'bm' + (++cardSeq), name: (cardName(c) + ' (Kopie)').slice(0, 40), defName: nextName(), color: nextColor(), show: true,
      rows: c.rows.map(function (r) { return newRow(r.isin, r.pct); }) };
    state.cards.splice(state.cards.indexOf(c) + 1, 0, d);
    benchChanged();
    focusCard(d.id, '.bb-name', false, true);
  }
  function delCard(c) {
    var k = state.cards.indexOf(c);
    if (drop && drop.cardId === c.id) closeDrop();
    state.cards.splice(k, 1);
    benchChanged();
    var nx = state.cards[k] || state.cards[k - 1], add = $('benchCards').querySelector('.bb-add');
    if (nx) focusCard(nx.id, '[data-act="del"]'); else if (add) add.focus();
  }
  /** Holdings card back to the fetched allocation (its default rows). */
  function resetCard(c) {
    if (drop && drop.cardId === c.id) closeDrop();
    c.rows = c.def.map(function (r) { return newRow(r.isin, r.pct); });
    benchChanged();
    focusCard(c.id, '[data-act="show"]');
  }
  function addRow(c) {
    var r = newRow();
    c.rows.push(r);
    benchChanged();
    focusCard(c.id, '[data-row="' + r.id + '"] .bb-ins', true);
  }
  function clearRows(c) {
    if (drop && drop.cardId === c.id) closeDrop();
    c.rows = [newRow()];
    benchChanged();
    focusCard(c.id, '.bb-ins', true);
  }
  function delRow(c, r) {
    var k = c.rows.indexOf(r), only = c.rows.length === 1;
    if (drop && drop.rowId === r.id) closeDrop();
    if (only) c.rows = [newRow()]; else c.rows.splice(k, 1);
    benchChanged();
    var nx = c.rows[Math.min(k, c.rows.length - 1)];
    focusCard(c.id, '[data-row="' + nx.id + '"] ' + (only ? '.bb-ins' : '.bb-x'), false);
  }

  // instrument field = search combobox; its list is one overlay element on <body>, so no card can clip it
  var drop = null;                     // open list: { inp, cardId, rowId, items, hi }
  var dropEl = document.createElement('div');
  dropEl.className = 'bb-drop';
  dropEl.id = 'bbDrop';
  dropEl.setAttribute('role', 'listbox');
  dropEl.setAttribute('aria-label', 'Instrumente');
  dropEl.hidden = true;
  document.body.appendChild(dropEl);

  function ctxOf(t) {
    var el = t && t.closest ? t.closest('[data-card]') : null, c = el ? cardById(el.getAttribute('data-card')) : null;
    var rw = c && t.closest('[data-row]'), r = rw ? rowById(c, rw.getAttribute('data-row')) : null;
    return { id: el ? el.getAttribute('data-card') : null, c: c, r: r };
  }
  function excluded(c, r) { var ex = {}; c.rows.forEach(function (o) { if (o !== r && o.isin) ex[o.isin] = 1; }); return ex; }
  function isDirty(t) { var o = ctxOf(t), i = o.r && o.r.isin ? INSTR_BY[o.r.isin] : null; return t.value.trim() !== (i ? i.short : ''); }
  function liveIns(c, r) { return $('benchCards').querySelector('[data-card="' + c.id + '"] [data-row="' + r.id + '"] .bb-ins'); }
  function setIns(c, r, i) {
    var changed = (r.isin || null) !== (i ? i.isin : null), el = liveIns(c, r);
    r.isin = i ? i.isin : null;
    r.q = i ? i.short : '';
    if (el) { el.value = r.q; el.title = insTitle(i); }
    if (changed) benchChanged();
  }
  /** Leaving a field: an exact short name / ISIN picks that instrument, an empty field removes it, anything else is reverted. */
  function commitIns(t) {
    var o = ctxOf(t);
    if (!o.c || !o.r) return;                 // card / row removed meanwhile
    var sel = o.r.isin ? INSTR_BY[o.r.isin] : null, q = t.value.trim(), ql = q.toLowerCase(), ex = excluded(o.c, o.r);
    if (sel && q === sel.short) return;
    if (!q) { setIns(o.c, o.r, null); return; }
    var hit = INSTR.filter(function (i) { return !ex[i.isin] && (i.short.toLowerCase() === ql || i.isin.toLowerCase() === ql); });
    setIns(o.c, o.r, hit.length === 1 ? hit[0] : sel);
  }
  function openDrop(t) {
    var o = ctxOf(t);
    if (!o.c || !o.r) return;
    var sel = o.r.isin ? INSTR_BY[o.r.isin] : null, q = t.value.trim();
    var filter = sel && q === sel.short ? '' : q;               // unchanged field: the whole list, the current instrument marked
    var items = searchInstr(filter, excluded(o.c, o.r)), hi = 0;
    if (!filter && sel) items.forEach(function (i, k) { if (i.isin === sel.isin) hi = k; });
    if (drop && drop.inp !== t) closeDrop();
    drop = { inp: t, cardId: o.c.id, rowId: o.r.id, items: items, hi: hi };
    dropEl.innerHTML = items.length ? items.map(function (i, k) {
      return '<div class="bb-opt' + (sel && i.isin === sel.isin ? ' is-sel' : '') + '" role="option" id="bbo-' + k + '" data-k="' + k +
        '" aria-selected="false"><b>' + esc(i.short) + '</b><span>' + esc(instrSub(i)) + '</span></div>';
    }).join('') : '<div class="bb-empty">' + (searchInstr(filter, {}).length ? 'Schon in dieser Benchmark enthalten' :
      'Kein Instrument mit Kursdaten gefunden') + '</div>';
    dropEl.hidden = false;
    t.setAttribute('aria-expanded', 'true');
    placeDrop();
    setHi(hi);
  }
  function closeDrop() {
    if (!drop) return;
    drop.inp.setAttribute('aria-expanded', 'false');
    drop.inp.removeAttribute('aria-activedescendant');
    drop = null;
    dropEl.hidden = true;
    dropEl.innerHTML = '';
  }
  function setHi(k) {
    var n = drop ? drop.items.length : 0;
    if (!n) { if (drop) drop.inp.removeAttribute('aria-activedescendant'); return; }
    k = ((k % n) + n) % n;
    var old = dropEl.querySelector('.is-hi'), el = dropEl.children[k];
    if (old) { old.classList.remove('is-hi'); old.setAttribute('aria-selected', 'false'); }
    drop.hi = k;
    el.classList.add('is-hi');
    el.setAttribute('aria-selected', 'true');
    drop.inp.setAttribute('aria-activedescendant', el.id);
    if (el.offsetTop < dropEl.scrollTop) dropEl.scrollTop = el.offsetTop;            // keep it in view without scrolling the page
    else if (el.offsetTop + el.offsetHeight > dropEl.scrollTop + dropEl.clientHeight) dropEl.scrollTop = el.offsetTop + el.offsetHeight - dropEl.clientHeight;
  }
  function pick(k) {
    var i = drop && drop.items[k], c = drop && cardById(drop.cardId), r = c && rowById(c, drop.rowId);
    closeDrop();
    if (!i || !r) return null;
    setIns(c, r, i);
    return { c: c, r: r };
  }
  /** After a pick: on to the percent field of the same row. */
  function toPct(o) { if (o) focusCard(o.c.id, '[data-row="' + o.r.id + '"] .bb-pct', false, true); }
  /** Below the field (above when there is more room there), at least 340 px wide, inside the window. */
  function placeDrop() {
    if (!drop) return;
    var row = drop.inp.closest('.bb-row') || drop.inp, rr = row.getBoundingClientRect(), ir = drop.inp.getBoundingClientRect();
    var sc = drop.inp.closest('.bb-rows'), sr = sc ? sc.getBoundingClientRect() : null;
    if (!ir.width || (sr && (ir.bottom < sr.top + 4 || ir.top > sr.bottom - 4))) { closeDrop(); return; }   // scrolled out of its card
    var vv = window.visualViewport, bar = $('topBar');
    var vw = document.documentElement.clientWidth, vh = vv ? Math.min(window.innerHeight, vv.offsetTop + vv.height) : window.innerHeight;  // above an on-screen keyboard
    var w = Math.min(Math.max(rr.width, 340), vw - 16), left = Math.max(8, Math.min(rr.left, vw - 8 - w));
    dropEl.style.width = w + 'px';
    dropEl.style.maxHeight = 'none';
    var need = Math.min(dropEl.scrollHeight + dropEl.offsetHeight - dropEl.clientHeight, 320), below = vh - ir.bottom - 12;   // + borders
    var above = ir.top - (bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0) - 12;
    var up = below < need && above > below, h = Math.max(96, Math.min(need, up ? above : below));
    dropEl.style.maxHeight = h + 'px';
    dropEl.style.left = (left + window.pageXOffset) + 'px';
    dropEl.style.top = ((up ? ir.top - 4 - Math.min(h, need) : ir.bottom + 4) + window.pageYOffset) + 'px';
  }
  function insKey(ev, t) {
    var k = ev.key, open = !!drop && drop.inp === t;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      ev.preventDefault();
      if (!open) openDrop(t); else setHi(drop.hi + (k === 'ArrowDown' ? 1 : -1));
    } else if (k === 'Enter') {
      ev.preventDefault();
      if (open && drop.items.length) toPct(pick(drop.hi)); else { closeDrop(); commitIns(t); }
    } else if (k === 'Escape' || k === 'Esc') {
      if (!open && !isDirty(t)) return;          // nothing to undo: Esc goes on to the chart (clears a measurement)
      ev.preventDefault();
      ev.stopPropagation();
      closeDrop();
      var o = ctxOf(t);
      if (o.r) { o.r.q = o.r.isin ? INSTR_BY[o.r.isin].short : ''; t.value = o.r.q; }
    } else if (k === 'Tab') {
      if (open && isDirty(t) && drop.items.length) pick(drop.hi); else closeDrop();   // focus then moves on to the percent field
    }
  }

  function bindBench() {
    var box = $('benchCards');
    box.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-act]'), t = ev.target;
      if (!b) {
        if (t.classList.contains('bb-ins') && !(drop && drop.inp === t)) openDrop(t);   // click into a field: the list
        return;
      }
      var act = b.getAttribute('data-act'), o = ctxOf(b);
      if (act === 'new') { addCard(); return; }
      if (!o.c) return;
      if (act === 'show') { o.c.show = !o.c.show; benchChanged(); return; }
      if (act === 'reset') { resetCard(o.c); return; }
      if (act === 'dup' && !o.c.hold) dupCard(o.c);
      else if (act === 'del' && !o.c.hold) delCard(o.c);
      else if (act === 'addrow') addRow(o.c);
      else if (act === 'clear') clearRows(o.c);
      else if (act === 'delrow' && o.r) delRow(o.c, o.r);
    });
    box.addEventListener('input', function (ev) {
      var t = ev.target, f = t.getAttribute('data-f'), o = ctxOf(t), was;
      if (!o.c) return;
      if (f === 'ins' && o.r) { o.r.q = t.value; openDrop(t); return; }
      was = cardInfo(o.c).valid;
      if (f === 'name') o.c.name = t.value;
      else if (f === 'pct' && o.r) o.r.pct = t.value;
      else return;
      if (was || cardInfo(o.c).valid) benchChanged();              // an invalid card stays out of everything: only its footer changes
      else patchCard(t.closest('[data-card]'), { id: o.c.id, c: o.c }, cur);
    });
    box.addEventListener('keydown', function (ev) {
      var t = ev.target, f = t.getAttribute('data-f'), o;
      if (f === 'ins') { insKey(ev, t); return; }
      if (ev.key !== 'Enter' || (f !== 'pct' && f !== 'name')) return;
      o = ctxOf(t);
      if (!o.c) return;
      ev.preventDefault();
      if (f === 'name') focusCard(o.c.id, '.bb-ins', false);
      else if (o.r === o.c.rows[o.c.rows.length - 1] && cardInfo(o.c).total < 100) addRow(o.c);   // Enter in the last row: next row
    });
    box.addEventListener('focusin', function (ev) {
      var t = ev.target, o;
      if (noOpen || !t.classList.contains('bb-ins') || (drop && drop.inp === t)) return;
      o = ctxOf(t);
      if (o.r && !o.r.isin && !t.value.trim()) openDrop(t);       // empty field: show the list right away
    });
    box.addEventListener('focusout', function (ev) {
      var t = ev.target, f = t.getAttribute('data-f'), o;
      if (f === 'ins') {
        setTimeout(function () {
          if (document.activeElement === t) return;
          if (drop && drop.inp === t) closeDrop();
          commitIns(t);
        }, 0);
      } else if (f === 'name') {
        o = ctxOf(t);
        if (o.c && !o.c.name.trim()) { o.c.name = o.c.defName = defaultName(o.c); t.value = o.c.name; t.placeholder = o.c.defName; benchChanged(); }
      }
    });
    dropEl.addEventListener('mousedown', function (ev) { ev.preventDefault(); });          // the field keeps the focus
    dropEl.addEventListener('click', function (ev) {
      var it = ev.target.closest('[data-k]');
      if (it && drop) toPct(pick(+it.getAttribute('data-k')));
    });
    dropEl.addEventListener('mousemove', function (ev) {
      var it = ev.target.closest('[data-k]');
      if (it && drop && +it.getAttribute('data-k') !== drop.hi) setHi(+it.getAttribute('data-k'));
    });
    window.addEventListener('resize', placeDrop);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', placeDrop);
    box.addEventListener('scroll', function () { if (drop) placeDrop(); }, true);     // rows scroll inside a card: the list follows
  }

  function renderHeadline(M) {
    var s = M.ps, R = M.R, main = $('hlMain'), sub = $('hlSub'), note = state.custom ? '' : clipNote(state.preset, R);
    if (M.intra && M.intra.oneT) note = IV_LONG[M.intra.key] + ' bis ' + F.asofBerlin(M.intra.asof) + ' Uhr' +
      (M.intra.missing.length ? ', ' + M.intra.missing.length + ' Werte ohne Intraday-Kurse' : '');
    var period = 'im Zeitraum ' + periodText(R) + (note ? ' <span class="weak">(' + esc(note) + ')</span>' : '');
    if (!M.p || !s) {
      // actionable: the button switches „Einzelwerte“ on (also when hidden), scrolls to it and focuses the next step (openAssets)
      var zero = state.selected.size && ctx !== ctx0;
      main.hidden = false;
      main.innerHTML = '<span class="hl-empty"><span class="weak">' + esc(zero ? 'Keine Bestände in der Auswahl' : 'Keine Position ausgewählt') + '</span>' +
        '<button type="button" class="hl-act" data-hl-act="assets">' + (zero ? 'Stück anpassen' : 'Positionen auswählen') + '</button></span>';
      sub.innerHTML = (zero ? 'Was-wäre-wenn: alle ausgewählten Positionen stehen auf 0 Stück · ' : 'Auswahl über die Liste „Einzelwerte“ · ') + period;
      $('legend').innerHTML = '';
      return;
    }
    // no big figure here (user, 27.09.: the overview block above already shows the value) – only the line with the period
    main.hidden = true;
    main.innerHTML = '';
    if (state.mode === 'value') {
      sub.innerHTML = colored(s.pl, eurS(s.pl) + ' (' + pct(s.totalReturn) + ')') + ' ' + period;
    } else {
      sub.innerHTML = colored(s.totalReturn, pct(s.totalReturn)) + ' ' + period + ' · Endwert ' + eur(s.endValue);
    }
    var lg = '<span class="lg-item" style="--c:var(--accent)"><i></i><span>' + (M.orig ? 'Was-wäre-wenn' : 'Portfolio') + '</span>' +
      '<b class="' + sgn(s.totalReturn) + '">' + pct(s.totalReturn) + '</b></span>';
    if (M.orig) {
      var ro = get(M.origStats, 'totalReturn');
      lg += '<span class="lg-item lg-item--ghost"><i></i><span>Original</span><b class="' + sgn(ro) + '">' + pct(ro) + '</b></span>';
    }
    M.selB.forEach(function (x) {
      var r = get(x.st, 'totalReturn');
      lg += '<span class="lg-item" style="--c:' + x.color + '"><i></i><span>' + esc(x.name) + '</span><b class="' + sgn(r) + '">' +
        pct(r) + '</b></span>';
    });
    $('legend').innerHTML = lg;
  }

  // ------------------------------------------------------------------ KPI cards
  function card(o) {
    return '<div class="kpi' + (o.weak ? ' is-weak' : '') + '" title="' + esc(o.title) + '">' +
      '<div class="kpi-label">' + esc(o.label) + '</div>' +
      '<div class="kpi-value">' + o.value + '</div>' +
      (o.extra ? '<div class="kpi-extra">' + o.extra + '</div>' : '') +
      (o.bench ? '<div class="kpi-bench">' + o.bench + '</div>' : '') +
      '</div>';
  }

  function currentDDExtra(M) {
    var s = M.ps, dd = M.pdd && M.pdd.dd;
    if (!s || !dd || !isNum(s.currentDD)) return '';
    if (s.currentDD >= 0) return 'auf Höchststand';
    for (var k = dd.length - 1; k >= 0; k--) {
      if (isNum(dd[k]) && dd[k] >= 0) return 'unter dem Hoch vom ' + esc(F.date(ctx.dates[M.R.start + k], 'short'));
    }
    return '';
  }

  function renderKpis(M) {
    var s = M.ps, x0 = M.selB[0] || null, b = x0 ? x0.st : null;
    $('kpiSub').textContent = 'Zeitraum ' + periodText(M.R) + (x0 ? ' · untere Zeile: ' + x0.name : '');
    function bench(text) {
      return x0 ? '<i style="background:' + x0.color + '"></i><span>' + esc(x0.name) + ': ' + text + '</span>' : '';
    }
    var weak = !!(s && !s.cagrReliable);
    var bd = s && s.bestDay, wd = s && s.worstDay, bbd = b && b.bestDay, bwd = b && b.worstDay;
    var ddExtra = '';
    if (s && isNum(s.maxDD)) {
      ddExtra = s.maxDD < 0 ?
        esc(dshort(s.maxDDPeakDate) + ' → ' + dshort(s.maxDDTroughDate)) + ' · ' +
        (s.maxDDRecoveryDate ? 'erholt ' + esc(dshort(s.maxDDRecoveryDate)) : '<span class="neg">nicht erholt</span>') :
        'kein Rückgang';
    }
    var cards = [
      card({
        label: 'Gesamtrendite', title: 'Endwert / Startwert − 1 · G/V = Endwert − Startwert',
        value: colored(get(s, 'totalReturn'), pct(get(s, 'totalReturn'))),
        extra: s ? colored(s.pl, eurS(s.pl)) : '',
        bench: bench(pct(get(b, 'totalReturn')) + ' · ' + eurS(M.p ? get(b, 'pl') : null))   // € only relative to a portfolio
      }),
      card({
        label: 'Rendite p.a.', title: 'CAGR = (1 + Gesamtrendite)^(365 / Kalendertage) − 1', weak: weak,
        value: weak ? pct(get(s, 'cagr')) : colored(get(s, 'cagr'), pct(get(s, 'cagr'))),
        extra: weak ? '<span class="weak">wenig aussagekräftig &lt; 3 Monate</span>' : (s ? int(s.days) + ' Kalendertage' : ''),
        bench: bench(pct(get(b, 'cagr')))
      }),
      card({
        label: 'Volatilität p.a.', title: 'Standardabweichung der Tagesrenditen (Stichprobe, n − 1) · √252',
        value: pctU(get(s, 'volAnn')), bench: bench(pctU(get(b, 'volAnn')))
      }),
      card({
        label: 'Sharpe-Ratio', title: 'Ø(r − rf_d) / σ(r) · √252 mit rf_d = (1 + rf)^(1/252) − 1',
        value: ratio(get(s, 'sharpe')), extra: 'rf ' + pctU(state.rf, 1) + ' p.a.', bench: bench(ratio(get(b, 'sharpe')))
      }),
      card({
        label: 'Sortino-Ratio', title: 'Ø(r − rf_d) / √(Σ min(0, r − rf_d)² / n) · √252',
        value: ratio(get(s, 'sortino')), extra: 'nur Abwärtsschwankung', bench: bench(ratio(get(b, 'sortino')))
      }),
      card({
        label: 'Max. Drawdown', title: 'größter Rückgang vom laufenden Hoch: min(V_t / max(V_0 … V_t) − 1)',
        value: colored(get(s, 'maxDD'), pctU(get(s, 'maxDD'))), extra: ddExtra, bench: bench(pctU(get(b, 'maxDD')))
      }),
      card({
        label: 'Calmar-Ratio', title: 'Rendite p.a. / |Max. Drawdown|', weak: weak,
        value: ratio(get(s, 'calmar')), extra: weak ? '<span class="weak">beruht auf Rendite p.a.</span>' : '',
        bench: bench(ratio(get(b, 'calmar')))
      }),
      card({
        label: 'VaR 95 % (1 Tag)', title: 'historischer Value at Risk: −(5-%-Quantil der Tagesrenditen) · € = VaR · Endwert',
        value: pctU(get(s, 'var95')), extra: s ? '≈ ' + eur(s.var95EUR, { dec: 0 }) + ' Tagesverlust' : '',
        bench: bench(pctU(get(b, 'var95')))
      }),
      card({
        label: 'CVaR 95 % (1 Tag)', title: 'Expected Shortfall: −Ø der Tagesrenditen ≤ 5-%-Quantil · € = CVaR · Endwert',
        value: pctU(get(s, 'cvar95')), extra: s ? '≈ ' + eur(s.cvar95EUR, { dec: 0 }) + ' Tagesverlust' : '',
        bench: bench(pctU(get(b, 'cvar95')))
      }),
      card({
        label: 'Bester / Schlechtester Tag', title: 'höchste und niedrigste Tagesrendite im Zeitraum',
        value: colored(get(bd, 'ret'), pct(get(bd, 'ret'))) + '<span class="sep"> / </span>' + colored(get(wd, 'ret'), pct(get(wd, 'ret'))),
        extra: s ? esc(dshort(bd && bd.date) + ' / ' + dshort(wd && wd.date)) : '',
        bench: bench(pct(get(bbd, 'ret')) + ' / ' + pct(get(bwd, 'ret')))
      }),
      card({
        label: 'Positive Tage', title: 'Anteil der Handelstage mit Rendite > 0',
        value: pctU(get(s, 'pctPositive'), 1), extra: M.p && M.p.ret ? 'von ' + int(M.p.ret.length) + ' Handelstagen' : '',
        bench: bench(pctU(get(b, 'pctPositive'), 1))
      }),
      card({
        label: 'Aktueller Drawdown', title: 'V_Ende / bisheriges Hoch − 1',
        value: colored(get(s, 'currentDD'), pctU(get(s, 'currentDD'))), extra: currentDDExtra(M), bench: bench(pctU(get(b, 'currentDD')))
      })
    ];
    $('kpis').innerHTML = cards.join('');
  }

  // ------------------------------------------------------------------ benchmark table
  var BENCH_COLS = [
    ['Rendite', 'Gesamtrendite im Zeitraum'], ['p.a.', 'annualisierte Rendite (CAGR)'], ['Vol. p.a.', 'annualisierte Volatilität'],
    ['Sharpe', 'Sharpe-Ratio'], ['Sortino', 'Sortino-Ratio'], ['Max. DD', 'maximaler Drawdown'],
    ['Beta', 'cov(rP, rB) / var(rB)'], ['Korrelation', 'Korrelation der Tagesrenditen (R² im Tooltip der Zelle)'],
    ['Alpha p.a.', '(Ø(rP − rf_d) − β · Ø(rB − rf_d)) · 252'], ['Tracking Error', 'σ(rP − rB) · √252'],
    ['Info-Ratio', 'Ø(rP − rB) · 252 / Tracking Error'], ['Up-/Down-Capture', 'Ø rP / Ø rB an Tagen mit rB > 0 bzw. rB < 0'],
    ['Mehrrendite', 'Gesamtrendite Portfolio − Gesamtrendite Benchmark (Prozentpunkte)']
  ];
  function statCells(st) {
    var weak = st && !st.cagrReliable;
    return '<td>' + colored(get(st, 'totalReturn'), pct(get(st, 'totalReturn'))) + '</td>' +
      '<td' + (weak ? ' class="dim" title="wenig aussagekräftig &lt; 3 Monate"' : '') + '>' +
      (weak ? pct(get(st, 'cagr')) : colored(get(st, 'cagr'), pct(get(st, 'cagr')))) + '</td>' +
      '<td>' + pctU(get(st, 'volAnn')) + '</td><td>' + ratio(get(st, 'sharpe')) + '</td><td>' + ratio(get(st, 'sortino')) + '</td>' +
      '<td>' + colored(get(st, 'maxDD'), pctU(get(st, 'maxDD'))) + '</td>';
  }
  function relCells(rel) {
    if (!rel) return '<td class="bl dash">–</td>' + new Array(7).join('<td class="dash">–</td>');
    return '<td class="bl">' + ratio(get(rel, 'beta')) + '</td>' +
      '<td title="R² ' + esc(ratio(get(rel, 'r2'))) + '">' + ratio(get(rel, 'corr')) + '</td>' +
      '<td>' + colored(get(rel, 'alpha'), pct(get(rel, 'alpha'))) + '</td>' +
      '<td>' + pctU(get(rel, 'trackingError')) + '</td>' +
      '<td>' + ratio(get(rel, 'infoRatio')) + '</td>' +
      '<td>' + pctU(get(rel, 'upCapture'), 0) + ' / ' + pctU(get(rel, 'downCapture'), 0) + '</td>' +
      '<td>' + colored(get(rel, 'excessReturn'), pct(get(rel, 'excessReturn'))) + '</td>';
  }
  function renderBenchTable(M) {
    $('benchSub').textContent = 'Zeitraum ' + periodText(M.R) + ' · rf ' + pctU(state.rf, 1);
    var head = '<thead><tr class="th-group"><th class="sticky"></th><th colspan="6">im Zeitraum</th>' +
      '<th colspan="7" class="th-rel">Portfolio ggü. Benchmark</th></tr><tr><th class="l sticky">&nbsp;</th>' +
      BENCH_COLS.map(function (c, k) {
        return '<th' + (k === 6 ? ' class="bl"' : '') + ' title="' + esc(c[1]) + '">' + esc(c[0]) + '</th>';
      }).join('') + '</tr></thead>';
    var body = '<tr><td class="l sticky"><span class="row-name"><i style="background:var(--accent)"></i>Portfolio</span></td>' +
      (M.ps ? statCells(M.ps) : new Array(7).join('<td class="dash">–</td>')) + relCells(null) + '</tr>';
    M.selB.forEach(function (x) {
      body += '<tr><td class="l sticky" title="' + esc(x.b.description || '') + '"><span class="row-name"><i style="background:' + x.color +
        '"></i>' + esc(x.name) + '</span></td>' + statCells(x.st) + relCells(x.rel) + '</tr>';
    });
    if (!M.selB.length) body += '<tr><td class="l sticky dash" colspan="14">Keine Benchmark im Chart – oben unter „Benchmarks“ eine Karte einblenden oder mit „+ Benchmark“ anlegen (Summe 100 %).</td></tr>';
    $('benchTable').innerHTML = head + '<tbody>' + body + '</tbody>';
  }

  // ------------------------------------------------------------------ monthly table
  function renderMonthly(M) {
    var ref = M.monthsRef || [], months = ref.map(function (r) { return r.month; }), partial = {};
    ref.forEach(function (r) { partial[r.month] = !!r.partial; });
    var multiYear = months.length > 1 && months[0].slice(0, 4) !== months[months.length - 1].slice(0, 4);
    var rows = [{ name: 'Portfolio', color: 'var(--accent)', data: M.monthlyP }].concat(M.selB.map(function (x) {
      return { name: x.name, color: x.color, data: x.monthly };
    }));
    var maxAbs = 0.02;
    rows.forEach(function (rw) {
      (rw.data || []).forEach(function (c) { if (c && isNum(c.ret)) maxAbs = Math.max(maxAbs, Math.abs(c.ret)); });
    });
    var head = '<thead><tr><th class="l sticky">&nbsp;</th>' + months.map(function (m) {
      return '<th' + (partial[m] ? ' title="Teilmonat"' : '') + '>' + esc(monthLabel(m + '-01', multiYear)) + (partial[m] ? '*' : '') + '</th>';
    }).join('') + '</tr></thead>';
    var body = rows.map(function (rw) {
      var map = {};
      (rw.data || []).forEach(function (c) { if (c) map[c.month] = c.ret; });
      return '<tr><td class="l sticky"><span class="row-name"><i style="background:' + rw.color + '"></i>' + esc(rw.name) + '</span></td>' +
        months.map(function (m) {
          var r = map[m];
          if (!isNum(r)) return '<td><span class="mcell dash">–</span></td>';
          var a = (0.10 + 0.45 * Math.min(1, Math.abs(r) / maxAbs)).toFixed(3);
          var bg = 'rgba(var(' + (r >= 0 ? '--accent-rgb' : '--neg-rgb') + '),' + a + ')';   // colours from the CSS tokens
          return '<td><span class="mcell" style="background:' + bg + '">' + pct(r) + '</span></td>';
        }).join('') + '</tr>';
    }).join('');
    $('monthTable').innerHTML = head + '<tbody>' + body + '</tbody>';
    $('monthNote').hidden = !months.some(function (m) { return partial[m]; });
  }

  // ------------------------------------------------------------------ group table
  // ------------------------------------------------------------------ asset table
  var ASSET_COLS = [
    { key: 'short', h: 'Name', cls: 'l sticky' },
    { key: 'sharesScaled', h: 'Stück', t: 'Stückzahl (bei aktivem Startwert skaliert)' },
    { key: 'p0', h: 'Kurs Start', t: 'Kurs am ersten Tag des Zeitraums (EUR)' },
    { key: 'p1', h: 'Kurs Ende', t: 'Kurs am letzten Tag des Zeitraums (EUR)' },
    { key: 'v1', h: 'Wert Ende' },
    { key: 'w1', h: 'Gewicht', t: 'Anteil am Endwert der Auswahl' },
    { key: 'ret', h: 'Rendite', t: 'Kursrendite im Zeitraum' },
    { key: 'pl', h: 'G/V €', t: 'Wertänderung im Zeitraum' },
    { key: 'contrib', h: 'Beitrag %-Pkt.', t: 'Beitrag zur Portfoliorendite in Prozentpunkten (Summe = Portfoliorendite)' },
    { key: 'vol', h: 'Vol. p.a.' },
    { key: 'maxDD', h: 'Max. DD' },
    { key: null, h: 'Verlauf', t: 'Kurs im Zeitraum' },
    { key: 'glSinceBuy', h: 'G/V seit Kauf', t: 'gegenüber Einstand, letzter Kurs, unabhängig vom Zeitraum' }
  ];

  function sortRows(rows) {
    var k = state.sort.key, dir = state.sort.dir;
    return rows.slice().sort(function (a, b) {
      if (k === 'short') return dir * String(a.short || '').localeCompare(String(b.short || ''), 'de');
      var va = a[k], vb = b[k], na = isNum(va), nb = isNum(vb);
      if (!na || !nb) return na === nb ? String(a.short || '').localeCompare(String(b.short || ''), 'de') : na ? -1 : 1;
      return va === vb ? String(a.short || '').localeCompare(String(b.short || ''), 'de') : (va < vb ? -dir : dir);
    });
  }

  function fmtShares(v) { return isNum(v) ? F.num(v, Math.abs(v - Math.round(v)) > 1e-9 ? 3 : 0) : '–'; }
  /** What-if: Stück cell as input (+ reset and the original count when changed). */
  function wiCell(r, changed) {
    var orig = ORIG_SHARES[r.isin];
    return '<td class="wi-td"><span class="wi-cell"><input type="text" class="wi-inp" inputmode="decimal" autocomplete="off" spellcheck="false"' +
      ' data-wi="' + esc(r.isin) + '" value="' + esc(fmtShares(r.shares)) + '" aria-label="Stückzahl ' + esc(r.short) + '"' +
      ' title="Stückzahl (0 = verkauft) oder Zielwert mit €, z. B. „10.000 €“ – Enter übernimmt">' +
      (changed ? '<button type="button" class="wi-reset" data-wireset="' + esc(r.isin) + '" title="Original wiederherstellen (' +
        esc(fmtShares(orig)) + ' Stück)" aria-label="' + esc(r.short) + ': Original wiederherstellen">↺</button>' : '') +
      '</span>' + (changed ? '<span class="sub2">statt ' + esc(fmtShares(orig)) + '</span>' : '') + '</td>';
  }
  /** "124" | "12,5" | "10.000 €" (target value, converted at the latest price) -> shares >= 0, else null. */
  function parseShares(s, isin) {
    s = String(s || '').trim();
    if (!s) return null;
    var byValue = s.indexOf('€') >= 0, v = F.parseDE(s.replace(/€/g, ''));
    if (!isNum(v) || v < 0) return null;
    if (byValue) {
      var px = ctx0.px[isin], last = px ? px[ctx0.n - 1] : null;
      if (!isNum(last) || last <= 0) return null;
      v = v / last;
    }
    return v;
  }

  function renderAssets(M) {
    if (!state.showAssets) { layoutLists(); return; }   // hidden: not rendered; the toggle re-renders it when switched on
    var rows = sortRows(M.assets), s = M.ps, scaled = state.startValue != null;
    var nSel = 0, maxC = 0, glSum = 0, anyGl = false;
    rows.forEach(function (r) {
      if (!r.selected) return;
      nSel++;
      if (isNum(r.contrib)) maxC = Math.max(maxC, Math.abs(r.contrib));
      if (isNum(r.glSinceBuy)) { glSum += r.glSinceBuy; anyGl = true; }
    });
    $('assetSub').textContent = nSel + ' von ' + rows.length + ' ausgewählt · ' + periodText(M.R);
    var head = '<thead><tr>' + ASSET_COLS.map(function (c) {
      if (!c.key) return '<th' + (c.t ? ' title="' + esc(c.t) + '"' : '') + '>' + esc(c.h) + '</th>';
      var on = state.sort.key === c.key;
      return '<th class="' + (c.cls || '') + (on ? ' is-sorted' : '') + '" data-sort="' + c.key + '"' + (c.t ? ' title="' + esc(c.t) + '"' : '') +
        ' aria-sort="' + (on ? (state.sort.dir > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button" class="th-btn">' +
        esc(c.h) + '<span class="arr">' + (on ? (state.sort.dir > 0 ? '▲' : '▼') : '') + '</span></button></th>';
    }).join('') + '</tr></thead>';
    var body = rows.map(function (r) {
      var sh = r.sharesScaled, shDec = isNum(sh) && Math.abs(sh - Math.round(sh)) > 1e-9 ? 2 : 0;
      var cw = isNum(r.contrib) && maxC > 0 ? Math.min(50, Math.abs(r.contrib) / maxC * 50) : 0;
      var badge = r.listedAfterStart && r.firstDate ?
        '<span class="badge" title="erster Kurs am ' + esc(F.date(r.firstDate, 'short')) + ' – davor ohne Wertänderung gezählt">ab ' +
        esc(F.date(r.firstDate, 'dayMonthShort')) + '</span>' : '';
      var changed = state.whatIf && Object.prototype.hasOwnProperty.call(state.overrides, r.isin);
      return '<tr class="' + (r.selected ? '' : 'is-off') + (changed ? ' is-changed' : '') + '">' +
        '<td class="l sticky"><label class="nm-cell"><input type="checkbox" data-isin="' + esc(r.isin) + '"' + (r.selected ? ' checked' : '') +
        ' aria-label="' + esc(r.short) + ' auswählen">' + avatarHTML(r, 'av--sm') + '<span class="nm"><span class="nm-top"><b>' + esc(r.short) + '</b>' + badge + '</span>' +
        '<span class="nm-sub"><span class="nm-full" title="' + esc(r.name + ' · ' + r.isin) + '">' + esc(r.name) + '</span>' +
        '</span></span></label></td>' +
        (state.whatIf ? wiCell(r, changed) : '<td title="' + esc('Bestand: ' + fmtShares(r.shares) + ' Stück') + '">' + num(sh, shDec) + '</td>') +
        '<td>' + num(r.p0, 2) + '</td><td>' + num(r.p1, 2) + '</td>' +
        '<td>' + eur(r.v1) + '</td>' +
        '<td>' + (r.selected ? pctU(r.w1) : '<span class="dash">–</span>') + '</td>' +
        '<td>' + colored(r.ret, pct(r.ret)) + '</td>' +
        '<td>' + colored(r.pl, eurS(r.pl)) + '</td>' +
        '<td><span class="cbar"><span>' + colored(r.contrib, pp(r.contrib)) + '</span><span class="cbar-track">' +
        (cw > 0 ? '<span class="cbar-fill ' + (r.contrib >= 0 ? 'pos' : 'neg') + '" style="width:' + cw.toFixed(1) + '%"></span>' : '') +
        '</span></span></td>' +
        '<td>' + pctU(r.vol) + '</td>' +
        '<td>' + colored(r.maxDD, pctU(r.maxDD)) + '</td>' +
        '<td>' + C.sparkline(r.spark, { w: 80, h: 22 }) + '</td>' +
        '<td>' + colored(r.glSinceBuy, eurS(r.glSinceBuy)) + '<span class="sub2">' + colored(r.glSinceBuyPct, pct(r.glSinceBuyPct)) + '</span></td>' +
        '</tr>';
    }).join('');
    var foot = '<tfoot><tr><td class="l sticky">Summe Auswahl (' + nSel + ')</td><td></td><td></td><td></td>' +
      '<td>' + eur(get(s, 'endValue')) + '</td><td>' + (s ? pctU(1) : '–') + '</td>' +
      '<td>' + colored(get(s, 'totalReturn'), pct(get(s, 'totalReturn'))) + '</td>' +
      '<td>' + colored(get(s, 'pl'), eurS(get(s, 'pl'))) + '</td>' +
      '<td>' + colored(get(s, 'totalReturn'), pp(get(s, 'totalReturn'))) + '</td>' +
      '<td>' + pctU(get(s, 'volAnn')) + '</td><td>' + colored(get(s, 'maxDD'), pctU(get(s, 'maxDD'))) + '</td><td></td>' +
      '<td title="Summe der Einzelwerte">' + (anyGl ? colored(glSum, eurS(glSum)) : '–') + '</td></tr></tfoot>';
    var tbl = $('assetTable');
    keepFocus(tbl, function () { tbl.innerHTML = head + '<tbody>' + body + '</tbody>' + foot; });
    if (scaled) tbl.classList.add('is-scaled'); else tbl.classList.remove('is-scaled');
    layoutLists();                              // the table width decides side by side / stacked
  }

  // ------------------------------------------------------------------ holdings list ("Portfolio")
  function hashHue(str) {
    var h = 0;
    for (var k = 0; k < str.length; k++) h = (h * 31 + str.charCodeAt(k)) >>> 0;
    return h % 360;
  }
  function initials(short) {
    var words = String(short || '?').split(/[\s\-\/&.,()]+/).filter(Boolean);
    if (!words.length) return '?';
    var a = words[0].charAt(0), b = words.length > 1 && /^[A-Za-zÄÖÜäöü]/.test(words[1]) ? words[1].charAt(0) : words[0].charAt(1);
    return (a + (b || '')).toUpperCase();
  }
  // company logos (stock-logos-100x100/<name>.png, path from build_data.py); taken from the original data so what-if keeps them
  var LOGOS = {};
  (D.positions || []).forEach(function (p) { if (p.logo) LOGOS[p.isin] = p.logo; });
  /** Round logo like the app; the initials underneath show when there is no logo or the image fails to load. */
  function avatarHTML(r, cls) {
    var hue = hashHue(r.isin || r.short || ''), logo = LOGOS[r.isin];
    return '<span class="av' + (cls ? ' ' + cls : '') + (logo ? ' av--logo' : '') + '" style="background:hsl(' + hue + ',26%,27%);color:hsl(' + hue +
      ',45%,84%)" aria-hidden="true">' + esc(initials(r.short)) +
      (logo ? '<img src="' + esc(logo) + '" alt="" decoding="async" onerror="this.remove()">' : '') + '</span>';
  }
  function priceHTML(p) {
    if (!isNum(p)) return '<span class="dash">–</span>';
    var s = F.num(p, 2), i = s.lastIndexOf(',');
    return i < 0 ? '<b>' + esc(s) + '</b>' : '<b>' + esc(s.slice(0, i)) + '</b><sup>' + esc(s.slice(i + 1)) + '</sup>';
  }

  /** App-style value "553.343⁹⁹ €": integer part big, decimals and € stacked (sizes via .bigval / .bigval--sm). */
  function bigValueHTML(v) {
    if (!isNum(v)) return '<span class="bv-int weak">–</span>';
    var s = F.num(v, 2), i = s.lastIndexOf(',');
    return '<span class="bv-int">' + esc(i < 0 ? s : s.slice(0, i)) + '</span><span class="bv-frac"><span class="bv-dec">' +
      esc(i < 0 ? '00' : s.slice(i + 1)) + '</span><span class="bv-cur">€</span></span>';
  }

  var HOLD_LABEL = { '1T': 'Heute', '1W': 'Woche', '1M': 'Monat', '3M': '3 Monate', '6M': '6 Monate', '1J': '1 Jahr', 'SK': 'seit Kauf' };

  /**
   * One period for everything (user, 25.09.): the header pills and the chart tabs are the same switch.
   * Key = the preset ('1T' … 'MAX'), 'SK' (Seit Kauf: chart shows MAX, list/value vs. Einstand) or 'CUSTOM' (Von/Bis).
   */
  function periodKey() { return state.sinceBuy ? 'SK' : state.custom ? 'CUSTOM' : state.preset; }

  /** Period of the value block and the holdings list = the chart range, plus a ~21-day grey context window for 1T. */
  function holdPeriod() {
    var hp = periodKey(), sk = hp === 'SK', n = ctx.n;
    var R = sk ? { start: 0, end: n - 1 } : currentRange();
    var ws = hp === '1T' ? Math.max(0, R.end - CONTEXT_DAYS) : R.start;
    return { hp: hp, sk: sk, R: R, ws: ws };
  }
  /** "Heute", "Monat", "seit 02.01.", "25.08.–15.09.2026" … */
  function periodLabel(H) {
    var R = H.R;
    if (H.hp === 'CUSTOM') return periodText(R);
    if (H.hp === 'YTD') return 'seit ' + F.date(ctx.dates[R.start], 'dayMonthShort');
    if (H.hp === 'MAX') return 'seit ' + F.date(ctx.dates[R.start], 'short');
    var label = HOLD_LABEL[H.hp] || H.hp;
    var target = H.sk ? null : presetTarget(ctx.dates[R.end], H.hp);
    if (target && R.start === 0 && target < ctx.dates[0]) label += ' (Daten ab ' + F.date(ctx.dates[0], 'short') + ')';
    return label;
  }
  /** Sets the shared period; `p` = preset or 'SK'. */
  function setPeriod(p) {
    state.sinceBuy = p === 'SK';
    state.preset = p === 'SK' ? 'MAX' : p;
    state.custom = null;
    setRangeHint('');
    update();
  }
  function holdRet(r, sk) { return sk ? r.glSinceBuyPct : r.ret; }

  function sortHoldRows(rows, sk) {
    var byName = function (a, b) { return String(a.name || a.short || '').localeCompare(String(b.name || b.short || ''), 'de'); };
    var byNum = function (val, dir) {
      return function (a, b) {
        var va = val(a), vb = val(b), na = isNum(va), nb = isNum(vb);
        if (!na || !nb) return na === nb ? byName(a, b) : na ? -1 : 1;           // missing values last
        return va === vb ? byName(a, b) : (va < vb ? -dir : dir);
      };
    };
    var ret = function (r) { return holdRet(r, sk); }, val = function (r) { return r.v1; };
    var cmp = {
      'name-asc': byName,
      'name-desc': function (a, b) { return byName(b, a); },
      'ret-asc': byNum(ret, 1), 'ret-desc': byNum(ret, -1),
      'value-asc': byNum(val, 1), 'value-desc': byNum(val, -1)
    }[state.holdSort] || byNum(val, -1);
    return rows.slice().sort(cmp);
  }

  function holdRow(r, H) {
    var sk = H.sk, chg = holdRet(r, sk), chgEur = sk ? r.glSinceBuy : r.pl;
    var px = ctx.px && ctx.px[r.isin], spark, tip = r.name + ' · ' + r.isin;
    if (sk) {
      // baseline = Einstand je Stück, so teal/red matches the sign of "G/V seit Kauf"
      var cps = isNum(r.costBasis) && isNum(r.shares) && r.shares > 0 ? r.costBasis / r.shares : null;
      spark = C.splitSpark(px ? px.slice(0, ctx.n) : r.spark, { w: 64, h: 22, base: cps, includeBase: cps != null, cls: 'spark--hold' });
      if (cps != null) tip += ' · Einstand ' + num(cps, 2) + ' € je Stück';
    } else if (H.hp === '1T' && cur && cur.intra && cur.intra.oneT && E.intradayAsset(ctx, r.isin, cur.intra.frame)) {
      var ia = E.intradayAsset(ctx, r.isin, cur.intra.frame);
      spark = C.splitSpark(ia.px, { w: 64, h: 22, off: ia.ctxEnd + 1, base: ia.prevClose, cls: 'spark--hold' });
    } else {
      spark = C.splitSpark(px ? px.slice(H.ws, H.R.end + 1) : r.spark, { w: 64, h: 22, off: px ? H.R.start - H.ws : 0, cls: 'spark--hold' });
    }
    if (!r.selected) tip += ' · nicht ausgewählt';
    return '<div class="hrow' + (r.selected ? '' : ' is-off') + '" title="' + esc(tip) + '">' +
      avatarHTML(r) +
      '<span class="hr-name"><span class="hr-title">' + esc(r.name) + '</span><span class="hr-val">' + eur(r.v1) + '</span></span>' +
      '<span class="hr-spark">' + spark + '</span>' +
      '<span class="hr-chg"><span class="hr-pct ' + sgn(chg) + '">' + pct(chg) + '</span><span class="hr-eur">' + eurS(chgEur) + '</span></span>' +
      '<span class="hr-px">' + priceHTML(r.p1) + '</span>' +
      '</div>';
  }

  /**
   * Overview block (user, 27.09.): beside the Yacht value one block per benchmark shown in the chart (cur.selB, card
   * order: Mein Depot, Energie, own cards). Value at the period end and € change over the period in the amount of
   * „Benchmark (€)“ – the same scaling as "Echt" in the measurement boxes: benchmarkRealValue / benchmarkRealPl
   * (cards bought at the period start and held; unedited Mein Depot with the field empty = the real depot). % (tooltip)
   * = the benchmark's period return (legend / card). Daily like the Yacht value (1T: previous close -> last close).
   * "Seit Kauf": benchmarks have no cost basis, so they use the chart period (MAX) and say so.
   */
  function renderOvBench(H) {
    var box = $('ovBench'), list = cur ? cur.selB : [];
    if (!list.length) { box.innerHTML = ''; box.hidden = true; return; }
    var R = H.R, sk = H.sk, tgt = depotTarget(), today = F.date(ctx0.dates[ctx0.n - 1], 'short');
    var label = sk ? periodLabel({ hp: 'MAX', sk: false, R: R }) : periodLabel(H);
    var tgtTxt = isNum(tgt) ? eur(tgt, { dec: 0 }) : '–', dflt = state.depotValue == null;
    var intra = ctx0.status[R.end] === 'intraday' ? ' (intraday' + (ASOF ? ' ' + ASOF : '') + ')' : '';
    box.innerHTML = list.map(function (x, k) {
      var o = { target: tgt, buyAt: R.start };
      var val = E.benchmarkRealValue ? nv(E.benchmarkRealValue(ctx0, x.b, R.end, o)) : null;
      var chg = E.benchmarkRealPl ? nv(E.benchmarkRealPl(ctx0, x.b, R.start, R.end, o)) : null;
      var ret = get(x.st, 'totalReturn');
      var basis = x.real && dflt ? 'Wert = echte Stückzahlen deines Depots × Kurs (ohne Guthaben), am ' + today + ' ' + eur(tgt) :
        (x.real ? 'echte Stückzahlen deines Depots' :
          x.hold ? 'Stückzahlen aus den Anteilen vom ' + today + ', konstant' :
            'gekauft am ' + F.date(ctx0.dates[R.start], 'short') + ', dann gehalten') +
        ' – hochgerechnet auf ' + tgtTxt + ' am ' + today + ' (Betrag aus „Benchmark (€)“' +
        (dflt ? ' = Wert von „Mein Depot“ heute' : '') + ')';
      var tip = pct(ret) + ' · Veränderung von „' + x.name + '“ im Zeitraum ' + periodText(R) + intra + ' · ' + basis +
        (sk ? ' · Seit Kauf: Benchmarks haben keinen Einstand, daher der ganze Chartzeitraum (MAX)' : '');
      return '<div class="ovb" style="--c:' + x.color + '" data-bench="' + esc(x.id) + '">' +
        '<div class="ov-lbl"><i aria-hidden="true"></i><span>' + esc(x.name) + '</span></div>' +
        '<div class="bigval bigval--sm">' + bigValueHTML(val) + '</div>' +
        '<div class="hold-chg hold-chg--sm"><b class="' + sgn(chg) + '">' + eurS(chg) + '</b>' +
        ' <span class="hold-per">' + esc(label) + '</span>' +
        '<span class="info" tabindex="0" role="img" aria-label="Info" aria-describedby="ovTip' + k + '"></span>' +
        '<span class="info-tip" id="ovTip' + k + '" role="tooltip">' + esc(tip) + '</span></div></div>';
    }).join('');
    box.hidden = false;
  }
  /** Keeps an overview tooltip inside the window (the benchmark blocks can sit at the right edge). */
  function fitTip(ev) {
    var info = ev.target.closest && ev.target.closest('.ov .info'), tip = info && info.nextElementSibling;
    if (!tip || !tip.classList.contains('info-tip')) return;
    tip.style.left = '';
    requestAnimationFrame(function () {
      var r = tip.getBoundingClientRect(), over = r.right - (document.documentElement.clientWidth - 8);
      if (r.width && over > 0) tip.style.left = -Math.min(over, Math.max(0, r.left - 8)) + 'px';
    });
  }

  function renderHoldings() {
    var H = holdPeriod(), R = H.R, sk = H.sk, sel = state.selected;
    var rows = E.assets(ctx, { selected: sel, start: R.start, end: R.end, scale: 1 }) || [];

    // header: Σ current value of the selected positions (sums of engine outputs only)
    var total = 0, glSum = 0, costSum = 0, anySel = false, anyGl = false;
    rows.forEach(function (r) {
      if (!r.selected) return;
      anySel = true;
      if (isNum(r.v1)) total += r.v1;
      if (isNum(r.glSinceBuy) && isNum(r.costBasis)) { glSum += r.glSinceBuy; costSum += r.costBasis; anyGl = true; }
    });
    $('holdTotal').innerHTML = bigValueHTML(anySel ? total : null);
    $('holdSub').textContent = anySel ? eur(total) : '';

    var chgEur = null, chgPct = null;
    if (anySel && sk) {
      chgEur = anyGl ? glSum : null;
      chgPct = anyGl && costSum > 0 ? glSum / costSum : null;
    } else if (anySel) {
      var ps = E.portfolio(ctx, { selected: sel, start: R.start, end: R.end, startValue: null });
      var st = ps ? E.stats(ps, { rf: state.rf }) : null;
      chgEur = get(st, 'pl');
      chgPct = get(st, 'totalReturn');
    }
    var label = periodLabel(H);
    var tipText = pct(chgPct) + ' ' + (sk ? 'gegenüber Einstand' :
      '· Wertänderung der ausgewählten Positionen im Zeitraum ' + periodText(R) +
      (ctx.status[R.end] === 'intraday' ? ' (intraday' + (ASOF ? ' ' + ASOF : '') + ')' : '') + ', Rückrechnung mit aktuellen Stückzahlen');
    // as in the app: "+19.051,71 € Monat ⓘ" – the percentage sits in the info tooltip
    $('holdChg').innerHTML = anySel ?
      '<b class="' + sgn(chgEur) + '">' + eurS(chgEur) + '</b>' +
      ' <span class="hold-per">' + esc(label) + '</span>' +
      '<span class="info" tabindex="0" role="img" aria-label="Info" aria-describedby="holdTip"></span>' +
      '<span class="info-tip" id="holdTip" role="tooltip">' + esc(tipText) + '</span>' :
      '<span class="weak">Keine Position ausgewählt</span>';
    renderOvBench(H);

    Array.prototype.forEach.call($('holdPills').querySelectorAll('[data-hp]'), function (b) {
      var on = b.getAttribute('data-hp') === H.hp;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    Array.prototype.forEach.call($('holdSortMenu').querySelectorAll('[data-hsort]'), function (b) {
      var on = b.getAttribute('data-hsort') === state.holdSort;
      b.classList.toggle('is-checked', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });

    if (!state.showHold) return;                // list hidden: rows not rendered (value block + pills above always are)
    var html = sortHoldRows(rows, sk).map(function (r) { return holdRow(r, H); }).join('');
    var list = $('holdList');
    keepFocus(list, function () { list.innerHTML = html; });
  }

  // ------------------------------------------------------------------ list section (toggles "Portfolio" / "Einzelwerte")
  var LIST_GAP = 24, HOLD_W = 480, HOLD_MIN = 400;   // side by side: gap (= CSS), Portfolio width, narrowest Portfolio still side by side
  /**
   * Shows / hides the two lists and picks the layout when both are on: side by side (.is-side: Portfolio left at
   * HOLD_W without its sparkline column, Einzelwerte right at its natural width, both centred on the column and at
   * most window − 32 px wide) or stacked (.is-stack) when that does not fit. Called after every table render and on resize.
   */
  function layoutLists() {
    var sec = $('lists'), hold = !!state.showHold, assets = !!state.showAssets;
    if (!sec) return;
    $('holdBlock').hidden = !hold;
    $('assetBlock').hidden = !assets;
    $('listsHint').hidden = hold || assets;
    Array.prototype.forEach.call($('listToggles').querySelectorAll('[data-list]'), function (b) {
      var on = b.getAttribute('data-list') === 'hold' ? hold : assets;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var side = false;
    if (hold && assets) {
      var avail = document.documentElement.clientWidth - 32;
      sec.classList.remove('is-stack');
      sec.classList.add('is-side');             // measure the table card at its natural width
      var cw = $('assetBlock').querySelector('.card').offsetWidth;
      var hw = Math.min(HOLD_W, avail - LIST_GAP - cw);
      side = hw >= HOLD_MIN;
      if (side) {
        sec.style.setProperty('--hold-w', Math.floor(hw) + 'px');
        sec.style.setProperty('--lists-max', avail + 'px');
      }
    }
    sec.classList.toggle('is-side', side);
    sec.classList.toggle('is-stack', hold && assets && !side);
  }
  /**
   * Button in the empty-selection headline: switches „Einzelwerte“ on (if hidden), scrolls it under the sticky bar and
   * focuses the next step – the first changed Stück field (what-if, all at 0) or „Alle“.
   */
  function openAssets() {
    if (!state.showAssets) { state.showAssets = true; if (cur) renderAssets(cur); }
    layoutLists();
    var blk = $('assetBlock'), bar = $('topBar'), calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var y = blk.getBoundingClientRect().top + window.pageYOffset - (bar ? bar.offsetHeight : 0) - 12;
    window.scrollTo({ top: Math.max(0, Math.round(y)), behavior: calm ? 'auto' : 'smooth' });
    var t = $('assetTable').querySelector('tr.is-changed .wi-inp') || $('selAll');
    if (t) t.focus({ preventScroll: true });
  }
  function bindLists() {
    $('hlMain').addEventListener('click', function (ev) { if (ev.target.closest('[data-hl-act="assets"]')) openAssets(); });
    $('listToggles').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-list]');
      if (!b) return;
      if (b.getAttribute('data-list') === 'hold') {
        state.showHold = !state.showHold;
        if (state.showHold) renderHoldings();
      } else {
        state.showAssets = !state.showAssets;
        if (state.showAssets && cur) renderAssets(cur);
      }
      layoutLists();
    });
    var pending = 0;
    window.addEventListener('resize', function () {
      if (pending || !(state.showHold && state.showAssets)) return;
      pending = requestAnimationFrame(function () { pending = 0; layoutLists(); });
    });
  }

  // sort menu ("⋮")
  function sortMenuOpen() { return !$('holdSortMenu').hidden; }
  function openSortMenu(focusItem) {
    var menu = $('holdSortMenu');
    menu.hidden = false;
    $('holdSortBtn').setAttribute('aria-expanded', 'true');
    if (focusItem) {
      var it = menu.querySelector('[aria-checked="true"]') || menu.querySelector('[data-hsort]');
      if (it) it.focus();
    }
  }
  function closeSortMenu(returnFocus) {
    var menu = $('holdSortMenu');
    if (menu.hidden) return false;
    menu.hidden = true;
    $('holdSortBtn').setAttribute('aria-expanded', 'false');
    if (returnFocus) $('holdSortBtn').focus();
    return true;
  }

  // ------------------------------------------------------------------ what-if (banner + controls)
  /** Σ current value (latest price) of the selected positions in context c. */
  function selectedValueToday(c) {
    var rows = E.assets(c, { selected: state.selected, start: c.n - 1, end: c.n - 1, scale: 1 }) || [], t = 0, any = false;
    rows.forEach(function (r) { if (r.selected && isNum(r.v1)) { t += r.v1; any = true; } });
    return any ? t : null;
  }
  function renderWhatIf() {
    var k = Object.keys(state.overrides).length, on = state.whatIf && k > 0;   // banner only once something was changed
    var bn = $('wiBanner');
    bn.hidden = !on;
    document.body.classList.toggle('wi-on', on);
    if (!on) return;
    var today = selectedValueToday(ctx);
    $('wiText').innerHTML = '<b>Was-wäre-wenn<span class="wi-long"> aktiv</span></b><span class="wi-sep">·</span>' +
      (k ? k + (k === 1 ? ' Position' : ' Positionen') + ' geändert' : 'noch keine Änderung – Stück unten in „Einzelwerte“ anpassen') +
      '<span class="wi-sep">·</span>Wert heute <b>' + eur(today) + '</b>' +
      (k ? ' <span class="wi-orig">(Original ' + eur(selectedValueToday(ctx0)) + ')</span>' : '');
    $('wiReset').hidden = !k;
  }

  // ------------------------------------------------------------------ risk & correlation
  var heat = new C.Heatmap($('heatmap'));

  function kpiMini(label, value, title, extra) {
    return '<div class="kpi kpi--mini" title="' + esc(title || '') + '"><div class="kpi-label">' + esc(label) + '</div>' +
      '<div class="kpi-value">' + value + '</div>' + (extra ? '<div class="kpi-extra">' + extra + '</div>' : '') + '</div>';
  }

  function renderRisk(M) {
    var kp = $('riskKpis'), bars = $('riskBars'), avgEl = $('heatAvg');
    $('riskSub').textContent = 'Zeitraum ' + periodText(M.R) + ' · Gewichte am ' + F.date(ctx.dates[M.R.end], 'short') +
      (ctx !== ctx0 ? ' · Was-wäre-wenn' : '');
    var rc = HAS_RISK && M.p ? E.riskContribution(ctx, { selected: state.selected, start: M.R.start, end: M.R.end }) : null;
    var rows = rc && rc.rows ? rc.rows.filter(function (r) { return isNum(r.weight) && r.weight > 0; }) : [];
    if (!rc || !rows.length) {
      kp.innerHTML = kpiMini('Vol. p.a. (aktuelle Gewichte)', '–') + kpiMini('Diversifikations-Ratio', '–') + kpiMini('Top 3 Risikotreiber', '–');
      bars.innerHTML = '<p class="empty-note">' + (!HAS_RISK ? 'Nicht verfügbar: js/engine.js ohne riskContribution()/correlationMatrix().' :
        M.p ? 'Zu wenig Kursdaten im Zeitraum für eine Risikozerlegung.' : emptyText() + '.') + '</p>';
      heat.render(null);
      avgEl.textContent = '';
      return;
    }
    var info = {};
    M.assets.forEach(function (a) { info[a.isin] = a; });
    function shortOf(i) { return info[i] ? info[i].short : i; }
    var byRisk = rows.slice().sort(function (a, b) { return (nv(b.pctr) || 0) - (nv(a.pctr) || 0); });
    var names = byRisk.slice(0, 3).map(function (r) { return shortOf(r.isin); }), top3 = nv(rc.top3Pctr);
    if (top3 === null) {                                     // older engine without the extra: plain sum of the 3 largest
      top3 = 0;
      byRisk.slice(0, 3).forEach(function (r) { if (isNum(r.pctr)) top3 += r.pctr; });
    }
    kp.innerHTML =
      kpiMini('Vol. p.a. (aktuelle Gewichte)', pctU(rc.volAnn), 'σ = √(wᵀ Σ w · 252) mit den Gewichten am Ende des Zeitraums') +
      kpiMini('Diversifikations-Ratio', ratio(rc.diversificationRatio), 'Σ wᵢ · σᵢ / σ Portfolio – 1 = keine Streuung, höher = mehr Diversifikation') +
      kpiMini('Top 3 Risikotreiber', pctU(top3, 1) + ' <span class="kpi-unit">des Risikos</span>',
        'Summe der Risikoanteile der drei größten Risikotreiber', esc(names.join(', ')));

    var maxV = 0.0001;
    rows.forEach(function (r) { maxV = Math.max(maxV, nv(r.weight) || 0, nv(r.pctr) || 0); });
    bars.innerHTML = byRisk.map(function (r) {
      var w = nv(r.weight) || 0, p = nv(r.pctr), over = isNum(p) && p > w * 1.25 && p - w > 0.005;
      var a = info[r.isin] || {};
      return '<div class="rb-row" title="' + esc((a.name || r.isin) + ' · Vol. p.a. ' + pctU(r.vol) + ' · Grenzbeitrag (MCTR) ' + pctU(r.mctr) +
        ' · Risikobeitrag ' + pctU(r.ctr)) + '">' +
        '<span class="rb-name">' + esc(shortOf(r.isin)) + '</span>' +
        '<span class="rb-bars"><i class="rb-bar rb-bar--w" style="width:' + (w / maxV * 100).toFixed(1) + '%"></i>' +
        '<i class="rb-bar rb-bar--r' + (isNum(p) && p < 0 ? ' is-neg' : '') + '" style="width:' + (Math.max(0, Math.abs(p || 0)) / maxV * 100).toFixed(1) + '%"></i></span>' +
        '<span class="rb-vals"><span>' + pctU(w, 1) + '</span><b class="' + (over ? 'is-over' : '') + '">' + pctU(p, 1) + '</b></span></div>';
    }).join('');

    var order = rows.slice().sort(function (a, b) { return b.weight - a.weight; }).map(function (r) { return r.isin; });
    var cm = E.correlationMatrix(ctx, { isins: order, start: M.R.start, end: M.R.end });
    var ids = cm && cm.isins ? cm.isins : order, mm = cm && cm.m ? cm.m : [], nn = cm && cm.n ? cm.n : [];
    var avg = cm ? nv(cm.avg) : null;
    avgEl.innerHTML = (avg !== null ? 'Ø paarweise Korrelation <b>' + ratio(avg) + '</b> · ' : '') + ids.length + ' Positionen';
    heat.render({
      labels: ids.map(shortOf),
      m: mm, n: nn,
      valueLabel: function (c) { return F.num(c, 2); },
      tipText: function (a, b) {
        var c = mm[a] ? mm[a][b] : null, k = nn[a] ? nn[a][b] : null;
        return shortOf(ids[a]) + ' × ' + shortOf(ids[b]) + ': ' + (isNum(c) ? F.num(c, 2) : '–') + (isNum(k) ? ' (' + k + ' Tage)' : '');
      }
    });
  }

  // ------------------------------------------------------------------ notes
  function renderNotes() {
    var notes = (META.notes || []).map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('');
    var gen = META.generated_at ? F.date(String(META.generated_at).slice(0, 10), 'short') + ', ' + String(META.generated_at).slice(11, 16) + ' Uhr' : '–';
    $('notes').innerHTML = '<h2>Hinweise</h2>' + (notes ? '<ul>' + notes + '</ul>' : '') +
      '<p>Datenquelle: ' + esc(META.source || '–') + ' · Daten erzeugt: ' + esc(gen) + ' · Zeitraum der Kursdaten: ' +
      esc(F.date(ctx.dates[0], 'short') + ' – ' + F.date(ctx.dates[ctx.n - 1], 'short')) + '</p>' +
      '<p><strong>Keine Anlageberatung.</strong> Reine Informationsdarstellung, alle Angaben ohne Gewähr.</p>';
  }

  // ------------------------------------------------------------------ update cycle
  function update(opts) {
    opts = opts || {};
    if (!opts.keepMeasure) { sync.reset(); state.measure = null; state.hover = null; }
    applyWhatIf();
    cache = {};
    cur = compute();
    renderWhatIf();
    renderRangeBar();
    renderMode();
    renderSettings(cur);
    renderHeadline(cur);
    renderCharts(cur);
    renderInterval(cur);
    renderHoldings();
    renderKpis(cur);
    renderBenchTable(cur);
    renderMonthly(cur);
    renderAssets(cur);
    renderRisk(cur);
    renderMeasureBar();
  }

  /** What-if: a Stück input was committed (Enter / blur). */
  function onWhatIfInput(inp) {
    var isin = inp.getAttribute('data-wi'), v = parseShares(inp.value, isin);
    if (v === null) {
      inp.classList.add('is-invalid');
      inp.setAttribute('aria-invalid', 'true');
      inp.title = 'Ungültig – Stückzahl ≥ 0 oder Zielwert mit €, z. B. „10.000 €“';
      return;                                   // keep the previous state
    }
    var next = extend({}, state.overrides), orig = ORIG_SHARES[isin];
    if (isNum(orig) && Math.abs(v - orig) < 1e-9) delete next[isin]; else next[isin] = v;
    state.overrides = next;
    setTimeout(function () { update(); }, 0);   // let focus move first (Tab), keepFocus then restores it
  }

  function setRangeHint(t) { $('rangeHint').textContent = t || ''; }

  function onDateChange() {
    var from = dfFrom.iso() || dfFrom.value, to = dfTo.iso() || dfTo.value;
    var r = from && to ? E.customRange(ctx, from, to) : null;
    if (!r) {
      setRangeHint(!from || !to ? 'Bitte beide Daten angeben.' : 'Ungültiger Zeitraum (mind. 2 Handelstage, Von vor Bis).');
      return;                                   // keep the previous range
    }
    setRangeHint('');
    state.custom = { from: from, to: to };
    state.preset = null;
    state.sinceBuy = false;
    update();
  }

  function onStartValue() {
    var inp = $('startValue'), s = inp.value.trim(), hint = $('scaleHint');
    if (!s) {
      inp.classList.remove('is-invalid');
      if (state.startValue !== null) { state.startValue = null; update({ keepMeasure: true }); } else renderSettings(cur);
      return;
    }
    var v = F.parseDE(s);
    if (!isNum(v) || v <= 0) {
      inp.classList.add('is-invalid');
      hint.classList.add('is-error');
      hint.textContent = 'ungültiger Betrag';
      $('startReset').hidden = false;
      return;
    }
    inp.classList.remove('is-invalid');
    if (v === state.startValue) { renderSettings(cur); return; }
    state.startValue = v;
    update({ keepMeasure: true });
  }

  /** "Benchmark (€)": only "Echt" in the measure boxes and the benchmark values of the overview use it – no re-render of the charts. */
  function onDepotValue() {
    var inp = $('depotValue'), s = inp.value.trim(), v = s ? F.parseDE(s) : null, hint = $('depotHint');
    if (s && (!isNum(v) || v <= 0)) { inp.classList.add('is-invalid'); hint.textContent = 'ungültiger Betrag'; $('depotReset').hidden = false; return; }
    inp.classList.remove('is-invalid');
    hint.textContent = '';
    state.depotValue = s ? v : null;
    $('depotReset').hidden = !s;
    renderOvBench(holdPeriod());                  // benchmark values in the overview use the same amount
    mainChart.tipKey = '';                        // rebuild an open measure box with the new value
    sync.draw();
  }

  function onRf() {
    var inp = $('rfInput'), s = inp.value.trim(), v = s ? F.parseDE(s) : null;
    if (!isNum(v) || v < -20 || v > 50) {
      inp.classList.add('is-invalid');
      $('rfHint').textContent = s ? 'ungültig' : 'Wert fehlt';
      return;
    }
    inp.classList.remove('is-invalid');
    $('rfHint').textContent = '';
    if (Math.abs(v / 100 - state.rf) < 1e-12) return;
    state.rf = v / 100;
    update({ keepMeasure: true });
  }

  function applyMeasure() {
    var pin = sync.pinned();
    if (!pin || !cur) return;
    var from = ctx.dates[cur.R.start + pin.a], to = ctx.dates[cur.R.start + pin.b];
    if (!from || !to || !E.customRange(ctx, from, to)) return;
    setRangeHint('');
    state.custom = { from: from, to: to };
    state.preset = null;
    state.sinceBuy = false;
    update();
  }

  function toggleSet(set, ids, on) {
    var next = new Set(set);
    ids.forEach(function (i) { if (on) next.add(i); else next.delete(i); });
    return next;
  }

  function bind() {
    $('rangeTabs').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-preset]');
      if (!b) return;
      setPeriod(b.getAttribute('data-preset'));
    });
    $('modeToggle').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-mode]');
      if (!b || b.getAttribute('data-mode') === state.mode) return;
      state.mode = b.getAttribute('data-mode');
      update({ keepMeasure: true });
    });
    $('startValue').addEventListener('input', onStartValue);
    $('depotValue').addEventListener('input', onDepotValue);
    var ov = document.querySelector('.ov');
    ov.addEventListener('pointerover', fitTip);
    ov.addEventListener('focusin', fitTip);
    $('depotReset').addEventListener('click', function () { $('depotValue').value = ''; onDepotValue(); $('depotValue').focus(); });
    $('startReset').addEventListener('click', function () { $('startValue').value = ''; onStartValue(); $('startValue').focus(); });
    $('rfInput').addEventListener('input', onRf);
    bindBench();                                 // benchmark cards + instrument search list
    $('applyMeasure').addEventListener('click', applyMeasure);
    $('assetTable').addEventListener('change', function (ev) {
      var t = ev.target;
      if (!t || !t.hasAttribute) return;
      if (t.hasAttribute('data-wi')) { onWhatIfInput(t); return; }
      if (!t.hasAttribute('data-isin')) return;
      state.selected = toggleSet(state.selected, [t.getAttribute('data-isin')], t.checked);
      update();
    });
    $('assetTable').addEventListener('keydown', function (ev) {
      var t = ev.target;
      if (!t || !t.hasAttribute || !t.hasAttribute('data-wi')) return;
      if (ev.key === 'Escape' || ev.key === 'Esc') {           // undo the typing in this cell
        var r = null;
        (cur ? cur.assets : []).forEach(function (a) { if (a.isin === t.getAttribute('data-wi')) r = a; });
        if (r) t.value = fmtShares(r.shares);
        t.classList.remove('is-invalid');
        ev.stopPropagation();
      }
    });
    $('assetTable').addEventListener('click', function (ev) {
      var rs = ev.target.closest('[data-wireset]');
      if (rs) {
        var next = extend({}, state.overrides);
        delete next[rs.getAttribute('data-wireset')];
        state.overrides = next;
        update();
        return;
      }
      var th = ev.target.closest('th[data-sort]');
      if (!th) return;
      var k = th.getAttribute('data-sort');
      state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: k === 'short' ? 1 : -1 };
      renderAssets(cur);
    });
    $('wiReset').addEventListener('click', function () { state.overrides = {}; update(); });
    $('selAll').addEventListener('click', function () { state.selected = new Set(ALL); update(); });
    $('selNone').addEventListener('click', function () { state.selected = new Set(); update(); });
    $('holdPills').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-hp]');
      if (!b || b.getAttribute('data-hp') === periodKey()) return;
      setPeriod(b.getAttribute('data-hp'));
    });
    bindLists();                                 // list section toggles + side-by-side / stacked on resize
    // "⋮" sort menu of the holdings list
    $('holdSortBtn').addEventListener('click', function () {
      if (sortMenuOpen()) closeSortMenu(false); else openSortMenu(true);
    });
    $('holdSortBtn').addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); openSortMenu(true); }
    });
    $('holdSortMenu').addEventListener('click', function (ev) {
      var it = ev.target.closest('[data-hsort]');
      if (!it) return;
      state.holdSort = it.getAttribute('data-hsort');
      closeSortMenu(true);
      renderHoldings();
    });
    $('holdSortMenu').addEventListener('keydown', function (ev) {
      var items = Array.prototype.slice.call(this.querySelectorAll('[data-hsort]'));
      var i = items.indexOf(document.activeElement), k = ev.key;
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End') {
        ev.preventDefault();
        var j = k === 'Home' ? 0 : k === 'End' ? items.length - 1 : (i + (k === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[j].focus();
      } else if (k === 'Escape' || k === 'Esc') {
        ev.preventDefault();
        ev.stopPropagation();
        closeSortMenu(true);
      } else if (k === 'Tab') {
        closeSortMenu(false);
      }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape' && ev.key !== 'Esc') return;
      if (closeSortMenu(true) || sync.clearMeasure()) ev.preventDefault();
    });
    document.addEventListener('pointerdown', function (ev) {
      var t = ev.target;
      if (sortMenuOpen() && !$('holdMenuWrap').contains(t)) closeSortMenu(false);
      // touch: a tap outside the charts / heatmap removes a sticky read-out and a tapped start point (a pinned measurement stays)
      if (ev.pointerType !== 'mouse' && sync.hoverI != null && !(t.closest && t.closest('.pc'))) sync.setHover(null);
      if (ev.pointerType !== 'mouse' && sync.following() && !(t.closest && t.closest('.pc'))) sync.clearMeasure();
      if (ev.pointerType !== 'mouse' && heat.hot && !$('heatmap').contains(t)) heat.highlight(null);
    }, true);

    var lastW = -1, lastH = -1, pending = 0, box = $('mainChart');
    function onResize() {
      if (pending) return;
      pending = requestAnimationFrame(function () {
        pending = 0;
        var w = box.clientWidth, h = box.clientHeight;
        if (w === lastW && h === lastH) return;
        var widthChanged = w !== lastW;
        lastW = w; lastH = h;
        rerenderChartsOnly();
        if (widthChanged && heat.model) heat.render();         // cell size follows the card width
      });
    }
    if (window.ResizeObserver) new ResizeObserver(onResize).observe(box);
    else window.addEventListener('resize', onResize);
  }

  // ------------------------------------------------------------------ start
  renderHeader();
  renderNotes();
  bind();
  update();
  setTimeout(function () { document.documentElement.classList.add('ready'); }, 60);   // enable marker fades after the first paint
  // small debugging handle (read-only use from the console)
  window.PFApp = { state: state, update: update, sync: sync, charts: { main: mainChart, dd: ddChart }, model: function () { return cur; } };
})();
