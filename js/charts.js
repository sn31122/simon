/* Yacht-Portfolio Dashboard – SVG charts (classic script, no libraries, works from file://).
 *
 *   PFCharts = { Sync, MainChart, DrawdownChart, sparkline, niceTicks }
 *
 * The charts only map numbers to pixels – no financial math happens here. Every value,
 * label and tooltip text is supplied by app.js (which gets it from PFEngine).
 *
 * Each chart has a base layer (grid, axes, series – rebuilt on data change / resize) and an
 * overlay layer (hover + drag-to-measure). Pointer moves only touch the overlay, batched to one
 * redraw per animation frame by the shared Sync object, which also keeps the main chart and the
 * drawdown chart in step (same x-scale, same hover index, same measurement).
 */
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var DRAG_PX = 4;          // pointer travel before a press turns into a measurement
  var uid = 0;

  // ---------------------------------------------------------------- helpers
  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function crisp(v) { return Math.round(v) + 0.5; }            // 1px strokes on pixel centres
  function raf(fn) { return (root.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(fn); }

  var measureCtx = null;
  function textW(str, font) {
    try {
      if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
      measureCtx.font = font;
      return measureCtx.measureText(String(str)).width;
    } catch (e) { return String(str).length * 6.6; }
  }

  /** "Nice" ticks inside [lo, hi], aiming for `target` ticks (1/2/2.5/5 x 10^k steps). */
  function niceTicks(lo, hi, target) {
    target = target || 5;
    if (!isNum(lo) || !isNum(hi)) return { ticks: [], step: 0 };
    if (hi < lo) { var t = lo; lo = hi; hi = t; }
    if (hi - lo < 1e-12) { var d = Math.abs(hi) * 0.02 || 1; lo -= d; hi += d; }
    var raw = (hi - lo) / target, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var cands = [1, 2, 2.5, 5, 10, 20], best = null;
    for (var c = 0; c < cands.length; c++) {
      var step = cands[c] * mag, i0 = Math.ceil(lo / step - 1e-9), i1 = Math.floor(hi / step + 1e-9);
      var score = Math.abs(i1 - i0 + 1 - target) + (cands[c] === 2.5 ? 0.4 : 0);
      if (!best || score < best.score) best = { score: score, step: step, i0: i0, i1: i1 };
    }
    var ticks = [];
    for (var k = best.i0; k <= best.i1; k++) { var v = k * best.step; ticks.push(v === 0 ? 0 : v); }
    return { ticks: ticks, step: best.step };
  }

  function extent(arrays, extra) {
    var lo = Infinity, hi = -Infinity;
    for (var a = 0; a < arrays.length; a++) {
      var arr = arrays[a] || [];
      for (var k = 0; k < arr.length; k++) { var v = arr[k]; if (isNum(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    }
    for (var e = 0; e < (extra || []).length; e++) { var x = extra[e]; if (isNum(x)) { if (x < lo) lo = x; if (x > hi) hi = x; } }
    return isNum(lo) && isNum(hi) ? { lo: lo, hi: hi } : null;
  }

  function linePath(values, xOf, yOf) {
    var d = '', pen = false;
    for (var k = 0; k < values.length; k++) {
      var v = values[k];
      if (!isNum(v)) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + r1(xOf(k)) + ' ' + r1(yOf(v));
      pen = true;
    }
    return d;
  }
  function areaPath(values, xOf, yOf, yBase) {
    var d = '', first = -1, last = -1;
    for (var k = 0; k < values.length; k++) {
      if (!isNum(values[k])) continue;
      if (first < 0) { first = k; d = 'M' + r1(xOf(k)) + ' ' + r1(yBase); }
      d += 'L' + r1(xOf(k)) + ' ' + r1(yOf(values[k]));
      last = k;
    }
    return first < 0 ? '' : d + 'L' + r1(xOf(last)) + ' ' + r1(yBase) + 'Z';
  }

  function gradient(defs, id, y1, y2, color, o1, o2) {
    // colours go into style (CSS custom properties are not reliable in presentation attributes)
    var g = svgEl('linearGradient', { id: id, gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0, y1: r1(y1), y2: r1(y2) }, defs);
    svgEl('stop', { offset: 0, style: 'stop-color:' + color + ';stop-opacity:' + o1 }, g);
    svgEl('stop', { offset: 1, style: 'stop-color:' + color + ';stop-opacity:' + o2 }, g);
    return 'url(#' + id + ')';
  }

  /** Shared x layout: trading-day index -> px (no weekend gaps). */
  function xLayout(W, m, padL, padR) {
    var plotW = Math.max(10, W - padL - padR);
    return {
      padL: padL, padR: padR, plotW: plotW, m: m,
      x: function (i) { return m > 1 ? padL + i * plotW / (m - 1) : padL + plotW / 2; },
      idx: function (px) { return m > 1 ? clamp(Math.round((px - padL) / plotW * (m - 1)), 0, m - 1) : 0; }
    };
  }

  /** X labels: month starts for long ranges (left-aligned like the app), "21.09." otherwise. */
  function xLabels(M, L, font) {
    var dates = M.dates || [], m = dates.length, out = [], i;
    if (M.xTicks) {                            // explicit ticks (or a function of the plot width), e.g. "Gestern · 15:15 · Heute · 15:15"
      var ticks = typeof M.xTicks === 'function' ? M.xTicks(L.plotW) : M.xTicks;
      out = ticks.map(function (t) {
        var o = { x: L.x(t.i), text: t.text, anchor: t.anchor || 'middle', w: textW(t.text, font) };
        if (o.anchor === 'middle' && o.x - o.w / 2 < 0) { o.anchor = 'start'; o.x = 0; }     // a centred label at the left edge
        return o;
      });
    } else if (m < 2) {
      return out;
    } else if (m >= 45) {
      var multiYear = dates[0].slice(0, 4) !== dates[m - 1].slice(0, 4);
      for (i = 0; i < m; i++) {
        var isStart = i === 0 ? !!M.firstIsMonthStart : dates[i].slice(0, 7) !== dates[i - 1].slice(0, 7);
        if (!isStart) continue;
        var withYear = multiYear && (dates[i].slice(5, 7) === '01');
        var t = M.monthLabel ? M.monthLabel(dates[i], withYear) : dates[i].slice(0, 7);
        out.push({ x: L.x(i), text: t, anchor: 'start', w: textW(t, font) });
      }
    } else {
      // short ranges like the app: day number at the first trading day of each week ("24", "31", "7. Sept.", "14"),
      // every day when the range is at most ~a week; the month name appears where the month changes
      var prevMonth = null, prevWeek = null;
      for (i = 0; i < m; i++) {
        var t = Date.UTC(+dates[i].slice(0, 4), +dates[i].slice(5, 7) - 1, +dates[i].slice(8, 10)) / 864e5;
        var week = Math.floor((t + 3) / 7), mon = dates[i].slice(0, 7);          // Monday-based weeks
        if (m > 8 && week === prevWeek) continue;
        prevWeek = week;
        var withMonth = prevMonth !== null && mon !== prevMonth;
        prevMonth = mon;
        var tx = M.weekLabel ? M.weekLabel(dates[i], withMonth) : String(+dates[i].slice(8, 10));
        var w = textW(tx, font), x = L.x(i), anchor = 'middle';
        if (i === 0 || x - w / 2 < 0) { anchor = 'start'; x = Math.max(0, x); }
        out.push({ x: x, text: tx, anchor: anchor, w: w });
      }
    }
    // drop overlapping labels (min ~48px between label starts, 8px clear space)
    var kept = [], lastL = -Infinity, lastR = -Infinity;
    for (i = 0; i < out.length; i++) {
      var o = out[i], left = o.anchor === 'start' ? o.x : o.anchor === 'end' ? o.x - o.w : o.x - o.w / 2;
      if (left + o.w > L.W + 0.5) continue;
      if (left - lastL < 48 || left < lastR + 8) continue;
      kept.push(o); lastL = left; lastR = left + o.w;
    }
    return kept;
  }

  // ---------------------------------------------------------------- Sync (shared interaction state)
  /**
   * Holds hover index and measurement for all linked charts and redraws their overlays once
   * per animation frame. opts.onMeasure(pinned|null) fires when a pinned measurement appears
   * or disappears; opts.onHover(i|null) on hover changes.
   */
  function Sync(opts) {
    this.opts = opts || {};
    this.charts = [];
    this.hoverI = null;
    this.measure = null;         // { a, b, live } – indices into the current range
    this._raf = 0;
  }
  Sync.prototype.add = function (chart) { this.charts.push(chart); };
  Sync.prototype.draw = function () {
    var self = this;
    if (this._raf) return;
    this._raf = raf(function () { self._raf = 0; self.flush(); });
  };
  Sync.prototype.flush = function () { for (var k = 0; k < this.charts.length; k++) this.charts[k].drawOverlay(this); };
  Sync.prototype.pinned = function () { var m = this.measure; return m && !m.live ? { a: m.a, b: m.b } : null; };
  /** Click mode (as in the app): a click sets the start point, the end follows the pointer, the next click ends it. */
  Sync.prototype.following = function () { var m = this.measure; return !!(m && m.live && m.follow); };
  Sync.prototype._emit = function () { if (this.opts.onMeasure) this.opts.onMeasure(this.pinned(), this.following()); };
  Sync.prototype.anchor = function (i) {
    this.measure = { a: i, b: i, live: true, follow: true };
    this.hoverI = null;
    this.draw();
    this._emit();
  };
  Sync.prototype.setHover = function (i) {
    if (i === this.hoverI) return;
    this.hoverI = i;
    this.draw();
    if (this.opts.onHover) this.opts.onHover(i);
  };
  Sync.prototype.measureStart = function (i) {
    var had = !!this.pinned();
    this.measure = { a: i, b: i, live: true };
    this.hoverI = null;
    this.draw();
    if (had) this._emit();
  };
  Sync.prototype.measureMove = function (i) {
    var m = this.measure;
    if (!m || !m.live || i == null || m.b === i) return;
    m.b = i;
    this.draw();
  };
  Sync.prototype.measureEnd = function (i) {
    var m = this.measure;
    if (!m) return;
    if (i != null) m.b = i;
    this.measure = m.a === m.b ? null : { a: Math.min(m.a, m.b), b: Math.max(m.a, m.b), live: false };
    this.draw();
    this._emit();
  };
  Sync.prototype.cancel = function () {
    var had = !!this.pinned() || !!this.measure;
    this.measure = null;
    this.hoverI = null;
    this.draw();
    if (had) this._emit();
  };
  /** Plain click / tap: ends a measurement, otherwise sets the start point of a new one. */
  Sync.prototype.tap = function (i, type) {
    if (this.measure) {
      this.measure = null;
      this.hoverI = type === 'mouse' ? i : null;
      this.draw();
      this._emit();
      return;
    }
    this.anchor(i);
  };
  Sync.prototype.clearMeasure = function () {
    if (!this.measure) return false;
    this.measure = null;
    this.draw();
    this._emit();
    return true;
  };
  /** Data changed: drop hover + measurement without notifying (the caller re-renders anyway). */
  Sync.prototype.reset = function () { this.measure = null; this.hoverI = null; };

  function bindPointer(chart) {
    var target = chart.svg, st = null;
    function localX(ev) { var r = target.getBoundingClientRect(); return ev.clientX - r.left; }
    function idxAt(x) { return chart.L ? chart.L.idx(x) : null; }

    target.addEventListener('pointerdown', function (ev) {
      if (!chart.sync || !chart.L) return;
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      var x = localX(ev);
      st = { id: ev.pointerId, x0: x, i0: idxAt(x), drag: false, type: ev.pointerType || 'mouse' };
      try { target.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    });
    target.addEventListener('pointermove', function (ev) {
      var S = chart.sync;
      if (!S || !chart.L) return;
      var x = localX(ev), i = idxAt(x);
      if (st && ev.pointerId === st.id) {
        if (!st.drag && Math.abs(x - st.x0) >= DRAG_PX) {
          st.drag = true;
          st.follow = S.following();                 // dragging during a click measurement moves its end point
          if (!st.follow) S.measureStart(st.i0);
        }
        if (st.drag) S.measureMove(i);
      } else if (!st && ev.pointerType === 'mouse') {
        if (S.following()) S.measureMove(i); else S.setHover(i);
      }
    });
    function finish(ev, cancelled) {
      if (!st || ev.pointerId !== st.id) return;
      var s = st, S = chart.sync;
      st = null;
      try { target.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      if (!S) return;
      if (s.follow) return;                          // click measurement stays open until the next click
      if (cancelled) { if (s.drag) S.cancel(); else if (!S.following()) S.setHover(null); return; }
      if (s.drag) S.measureEnd(idxAt(localX(ev)));   // press-drag-release: measurement stays pinned
      else S.tap(s.i0, s.type);
    }
    target.addEventListener('pointerup', function (ev) { finish(ev, false); });
    target.addEventListener('pointercancel', function (ev) { finish(ev, true); });
    target.addEventListener('pointerleave', function (ev) {
      if (!st && ev.pointerType === 'mouse' && chart.sync && !chart.sync.following()) chart.sync.setHover(null);
    });
    // capture lost without pointerup (rare): keep what was measured so far, forget a plain press
    target.addEventListener('lostpointercapture', function (ev) {
      if (!st || ev.pointerId !== st.id) return;
      var s = st;
      st = null;
      if (s.drag && !s.follow && chart.sync) chart.sync.measureEnd(null);
    });
  }

  function baseDom(chart, el, cls) {
    chart.el = el;
    chart.id = 'pfc' + (++uid);
    el.classList.add('pc', cls);
    chart.svg = svgEl('svg', { 'class': 'pc-svg', 'aria-hidden': 'true', focusable: 'false' });
    el.appendChild(chart.svg);
    chart.defs = svgEl('defs', null, chart.svg);
    chart.gGrid = svgEl('g', { 'class': 'pc-grid' }, chart.svg);
    chart.gSeries = svgEl('g', { 'class': 'pc-series' }, chart.svg);
    chart.gOver = svgEl('g', { 'class': 'pc-over' }, chart.svg);
    chart.gAxis = svgEl('g', { 'class': 'pc-axis' }, chart.svg);
    chart.gTop = svgEl('g', { 'class': 'pc-top' }, chart.svg);
    chart.msg = document.createElement('div');
    chart.msg.className = 'pc-msg';
    chart.msg.hidden = true;
    el.appendChild(chart.msg);
    chart.L = null;
    chart.model = null;
    if (chart.sync) chart.sync.add(chart);
    bindPointer(chart);
  }

  function sizeSvg(chart) {
    var W = Math.floor(chart.el.clientWidth), H = Math.floor(chart.el.clientHeight);
    chart.svg.setAttribute('width', W);
    chart.svg.setAttribute('height', H);
    chart.svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    return { W: W, H: H };
  }

  function drawYLabels(g, labels, W, avoid) {
    for (var k = 0; k < labels.length; k++) {
      var lb = labels[k], cy = lb.y - 9;
      if (avoid && Math.abs(cy - avoid) < 13) continue;         // keep clear of the value box
      var t = svgEl('text', { x: W, y: r1(lb.y - 5), 'text-anchor': 'end', 'class': 'pc-ylabel' }, g);
      t.textContent = lb.text;
    }
  }
  function drawXLabels(g, labels, y) {
    for (var k = 0; k < labels.length; k++) {
      var t = svgEl('text', { x: r1(labels[k].x), y: y, 'text-anchor': labels[k].anchor, 'class': 'pc-xlabel' }, g);
      t.textContent = labels[k].text;
    }
  }
  function vline(g, x, y1, y2, cls) {
    return svgEl('line', { x1: crisp(x), x2: crisp(x), y1: Math.round(y1), y2: Math.round(y2), 'class': cls || 'pc-vline' }, g);
  }

  // ---------------------------------------------------------------- Main chart
  /**
   * model = {
   *   dates: [iso], firstIsMonthStart: bool,
   *   series: { values: [number] } | null          – portfolio in the active mode (value or P/L)
   *   benches: [{ id, color, values: [number] }],
   *   baseline: number,                              – start value (Portfoliowert) or 0 (Gesamtrendite)
   *   axisLabel(v, step), lastLabel(v), monthLabel(iso, withYear), dayLabel(iso),
   *   hoverHTML(i, maxBench), measureHTML(a, b) -> html | { main: html, side: html|'' }, emptyText
   * }
   * measureHTML's `side` is an optional second box ("Mein Depot") placed beside the measure box (same top, same
   * height), or stacked under it on narrow charts. hoverHTML's optional maxBench caps the benchmark rows (used to size
   * the band). The band above the plot is sized from the real box heights: the measure box(es) and the hover box with
   * up to BAND_BENCH_ROWS benchmarks. When the hover box needs more room than the measure boxes, the chart element
   * grows by the difference (CSS var --band-extra), so the plot keeps its height.
   */
  var TIP_TOP = 2;          // px from the chart top to the tooltip boxes
  var TIP_GAP = 4;          // px between the measure box and the side box
  var BAND_MARGIN = 18;     // px between the lowest box and the plot top (keeps a y-label at the plot top clear)
  var BAND_BENCH_ROWS = 3;  // hover box rows kept out of the plot (user, 27.09.: more benchmarks may overlap)
  function tipParts(h) {
    return h && typeof h === 'object' ? { main: h.main || '', side: h.side || '' } : { main: h || '', side: '' };
  }
  function fillTip(tip, cls, html) {
    tip.className = cls;
    tip.innerHTML = html;
    tip.style.width = 'auto';
    tip.style.height = '';
    tip.style.left = '0px';
    tip.style.top = TIP_TOP + 'px';
    tip.hidden = false;
  }
  function MainChart(el, opts) {
    opts = opts || {};
    this.sync = opts.sync || null;
    baseDom(this, el, 'pc-main');
    this.tip = document.createElement('div');
    this.tip.className = 'pc-tip';
    this.tip.hidden = true;
    el.appendChild(this.tip);
    this.tip2 = document.createElement('div');        // side box of a measurement ("Mein Depot")
    this.tip2.className = 'pc-tip';
    this.tip2.hidden = true;
    el.appendChild(this.tip2);
    this.tipKey = '';
    this.tipW = 0; this.tipH = 0; this.tip2W = 0; this.tip2H = 0;
    this.sideOn = false;
    this.stack = false;
    this.tipBottom = TIP_TOP;
    this.bandExtra = 0;      // px the element is taller than its CSS height (--band-extra, see _band)
    this.size = null;        // { W, H } of the last render
  }

  MainChart.prototype.render = function (model) {
    if (model !== undefined) this.model = model;
    var M = this.model;
    clear(this.defs); clear(this.gGrid); clear(this.gSeries); clear(this.gOver); clear(this.gAxis); clear(this.gTop);
    this.hideTip();
    this.L = null;
    var vals = M && M.series && M.series.values;
    var ghost = M && M.ghost && M.ghost.values ? M.ghost.values : null;          // what-if: original portfolio
    var ext = vals && vals.length ?
      extent([vals, ghost].concat((M.benches || []).map(function (b) { return b.values; })), [M.baseline]) : null;
    var W0 = Math.floor(this.el.clientWidth), compact = W0 < 560;
    this.el.classList.toggle('pc--compact', compact);                // before the boxes are measured (compact padding)
    // intraday: M.last = last slot with data (later slots stay empty, as in the app), M.ctxEnd = end of the grey
    // context (earlier sessions); the colored line, the area and the dashed baseline start after it
    var lastI = ext ? (isNum(M.last) ? clamp(M.last, 0, vals.length - 1) : vals.length - 1) : 0;
    // band above the plot for the boxes, derived from their real height so they never cover the plot; the chart
    // grows by what the hover box needs beyond the measure boxes (the height is read after that)
    var band = ext && W0 > 60 ? this._band(M, lastI, W0, compact) : null;
    var extra = band ? band.extra : 0;
    if (extra !== this.bandExtra) this._setExtra(extra);
    var size = sizeSvg(this), W = size.W, H = size.H;
    this.size = size;
    var ok = !!(band && W > 60 && H > 120);
    this.msg.textContent = M && !ok ? (M.emptyText || '') : '';
    this.msg.hidden = !this.msg.textContent;
    this.el.classList.toggle('is-empty', !ok);
    this.svg.classList.remove('is-measuring');
    if (!ok) return;

    var ff = root.getComputedStyle ? root.getComputedStyle(this.el).fontFamily : 'sans-serif';
    var m = vals.length, benches = M.benches || [];
    var top = band.top, bottom = H - (compact ? 30 : 38);
    var cEnd = isNum(M.ctxEnd) && M.ctxEnd < lastI ? M.ctxEnd : -1;
    var main = cEnd < 0 ? vals : vals.map(function (v, k) { return k > cEnd ? v : null; });

    // value box at the right edge decides how much room the plot leaves on the right
    var lastV = vals[lastI];
    var lastTxt = isNum(lastV) && M.lastLabel ? M.lastLabel(lastV) : '';
    var boxFont = '600 11px ' + ff;
    var boxW = lastTxt ? Math.ceil(textW(lastTxt, boxFont)) + 10 : 0;
    var X = xLayout(W, m, 1, lastTxt ? boxW + 10 : 8);

    var span = ext.hi - ext.lo;
    if (span <= 0) span = Math.abs(ext.hi) * 0.02 || 1;
    var dLo = ext.lo - span * 0.07, dHi = ext.hi + span * 0.09;
    var yOf = function (v) { return top + (dHi - v) / (dHi - dLo) * (bottom - top); };
    var L = this.L = {
      W: W, H: H, top: top, bottom: bottom, m: m, padL: X.padL, padR: X.padR, plotW: X.plotW,
      x: X.x, idx: function (px) { return Math.min(X.idx(px), lastI); }, y: yOf, tipTop: TIP_TOP
    };

    // grid + y labels
    var T = niceTicks(dLo, dHi, 4), ylabels = [];
    for (var k = 0; k < T.ticks.length; k++) {
      var tv = T.ticks[k], ty = crisp(yOf(tv));
      if (ty < top - 1 || ty > bottom + 1) continue;
      svgEl('line', { x1: 0, x2: W, y1: ty, y2: ty, 'class': 'pc-gridline' }, this.gGrid);
      ylabels.push({ y: ty, text: M.axisLabel ? M.axisLabel(tv, T.step) : String(tv) });
    }
    var yBase = isNum(M.baseline) ? yOf(M.baseline) : bottom;
    if (isNum(M.baseline)) svgEl('line', { x1: cEnd < 0 ? 0 : r1(X.x(cEnd + 1)), x2: W, y1: crisp(yBase), y2: crisp(yBase), 'class': 'pc-baseline' }, this.gGrid);

    // benchmarks (below the portfolio)
    for (var b = 0; b < benches.length; b++) {
      var bd = linePath(benches[b].values || [], X.x, yOf);
      if (bd) svgEl('path', { d: bd, 'class': 'pc-bench', style: 'stroke:' + benches[b].color }, this.gSeries);
    }
    if (ghost) {
      var gd = linePath(ghost, X.x, yOf);
      if (gd) svgEl('path', { d: gd, 'class': 'pc-ghost' }, this.gSeries);
    }

    if (cEnd >= 0) {
      var cd = linePath(vals.slice(0, cEnd + 1), X.x, yOf);
      if (cd) svgEl('path', { d: cd, 'class': 'pc-line pc-line--ctx' }, this.gSeries);
    }

    // portfolio area as in the app: teal gradient above the baseline, red below (start value / 0 €)
    var vExt = extent([main]);
    var area = areaPath(main, X.x, yOf, yBase);
    if (area && vExt) {
      var gArea = svgEl('g', { 'class': 'pc-area' }, this.gSeries);
      var idA = this.id + '-ga', idB = this.id + '-gb', cA = this.id + '-ca', cB = this.id + '-cb';
      var clipA = svgEl('clipPath', { id: cA }, this.defs);
      svgEl('rect', { x: 0, y: 0, width: W, height: Math.max(0, yBase) }, clipA);
      var clipB = svgEl('clipPath', { id: cB }, this.defs);
      svgEl('rect', { x: 0, y: yBase, width: W, height: Math.max(0, H - yBase) }, clipB);
      var fillA = gradient(this.defs, idA, Math.min(yOf(vExt.hi), yBase - 1), yBase, 'var(--accent)', 0.35, 0);
      var fillB = gradient(this.defs, idB, Math.max(yOf(vExt.lo), yBase + 1), yBase, 'var(--neg)', 0.35, 0);
      if (yOf(vExt.hi) < yBase) svgEl('path', { d: area, fill: fillA, 'clip-path': 'url(#' + cA + ')' }, gArea);
      if (yOf(vExt.lo) > yBase) svgEl('path', { d: area, fill: fillB, 'clip-path': 'url(#' + cB + ')' }, gArea);
    }
    // the line itself switches colour where it crosses the baseline
    if (isNum(M.baseline)) {
      var sp = splitPaths(main, 0, X.x, yOf, M.baseline);
      if (sp.dn) svgEl('path', { d: sp.dn, 'class': 'pc-line pc-line--dn' }, this.gSeries);
      if (sp.up) svgEl('path', { d: sp.up, 'class': 'pc-line' }, this.gSeries);
    } else {
      svgEl('path', { d: linePath(main, X.x, yOf), 'class': 'pc-line' }, this.gSeries);
    }

    // last value: dotted link + box at the right edge (teal, red below the baseline)
    var boxMid = null;
    if (lastTxt) {
      var xl = X.x(lastI), yl = yOf(lastV), boxH = 17, below = isNum(M.baseline) && lastV < M.baseline ? ' is-neg' : '';
      var by = Math.round(clamp(yl - boxH / 2, top - 12, bottom - boxH + 4));
      var bx = W - boxW;
      boxMid = by + boxH / 2;
      if (bx - xl > 6) svgEl('line', { x1: r1(xl + 3), x2: bx - 2, y1: crisp(yl), y2: crisp(yl), 'class': 'pc-lastlink' + below }, this.gTop);
      svgEl('rect', { x: bx, y: by, width: boxW, height: boxH, rx: 2, 'class': 'pc-lastbox' + below }, this.gTop);
      var tt = svgEl('text', { x: r1(bx + boxW / 2), y: by + 12.5, 'text-anchor': 'middle', 'class': 'pc-lasttext' }, this.gTop);
      tt.textContent = lastTxt;
    }

    drawYLabels(this.gAxis, ylabels, W, boxMid);
    drawXLabels(this.gAxis, xLabels(M, L, '600 11px ' + ff), H - 8);

    this.drawOverlay(this.sync);
  };

  MainChart.prototype.hideTip = function () { this.tip.hidden = true; this.tip2.hidden = true; this.tipKey = ''; };

  /**
   * Band above the plot for the current content: { top, extra }. top = the taller of the measure block (measure box
   * + side box: beside it, or stacked under it when both do not fit next to each other; probed with the full range)
   * and the hover box with at most BAND_BENCH_ROWS benchmark rows, plus a margin. extra = how much taller the hover
   * box is than the measure block: the chart element grows by that, so the plot height does not depend on it.
   */
  MainChart.prototype._band = function (M, lastI, W, compact) {
    var t1 = this.tip, t2 = this.tip2, h = tipParts(M.measureHTML ? M.measureHTML(0, lastI) : '');
    t1.style.visibility = t2.style.visibility = 'hidden';
    fillTip(t1, 'pc-tip pc-tip--measure', h.main);
    var w1 = t1.offsetWidth, h1 = t1.offsetHeight, w2 = 0, h2 = 0, hh = 0;
    if (h.side) { fillTip(t2, 'pc-tip pc-tip--side', h.side); w2 = Math.ceil(t2.getBoundingClientRect().width); h2 = t2.offsetHeight; }
    if (M.hoverHTML) { fillTip(t1, 'pc-tip pc-tip--hover', tipParts(M.hoverHTML(lastI, BAND_BENCH_ROWS)).main); hh = t1.offsetHeight; }
    t1.style.visibility = t2.style.visibility = '';
    this.hideTip();
    this.stack = !!h.side && (compact || w1 + TIP_GAP + w2 > W);
    var block = !(h1 > 0) ? (compact ? 62 : 80) - TIP_TOP - BAND_MARGIN : !h.side ? h1 : this.stack ? h1 + TIP_GAP + h2 : Math.max(h1, h2);
    return { top: Math.ceil(TIP_TOP + Math.max(block, hh) + BAND_MARGIN), extra: Math.max(0, Math.ceil(hh - block)) };
  };

  /**
   * Sets the extra band height. The change comes from controls below the chart (benchmark cards, Stück fields), so the
   * content there stays where it is (manual scroll anchoring): the page scrolls by the height change when the focus is
   * below the chart or the chart ends above the middle of the window – unless the browser already compensated.
   */
  MainChart.prototype._setExtra = function (extra) {
    var el = this.el, dh = extra - this.bandExtra, t0 = el.getBoundingClientRect().top, a = document.activeElement;
    el.style.setProperty('--band-extra', extra + 'px');
    this.bandExtra = extra;
    var r = el.getBoundingClientRect(), vh = root.innerHeight || 0;
    var below = a && a !== document.body && !el.contains(a) && (el.compareDocumentPosition(a) & 4);   // 4 = FOLLOWING
    if (dh && r.top === t0 && (below || r.bottom - dh < vh / 2) && root.scrollBy) root.scrollBy(0, dh);
  };

  /** True when the element's size differs from the last render (a resize the chart did not cause itself). */
  MainChart.prototype.sizeChanged = function () {
    var s = this.size;
    return !s || Math.floor(this.el.clientWidth) !== s.W || Math.floor(this.el.clientHeight) !== s.H;
  };

  MainChart.prototype.drawOverlay = function (S) {
    var g = this.gOver, L = this.L, M = this.model;
    clear(g);
    var meas = S && S.measure, hov = S ? S.hoverI : null;
    if (!L || !M || !M.series) { this.hideTip(); this.svg.classList.remove('is-measuring'); return; }
    var vals = M.series.values, m = L.m, yBot = L.bottom, yTop;
    var measuring = !!(meas && meas.a !== meas.b && meas.a != null && meas.b != null);
    this.svg.classList.toggle('is-measuring', measuring);
    if (meas && !measuring && meas.a != null) hov = meas.a;       // pressed, not dragged yet

    // the tooltip sits at the top of the chart; the dotted lines start at its lower edge (as in the app)
    if (measuring) {
      var a = clamp(Math.min(meas.a, meas.b), 0, m - 1), b = clamp(Math.max(meas.a, meas.b), 0, m - 1);
      var xa = L.x(a), xb = L.x(b);
      this.showMeasureTip(a, b, xa, xb, !meas.live);
      yTop = Math.min(yBot - 10, this.tipBottom);
      svgEl('rect', { x: r1(xa), y: yTop, width: r1(Math.max(0, xb - xa)), height: Math.max(0, yBot - yTop), 'class': 'pc-region' }, g);
      vline(g, xa, yTop, yBot);
      vline(g, xb, yTop, yBot);
      if (isNum(vals[a])) svgEl('circle', { cx: r1(xa), cy: r1(L.y(vals[a])), r: 4, 'class': 'pc-ring' }, g);
      if (isNum(vals[b])) svgEl('circle', { cx: r1(xb), cy: r1(L.y(vals[b])), r: 4, 'class': 'pc-ring' }, g);
    } else if (hov != null && hov >= 0 && hov < m) {
      var x = L.x(hov);
      this.showHoverTip(hov, x);
      yTop = Math.min(yBot - 10, this.tipBottom);
      vline(g, x, yTop, yBot, 'pc-vline pc-vline--hover');
      var benches = M.benches || [];
      for (var k = 0; k < benches.length; k++) {
        var bv = benches[k].values && benches[k].values[hov];
        if (isNum(bv)) svgEl('circle', { cx: r1(x), cy: r1(L.y(bv)), r: 2.75, fill: benches[k].color, 'class': 'pc-dot' }, g);
      }
      var gv = M.ghost && M.ghost.values ? M.ghost.values[hov] : null;
      if (isNum(gv)) svgEl('circle', { cx: r1(x), cy: r1(L.y(gv)), r: 2.75, 'class': 'pc-dot pc-dot--ghost' }, g);
      if (isNum(vals[hov])) svgEl('circle', { cx: r1(x), cy: r1(L.y(vals[hov])), r: 4, 'class': 'pc-ring pc-ring--hover' }, g);
    } else {
      this.hideTip();
    }
  };

  /** Fills the box(es) when the content key changes (tipKey = '' forces a rebuild) and reads their natural size. */
  MainChart.prototype._setTip = function (key, cls, html) {
    if (this.tipKey === key) return;
    var h = tipParts(html), tip = this.tip, t2 = this.tip2;
    fillTip(tip, 'pc-tip ' + cls, h.main);
    this.tipW = tip.offsetWidth;            // natural size (layout read only when the index changes)
    this.tipH = tip.offsetHeight;
    this.sideOn = !!h.side;
    if (h.side) {
      fillTip(t2, 'pc-tip pc-tip--side', h.side);
      this.tip2W = Math.ceil(t2.getBoundingClientRect().width);   // not offsetWidth: rounded down, the boxes would wrap
      this.tip2H = t2.offsetHeight;
    } else {
      t2.hidden = true;
    }
    this.tipSetW = this.tip2SetW = null;
    this.tipKey = key;
  };

  MainChart.prototype.showHoverTip = function (i, x) {
    var L = this.L, M = this.model;
    this._setTip('h' + i, 'pc-tip--hover', M.hoverHTML ? M.hoverHTML(i) : '');
    var w = Math.min(this.tipW, L.W);
    this.tip.style.width = w + 'px';
    this.tip.style.left = Math.round(clamp(x - w / 2, 0, Math.max(0, L.W - w))) + 'px';
    this.tip.hidden = false;
    this.tipBottom = L.tipTop + this.tipH;
  };

  /**
   * Measure box at the top (reaches 40px past both lines, as in the app; centred when narrower than its content;
   * clamped to the chart). The side box goes right of it, or left when there is no room on the right; if neither fits,
   * the pair shifts by the smaller amount. Narrow charts (this.stack, from render) put the side box under it.
   */
  MainChart.prototype.showMeasureTip = function (a, b, xa, xb, pinned) {
    var L = this.L, M = this.model, W = L.W, tip = this.tip, t2 = this.tip2;
    this._setTip('m' + a + '-' + b, 'pc-tip--measure', M.measureHTML ? M.measureHTML(a, b) : '');
    var side = this.sideOn, sw = side ? Math.min(this.tip2W, W) : 0, natural = Math.min(this.tipW, W);
    var stack = side && (this.stack || natural + TIP_GAP + sw > W);
    var room = side && !stack ? W - sw - TIP_GAP : W;                 // width left for the measure box
    var mid = (xa + xb) / 2, left = xa - 40, right = xb + 40;
    if (right - left < natural) { left = mid - natural / 2; right = mid + natural / 2; }
    else if (right - left > room) { left = mid - room / 2; right = mid + room / 2; }
    if (left < 0) { right -= left; left = 0; }
    if (right > W) { left -= right - W; right = W; }
    left = Math.round(Math.max(0, left));
    right = Math.round(right);
    var sl = 0;
    if (side && !stack) {
      if (right + TIP_GAP + sw <= W) sl = right + TIP_GAP;
      else if (left - TIP_GAP - sw >= 0) sl = left - TIP_GAP - sw;
      else {
        var dR = right + TIP_GAP + sw - W, dL = TIP_GAP + sw - left;
        if (dR <= dL) { left -= dR; right -= dR; sl = right + TIP_GAP; }
        else { left += dL; right += dL; sl = left - TIP_GAP - sw; }
      }
    }
    var w = right - left;
    tip.style.left = left + 'px';
    if (w !== this.tipSetW) {
      tip.style.width = w + 'px';
      this.tipSetW = w;
      this.tipH = tip.offsetHeight;
    }
    tip.hidden = false;
    var bottom = L.tipTop + this.tipH;
    if (side) {
      var w2 = sw, top2 = L.tipTop;
      if (stack) {                                                     // under the measure box, same left edge
        w2 = Math.min(W, Math.max(w, sw));
        sl = clamp(left, 0, W - w2);
        top2 = bottom + TIP_GAP;
      }
      t2.style.left = Math.round(sl) + 'px';
      t2.style.top = top2 + 'px';
      if (!stack) {                                                    // same height as the measure box
        if (w2 !== this.tip2SetW) { t2.style.width = w2 + 'px'; this.tip2SetW = w2; }
        var hh = Math.max(this.tipH, this.tip2H);
        tip.style.height = t2.style.height = hh + 'px';
      } else {
        tip.style.height = t2.style.height = '';
        // the side boxes may wrap into more rows at the stacked width: read their height again
        if (w2 !== this.tip2SetW) { t2.style.width = w2 + 'px'; this.tip2SetW = w2; this.tip2H = t2.offsetHeight; }
      }
      t2.classList.toggle('is-pinned', !!pinned);                     // pinned: rows take the pointer (title)
      t2.hidden = false;
      bottom = stack ? top2 + this.tip2H : L.tipTop + Math.max(this.tipH, this.tip2H);
    }
    this.tipBottom = bottom;
  };

  // ---------------------------------------------------------------- Drawdown chart
  /**
   * model = {
   *   dates, firstIsMonthStart, dd: [<=0 fractions], benches: [{ id, color, dd: [...] }],
   *   maxMarker: { i, value, label } | null, axisLabel(v, step), monthLabel, dayLabel,
   *   readout(i|null) -> html, emptyText, padR (from the main chart, keeps x in sync)
   * }
   * opts.readout: element that receives the hover read-out.
   */
  function DrawdownChart(el, opts) {
    opts = opts || {};
    this.sync = opts.sync || null;
    this.readoutEl = opts.readout || null;
    baseDom(this, el, 'pc-dd');
    this.readKey = null;
  }

  DrawdownChart.prototype.render = function (model) {
    if (model !== undefined) this.model = model;
    var M = this.model, size = sizeSvg(this), W = size.W, H = size.H;
    clear(this.defs); clear(this.gGrid); clear(this.gSeries); clear(this.gOver); clear(this.gAxis); clear(this.gTop);
    this.L = null;
    this.readKey = null;
    var dd = M && M.dd;
    var ext = dd && dd.length ? extent([dd].concat((M.benches || []).map(function (b) { return b.dd; })), [0]) : null;
    var ok = !!(ext && W > 60 && H > 60);
    this.msg.textContent = M && !ok ? (M.emptyText || '') : '';
    this.msg.hidden = !this.msg.textContent;
    this.el.classList.toggle('is-empty', !ok);
    if (!ok) { this.setReadout(null); return; }

    var ff = root.getComputedStyle ? root.getComputedStyle(this.el).fontFamily : 'sans-serif';
    var m = dd.length, top = 20, bottom = H - 26;
    var X = xLayout(W, m, 1, isNum(M.padR) ? M.padR : 60);
    var lo = Math.min(ext.lo, 0);
    var dLo = lo < -0.0025 ? lo * 1.12 : -0.01;
    var yOf = function (v) { return top + (0 - v) / (0 - dLo) * (bottom - top); };
    var lastI = isNum(M.last) ? clamp(M.last, 0, m - 1) : m - 1;
    var L = this.L = { W: W, H: H, top: top, bottom: bottom, m: m, padL: X.padL, padR: X.padR, plotW: X.plotW, x: X.x,
      idx: function (px) { return Math.min(X.idx(px), lastI); }, y: yOf };

    var T = niceTicks(dLo, 0, 4), ylabels = [];
    for (var k = 0; k < T.ticks.length; k++) {
      var ty = crisp(yOf(T.ticks[k]));
      if (ty < top - 1 || ty > bottom + 1) continue;
      svgEl('line', { x1: 0, x2: W, y1: ty, y2: ty, 'class': 'pc-gridline' }, this.gGrid);
      ylabels.push({ y: ty, text: M.axisLabel ? M.axisLabel(T.ticks[k], T.step) : String(T.ticks[k]) });
    }

    var benches = M.benches || [];
    for (var b = 0; b < benches.length; b++) {
      var bd = linePath(benches[b].dd || [], X.x, yOf);
      if (bd) svgEl('path', { d: bd, 'class': 'pc-bench pc-bench--dd', style: 'stroke:' + benches[b].color }, this.gSeries);
    }
    var y0 = yOf(0), yMin = yOf(lo);
    var area = areaPath(dd, X.x, yOf, y0);
    if (area && yMin > y0 + 0.5) {
      var fill = gradient(this.defs, this.id + '-gdd', yMin, y0, 'var(--neg)', 0.45, 0.05);
      svgEl('path', { d: area, fill: fill, 'class': 'pc-ddarea' }, this.gSeries);
    }
    svgEl('path', { d: linePath(dd, X.x, yOf), 'class': 'pc-ddline' }, this.gSeries);

    // max drawdown marker + label
    var mk = M.maxMarker;
    if (mk && isNum(mk.value) && mk.value < 0 && mk.i >= 0 && mk.i < m) {
      var mx = X.x(mk.i), my = yOf(mk.value), font = '600 11px ' + ff, lw = textW(mk.label, font);
      svgEl('circle', { cx: r1(mx), cy: r1(my), r: 3.5, 'class': 'pc-ddmark' }, this.gTop);
      // right of the marker, else left of it; when it fits on neither side (long sub-daily labels on phones) it goes
      // under the marker, centred on it and kept inside the plot (its text stroke keeps it readable over the lines)
      var right = mx + 8 + lw <= W - 4, left = mx - 8 - lw >= 0, under = !right && !left;
      var lx = right ? mx + 8 : left ? mx - 8 : clamp(mx - lw / 2, 0, Math.max(0, X.padL + X.plotW - lw));
      var ly = under ? (my + 17 <= bottom + 12 ? my + 17 : my - 9) : clamp(my + 4, top + 10, bottom + 12);
      var lt = svgEl('text', {
        x: r1(lx), y: r1(ly), 'text-anchor': right || under ? 'start' : 'end', 'class': 'pc-ddlabel'
      }, this.gTop);
      lt.textContent = mk.label;
    }

    drawYLabels(this.gAxis, ylabels, W, null);
    drawXLabels(this.gAxis, xLabels(M, L, '600 11px ' + ff), H - 8);
    this.drawOverlay(this.sync);
  };

  DrawdownChart.prototype.setReadout = function (i) {
    if (!this.readoutEl) return;
    var key = i == null ? 'none' : 'i' + i;
    if (this.readKey === key) return;
    this.readKey = key;
    var M = this.model;
    this.readoutEl.innerHTML = M && M.readout ? M.readout(i) : '';
  };

  DrawdownChart.prototype.drawOverlay = function (S) {
    var g = this.gOver, L = this.L, M = this.model;
    clear(g);
    if (!L || !M || !M.dd) { this.setReadout(null); return; }
    var meas = S && S.measure, hov = S ? S.hoverI : null, m = L.m;
    var measuring = !!(meas && meas.a !== meas.b && meas.a != null && meas.b != null);
    if (meas && !measuring && meas.a != null) hov = meas.a;
    if (measuring) {
      var a = clamp(Math.min(meas.a, meas.b), 0, m - 1), b = clamp(Math.max(meas.a, meas.b), 0, m - 1);
      var xa = L.x(a), xb = L.x(b);
      svgEl('rect', { x: r1(xa), y: L.top, width: r1(Math.max(0, xb - xa)), height: L.bottom - L.top, 'class': 'pc-region' }, g);
      vline(g, xa, L.top, L.bottom, 'pc-vline pc-vline--dd');
      vline(g, xb, L.top, L.bottom, 'pc-vline pc-vline--dd');
      this.setReadout(null);
    } else if (hov != null && hov >= 0 && hov < m) {
      var x = L.x(hov);
      vline(g, x, L.top, L.bottom, 'pc-vline pc-vline--hover');
      var benches = M.benches || [];
      for (var k = 0; k < benches.length; k++) {
        var bv = benches[k].dd && benches[k].dd[hov];
        if (isNum(bv)) svgEl('circle', { cx: r1(x), cy: r1(L.y(bv)), r: 2.5, fill: benches[k].color, 'class': 'pc-dot' }, g);
      }
      if (isNum(M.dd[hov])) svgEl('circle', { cx: r1(x), cy: r1(L.y(M.dd[hov])), r: 3.5, 'class': 'pc-ring pc-ring--dd' }, g);
      this.setReadout(hov);
    } else {
      this.setReadout(null);
    }
  };

  // ---------------------------------------------------------------- Sparklines (SVG strings for cells / list rows)
  /** Paths for values[from..] split at `base`: points >= base go to `up`, below to `dn`; crossings are interpolated. */
  function splitPaths(values, from, xOf, yOf, base) {
    var up = '', dn = '', prev = null, yb = r1(yOf(base));
    for (var k = from; k < values.length; k++) {
      var v = values[k];
      if (!isNum(v)) { prev = null; continue; }
      var x = r1(xOf(k)), y = r1(yOf(v)), side = v >= base ? 1 : -1, pt = x + ' ' + y;
      if (!prev) {
        if (side > 0) up += 'M' + pt; else dn += 'M' + pt;
      } else if (side === prev.side) {
        if (side > 0) up += 'L' + pt; else dn += 'L' + pt;
      } else {
        var t = (base - prev.v) / (v - prev.v), xi = r1(prev.x + t * (x - prev.x)), cross = xi + ' ' + yb;
        if (prev.side > 0) { up += 'L' + cross; dn += 'M' + cross + 'L' + pt; } else { dn += 'L' + cross; up += 'M' + cross + 'L' + pt; }
      }
      prev = { x: x, v: v, side: side };
    }
    return { up: up, dn: dn };
  }

  /**
   * Sparkline: values[0..off] grey context, values[off..] teal where >= base and red where below
   * (split exactly at the crossings), dashed baseline at `base` (default values[off] = period start).
   * o = { w, h, off, base, includeBase (y-extent includes base), baseline:false, cls, fluid (scales with CSS size) }
   */
  function splitSpark(values, o) {
    o = o || {};
    var w = o.w || 64, h = o.h || 22, pad = o.pad != null ? o.pad : 2, n = values ? values.length : 0;
    var out = '<svg class="spark' + (o.cls ? ' ' + o.cls : '') + '" viewBox="0 0 ' + w + ' ' + h + '"' +
      (o.fluid ? ' preserveAspectRatio="none"' : ' width="' + w + '" height="' + h + '"') + ' aria-hidden="true" focusable="false">';
    if (!n) return out + '</svg>';
    var off = clamp(Math.round(o.off) || 0, 0, n - 1), first = null;
    for (var k = off; k < n; k++) if (isNum(values[k])) { first = values[k]; break; }
    var base = isNum(o.base) ? o.base : first;
    var ext = extent([values], o.includeBase && isNum(base) ? [base] : null);
    if (!ext || !isNum(base)) return out + '</svg>';
    var lo = ext.lo, hi = ext.hi;
    if (hi - lo < 1e-12) { lo -= 1; hi += 1; }
    var xOf = function (i) { return pad + (n > 1 ? i * (w - 2 * pad) / (n - 1) : (w - 2 * pad) / 2); };
    var yOf = function (v) { return pad + (hi - v) / (hi - lo) * (h - 2 * pad); };
    var ve = o.fluid ? ' vector-effect="non-scaling-stroke"' : '';
    if (o.baseline !== false) {
      var yb = r1(yOf(base));
      out += '<line class="spk-base" x1="0" x2="' + w + '" y1="' + yb + '" y2="' + yb + '"' + ve + '/>';
    }
    if (off > 0) out += '<path class="spk-ctx" d="' + linePath(values.slice(0, off + 1), xOf, yOf) + '"' + ve + '/>';
    var sp = splitPaths(values, off, xOf, yOf, base);
    if (sp.dn) out += '<path class="spk-dn" d="' + sp.dn + '"' + ve + '/>';
    if (sp.up) out += '<path class="spk-up" d="' + sp.up + '"' + ve + '/>';
    return out + '</svg>';
  }

  /** Table sparkline (80×22 default): whole series, split-coloured against its first value. */
  function sparkline(values, o) {
    o = o || {};
    return splitSpark(values, { w: o.w || 80, h: o.h || 22, cls: o.cls });
  }

  // ---------------------------------------------------------------- Correlation heatmap
  /** RGB triplet of a CSS custom property like "--accent-rgb: 40, 235, 207" (single colour source: the stylesheet). */
  function cssTriplet(name, fallback) {
    try {
      var v = root.getComputedStyle(document.documentElement).getPropertyValue(name).split(',').map(Number);
      if (v.length === 3 && v.every(isNum)) return v;
    } catch (e) { /* no styles yet */ }
    return fallback;
  }
  var HM = null;                                   // {neutral, pos, neg}, read once from the stylesheet
  /** Diverging colour: −1 --neg … 0 neutral … +1 --accent (null = empty cell). */
  function corrColor(c) {
    if (!isNum(c)) return null;
    if (!HM) HM = { neutral: cssTriplet('--neutral-rgb', [42, 45, 49]), pos: cssTriplet('--accent-rgb', [40, 235, 207]), neg: cssTriplet('--neg-rgb', [231, 142, 120]) };
    var t = Math.min(1, Math.abs(c)), to = c >= 0 ? HM.pos : HM.neg, rgb = [];
    for (var k = 0; k < 3; k++) rgb.push(Math.round(HM.neutral[k] + (to[k] - HM.neutral[k]) * t));
    return 'rgb(' + rgb.join(',') + ')';
  }

  /**
   * model = { labels: [short], titles: [full name], m: [[c|null]], n: [[count]],
   *           valueLabel(c) -> "0,82", tipText(i, j) -> "Micron × SK Hynix: 0,82 (184 Tage)" }
   */
  function Heatmap(el) {
    this.el = el;
    el.classList.add('hm');
    this.svg = svgEl('svg', { 'class': 'hm-svg', role: 'img', 'aria-label': 'Korrelationsmatrix der Tagesrenditen' });
    el.appendChild(this.svg);
    this.tip = document.createElement('div');
    this.tip.className = 'hm-tip';
    this.tip.hidden = true;
    el.appendChild(this.tip);
    this.model = null;
    this.G = null;
    this.hot = null;
    var self = this;
    function cellAt(ev) {
      var G = self.G;
      if (!G) return null;
      var r = self.svg.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
      var j = Math.floor((x - G.x0) / G.cell), i = Math.floor((y - G.y0) / G.cell);
      return i >= 0 && j >= 0 && i < G.n && j < G.n ? { i: i, j: j } : null;
    }
    this.svg.addEventListener('pointermove', function (ev) { if (ev.pointerType === 'mouse') self.highlight(cellAt(ev)); });
    this.svg.addEventListener('pointerdown', function (ev) { if (ev.pointerType !== 'mouse') self.highlight(cellAt(ev)); });
    this.svg.addEventListener('pointerleave', function (ev) { if (ev.pointerType === 'mouse') self.highlight(null); });
  }

  Heatmap.prototype.render = function (model) {
    if (model !== undefined) this.model = model;
    var M = this.model, svg = this.svg;
    clear(svg);
    this.tip.hidden = true;
    this.hot = null;
    this.G = null;
    var n = M && M.labels ? M.labels.length : 0;
    if (!n) { svg.setAttribute('width', 0); svg.setAttribute('height', 0); return; }
    var ff = root.getComputedStyle ? root.getComputedStyle(this.el).fontFamily : 'sans-serif';
    var font = '600 11px ' + ff, lw = 0;
    for (var k = 0; k < n; k++) lw = Math.max(lw, textW(M.labels[k], font));
    var labelW = Math.ceil(lw) + 10, avail = Math.max(200, this.el.clientWidth);
    var cell = clamp(Math.floor((avail - labelW - lw * 0.55 - 8) / n), 14, 40);
    var cos = Math.cos(Math.PI / 3), sin = Math.sin(Math.PI / 3);        // column labels at −60°
    var x0 = labelW, y0 = Math.ceil(lw * sin) + 12;
    var W = Math.ceil(x0 + n * cell + lw * cos + 8), H = y0 + n * cell + 2;
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    this.G = { x0: x0, y0: y0, cell: cell, n: n };
    var showNum = cell >= 30 && M.valueLabel;
    var gRows = svgEl('g', { 'class': 'hm-rows' }, svg), gCols = svgEl('g', { 'class': 'hm-cols' }, svg);
    var gCells = svgEl('g', { 'class': 'hm-cells' }, svg);
    this.rowLbl = [];
    this.colLbl = [];
    for (var i = 0; i < n; i++) {
      var ty = y0 + i * cell + cell / 2 + 4;
      var rl = svgEl('text', { x: labelW - 6, y: r1(ty), 'text-anchor': 'end', 'class': 'hm-label' }, gRows);
      rl.textContent = M.labels[i];
      this.rowLbl.push(rl);
      var cx = x0 + i * cell + cell / 2 + 3;
      var cl = svgEl('text', { x: 0, y: 0, 'class': 'hm-label', transform: 'translate(' + r1(cx) + ' ' + (y0 - 5) + ') rotate(-60)' }, gCols);
      cl.textContent = M.labels[i];
      this.colLbl.push(cl);
      for (var j = 0; j < n; j++) {
        var c = M.m && M.m[i] ? M.m[i][j] : null, fill = corrColor(c);
        svgEl('rect', {
          x: x0 + j * cell, y: y0 + i * cell, width: cell - 1, height: cell - 1, rx: 2,
          'class': fill ? 'hm-cell' : 'hm-cell hm-cell--na', fill: fill || null
        }, gCells);
        if (showNum && isNum(c)) {
          var tt = svgEl('text', {
            x: r1(x0 + j * cell + (cell - 1) / 2), y: r1(y0 + i * cell + cell / 2 + 3.5), 'text-anchor': 'middle',
            'class': 'hm-num' + (Math.abs(c) > 0.55 ? ' hm-num--dark' : '')
          }, gCells);
          tt.textContent = M.valueLabel(c);
        }
      }
    }
    this.gHot = svgEl('g', { 'class': 'hm-hot' }, svg);
  };

  Heatmap.prototype.highlight = function (hit) {
    var key = hit ? hit.i + ':' + hit.j : null;
    if (key === this.hot) return;
    this.hot = key;
    var G = this.G, M = this.model;
    if (this.gHot) clear(this.gHot);
    (this.rowLbl || []).forEach(function (t) { t.classList.remove('is-hot'); });
    (this.colLbl || []).forEach(function (t) { t.classList.remove('is-hot'); });
    if (!hit || !G) { this.tip.hidden = true; return; }
    this.rowLbl[hit.i].classList.add('is-hot');
    this.colLbl[hit.j].classList.add('is-hot');
    svgEl('rect', { x: G.x0 + hit.j * G.cell - 0.5, y: G.y0 + hit.i * G.cell - 0.5, width: G.cell, height: G.cell, rx: 2, 'class': 'hm-focus' }, this.gHot);
    this.tip.textContent = M.tipText ? M.tipText(hit.i, hit.j) : '';
    this.tip.hidden = false;
    var cx = G.x0 + (hit.j + 1) * G.cell + 8, cy = G.y0 + hit.i * G.cell - 6;
    var w = this.tip.offsetWidth, maxX = Math.max(0, this.svg.clientWidth - w);
    if (cx > maxX) cx = G.x0 + hit.j * G.cell - w - 8;               // flip to the left of the cell
    this.tip.style.left = Math.round(clamp(cx, 0, maxX)) + 'px';
    this.tip.style.top = Math.round(Math.max(0, cy - this.tip.offsetHeight)) + 'px';
  };

  root.PFCharts = {
    Sync: Sync,
    MainChart: MainChart,
    DrawdownChart: DrawdownChart,
    Heatmap: Heatmap,
    corrColor: corrColor,
    sparkline: sparkline,
    splitSpark: splitSpark,
    niceTicks: niceTicks
  };
})(typeof window !== 'undefined' ? window : this);
