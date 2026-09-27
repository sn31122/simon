(async function () {
  var $ = function (id) { return document.getElementById(id); };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms || 30); }); };
  var out = {}, A = window.PFApp;
  function bad() {   // NaN / undefined anywhere in the visible text of the page
    var t = document.body.innerText;
    return /NaN|undefined|Infinity/.test(t) ? t.match(/.{0,40}(NaN|undefined|Infinity).{0,20}/)[0] : null;
  }
  function lay() {
    var s = $('lists'), h = $('holdBlock').getBoundingClientRect(), c = $('assetBlock').querySelector('.card').getBoundingClientRect();
    return { cls: s.className.replace('block lists', '').trim(), holdW: Math.round(h.width), holdL: Math.round(h.left), cardL: Math.round(c.left), cardR: Math.round(c.right), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
  }
  function holdOff() { return document.querySelectorAll('#holdList .hrow.is-off').length; }
  function holdRows() { return document.querySelectorAll('#holdList .hrow').length; }

  out.init = { lay: lay(), rows: holdRows(), tbl: $('assetTable').rows.length };
  // Einzelwerte on -> both
  document.querySelector('[data-list=assets]').click();
  out.both = { lay: lay(), rows: holdRows(), tblRows: $('assetTable').tBodies[0].rows.length, sparkShown: getComputedStyle(document.querySelector('.hr-spark')).display };

  // checkbox: deselect the first table row
  var cb = $('assetTable').querySelector('input[type=checkbox][data-isin]'), isin = cb.getAttribute('data-isin');
  var totalBefore = $('holdSub').textContent, hl0 = $('hlMain').textContent;
  cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true }));
  await wait();
  out.checkbox = { isin: isin, sel: A.state.selected.size, holdOff: holdOff(), totalBefore: totalBefore, totalAfter: $('holdSub').textContent, hlBefore: hl0, hlAfter: $('hlMain').textContent,
    rowOff: $('assetTable').querySelector('[data-isin="' + isin + '"]').closest('tr').className, sub: $('assetSub').textContent };
  // Keine / Alle
  $('selNone').click(); await wait();
  out.none = { sel: A.state.selected.size, holdOff: holdOff(), hl: $('hlMain').textContent, holdTotal: $('holdTotal').textContent, chg: $('holdChg').textContent, kpi: $('kpis').textContent.slice(0, 40), bad: bad() };
  $('selAll').click(); await wait();
  out.all = { sel: A.state.selected.size, holdOff: holdOff(), hl: $('hlMain').textContent };

  // what-if: Stück of the first row
  var inp = $('assetTable').querySelector('input.wi-inp'), wi = inp.getAttribute('data-wi');
  inp.focus(); inp.value = '1000'; inp.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(80);
  out.whatIf = { isin: wi, banner: !$('wiBanner').hidden, text: $('wiText').textContent, changedRow: !!$('assetTable').querySelector('tr.is-changed'), lay: lay(), focus: document.activeElement && document.activeElement.getAttribute('data-wi'), legend: $('legend').textContent.slice(0, 60) };
  $('wiReset').click(); await wait();
  out.whatIfReset = { banner: !$('wiBanner').hidden, overrides: Object.keys(A.state.overrides).length };

  // table header sort + holdings sort menu
  $('assetTable').querySelector('th[data-sort="short"] button').click(); await wait();
  out.tblSort = { sort: A.state.sort, first: $('assetTable').tBodies[0].rows[0].querySelector('b').textContent };
  $('holdSortBtn').click(); await wait();
  var menuOpen = !$('holdSortMenu').hidden;
  $('holdSortMenu').querySelector('[data-hsort="name-asc"]').click(); await wait();
  out.holdSort = { menuOpen: menuOpen, menuClosed: $('holdSortMenu').hidden, first: document.querySelector('#holdList .hr-title').textContent, sort: A.state.holdSort };

  // periods: pills 3M / 6M, tab 6M, 1T, Seit Kauf
  function per() {
    var ap = document.querySelector('#holdPills .is-active'), at = document.querySelector('#rangeTabs .is-active');
    return { pill: ap && ap.getAttribute('data-hp'), tab: at && at.getAttribute('data-preset'), label: (document.querySelector('#holdChg .hold-per') || {}).textContent, chg: ($('holdChg').querySelector('b') || {}).textContent, rows: holdRows(), tblSub: $('assetSub').textContent, spark: document.querySelectorAll('#holdList .hr-spark svg').length, bad: bad() };
  }
  document.querySelector('#holdPills [data-hp="3M"]').click(); await wait(); out.p3M = per();
  document.querySelector('#holdPills [data-hp="6M"]').click(); await wait(); out.p6M = per();
  document.querySelector('#rangeTabs [data-preset="3M"]').click(); await wait(); out.tab3M = per();
  document.querySelector('#holdPills [data-hp="1T"]').click(); await wait(); out.p1T = per(); out.p1T.intra = !!A.model().intra;
  document.querySelector('#holdPills [data-hp="SK"]').click(); await wait(); out.pSK = per();
  document.querySelector('#holdPills [data-hp="YTD"]').click(); await wait(); out.pYTD = per();

  // drawdown hover synced with the main chart
  var dd = A.charts.dd, r = dd.svg.getBoundingClientRect();
  dd.svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', pointerId: 1, clientX: r.left + r.width * 0.5, clientY: r.top + 40 }));
  await wait(60);
  out.ddHover = { hoverI: A.sync.hoverI, readout: $('ddReadout').textContent.slice(0, 60), mainTip: (document.querySelector('#mainChart .pc-tip') || {}).textContent, padR: [A.charts.main.L && A.charts.main.L.padR, dd.model && dd.model.padR] };
  dd.svg.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false, pointerType: 'mouse', pointerId: 1 }));

  // toggles: all four combinations
  var combos = [];
  function setT(h, a) {
    if (A.state.showHold !== h) document.querySelector('[data-list=hold]').click();
    if (A.state.showAssets !== a) document.querySelector('[data-list=assets]').click();
    return { h: h, a: a, lay: lay(), holdHidden: $('holdBlock').hidden, assetHidden: $('assetBlock').hidden, hint: !$('listsHint').hidden, pressed: [].map.call(document.querySelectorAll('[data-list]'), function (b) { return b.getAttribute('aria-pressed'); }).join('/') };
  }
  combos.push(setT(false, false), setT(true, false), setT(false, true), setT(true, true));
  out.combos = combos;
  // list switched on after a change made while it was hidden must be current
  setT(true, false);
  document.querySelector('#holdPills [data-hp="1M"]').click(); await wait();
  $('startValue').value = '100.000'; $('startValue').dispatchEvent(new Event('input')); await wait();
  setT(true, true);
  out.staleCheck = { sub: $('assetSub').textContent, scaled: $('assetTable').classList.contains('is-scaled'), sumRow: $('assetTable').tFoot.textContent.slice(0, 60) };
  $('startValue').value = ''; $('startValue').dispatchEvent(new Event('input')); await wait();
  setT(false, true);
  document.querySelector('#holdPills [data-hp="6M"]').click(); await wait();
  setT(true, true);
  out.staleCheck2 = per();
  out.bad = bad();
  return out;
})()
