(async function (o) {
  // o = { preset, mode: 'pl'|'value', depot: true|false, start: '10.000', fa, fb (fractions of the range), live }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  if (o.preset) { document.querySelector('#rangeTabs [data-preset="' + o.preset + '"]').click(); await wait(200); }
  if (o.mode && PFApp.state.mode !== o.mode) { document.querySelector('#modeToggle [data-mode="' + o.mode + '"]').click(); await wait(200); }
  if (o.benches) {   // e.g. ['msci_world', ...]: toggle chips so exactly these (plus/minus my_depot per o.depot) are on
    o.benches.forEach((id) => { if (PFApp.state.benchmarks.indexOf(id) < 0) { const c = document.querySelector('#benchChips [data-bench="' + id + '"]'); c && c.click(); } });
    await wait(200);
  }
  if (o.depot === false || o.depot === true) {
    const has = PFApp.state.benchmarks.indexOf('my_depot') >= 0;
    const chip = document.querySelector('#benchChips [data-bench="my_depot"]');
    if (has !== o.depot) {
      if (chip) chip.click(); else { PFApp.state.fixedOn.my_depot = o.depot; PFApp.update({ keepMeasure: true }); }
      await wait(200);
    }
  }
  if (o.start) { const i = document.querySelector('#startValue'); i.value = o.start; i.dispatchEvent(new Event('input', { bubbles: true })); await wait(200); }
  if (o.whatif) { await o.whatif(); await wait(200); }
  if (o.depotValue != null && o.depotLater !== true) { const i = document.querySelector('#depotValue'); i.value = o.depotValue; i.dispatchEvent(new Event('input', { bubbles: true })); await wait(200); }
  const S = PFApp.sync, C = PFApp.charts.main, L = C.L, m = L.m;
  const last = C.model && typeof C.model.last === 'number' ? C.model.last : m - 1;
  const a = Math.round(last * o.fa), b = Math.round(last * o.fb);
  if (o.hover != null) { S.setHover(Math.round(last * o.hover)); S.flush(); }
  else if (o.live) { S.anchor(a); S.measureMove(b); S.flush(); }
  else { S.measureStart(a); S.measureEnd(b); S.flush(); }
  await wait(100);
  let before = null;
  if (o.depotLater) {
    before = C.tip2.hidden ? null : C.tip2.innerText.replace(/\n+/g, ' | ');
    const i = document.querySelector('#depotValue'); i.value = o.depotValue; i.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(150);
  }
  const sv = C.svg.getBoundingClientRect();
  const r = (e) => { const x = e.getBoundingClientRect(); return { l: Math.round(x.left - sv.left), t: Math.round(x.top - sv.top), w: Math.round(x.width), h: Math.round(x.height), r: Math.round(x.right - sv.left), b: Math.round(x.bottom - sv.top) }; };
  const lines = [...C.gOver.querySelectorAll('line')].map((l) => ({ x: +l.getAttribute('x1'), y1: +l.getAttribute('y1') }));
  // plot content: highest drawn y of the series paths and the topmost gridline
  const grid = [...C.gGrid.querySelectorAll('.pc-gridline')].map((g) => +g.getAttribute('y1'));
  const labels = [...C.gAxis.querySelectorAll('.pc-ylabel')].map((t) => { const bb = t.getBBox(); return Math.round(bb.y); });
  let minY = Infinity;
  C.gSeries.querySelectorAll('path').forEach((p) => { const bb = p.getBBox(); if (bb.height || bb.width) minY = Math.min(minY, bb.y); });
  const txt = (e) => e.hidden ? null : e.innerText.replace(/\n+/g, ' | ');
  const bad = /NaN|undefined|Infinity|–/.test((C.tip.innerText || '') + (C.tip2.hidden ? '' : C.tip2.innerText));
  return {
    before, W: L.W, H: L.H, top: L.top, bottom: L.bottom, stack: C.stack, a, b, tipBottom: C.tipBottom,
    tip: C.tip.hidden ? null : r(C.tip), tip2: C.tip2.hidden ? null : r(C.tip2),
    text: txt(C.tip), text2: txt(C.tip2), titles: C.tip2.hidden ? null : [...C.tip2.querySelectorAll('[title]')].map((e) => e.title),
    lines, gridTop: Math.min.apply(null, grid), labelTop: Math.min.apply(null, labels), seriesTop: Math.round(minY), bad,
    pinned: C.tip2.classList.contains('is-pinned'),
    scrollW: document.documentElement.scrollWidth, innerW: innerWidth, depotValue: PFApp.state.depotValue
  };
})
