// Browser acceptance checks for dashboard.html (see docs/VERIFICATION.md) with real mouse, keyboard and touch input.
// Optional test dependency, not used by the page: Playwright (npm install --no-save --package-lock=false playwright,
// or a global install via NODE_PATH). BROWSER_EXECUTABLE selects a browser binary (e.g. Edge on Windows).
// Usage: python3 -m http.server 8770 --bind 127.0.0.1   then   node tools/acceptance-check.cjs [url] [outDir]
// Writes results.json and screenshots to outDir (default artifacts/acceptance, gitignored); exit code 1 on any failure.
// Without Segoe UI (Linux), set SEGOE_UI_FALLBACK_DIR to a folder with the Selawik TTFs (see segoe-fallback.cjs):
// the list/box widths depend on the font, and DejaVu Sans is much wider than the Windows font.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { addSegoeFallback, fontsReady } = require('./segoe-fallback.cjs');

const URL = process.argv[2] || 'http://127.0.0.1:8770/dashboard.html';
const OUT = path.resolve(process.argv[3] || 'artifacts/acceptance');
const FONT_DIR = process.env.SEGOE_UI_FALLBACK_DIR || '';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function check(area, name, pass, detail) {
  results.push({ area, name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + area + ' · ' + name + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}
const shots = [];
async function shot(page, name, opts) {
  const jpeg = !!(opts && opts.fullPage);              // full pages as JPEG (much smaller in the repo)
  const file = path.join(OUT, name + (jpeg ? '.jpg' : '.png'));
  await page.waitForTimeout(450);                       // let the .3s marker fades finish
  const o = Object.assign({ path: file }, opts || {}, jpeg ? { type: 'jpeg', quality: 80 } : {});
  delete o.note;
  await page.screenshot(o);
  shots.push({ file: path.basename(file), viewport: page.viewportSize(), note: (opts && opts.note) || '' });
}

async function open(browser, width, height, touch) {
  const context = await browser.newContext({ viewport: { width, height: height || 1000 }, hasTouch: !!touch, isMobile: !!touch });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
  await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204 }));
  // helpers (29.09.): own cards = every card except the "Mein Depot" preset card; names of the drawn benchmarks
  await page.addInitScript(() => {
    window.__own = (k) => PFApp.state.cards.filter((c) => c.preset !== 'my_depot')[k || 0];
    window.__ownAll = () => PFApp.state.cards.filter((c) => c.preset !== 'my_depot');
    window.__shown = () => PFApp.model().selB.map((x) => x.name).join();
  });
  page.fallbackFont = FONT_DIR ? await addSegoeFallback(page, FONT_DIR) : false;
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.PFApp && document.querySelector('#benchCards .bb-card'));
  if (page.fallbackFont) await fontsReady(page);
  await page.waitForTimeout(100);
  // user 30.09.: the page opens on 1T; the checks below were written for YTD, so every page switches to it after load
  page.startPreset = await page.evaluate(() => PFApp.state.preset);
  await page.click('#rangeTabs [data-preset="YTD"]');
  await page.waitForTimeout(100);
  return page;
}
const overflow = (page) => page.evaluate(() => ({ w: innerWidth, sw: document.documentElement.scrollWidth }));
const badText = (page) => page.evaluate(() => {
  const t = document.body.innerText;
  return { nan: /\bNaN\b/.test(t), undef: /\bundefined\b/.test(t) };
});
async function settle(page) { await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); }
async function selectAllAndType(page, text) {
  await page.keyboard.press('Control+A');
  if (text) await page.keyboard.type(text); else await page.keyboard.press('Backspace');   // '' = clear the field
}
/** Waits until window.scrollY stops changing (smooth scrolling), at most ~3 s. */
async function scrollSettled(page) {
  let last = -1;
  for (let k = 0; k < 30; k++) {
    const y = await page.evaluate(() => window.scrollY);
    if (y === last) return;
    last = y;
    await page.waitForTimeout(100);
  }
}

/** Builds a card through the UI: rows = [[query, percent], ...]; returns the card id. */
async function addCard(page, rows) {
  await page.click('#benchCards .bb-add');           // "+ Benchmark" opens its menu (29.09.) -> "Leere Karte"
  await page.click('#bbMenu .bb-mi[data-act="empty"]');
  for (let k = 0; k < rows.length; k++) {
    await page.keyboard.type(rows[k][0]);
    await page.keyboard.press('Enter');               // highlighted entry -> focus moves to the % field
    await page.keyboard.type(rows[k][1]);
    await page.keyboard.press(k < rows.length - 1 ? 'Enter' : 'Tab');   // Enter in the last row adds a row (< 100 %)
  }
  await settle(page);
  return page.evaluate(() => PFApp.state.cards[PFApp.state.cards.length - 1].id);
}
async function cardEl(page, id) { return page.locator('#benchCards [data-card="' + id + '"]'); }

/** Chart geometry in #mainChart coordinates: plot, tips, highest series point under each tip, y labels, last box. */
async function chartGeo(page) {
  return page.evaluate(() => {
    const ch = PFApp.charts.main, L = ch.L, M = ch.model, el = document.getElementById('mainChart');
    if (!L || !M) return null;
    const tips = Array.from(el.querySelectorAll('.pc-tip')).filter((t) => !t.hidden).map((t) => ({
      cls: t.className, left: t.offsetLeft, top: t.offsetTop, right: t.offsetLeft + t.offsetWidth, bottom: t.offsetTop + t.offsetHeight
    }));
    const series = [M.series && M.series.values].concat((M.benches || []).map((b) => b.values), [M.ghost && M.ghost.values]).filter(Boolean);
    const last = typeof M.last === 'number' ? M.last : L.m - 1;
    function minYUnder(t) {
      let y = Infinity;
      for (const vals of series) for (let i = 0; i <= last; i++) {
        const v = vals[i];
        if (typeof v !== 'number' || !isFinite(v)) continue;
        const x = L.x(i);
        if (x >= t.left - 2 && x <= t.right + 2) y = Math.min(y, L.y(v));
      }
      return y;
    }
    const boxes = Array.from(el.querySelectorAll('.pc-ylabel, .pc-lastbox')).map((n) => { const b = n.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height, t: n.textContent }; });
    const hits = [];
    tips.forEach((t) => {
      const my = minYUnder(t);
      if (t.bottom > my - 1) hits.push({ tip: t.cls, bottom: t.bottom, lineTop: Math.round(my * 10) / 10 });
      boxes.forEach((b) => {
        if (t.left < b.x + b.w && t.right > b.x && t.top < b.y + b.h && t.bottom > b.y) hits.push({ tip: t.cls, label: b.t || 'lastbox' });
      });
    });
    return { W: L.W, top: L.top, tips, hits, inside: tips.every((t) => t.left >= 0 && t.right <= L.W + 0.5) };
  });
}
/** Real mouse drag inside the main chart between fractions fa and fb of the plot width. */
/** On phones the chart can start below the fold (top blocks, Statistik panel above it): bring it into view first. */
async function chartIntoView(page) {
  await page.evaluate(() => {
    const r = document.getElementById('mainChart').getBoundingClientRect(), bar = document.getElementById('topBar');
    const top = bar ? bar.getBoundingClientRect().bottom : 0;
    if (r.top < top || r.bottom > innerHeight) window.scrollBy(0, r.top - top - Math.max(0, (innerHeight - top - r.height) / 2));
  });
  await settle(page);
}
async function drag(page, fa, fb) {
  await chartIntoView(page);
  const box = await page.locator('#mainChart svg').boundingBox();
  const L = await page.evaluate(() => ({ padL: PFApp.charts.main.L.padL, plotW: PFApp.charts.main.L.plotW, top: PFApp.charts.main.L.top, bottom: PFApp.charts.main.L.bottom }));
  const y = box.y + (L.top + L.bottom) / 2, xa = box.x + L.padL + L.plotW * fa, xb = box.x + L.padL + L.plotW * fb;
  await page.mouse.move(xa, y);
  await page.mouse.down();
  await page.mouse.move((xa + xb) / 2, y, { steps: 6 });
  await page.mouse.move(xb, y, { steps: 6 });
  await page.mouse.up();
  await settle(page);
}
async function hoverAt(page, f) {
  await chartIntoView(page);
  const box = await page.locator('#mainChart svg').boundingBox();
  const L = await page.evaluate(() => ({ padL: PFApp.charts.main.L.padL, plotW: PFApp.charts.main.L.plotW, top: PFApp.charts.main.L.top, bottom: PFApp.charts.main.L.bottom }));
  await page.mouse.move(box.x + L.padL + L.plotW * f, box.y + (L.top + L.bottom) / 2, { steps: 2 });
  await settle(page);
}
/**
 * Measurement boxes (29.09.: one tooltip, one equal box per line – Portfolio first, then the drawn benchmarks): every box's
 * % / "start → end" / € change vs the drawn value series at the measured points. rows/expect = the "Mein Depot" box.
 */
async function depotBoxCheck(page) {
  return page.evaluate(() => {
    const E = window.PFEngine, F = E.fmt, M = PFApp.model(), pin = PFApp.sync.pinned() || PFApp.sync.measure;
    const tip = document.querySelector('#mainChart .pc-tip');
    if (!pin || !tip || tip.hidden || !tip.querySelector('.tt-d')) return { side: false };
    const a = Math.min(pin.a, pin.b), b = Math.max(pin.a, pin.b);
    const lines = M.intra ? [['Portfolio', M.intra.value]].concat(M.intra.benches.map((o) => [o.x.name, o.s.value]))
      : [['Portfolio', M.p.value]].concat(M.selB.filter((x) => x.s).map((x) => [x.name, x.s.value]));
    const boxes = Array.from(tip.querySelectorAll('.tt-d')).map((d) => [d.querySelector('.tt-dv').textContent.trim(),
      d.querySelector('.tt-dval').textContent.trim(), d.querySelector('.tt-dchg').textContent.trim()]);
    const exp = lines.map(([, v]) => {
      const w = E.intradayWindow(v, a, b);
      return [F.pct(w.ret, { sign: true, dec: 2 }), F.eur(v[a], { dec: 0 }) + ' → ' + F.eur(v[b], { dec: 0 }), F.eur(w.pl, { sign: true, dec: 0 })];
    });
    const k = lines.findIndex((l) => l[0] === 'Mein Depot');
    return { side: k > 0 && boxes.length === lines.length, n: boxes.length, nl: lines.length, rows: k > 0 ? boxes[k] : null, expect: k > 0 ? exp[k] : null,
      all: JSON.stringify(boxes) === JSON.stringify(exp), caption: (tip.querySelector('.tt-cap') || {}).textContent || '', hasTarget: true };
  });
}

(async () => {
  const opts = { headless: true };
  if (process.env.BROWSER_EXECUTABLE) opts.executablePath = process.env.BROWSER_EXECUTABLE;
  const browser = await chromium.launch(opts);
  const pages = [];
  try {
    // ================================================================= data + start (1903)
    let page = await open(browser, 1903, 1000);
    check('general', 'the page opens on 1T (user 30.09.)', page.startPreset === '1T', page.startPreset);
    pages.push(page);
    const data = await page.evaluate(() => {
      const D = window.PORTFOLIO_DATA, ins = D.instruments.map((i) => i.isin), n = D.dates.length, last = D.dates[n - 1];
      const g = (k) => D.grids && D.grids[k] ? D.grids[k].dates[D.grids[k].dates.length - 1] : null;
      const hist = (D.res || []).filter((r) => r !== 'd').length;
      return {
        instruments: ins.length, prices: Object.keys(D.prices).length, dates: n, last, lastStatus: D.status[n - 1],
        intradayOnlyLast: D.status.slice(0, -1).every((x) => x === 'final'), m30: g('m30'), h2: g('h2'), hist, dailyFrom: D.meta.daily_from,
        res: Array.isArray(D.res) && D.res.length === n, bloom: ins.filter((i) => i === 'US0937121079').length,
        presets: (D.card_presets || []).map((b) => b.id + ':' + b.start), benchmarks: D.benchmarks.map((b) => b.id), positions: D.positions.length,
        depot: !!(D.depot && D.depot.holdings && Object.keys(D.depot.holdings).length), allPriced: ins.every((i) => D.prices[i])
      };
    });
    check('data', 'every instrument has a price series; only the last row may be intraday; history rows before the daily data; 30-min and 2-h grids end on the last daily date',
      data.instruments === data.prices && data.allPriced && data.intradayOnlyLast && data.res && data.hist > 100 && data.dailyFrom === '2026-01-02' &&
      data.m30 === data.last && data.h2 === data.last, data);
    check('data', 'Bloom once, 32 positions, no locked presets; presets Mein Depot (card) + Energie, Old portfolio, Situational Awareness, Depot-Historie (menu); depot data present',
      data.bloom === 1 && data.positions === 32 && data.benchmarks.length === 0 && data.depot &&
      ['my_depot:card', 'energie:menu', 'old_portfolio:menu', 'situational_awareness:menu', 'depot_history:menu'].every((x) => data.presets.indexOf(x) >= 0), data);

    // ================================================================= benchmark cards
    const init = await page.evaluate(() => {
      const cards = document.querySelectorAll('#benchCards .bb-card'), f = cards[1], c = PFApp.state.cards.find((x) => x.preset === 'my_depot');
      return { n: cards.length, name: c && c.name, preset: c && c.preset, show: c && c.show, color: c && c.color,
        acts: Array.from(f.querySelectorAll('[data-act]')).map((b) => b.getAttribute('data-act')), pctInputs: f.querySelectorAll('.bb-pct').length,
        pcts: Array.from(f.querySelectorAll('.bb-pct')).map((x) => x.value), total: f.querySelector('.bb-total').textContent,
        shown: window.__shown(), legend: document.getElementById('legend').textContent };
    });
    check('cards', 'initially only the "Mein Depot" preset card: editable (% rows, whole numbers, total 100 %), white, shown in the chart',
      init.n === 2 && init.name === 'Mein Depot' && init.preset === 'my_depot' && init.show && init.color.toLowerCase() === '#f2f3f4' &&
      init.pctInputs >= 5 && init.pcts.every((v) => /^\d+$/.test(v)) && init.total === '100 %' && init.shown === 'Mein Depot' && /Mein Depot/.test(init.legend) &&
      ['show', 'dup', 'del'].every((a) => init.acts.indexOf(a) >= 0), init);
    await page.click('#benchCards .bb-add');
    const menu = await page.evaluate(() => ({ open: !document.getElementById('bbMenu').hidden,
      items: Array.from(document.querySelectorAll('#bbMenu .bb-mi')).map((b) => b.getAttribute('data-p') || b.getAttribute('data-act')) }));
    await page.click('#bbMenu .bb-mi[data-p="energie"]');
    await settle(page);
    const eid = await page.evaluate(() => PFApp.state.cards[PFApp.state.cards.length - 1].id);
    const eShown = await page.evaluate((id) => ({ shown: window.__shown(), legend: /Energie/.test(document.getElementById('legend').textContent),
      lines: PFApp.charts.main.model.benches.length, table: Array.from(document.querySelectorAll('#cmpTable tbody tr')).some((r) => /Energie/.test(r.textContent)),
      rows: PFApp.state.cards.find((c) => c.id === id).rows.length }), eid);
    await page.click('#benchCards [data-card="' + eid + '"] [data-act="del"]');
    await settle(page);
    const eDel = await page.evaluate(() => ({ cards: PFApp.state.cards.length, dom: document.querySelectorAll('#benchCards .bb-card').length, shown: window.__shown() }));
    check('cards', '"+ Benchmark" menu: Leere Karte + every preset; Energie is added shown (legend, chart line, Statistik), the trash deletes it',
      menu.open && ['empty', 'my_depot', 'energie', 'old_portfolio', 'situational_awareness', 'depot_history'].every((x) => menu.items.indexOf(x) >= 0) &&
      eShown.shown === 'Mein Depot,Energie' && eShown.legend && eShown.lines === 2 && eShown.table && eShown.rows === 11 &&
      eDel.cards === 1 && eDel.dom === 2 && eDel.shown === 'Mein Depot', { menu, eShown, eDel });
    await page.click('#benchCards .bb-card:nth-child(2) [data-act="show"]');
    await settle(page);
    const hidden = await page.evaluate(() => ({ shown: PFApp.state.benchmarks.length, legend: document.getElementById('legend').textContent,
      lines: PFApp.charts.main.model.benches.length, table: document.querySelectorAll('#cmpTable tbody tr').length }));
    await page.click('#benchCards .bb-card:nth-child(2) [data-act="show"]');
    await settle(page);
    const reshown = await page.evaluate(() => window.__shown());
    check('cards', 'Mein Depot hide/show removes and restores it everywhere',
      hidden.shown === 0 && !/Mein Depot/.test(hidden.legend) && hidden.lines === 0 && reshown === 'Mein Depot', hidden);

    await page.click('#benchCards .bb-add');
    await page.click('#bbMenu .bb-mi[data-act="empty"]');
    await settle(page);
    const fresh = await page.evaluate(() => {
      const a = document.activeElement, c = window.__own(0), drop = document.getElementById('bbDrop');
      return { focusIns: a && a.classList.contains('bb-ins'), inCard: !!(a && a.closest('[data-card="' + c.id + '"]')), rows: c.rows.length,
        name: c.name, open: !drop.hidden, opts: drop.querySelectorAll('.bb-opt').length, all: window.PORTFOLIO_DATA.instruments.length, color: c.color };
    });
    check('cards', 'new card: "Benchmark 1", one empty row, focus in its instrument field, list open with every instrument',
      fresh.focusIns && fresh.inCard && fresh.rows === 1 && fresh.name === 'Benchmark 1' && fresh.open && fresh.opts === fresh.all && fresh.all === data.instruments, fresh);

    async function searchTop(q) {
      await selectAllAndType(page, q);
      await settle(page);
      return page.evaluate(() => Array.from(document.querySelectorAll('#bbDrop .bb-opt')).slice(0, 4).map((o) => o.querySelector('b').textContent + ' | ' + o.querySelector('span').textContent));
    }
    const s1 = await searchTop('micro'), s2 = await searchTop('US67'), s3 = await searchTop('nvidia'), s4 = await searchTop('halbleiter 3'),
      s5 = await searchTop('coh'), s6 = await searchTop('IE00B4L5Y983'), s7 = await searchTop('NAS');
    check('cards', 'search: prefix matches first (micro -> Micron, Microsoft, then AMD by word start)',
      /^Micron \|/.test(s1[0]) && /^Microsoft \|/.test(s1[1]) && /^AMD \|/.test(s1[2]), s1);
    check('cards', 'search by ISIN prefix, full name, case-insensitive; new stocks searchable',
      /^NVIDIA \|/.test(s2[0]) && /^NVIDIA \|/.test(s3[0]) && /^Halbleiter 3x \|/.test(s4[0]) && /^Coherent \|/.test(s5[0]) && /^MSCI World \|/.test(s6[0]) && /^Nasdaq-100/.test(s7[0]),
      { s2: s2[0], s3: s3[0], s4: s4[0], s5: s5[0], s6: s6[0], s7: s7.slice(0, 3) });
    check('cards', 'entry subtitle = full name · ISIN · type', /^Coherent \| Coherent · US19247G1076 · Aktie$/.test(s5[0]), s5[0]);
    // keyboard: arrows wrap, Enter picks -> % field
    await selectAllAndType(page, 'nas');
    await settle(page);
    const nNas = await page.evaluate(() => document.querySelectorAll('#bbDrop .bb-opt').length);
    await page.keyboard.press('ArrowUp');
    const wrapUp = await page.evaluate(() => { const o = document.querySelectorAll('#bbDrop .bb-opt'); return o[o.length - 1].classList.contains('is-hi'); });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const hi2 = await page.evaluate(() => document.querySelector('#bbDrop .is-hi b').textContent);
    await page.keyboard.press('Enter');
    await settle(page);
    const picked = await page.evaluate(() => { const c = window.__own(0), a = document.activeElement; return { isin: c.rows[0].isin, q: c.rows[0].q, pctFocus: a.classList.contains('bb-pct'), closed: document.getElementById('bbDrop').hidden }; });
    check('cards', 'arrows wrap, Enter picks the highlighted entry and moves to the % field',
      nNas > 1 && wrapUp && picked.q === hi2 && picked.pctFocus && picked.closed, { nNas, wrapUp, hi2, picked });
    // Esc on a changed instrument field reverts it
    await page.keyboard.press('Shift+Tab');
    await selectAllAndType(page, 'gold');
    await page.keyboard.press('Escape');
    await settle(page);
    const esc1 = await page.evaluate(() => ({ val: document.activeElement.value, open: !document.getElementById('bbDrop').hidden, isin: window.__own(0).rows[0].isin }));
    check('cards', 'Esc closes the list and reverts the typed text', esc1.val === picked.q && !esc1.open && esc1.isin === picked.isin, esc1);
    // Esc with nothing to revert reaches the page: clears a measurement
    await page.evaluate(() => { PFApp.sync.measureStart(10); PFApp.sync.measureEnd(40); PFApp.sync.flush(); });
    await page.keyboard.press('Escape');
    await settle(page);
    check('cards', 'Esc on an unchanged field still clears a chart measurement', await page.evaluate(() => PFApp.sync.pinned() === null));
    // Tab with changed text picks the highlighted entry; exact ISIN on blur picks; partial text reverts
    await selectAllAndType(page, 'micr');
    await settle(page);
    await page.keyboard.press('Tab');
    await settle(page);
    const tab1 = await page.evaluate(() => ({ q: window.__own(0).rows[0].q, pct: document.activeElement.classList.contains('bb-pct') }));
    check('cards', 'Tab with changed text picks the highlighted entry and moves to the % field', tab1.q === 'Micron' && tab1.pct, tab1);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await settle(page);
    check('cards', 'Tab on an unchanged field keeps the instrument', await page.evaluate(() => window.__own(0).rows[0].q === 'Micron'));
    await page.keyboard.press('Shift+Tab');
    await selectAllAndType(page, 'us5949181045');
    await page.evaluate(() => document.activeElement.blur());
    await settle(page);
    const blur1 = await page.evaluate(() => window.__own(0).rows[0].q);
    await page.locator('#benchCards .bb-card:nth-child(3) .bb-ins').first().click();
    await selectAllAndType(page, 'Micr');
    await page.evaluate(() => document.activeElement.blur());
    await settle(page);
    const blur2 = await page.evaluate(() => window.__own(0).rows[0].q);
    check('cards', 'blur: exact ISIN picks it, partial text is reverted', blur1 === 'Microsoft' && blur2 === 'Microsoft', { blur1, blur2 });

    // percentages and validity
    const cid = await page.evaluate(() => window.__own(0).id);
    const pctSel = '#benchCards [data-card="' + cid + '"] .bb-pct';
    async function pctState(text) {
      await page.locator(pctSel).first().click();
      await selectAllAndType(page, text);
      await settle(page);
      return page.evaluate((id) => {
        const el = document.querySelector('[data-card="' + id + '"]');
        const b = PFApp.model().benches.find((x) => x.id === id), p = PFApp.model().p;
        return { valid: !!b, total: el.querySelector('.bb-total').textContent, hint: el.querySelector('.bb-hint').textContent,
          ret: el.querySelector('.bb-ret').textContent, v0: b && b.s ? b.s.value[0] / p.startValue : null };
      }, cid);
    }
    const P = {};
    for (const t of ['99,98', '99,99', '100', '100,01', '100,02', '1.000', '-5', 'abc', '', '0', '100.0']) P[t || '(leer)'] = await pctState(t);
    // user 30.09.: a total ≠ 100 % is drawn as absolute amounts – starts at total % of the start value, same return
    const near = (a, b) => a !== null && Math.abs(a - b) < 1e-9;
    check('cards', 'total ≠ 100 % is valid as absolute amounts (99,98 / 100,02 / 1.000 % start at that share of the start value, same return, hint "Absolut"); 99,99–100,01 = 100 %',
      ['99,98', '99,99', '100', '100,01', '100,02', '1.000'].every((t) => P[t].valid && P[t].ret === P['100'].ret) &&
      near(P['99,98'].v0, 0.9998) && near(P['100,02'].v0, 1.0002) && near(P['1.000'].v0, 10) && near(P['100'].v0, 1) && near(P['100,01'].v0, 1) &&
      /Absolut: 99,98 %/.test(P['99,98'].hint) && /Absolut: 100,02 %/.test(P['100,02'].hint) && !/Absolut/.test(P['100,01'].hint),
      { '99,98': P['99,98'], '100,01': P['100,01'], '100,02': P['100,02'], '1.000': P['1.000'] });
    check('cards', 'German input: "1.000" = 1000 %, "-5"/"abc" invalid ("Ungültige Prozentzahl"), empty/0 = 0 %, "100.0" = 100 %',
      P['1.000'].valid && /1\.000 %/.test(P['1.000'].total) && !P['-5'].valid && /Ungültige/.test(P['-5'].hint) && !P['abc'].valid &&
      !P['(leer)'].valid && /^0 %$/.test(P['(leer)'].total) && /Instrument wählen/.test(P['(leer)'].hint) && !P['0'].valid && P['100.0'].valid,
      { '1.000': P['1.000'].total, '-5': P['-5'].hint, leer: P['(leer)'], '100.0': P['100.0'].valid });
    check('cards', 'invalid card shows "–" as return', P['-5'].ret === '–' && P['100'].ret !== '–', { invalid: P['-5'].ret, valid: P['100'].ret });
    // a % without instrument -> invalid; instrument with 0 % ignored
    await pctState('60');
    await page.click('#benchCards [data-card="' + cid + '"] [data-act="addrow"]');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    await page.keyboard.type('40');
    await settle(page);
    const orphan = await page.evaluate((id) => { const el = document.querySelector('[data-card="' + id + '"]'); return { valid: PFApp.model().benches.some((b) => b.id === id), hint: el.querySelector('.bb-hint').textContent }; }, cid);
    check('cards', 'a percentage without an instrument makes the card invalid ("Instrument fehlt")', !orphan.valid && /Instrument fehlt/.test(orphan.hint), orphan);
    // duplicate exclusion inside a card
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.type('Microsoft');
    await settle(page);
    const dupEx = await page.evaluate(() => ({ items: Array.from(document.querySelectorAll('#bbDrop .bb-opt b')).map((b) => b.textContent), empty: (document.querySelector('#bbDrop .bb-empty') || {}).textContent || '' }));
    check('cards', 'an instrument already in the card is not offered again', dupEx.items.indexOf('Microsoft') < 0 && /Schon in dieser Benchmark/.test(dupEx.empty), dupEx);
    await selectAllAndType(page, 'NVIDIA');
    await page.keyboard.press('Enter');
    await settle(page);
    const two = await page.evaluate((id) => { const c = PFApp.state.cards.find((x) => x.id === id); return { rows: c.rows.map((r) => [r.q, r.pct]), valid: PFApp.model().benches.some((b) => b.id === id) }; }, cid);
    check('cards', '60 % Microsoft + 40 % NVIDIA is valid', two.valid && two.rows.length === 2, two);

    // buy and hold (no rebalancing) vs an independent computation; 1T bought at the previous close
    const bh = await page.evaluate((id) => {
      const E = window.PFEngine, ctx = E.prepare(window.PORTFOLIO_DATA), M = PFApp.model(), x = M.byId[id], R = M.R, base = M.p.startValue;
      const w = { US5949181045: 0.6, US67066G1040: 0.4 };
      let maxErr = 0;
      for (let k = R.start; k <= R.end; k++) {
        let v = 0;
        for (const i in w) v += w[i] * ctx.px[i][k] / ctx.px[i][R.start];
        maxErr = Math.max(maxErr, Math.abs(base * v - x.s.value[k - R.start]) / (base * v));
      }
      // daily rebalanced alternative for contrast
      let reb = base;
      for (let k = R.start + 1; k <= R.end; k++) { let r = 0; for (const i in w) r += w[i] * (ctx.px[i][k] / ctx.px[i][k - 1] - 1); reb *= 1 + r; }
      return { maxErr, bh: x.s.value[x.s.value.length - 1], reb, n: R.end - R.start + 1 };
    }, cid);
    check('cards', 'custom card = buy at period start and hold (matches Σ wᵢ·Pᵢ(t)/Pᵢ(start), differs from daily rebalancing)',
      bh.maxErr < 1e-9 && Math.abs(bh.bh - bh.reb) / bh.bh > 1e-4, bh);
    await page.click('#rangeTabs [data-preset="1T"]');
    await settle(page);
    const bh1 = await page.evaluate((id) => {
      // prices read straight from the 30-min grid of the data (the 1T chart = previous session + last session)
      const E = window.PFEngine, ctx = E.prepare(window.PORTFOLIO_DATA), G = ctx.grids.m30, M = PFApp.model();
      const o = M.intra && M.intra.benches.find((b) => b.x.id === id);
      if (!o) return { ok: false };
      const bi = ctx.n - 2, w = { US5949181045: 0.6, US67066G1040: 0.4 }, from = (G.D - 2) * G.S;
      let maxErr = 0;
      for (let k = 0; k <= M.intra.last; k++) {
        let v = 0;
        for (const i in w) v += w[i] * G.px[i][from + k] / ctx.px[i][bi];
        maxErr = Math.max(maxErr, Math.abs(M.intra.base * v - o.s.value[k]) / (M.intra.base * v));
      }
      return { ok: true, maxErr, legend: /Benchmark 1/.test(document.getElementById('legend').textContent), line: PFApp.charts.main.model.benches.some((b) => b.id === id) };
    }, cid);
    check('cards', '1T: card bought at the previous close and held; line + legend in 1T', bh1.ok && bh1.maxErr < 1e-9 && bh1.legend && bh1.line, bh1);
    await page.click('#rangeTabs [data-preset="YTD"]');
    await settle(page);
    // benchWin = period series, no re-buy at the sub-window start
    const bw = await page.evaluate((id) => {
      const M = PFApp.model(), x = M.selB.find((b) => b.id === id), a = 40, b = 120;
      PFApp.sync.setHover(b);
      PFApp.sync.flush();
      const tipTxt = document.querySelector('#mainChart .pc-tip').textContent;
      const E = window.PFEngine, ctx = E.prepare(window.PORTFOLIO_DATA);
      const fromStart = x.s.value[b] / x.s.value[0] - 1;
      const rebuy = E.benchmark(ctx, x.b, M.R.start + a, M.R.start + b, 1);
      const win = x.s.value[b] / x.s.value[a] - 1;
      PFApp.sync.setHover(null);
      return { hoverHas: tipTxt.indexOf(E.fmt.pct(fromStart, { sign: true, dec: 2 })) >= 0, win, rebuy: rebuy.value[rebuy.value.length - 1] - 1 };
    }, cid);
    check('cards', 'hover % reads the period series (bought at the range start)', bw.hoverHas, bw);

    // consumers agree for a custom card (hide Mein Depot so the card is the first shown benchmark)
    await page.click('#benchCards .bb-card:nth-child(2) [data-act="show"]');
    await settle(page);
    const agree = await page.evaluate((id) => {
      const el = document.querySelector('[data-card="' + id + '"]'), card = el.querySelector('.bb-ret').textContent;
      const lg = Array.from(document.querySelectorAll('#legend .lg-item')).find((n) => /Benchmark 1/.test(n.textContent));
      const row = Array.from(document.querySelectorAll('#cmpTable tbody tr')).find((r) => /Benchmark 1/.test(r.textContent));
      const kpi = document.querySelector('#kpis .kpi .kpi-bench');
      const dd = PFApp.charts.dd.model.benches.some((b) => b.id === id);
      PFApp.sync.setHover(60); PFApp.sync.flush();
      const readout = document.getElementById('ddReadout').textContent;
      PFApp.sync.setHover(null);
      return { card, legend: lg && lg.querySelector('b').textContent, table: row && row.children[4].textContent, kpi: kpi && kpi.textContent, dd, readout: /Benchmark 1/.test(readout) };
    }, cid);
    check('cards', 'card return = legend = Statistik = Kennzahlen bench line; drawdown line + readout',
      agree.card === agree.legend && agree.card === agree.table && agree.kpi && agree.kpi.indexOf(agree.card) >= 0 && agree.dd && agree.readout, agree);
    await page.click('#benchCards .bb-card:nth-child(2) [data-act="show"]');
    await settle(page);
    // invalid card excluded everywhere
    await page.locator(pctSel).first().click();
    await selectAllAndType(page, 'abc');
    await settle(page);
    const excl = await page.evaluate((id) => ({
      bench: PFApp.model().benches.some((b) => b.id === id), legend: /Benchmark 1/.test(document.getElementById('legend').textContent),
      lines: PFApp.charts.main.model.benches.some((b) => b.id === id), dd: PFApp.charts.dd.model.benches.some((b) => b.id === id),
      table: /Benchmark 1/.test(document.getElementById('cmpTable').textContent)
    }), cid);
    check('cards', 'an invalid card is left out of chart, drawdown, legend, Statistik',
      !excl.bench && !excl.legend && !excl.lines && !excl.dd && !excl.table, excl);
    await selectAllAndType(page, '60');
    await settle(page);

    // focus + caret kept while typing in the middle of the name
    const nameSel = '#benchCards [data-card="' + cid + '"] .bb-name';
    await page.locator(nameSel).click();
    await page.evaluate((s) => { const n = document.querySelector(s); n._probe = 1; n.setSelectionRange(3, 3); }, nameSel);
    await page.keyboard.type('XY');
    await settle(page);
    const caret = await page.evaluate((s) => { const n = document.activeElement; return { same: n._probe === 1 && n.matches(s), val: n.value, pos: n.selectionStart, legend: document.getElementById('legend').textContent }; }, nameSel);
    check('cards', 'name edit keeps focus and caret; legend follows', caret.same && caret.val === 'BenXYchmark 1' && caret.pos === 5 && /BenXYchmark 1/.test(caret.legend), caret);
    await page.locator(pctSel).first().click();
    await page.evaluate((s) => { const n = document.querySelector(s); n._probe = 2; n.setSelectionRange(1, 1); }, pctSel);
    await page.keyboard.type('5');
    await settle(page);
    const caret2 = await page.evaluate(() => { const n = document.activeElement; return { same: n._probe === 2, val: n.value, pos: n.selectionStart }; });
    check('cards', '% edit keeps focus and caret', caret2.same && caret2.val === '650' && caret2.pos === 2, caret2);
    await selectAllAndType(page, '60');
    // empty name -> default on blur
    await page.locator(nameSel).click();
    await selectAllAndType(page, '');
    await page.keyboard.press('Backspace');
    await page.evaluate(() => document.activeElement.blur());
    await settle(page);
    check('cards', 'emptied name falls back to the default on blur', await page.evaluate((s) => document.querySelector(s).value === 'Benchmark 1', nameSel));

    // structure: duplicate, second card, colours, same instrument in another card, clear, delete row, delete card
    await page.click('#benchCards [data-card="' + cid + '"] [data-act="dup"]');
    await settle(page);
    const dup = await page.evaluate(() => { const c = window.__ownAll(); const a = document.activeElement; return { n: c.length, name: c[1].name, rows: c[1].rows.map((r) => [r.isin, r.pct]), colors: c.map((x) => x.color), focusName: a.classList.contains('bb-name') && a.value === c[1].name }; });
    check('cards', 'duplicate: "… (Kopie)", same rows, new colour, focus on its name',
      dup.n === 2 && dup.name === 'Benchmark 1 (Kopie)' && dup.rows.length === 2 && dup.colors[0] !== dup.colors[1] && dup.focusName, dup);
    const cid3 = await addCard(page, [['Microsoft', '100']]);
    const three = await page.evaluate((id) => { const c = window.__ownAll(); return { valid: PFApp.model().benches.some((b) => b.id === id), colors: c.map((x) => x.color) }; }, cid3);
    const palette = ['#28ebcf', '#e78e78', '#f2f3f4'];
    check('cards', 'same instrument allowed in another card; colours distinct and away from accent/neg/white',
      three.valid && new Set(three.colors).size === three.colors.length && three.colors.every((c) => palette.indexOf(c.toLowerCase()) < 0), three);
    await page.click('#benchCards [data-card="' + cid3 + '"] [data-act="clear"]');
    await settle(page);
    const cleared = await page.evaluate((id) => { const c = PFApp.state.cards.find((x) => x.id === id); const a = document.activeElement; return { rows: c.rows.length, empty: !c.rows[0].isin && c.rows[0].pct === '100', focus: a.classList.contains('bb-ins') && !!a.closest('[data-card="' + id + '"]') }; }, cid3);
    check('cards', 'clear leaves one empty row (100 % typed in, 30.09.) and focuses its instrument field', cleared.rows === 1 && cleared.empty && cleared.focus, cleared);
    await page.keyboard.press('Escape');
    const dupId = await page.evaluate(() => window.__own(1).id);
    await page.click('#benchCards [data-card="' + dupId + '"] [data-act="delrow"]');
    await settle(page);
    const delrow = await page.evaluate((id) => { const c = PFApp.state.cards.find((x) => x.id === id); const a = document.activeElement; return { rows: c.rows.length, focusInCard: !!a.closest('[data-card="' + id + '"]') }; }, dupId);
    check('cards', 'remove row keeps focus inside the card', delrow.rows === 1 && delrow.focusInCard, delrow);
    const freed = await page.evaluate((id) => PFApp.state.cards.find((x) => x.id === id).color, dupId);
    await page.click('#benchCards [data-card="' + dupId + '"] [data-act="del"]');
    await settle(page);
    const del = await page.evaluate(() => { const a = document.activeElement; return { n: window.__ownAll().length, focus: a && (a.getAttribute('data-act') || a.className) }; });
    const cid4 = await addCard(page, [['Gold', '100']]);
    const reuse = await page.evaluate((id) => PFApp.state.cards.find((x) => x.id === id).color, cid4);
    check('cards', 'delete card moves focus to a sensible control; freed colour is reused', del.n === 2 && !!del.focus && reuse === freed, { del, freed, reuse });
    check('cards', 'no console errors while editing cards', page.errors.length === 0, page.errors.slice(0, 5));

    // dropdown overlay: not clipped by the card, below the field, upward near the bottom of the window
    await page.click('#benchCards [data-card="' + cid4 + '"] [data-act="addrow"]');
    await page.evaluate(() => { const a = document.activeElement; window.scrollBy(0, a.getBoundingClientRect().top - 180); });
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowDown');                // re-open at the new scroll position
    await settle(page);
    const place = await page.evaluate(() => {
      const d = document.getElementById('bbDrop').getBoundingClientRect(), i = document.activeElement.getBoundingClientRect(), card = document.activeElement.closest('.bb-card').getBoundingClientRect();
      return { open: !document.getElementById('bbDrop').hidden, below: d.top >= i.bottom - 1, beyondCard: d.bottom > card.bottom || d.right > card.right, inWindow: d.left >= 0 && d.right <= innerWidth && d.bottom <= innerHeight + 1 };
    });
    await shot(page, 'cards-dropdown-1903', { note: 'benchmark cards with the search list open' });
    await page.keyboard.press('Escape');
    await page.evaluate(() => { const a = document.activeElement; window.scrollBy(0, a.getBoundingClientRect().bottom - innerHeight + 60); });
    await page.keyboard.press('ArrowDown');
    await settle(page);
    const placeUp = await page.evaluate(() => { const d = document.getElementById('bbDrop').getBoundingClientRect(), i = document.activeElement.getBoundingClientRect(); return { above: d.bottom <= i.top + 1, top: d.top }; });
    check('cards', 'search list is an overlay outside the card, inside the window, opens upward near the bottom', place.open && place.below && place.beyondCard && place.inWindow && placeUp.above, { place, placeUp });
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.scrollTo(0, 0));

    // ================================================================= hover with 3 shown benchmarks (Mein Depot + 2 cards)
    await page.click('#benchCards [data-card="' + cid4 + '"] [data-act="del"]');
    await page.locator('#benchCards [data-card="' + cid3 + '"] .bb-ins').first().click();
    await page.keyboard.type('MSCI World');
    await page.keyboard.press('Enter');
    await page.keyboard.type('100');
    await page.keyboard.press('Tab');
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page);
    const shownNow = await page.evaluate(() => PFApp.state.benchmarks.length);
    async function hoverSweep(tag) {
      const bad = [];
      for (let f = 0; f <= 1.0001; f += 0.05) {
        await hoverAt(page, Math.min(f, 1));
        const g = await chartGeo(page);
        if (g && (g.hits.length || !g.inside)) bad.push({ f: Math.round(f * 100) / 100, hits: g.hits.slice(0, 2), inside: g.inside });
      }
      await page.mouse.move(1, 1);
      return bad;
    }
    const sweeps = {};
    for (const [mode, preset] of [['value', 'YTD'], ['pl', 'YTD'], ['value', '1T'], ['pl', '1T'], ['value', '1W'], ['pl', '1W'], ['value', '1M'], ['pl', '1M']]) {
      await page.click('#rangeTabs [data-preset="' + preset + '"]');
      await page.click('#modeToggle [data-mode="' + mode + '"]');
      await settle(page);
      sweeps[mode + '/' + preset] = await hoverSweep(mode + preset);
    }
    check('hover', 'desktop: hover box with 3 shown benchmarks never covers lines, y labels or the last-value box (YTD/1T/1W 30 min/1M 2 h, both modes)',
      shownNow === 3 && Object.values(sweeps).every((b) => b.length === 0), { shownNow, sweeps });
    await page.click('#modeToggle [data-mode="value"]');
    await page.click('#rangeTabs [data-preset="YTD"]');
    await hoverAt(page, 0.62);
    await shot(page, 'hover-3-benchmarks-1903', { clip: { x: 0, y: 0, width: 1903, height: 1000 }, note: 'hover with Mein Depot + 2 cards' });
    await page.mouse.move(1, 1);

    // ================================================================= measurement (1903, YTD and 1T)
    await drag(page, 0.55, 0.85);
    const m1 = await page.evaluate(() => ({ pin: PFApp.sync.pinned(), btn: !document.getElementById('applyMeasure').hidden }));
    const g1 = await chartGeo(page), d1 = await depotBoxCheck(page);
    check('measure', 'forward drag pins a measurement; "Zeitraum auf Auswahl setzen" shown', !!m1.pin && m1.pin.b > m1.pin.a && m1.btn, m1);
    check('measure', 'one measurement block (caption + one box per line), inside the chart, not covering lines/labels',
      g1.tips.length === 1 && g1.hits.length === 0 && g1.inside && d1.n === d1.nl && /–/.test(d1.caption), { g1, n: d1.n, nl: d1.nl, caption: d1.caption });
    check('measure', 'every box (Portfolio, Mein Depot): % / start → end € / € change match the drawn series at the measured points; no "Gleicher Wert"',
      d1.side && d1.all && !(await page.evaluate(() => /Gleicher Wert/.test(document.getElementById('mainChart').textContent))), d1);
    await shot(page, 'measure-ytd-1903', { clip: { x: 0, y: 0, width: 1903, height: 1000 }, note: 'pinned YTD measurement with the Mein Depot box' });
    await page.keyboard.press('Escape');
    await settle(page);
    const escd = await page.evaluate(() => PFApp.sync.measure === null);
    await hoverAt(page, 0.3);
    const hovAfter = await page.evaluate(() => { const t = document.querySelector('#mainChart .pc-tip'); return !t.hidden && t.classList.contains('pc-tip--hover'); });
    check('measure', 'Esc clears the measurement and hover works again', escd && hovAfter, { escd, hovAfter });
    await page.mouse.move(1, 1);
    await drag(page, 0.8, 0.35);
    const rev = await page.evaluate(() => PFApp.sync.pinned());
    const drev = await depotBoxCheck(page);
    check('measure', 'reverse drag pins the same kind of span (a < b) with correct numbers', !!rev && rev.a < rev.b && drev.side && drev.all, { rev, drev });
    // click - follow - click
    await page.keyboard.press('Escape');
    const box = await page.locator('#mainChart svg').boundingBox();
    const Lx = await page.evaluate(() => ({ padL: PFApp.charts.main.L.padL, plotW: PFApp.charts.main.L.plotW, top: PFApp.charts.main.L.top, bottom: PFApp.charts.main.L.bottom }));
    const yM = box.y + (Lx.top + Lx.bottom) / 2;
    await page.mouse.click(box.x + Lx.padL + Lx.plotW * 0.2, yM);
    await page.mouse.move(box.x + Lx.padL + Lx.plotW * 0.5, yM, { steps: 8 });
    await settle(page);
    const follow = await page.evaluate(() => ({ following: PFApp.sync.following(), measure: PFApp.sync.measure, tips: Array.from(document.querySelectorAll('#mainChart .pc-tip')).filter((t) => !t.hidden).length }));
    await page.mouse.click(box.x + Lx.padL + Lx.plotW * 0.5, yM);
    await settle(page);
    const ended = await page.evaluate(() => PFApp.sync.measure === null);
    check('measure', 'click sets the start, the end follows the pointer (live boxes), the next click ends it',
      follow.following && follow.measure && follow.measure.b > follow.measure.a && follow.tips === 1 && ended, { follow, ended });
    await page.mouse.move(1, 1);
    // edges and full range
    const edges = {};
    for (const [n, a, b] of [['left', 0.0, 0.08], ['right', 0.9, 1.0], ['full', 0.0, 1.0]]) {
      await drag(page, a, b);
      const g = await chartGeo(page);
      edges[n] = { tips: g.tips.length, hits: g.hits, inside: g.inside };
      await page.keyboard.press('Escape');
    }
    check('measure', 'left-edge, right-edge and full-range spans stay inside the chart and cover nothing',
      Object.values(edges).every((e) => e.tips === 1 && e.hits.length === 0 && e.inside), edges);
    // Gesamtrendite, Startwert, Mein Depot (€), hidden Mein Depot
    await drag(page, 0.4, 0.9);
    const base0 = await depotBoxCheck(page);
    await page.click('#modeToggle [data-mode="pl"]');
    await settle(page);
    const plMode = await page.evaluate(() => { const t = document.querySelector('#mainChart .pc-tip'); return { pinned: !!PFApp.sync.pinned(), text: t.textContent }; });
    const dpl = await depotBoxCheck(page);
    check('measure', 'Gesamtrendite keeps the measurement and the same box numbers (the value series as drawn)',
      plMode.pinned && /[+−-]\d/.test(plMode.text) && JSON.stringify(dpl.rows) === JSON.stringify(base0.rows), { text: plMode.text.slice(0, 80), rows: dpl.rows });
    await page.click('#modeToggle [data-mode="value"]');
    const sv = {};
    for (const v of ['10000', '1000000', '']) {
      await page.locator('#startValue').click();
      await selectAllAndType(page, v);
      await settle(page);
      sv[v || 'leer'] = await depotBoxCheck(page);
    }
    check('measure', 'Startwert 10.000 / 1.000.000 / empty: the boxes follow the scaled lines (same %, other €), numbers match the drawn series',
      Object.values(sv).every((d) => d.side && d.all) && sv['10000'].rows[0] === sv['leer'].rows[0] && sv['1000000'].rows[0] === sv['leer'].rows[0] &&
      new Set([sv['10000'].rows[1], sv['1000000'].rows[1], sv['leer'].rows[1]]).size === 3,
      { s10k: sv['10000'].rows, s1m: sv['1000000'].rows, leer: sv['leer'].rows });
    // buttons next to Startwert (29.09.): "Mein Depot" = the real depot's current value, "Yacht" = empty
    await page.click('#svDepot');
    await settle(page);
    const svd = await page.evaluate(() => { const d = PFEngine.depotNow(PFEngine.prepare(window.PORTFOLIO_DATA));
      return { sv: PFApp.state.startValue, want: Math.round(d.value), on: document.getElementById('svDepot').classList.contains('is-on'), start: Math.round(PFApp.model().p.value[0]) }; });
    const dvb = await depotBoxCheck(page);
    await page.click('#svYacht');
    await settle(page);
    const svy = await page.evaluate(() => ({ sv: PFApp.state.startValue, field: document.getElementById('startValue').value, on: document.getElementById('svYacht').classList.contains('is-on') }));
    check('measure', '"Mein Depot" button: Startwert = the real depot value, every line starts there, boxes follow; "Yacht" empties it',
      svd.sv === svd.want && svd.on && svd.start === svd.want && dvb.side && dvb.all && svy.sv === null && svy.field === '' && svy.on, { svd, svy });
    await page.locator('#startValue').click();
    await selectAllAndType(page, '');
    await page.click('#benchCards .bb-card:nth-child(2) [data-act="show"]');
    await settle(page);
    await drag(page, 0.4, 0.9);
    const noDepot = await chartGeo(page);
    const nd = await depotBoxCheck(page);
    const ndTxt = await page.evaluate(() => document.querySelector('#mainChart .pc-tip').textContent);
    check('measure', 'Mein Depot hidden: no Mein Depot box (Portfolio + the other shown cards)',
      noDepot.tips.length === 1 && noDepot.hits.length === 0 && nd.n === nd.nl && nd.rows === null && !/Mein Depot/.test(ndTxt), { tips: noDepot.tips, n: nd.n });
    await page.keyboard.press('Escape');
    await page.click('#benchCards .bb-card:nth-child(2) [data-act="show"]');
    await settle(page);
    // 1T
    await page.click('#rangeTabs [data-preset="1T"]');
    await settle(page);
    const t1 = await page.evaluate(() => ({ x: Array.from(document.querySelectorAll('#mainChart .pc-xlabel')).map((n) => n.textContent),
      note: document.getElementById('chartNote').textContent, intra: !!PFApp.model().intra, dates: PFApp.model().intra && PFApp.model().intra.dates,
      last2: window.PORTFOLIO_DATA.dates.slice(-2) }));
    const dayWords = t1.x.filter((t) => /^(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag|Gestern|Heute)$/.test(t));
    check('data', '1T shows the 30-min sessions of the last two trading days (two day labels, note "30-Minuten-Kurse bis HH:MM Uhr" under the chart)',
      t1.intra && JSON.stringify(t1.dates) === JSON.stringify(t1.last2) && dayWords.length === 2 && /30-Minuten-Kurse bis \d\d:\d\d Uhr/.test(t1.note), { x: t1.x, dates: t1.dates, note: t1.note.slice(0, 120) });
    await drag(page, 0.35, 0.6);
    const g1t = await chartGeo(page), d1t = await depotBoxCheck(page);
    const lbl = await page.evaluate(() => document.querySelector('#mainChart .pc-tip .tt-cap').textContent);
    check('measure', '1T: slot labels in the caption, both boxes match the 30-min lines, nothing covered',
      /, \d\d:\d\d/.test(lbl) && g1t.tips.length === 1 && g1t.hits.length === 0 && d1t.side && d1t.all, { lbl, g1t, d1t });
    await shot(page, 'measure-1t-1903', { clip: { x: 0, y: 0, width: 1903, height: 1000 }, note: '1T measurement' });
    await page.keyboard.press('Escape');
    await page.click('#rangeTabs [data-preset="YTD"]');
    // drawdown sync
    await hoverAt(page, 0.5);
    const ddSync = await page.evaluate(() => ({ hover: PFApp.sync.hoverI, readout: document.getElementById('ddReadout').textContent, padR: [PFApp.charts.main.L.padR, PFApp.charts.dd.L && PFApp.charts.dd.L.padR] }));
    check('measure', 'drawdown chart follows the main chart hover; same padR', ddSync.hover != null && /\d{4}/.test(ddSync.readout) && ddSync.padR[0] === ddSync.padR[1], ddSync);
    await page.mouse.move(1, 1);

    // ================================================================= chart interval (user, 27.09.): 1T/1W 30 min, 1M 2 h,
    // longer daily; custom ranges by length (<= 7 days 30 min, <= 31 days 2 h), stepping down where the finer data is missing
    const ivState = () => page.evaluate(() => {
      const M = PFApp.model(), I = M.intra;
      return { key: M.iv.key, want: M.iv.want, note: document.getElementById('chartIv').textContent, m: I ? I.m : null, dates: I ? I.dates : null,
        x: Array.from(document.querySelectorAll('#mainChart .pc-xlabel')).map((n) => n.textContent),
        ddLen: PFApp.charts.dd.model && PFApp.charts.dd.model.dd ? PFApp.charts.dd.model.dd.length : null,
        endGap: I && M.ps ? Math.abs(I.value[I.last] - M.ps.endValue) : null, baseGap: I && M.p ? Math.abs(I.base - M.p.startValue) : null, endValue: M.ps ? M.ps.endValue : null,
        btn: !document.getElementById('applyMeasure').hidden, ranges: document.getElementById('dateRange').classList.contains('is-custom') };
    });
    /** Types a range into Von/Bis like a user (TT.MM.JJJJ digits, commit on the complete year); order keeps it valid. */
    async function typeRange(from, to) {
      const curTo = await page.evaluate(() => PFApp.state.custom ? PFApp.state.custom.to : null);
      const iso = (s) => s.slice(6) + '-' + s.slice(3, 5) + '-' + s.slice(0, 2);
      const toFirst = curTo && iso(from) > curTo;
      for (const [sel, v] of toFirst ? [['#dateTo', to], ['#dateFrom', from]] : [['#dateFrom', from], ['#dateTo', to]]) {
        await page.click(sel + ' .dseg >> nth=0');
        await page.keyboard.type(v.replace(/\./g, ''));
        await settle(page);
      }
      await page.evaluate(() => document.activeElement.blur());
      await settle(page);
    }
    const iv = {};
    for (const p of ['1T', '1W', '1M', '3M']) { await page.click('#rangeTabs [data-preset="' + p + '"]'); await settle(page); iv[p] = await ivState(); }
    for (const [name, a, b] of [['week in 30 min', '18.09.2026', '25.09.2026'], ['week early Sept.', '01.09.2026', '07.09.2026'],
      ['week in Aug.', '10.08.2026', '17.08.2026'], ['3 weeks', '01.09.2026', '21.09.2026']]) {
      await typeRange(a, b);
      iv[name] = Object.assign(await ivState(), { custom: await page.evaluate(() => PFApp.state.custom) });
    }
    const lastIntraday = await page.evaluate(() => window.PORTFOLIO_DATA.status.at(-1) === 'intraday');
    const ivKeys = Object.fromEntries(Object.entries(iv).map(([k, v]) => [k, v.key]));
    check('interval', 'interval per range: 1T/1W 30 min, 1M 2 h, 3M daily; custom week in the 30-min data 30 min, early-Sept. week 2 h, Aug. week daily, 3 weeks 2 h',
      JSON.stringify(ivKeys) === JSON.stringify({ '1T': 'm30', '1W': 'm30', '1M': 'h2', '3M': 'day', 'week in 30 min': 'm30', 'week early Sept.': 'h2', 'week in Aug.': 'day', '3 weeks': 'h2' }) &&
      iv['week early Sept.'].custom && iv['week early Sept.'].custom.from === '2026-09-01' && iv['week in Aug.'].custom.to === '2026-08-17', ivKeys);
    check('interval', 'note under the chart: "Intervall: 30 Min." / "2 Std." / "1 Tag" and why it stepped down',
      /^Intervall: 30 Min\.$/.test(iv['1W'].note) && /^Intervall: 2 Std\.$/.test(iv['1M'].note) && /^Intervall: 1 Tag$/.test(iv['3M'].note) &&
      /^Intervall: 2 Std\. · keine 30-Min-Kurse für diesen Zeitraum$/.test(iv['week early Sept.'].note) &&
      /^Intervall: 1 Tag · keine 30-Min- oder 2-Std-Kurse für diesen Zeitraum$/.test(iv['week in Aug.'].note) && /^Intervall: 2 Std\.$/.test(iv['3 weeks'].note),
      Object.fromEntries(Object.entries(iv).map(([k, v]) => [k, v.note])));
    check('interval', 'sub-daily charts start on the daily start value and end on the daily end value (headline = chart end); points per interval',
      // an open (intraday) last day: the grid's latest point may lie a few minutes after the daily price (tiny gap allowed)
      ['1W', '1M', 'week in 30 min', 'week early Sept.', '3 weeks'].every((k) => iv[k].baseGap < 1e-6 && (iv[k].endGap < 1e-6 || (lastIntraday && iv[k].endGap / iv[k].endValue < 1e-3))) &&
      iv['1W'].m > 100 && iv['1M'].m > iv['1W'].m && iv['week early Sept.'].m > 10 && iv['1T'].m === 64 && iv['3M'].m === null,
      Object.fromEntries(Object.entries(iv).map(([k, v]) => [k, { m: v.m, endGap: v.endGap, baseGap: v.baseGap }])));
    check('interval', 'x axis: 1T day words + 15:15, 1W one label per session ("Mo 21.09."), 1M dates at week starts ("31. Aug."); drawdown on the same grid',
      /^(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Gestern|Heute)$/.test(iv['1T'].x[0]) && iv['1T'].x.indexOf('15:15') > 0 &&
      iv['1W'].x.length === 5 && iv['1W'].x.every((t) => /^(Mo|Di|Mi|Do|Fr) \d\d\.\d\d\.$/.test(t)) &&
      /^\d+\. \S+$/.test(iv['1M'].x[0]) && ['1T', '1W', '1M', 'week early Sept.'].every((k) => iv[k].ddLen === iv[k].m),
      { '1T': iv['1T'].x, '1W': iv['1W'].x, '1M': iv['1M'].x, earlySept: iv['week early Sept.'].x });
    await shot(page, 'interval-2h-custom-1903', { clip: { x: 0, y: 0, width: 1903, height: 1000 }, note: 'custom 3-week range on the 2-h grid' });
    // 1W: hover labels, drag both directions, click-follow-click, boxes, Esc, Gesamtrendite, Startwert, what-if, empty
    await page.click('#rangeTabs [data-preset="1W"]');
    await page.click('#modeToggle [data-mode="value"]');
    await settle(page);
    await hoverAt(page, 0);
    const h0 = await page.evaluate(() => document.querySelector('#mainChart .pc-tip .tt-date').textContent);
    await hoverAt(page, 0.47);
    const h1 = await page.evaluate(() => ({ t: document.querySelector('#mainChart .pc-tip .tt-date').textContent, dd: document.getElementById('ddReadout').textContent }));
    await page.mouse.move(1, 1);
    check('interval', '1W hover: date + time ("Mi 23.09., 14:30"), the start point "…, Schluss"; drawdown read-out with the same label',
      /^(Mo|Di|Mi|Do|Fr) \d\d\.\d\d\., Schluss$/.test(h0) && /^(Mo|Di|Mi|Do|Fr) \d\d\.\d\d\., \d\d:\d\d$/.test(h1.t) && h1.dd.indexOf(h1.t) === 0, { h0, h1 });
    await drag(page, 0.3, 0.75);
    const w1 = await page.evaluate(() => ({ pin: PFApp.sync.pinned(), btn: !document.getElementById('applyMeasure').hidden,
      dates: ((document.querySelector('#mainChart .pc-tip .tt-cap') || {}).textContent || '').split(' – ').filter(Boolean), help: document.getElementById('chartHelp').textContent }));
    const gw1 = await chartGeo(page), dw1 = await depotBoxCheck(page);
    check('interval', '1W forward drag: pinned, caption with date + time, the boxes match the 30-min lines, nothing covered, no "Zeitraum auf Auswahl setzen"',
      !!w1.pin && w1.pin.b > w1.pin.a && !w1.btn && w1.dates.length === 2 && w1.dates.every((t) => /^(Mo|Di|Mi|Do|Fr) \d\d\.\d\d\., (\d\d:\d\d|Schluss)$/.test(t)) &&
      gw1.tips.length === 1 && gw1.hits.length === 0 && gw1.inside && dw1.side && dw1.all && /^Messung .+, \d\d:\d\d – /.test(w1.help),
      { w1, hits: gw1.hits, rows: dw1.rows, expect: dw1.expect });
    await shot(page, 'measure-1w-1903', { clip: { x: 0, y: 0, width: 1903, height: 1000 }, note: '1W (30 min) measurement' });
    await page.keyboard.press('Escape');
    await drag(page, 0.9, 0.12);
    const wrev = await page.evaluate(() => PFApp.sync.pinned()), dwrev = await depotBoxCheck(page);
    await page.click('#modeToggle [data-mode="pl"]');
    await settle(page);
    const wpl = await page.evaluate(() => ({ pinned: !!PFApp.sync.pinned(), text: document.querySelector('#mainChart .pc-tip').textContent }));
    const dwpl = await depotBoxCheck(page);
    await page.click('#modeToggle [data-mode="value"]');
    await page.keyboard.press('Escape');
    await settle(page);
    check('interval', '1W reverse drag (a < b, numbers match), Gesamtrendite keeps it with signed values and the same Mein Depot numbers, Esc clears',
      !!wrev && wrev.a < wrev.b && dwrev.all && wpl.pinned && /[+−-]\d/.test(wpl.text) &&
      JSON.stringify(dwpl.rows) === JSON.stringify(dwrev.rows) && (await page.evaluate(() => PFApp.sync.measure === null)), { wrev, rows: dwrev.rows, pl: dwpl.rows });
    const bw1 = await page.locator('#mainChart svg').boundingBox();
    const Lw = await page.evaluate(() => ({ padL: PFApp.charts.main.L.padL, plotW: PFApp.charts.main.L.plotW, top: PFApp.charts.main.L.top, bottom: PFApp.charts.main.L.bottom }));
    const yw = bw1.y + (Lw.top + Lw.bottom) / 2;
    await page.mouse.click(bw1.x + Lw.padL + Lw.plotW * 0.7, yw);
    await page.mouse.move(bw1.x + Lw.padL + Lw.plotW * 0.25, yw, { steps: 8 });
    await settle(page);
    const wf = await page.evaluate(() => ({ following: PFApp.sync.following(), m: PFApp.sync.measure, tips: Array.from(document.querySelectorAll('#mainChart .pc-tip')).filter((t) => !t.hidden).length }));
    await page.mouse.click(bw1.x + Lw.padL + Lw.plotW * 0.25, yw);
    await settle(page);
    check('interval', '1W click-follow-click (leftwards): live boxes, the next click ends it',
      wf.following && wf.m && wf.m.b < wf.m.a && wf.tips === 1 && (await page.evaluate(() => PFApp.sync.measure === null)), wf);
    await page.mouse.move(1, 1);
    await page.locator('#startValue').click();
    await selectAllAndType(page, '100000');
    await settle(page);
    await drag(page, 0.2, 0.6);
    const wsv = await page.evaluate(() => ({ base: PFApp.model().intra.base, end: PFApp.model().intra.value[PFApp.model().intra.last], ps: PFApp.model().ps.endValue }));
    const dwsv = await depotBoxCheck(page);
    await page.keyboard.press('Escape');
    await page.locator('#startValue').click();
    await selectAllAndType(page, '');
    await settle(page);
    check('interval', '1W with Startwert 100.000: grid scaled from 100.000 €, ends on the scaled daily end, measure numbers match',
      Math.abs(wsv.base - 100000) < 1e-6 && Math.abs(wsv.end - wsv.ps) < 1e-6 && dwsv.all, { wsv, rows: dwsv.rows });
    const wwi = await page.evaluate(() => {
      const first = PFApp.model().assets[0].isin;
      PFApp.state.overrides = { [first]: 0 };
      PFApp.update();
      const M = PFApp.model(), g = PFApp.charts.main.model.ghost;
      const out = { ghost: !!g && g.values.length === M.intra.m, orig: !!M.intra.orig, legend: /Original/.test(document.getElementById('legend').textContent) };
      PFApp.state.overrides = {};
      PFApp.state.selected = new Set();
      PFApp.update();
      out.empty = document.querySelector('#mainChart .pc-msg').textContent;
      out.intraNull = PFApp.model().intra === null;
      out.note = document.getElementById('chartIv').textContent;
      PFApp.state.selected = new Set(PFApp.model().assets.map((a) => a.isin));
      PFApp.update();
      return out;
    });
    const wbt = await badText(page);
    check('interval', '1W what-if draws the dashed original on the same grid; empty selection shows the empty text (no NaN)',
      wwi.ghost && wwi.orig && wwi.legend && /Keine Position/.test(wwi.empty) && wwi.intraNull && !wbt.nan && !wbt.undef, wwi);
    // 1M: drag on the 2-h grid
    await page.click('#rangeTabs [data-preset="1M"]');
    await settle(page);
    await drag(page, 0.15, 0.85);
    const gm1 = await chartGeo(page), dm1 = await depotBoxCheck(page);
    const lm1 = await page.evaluate(() => ((document.querySelector('#mainChart .pc-tip .tt-cap') || {}).textContent || '').split(' – ').filter(Boolean));
    check('interval', '1M drag on the 2-h grid: boxes cover nothing, labels with time, Mein Depot numbers match',
      gm1.tips.length === 1 && gm1.hits.length === 0 && gm1.inside && dm1.side && dm1.all &&
      lm1.every((t) => /^(Mo|Di|Mi|Do|Fr) \d\d\.\d\d\., (\d\d:\d\d|Schluss)$/.test(t)), { lm1, hits: gm1.hits, rows: dm1.rows, expect: dm1.expect });
    await shot(page, 'measure-1m-1903', { clip: { x: 0, y: 0, width: 1903, height: 1000 }, note: '1M (2 h) measurement' });
    await page.keyboard.press('Escape');
    await page.click('#rangeTabs [data-preset="YTD"]');
    await settle(page);
    check('interval', 'no console errors in the interval checks', page.errors.length === 0, page.errors.slice(0, 5));

    // ================================================================= periods
    const per = {};
    for (const [src, key] of [['#holdPills [data-hp="1T"]', '1T'], ['#holdPills [data-hp="1M"]', '1M'], ['#holdPills [data-hp="3M"]', '3M'], ['#rangeTabs [data-preset="6M"]', '6M'], ['#holdPills [data-hp="1W"]', '1W'], ['#rangeTabs [data-preset="MAX"]', 'MAX'], ['#holdPills [data-hp="SK"]', 'SK'], ['#holdPills [data-hp="YTD"]', 'YTD']]) {
      await page.click(src);
      await settle(page);
      per[key] = await page.evaluate(() => ({
        pill: (document.querySelector('#holdPills .is-active') || {}).textContent || null,
        tab: (document.querySelector('#rangeTabs .is-active') || {}).textContent || null,
        label: document.querySelector('#holdChg .hold-per') && document.querySelector('#holdChg .hold-per').textContent,
        dLabel: document.querySelector('#depotChg .hold-per') && document.querySelector('#depotChg .hold-per').textContent,
        dEur: document.querySelector('#depotChg b') && document.querySelector('#depotChg b').textContent
      }));
    }
    const depExp = await page.evaluate(() => {
      const c = PFEngine.prepare(window.PORTFOLIO_DATA), F = PFEngine.fmt, out = {};
      for (const p of ['1T', '1M', '3M']) out[p] = F.eur(PFEngine.depotChange(c, PFEngine.presetRange(c, p)).pl, { sign: true, dec: 2 });
      out.SK = F.eur(PFEngine.depotNow(c).gl, { sign: true, dec: 2 });
      return out;
    });
    check('periods', '"Mein Depot" top block follows the period (1T = daily P&L, 1M, 3M = depotChange; Seit Kauf = G/V seit Kauf) with the Yacht block\'s label',
      ['1T', '1M', '3M', '6M', 'YTD'].every((k) => per[k].dLabel === per[k].label) && per.SK.dLabel === 'seit Kauf' &&
      ['1T', '1M', '3M', 'SK'].every((k) => per[k].dEur === depExp[k]) && per['1T'].dEur !== per['1M'].dEur, { per, depExp });
    check('periods', '3M/6M pills and tabs update each other and the labels; MAX = no pill; Seit Kauf = MAX tab',
      per['3M'].pill === '3M' && per['3M'].tab === '3M' && per['3M'].label === '3 Monate' && per['6M'].pill === '6M' && per['6M'].tab === '6M' && per['6M'].label === '6 Monate' &&
      per['1W'].tab === '1W' && per.MAX.pill === null && per.MAX.tab === 'MAX' && per.SK.pill === 'Seit Kauf' && per.SK.tab === 'MAX' && per.YTD.pill === 'YTD', per);

    // ================================================================= lists and order (1903)
    const lists0 = await page.evaluate(() => ({ hold: document.querySelector('#listToggles [data-list="hold"]').getAttribute('aria-pressed'), assets: document.querySelector('#listToggles [data-list="assets"]').getAttribute('aria-pressed'), assetHidden: document.getElementById('assetBlock').hidden }));
    check('lists', 'defaults: Portfolio on, Einzelwerte off', lists0.hold === 'true' && lists0.assets === 'false' && lists0.assetHidden, lists0);
    const order = await page.evaluate(() => {
      const out = [], st = document.querySelector('.settings');
      for (let n = st.nextElementSibling; n; n = n.nextElementSibling) {
        const h = n.id === 'lists' ? 'Listen' : n.querySelector('h2') && n.querySelector('h2').textContent;
        if (h) out.push(h.trim());
      }
      return out;
    });
    const gone = await page.evaluate(() => !document.getElementById('monthTable') && !document.getElementById('riskBlock') && !document.getElementById('heatmap'));
    check('lists', 'order: lists, Drawdown, Kennzahlen, Hinweise (Benchmark-Vergleich removed 30.09.) (Monatsrenditen and Risiko & Korrelation removed)',
      order.join('|') === 'Listen|Drawdown|Kennzahlen|Hinweise' && gone, { order, gone });
    // card "Benchmark-Positionen" (30.09.): off by default; on = one group per shown benchmark with its holdings; the holdings add up to the group line
    const hb0 = await page.evaluate(() => ({ on: PFApp.state.hbOn, hidden: document.getElementById('hbBody').hidden, sortino: !!document.querySelector('#kpis') && /Sortino/.test(document.getElementById('kpis').textContent), vgl: !!document.getElementById('benchTable') }));
    await page.click('#hbToggle');
    await settle(page);
    const hb1 = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#hbBody tbody tr')), num = (t) => parseFloat(t.replace(/\./g, '').replace(',', '.').replace('+', ''));
      const grp = rows.filter((r) => r.classList.contains('hb-grp')), out = [];
      grp.forEach((g) => {
        let el = g.nextElementSibling, sumV = 0, sumPl = 0, n = 0;
        while (el && !el.classList.contains('hb-grp')) { if (!el.classList.contains('hb-note')) { sumV += num(el.children[1].textContent); sumPl += num(el.children[2].textContent); n++; } el = el.nextElementSibling; }
        out.push({ name: g.children[0].textContent.trim(), n, dV: Math.abs(sumV - num(g.children[1].textContent)), dPl: Math.abs(sumPl - num(g.children[2].textContent)) });
      });
      return { open: !document.getElementById('hbBody').hidden, groups: out, shown: window.__shown() };
    });
    await page.click('#hbToggle');
    await settle(page);
    const hb2 = await page.evaluate(() => document.getElementById('hbBody').hidden);
    check('lists', 'Benchmark-Positionen: off by default; on = every shown benchmark with its holdings, Σ holdings = the benchmark line (rounding ≤ 5 €); Sortino and Benchmark-Vergleich are gone',
      hb0.on === false && hb0.hidden && !hb0.sortino && !hb0.vgl && hb1.open && hb1.groups.length >= 1 && hb1.groups.every((g) => g.n >= 1 && g.dV <= 5 && g.dPl <= 5) && hb2, { hb0, hb1, hb2 });
    async function combos(pg) {
      const out = [];
      for (const [h, a] of [[true, false], [true, true], [false, true], [false, false]]) {
        for (const [k, want] of [['hold', h], ['assets', a]]) {
          const b = pg.locator('#listToggles [data-list="' + k + '"]');
          if ((await b.getAttribute('aria-pressed')) !== String(want)) await b.click();
        }
        await settle(pg);
        const o = await overflow(pg);
        out.push(Object.assign({ hold: h, assets: a }, await pg.evaluate(() => ({ side: document.getElementById('lists').classList.contains('is-side'), stack: document.getElementById('lists').classList.contains('is-stack'), hint: !document.getElementById('listsHint').hidden })), { ok: o.sw <= o.w }));
      }
      return out;
    }
    const c1903 = await combos(page);
    check('lists', '1903: four combinations, both on = side by side, both off = hint, no page overflow',
      c1903.every((c) => c.ok) && c1903[1].side && c1903[3].hint && !c1903[0].hint, c1903);
    // both on for the rest
    for (const k of ['hold', 'assets']) { const b = page.locator('#listToggles [data-list="' + k + '"]'); if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click(); }
    await page.locator('#lists').scrollIntoViewIfNeeded();
    await shot(page, 'lists-side-1903', { note: 'Portfolio + Einzelwerte side by side' });
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.waitForTimeout(150);
    const r1400 = await page.evaluate(() => document.getElementById('lists').classList.contains('is-stack'));
    await page.setViewportSize({ width: 1903, height: 1000 });
    await page.waitForTimeout(150);
    const r1903 = await page.evaluate(() => document.getElementById('lists').classList.contains('is-side'));
    check('lists', 'resize 1903 -> 1400 -> 1903 switches side by side / stacked', r1400 && r1903, { r1400, r1903 });
    // sorting
    await page.click('#assetTable th[data-sort="ret"] button');
    const s1a = await page.evaluate(() => PFApp.state.sort);
    await page.click('#assetTable th[data-sort="ret"] button');
    const s1b = await page.evaluate(() => PFApp.state.sort);
    await page.click('#holdSortBtn');
    await page.click('#holdSortMenu [data-hsort="name-asc"]');
    const hs = await page.evaluate(() => ({ key: PFApp.state.holdSort, first: document.querySelector('#holdList .hr-title').textContent }));
    check('lists', 'sorting via table headers (toggle direction) and the ⋮ menu', s1a.key === 'ret' && s1b.dir === -s1a.dir && hs.key === 'name-asc' && /^Advanced|^Alphabet|^A/.test(hs.first), { s1a, s1b, hs });
    // selection + what-if
    const firstIsin = await page.evaluate(() => document.querySelector('#assetTable input[data-isin]').getAttribute('data-isin'));
    await page.click('#assetTable input[data-isin="' + firstIsin + '"]');
    await settle(page);
    const sel31 = await page.evaluate(() => PFApp.state.selected.size);
    await page.click('#selAll');
    await settle(page);
    const wi = page.locator('#assetTable input[data-wi]').first();
    await wi.click();
    await selectAllAndType(page, '1');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(120);
    const wiState = await page.evaluate(() => ({ banner: !document.getElementById('wiBanner').hidden, changed: document.querySelectorAll('#assetTable tr.is-changed').length, focus: !!document.activeElement.closest('#assetTable'), ghost: !!PFApp.charts.main.model.ghost }));
    await page.click('#wiReset');
    await settle(page);
    const wiOff = await page.evaluate(() => document.getElementById('wiBanner').hidden);
    check('lists', 'checkbox selection, Alle; Stück what-if (banner, changed row, focus kept, Original line) and reset',
      sel31 === 31 && wiState.banner && wiState.changed === 1 && wiState.focus && wiState.ghost && wiOff, { sel31, wiState, wiOff });
    // empty selection hint while Einzelwerte is hidden
    await page.click('#selNone');
    await page.locator('#listToggles [data-list="assets"]').click();
    await settle(page);
    const empty = await page.evaluate(() => ({ legend: document.getElementById('legend').textContent, btn: !!document.querySelector('#legend [data-hl-act="assets"]'), assetsHidden: document.getElementById('assetBlock').hidden }));
    let emptyOk = false;
    if (empty.btn) {
      await page.click('#legend [data-hl-act="assets"]');
      await page.waitForTimeout(150);
      await scrollSettled(page);
      emptyOk = await page.evaluate(() => { const b = document.getElementById('assetBlock'); const r = b.getBoundingClientRect(); return !b.hidden && r.top < innerHeight && r.bottom > 0 && PFApp.state.showAssets; });
    }
    check('lists', 'empty selection: hint is actionable while Einzelwerte is hidden (switches it on and brings it into view)', empty.assetsHidden && empty.btn && emptyOk, Object.assign(empty, { emptyOk }));
    check('lists', 'empty selection shows no NaN/undefined', !(await badText(page)).nan && !(await badText(page)).undef);
    if (!(await page.evaluate(() => PFApp.state.showAssets))) await page.locator('#listToggles [data-list="assets"]').click();
    await page.click('#selAll');
    await settle(page);
    // hidden list refresh
    await page.locator('#listToggles [data-list="assets"]').click();
    await page.click('#holdPills [data-hp="1M"]');
    await page.locator('#startValue').click();
    await selectAllAndType(page, '10000');
    await settle(page);
    await page.locator('#listToggles [data-list="assets"]').click();
    await settle(page);
    const refresh = await page.evaluate(() => ({ sub: document.getElementById('assetSub').textContent, scaled: document.getElementById('assetTable').classList.contains('is-scaled') }));
    check('lists', 'a hidden Einzelwerte list is current when switched on (period + Startwert)', /Sept/.test(refresh.sub) || /\d\d\.\d\d\./.test(refresh.sub), refresh);
    await page.locator('#startValue').click();
    await selectAllAndType(page, '');
    await page.keyboard.press('Backspace');
    await page.click('#holdPills [data-hp="YTD"]');
    await settle(page);
    const bt = await badText(page);
    check('general', '1903: no console errors, no NaN/undefined on the page', page.errors.length === 0 && !bt.nan && !bt.undef, { errors: page.errors.slice(0, 5), bt });
    await shot(page, 'full-1903', { fullPage: true, note: 'full page at 1903 px (both lists on, 3 benchmarks)' });

    // reload resets
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.PFApp && document.querySelector('#benchCards .bb-card'));
    if (page.fallbackFont) await fontsReady(page);
    const reset = await page.evaluate(() => ({ cards: PFApp.state.cards.length, shown: window.__shown(), dom: document.querySelectorAll('#benchCards .bb-card').length, assets: PFApp.state.showAssets, hold: PFApp.state.showHold, sv: PFApp.state.startValue }));
    check('cards', 'reload resets to the Mein Depot card only (and list defaults, empty Startwert); nothing persisted', reset.cards === 1 && reset.shown === 'Mein Depot' && reset.dom === 2 && !reset.assets && reset.hold && reset.sv === null, reset);

    // ================================================================= 1920 and 1400
    for (const w of [1920, 1400]) {
      const pg = await open(browser, w, 1000);
      pages.push(pg);
      const c = await combos(pg);
      const side = c[1].side, stack = c[1].stack;
      check('lists', w + ': list layout (' + (w >= 1900 ? 'side by side' : 'stacked') + ') and no page overflow', c.every((x) => x.ok) && (w >= 1900 ? side : stack), c);
      if (w === 1400) {
        for (const k of ['hold', 'assets']) { const b = pg.locator('#listToggles [data-list="' + k + '"]'); if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click(); }
        await shot(pg, 'full-1400', { fullPage: true, note: 'full page at 1400 px, lists stacked' });
      }
      // chart interval at this width: 1W (30 min) and 1M (2 h) measurements cover nothing, labels fit, no page overflow
      await pg.evaluate(() => window.scrollTo(0, 0));
      const ivw = {};
      for (const [p, a, b] of [['1W', 0.2, 0.7], ['1M', 0.85, 0.1]]) {
        await pg.click('#rangeTabs [data-preset="' + p + '"]');
        await settle(pg);
        await drag(pg, a, b);
        const g = await chartGeo(pg), d = await depotBoxCheck(pg), o = await overflow(pg);
        ivw[p] = { key: await pg.evaluate(() => PFApp.model().iv.key), tips: g.tips.length, hits: g.hits, inside: g.inside, rows: d.all, ok: o.sw <= o.w,
          x: await pg.evaluate(() => Array.from(document.querySelectorAll('#mainChart .pc-xlabel')).map((n) => n.textContent)) };
        await pg.keyboard.press('Escape');
      }
      await pg.click('#rangeTabs [data-preset="YTD"]');
      check('interval', w + ': 1W (30 min) and 1M (2 h) measurements cover nothing, Mein Depot numbers match, no page overflow',
        ivw['1W'].key === 'm30' && ivw['1M'].key === 'h2' && Object.values(ivw).every((v) => v.tips === 1 && v.hits.length === 0 && v.inside && v.rows && v.ok && v.x.length >= 4), ivw);
      const btw = await badText(pg);
      check('general', w + ': no console errors, no NaN/undefined', pg.errors.length === 0 && !btw.nan && !btw.undef, { errors: pg.errors.slice(0, 5) });
    }

    // ================================================================= mobile 375
    const mp = await open(browser, 375, 812);
    pages.push(mp);
    page = mp;
    await drag(mp, 0.3, 0.8);
    const gm = await chartGeo(mp), dm = await depotBoxCheck(mp);
    check('mobile', 'measurement boxes stack, stay inside the chart, cover nothing; numbers match',
      gm.tips.length === 1 && gm.inside && gm.hits.length === 0 && dm.all, { gm, dm: dm.rows });
    await shot(mp, 'measure-375', { clip: { x: 0, y: 0, width: 375, height: 812 }, note: 'stacked measurement boxes on a phone' });
    await mp.keyboard.press('Escape');
    await addCard(mp, [['MSCI World', '100']]);
    await addCard(mp, [['Nasdaq-100', '100']]);
    await mp.evaluate(() => window.scrollTo(0, 0));
    const sweepM = {};
    for (const [mode, preset] of [['value', 'YTD'], ['value', '1T'], ['value', '1W'], ['pl', '1M']]) {
      await mp.click('#rangeTabs [data-preset="' + preset + '"]');
      await mp.click('#modeToggle [data-mode="' + mode + '"]');
      await settle(mp);
      sweepM[mode + '/' + preset] = await hoverSweep('m' + mode + preset);
    }
    check('mobile', 'hover box with 3 shown benchmarks covers nothing (YTD/1T/1W/1M)', Object.values(sweepM).every((b) => b.length === 0), sweepM);
    await mp.click('#modeToggle [data-mode="value"]');
    await mp.click('#rangeTabs [data-preset="1W"]');
    await settle(mp);
    await drag(mp, 0.75, 0.2);
    const gm1w = await chartGeo(mp), dm1w = await depotBoxCheck(mp);
    const m1w = await mp.evaluate(() => ({ x: Array.from(document.querySelectorAll('#mainChart .pc-xlabel')).map((n) => n.textContent), note: document.getElementById('chartIv').textContent,
      noteRight: document.getElementById('chartIv').getBoundingClientRect().right <= innerWidth }));
    const o1w = await overflow(mp);
    check('mobile', '375 1W (30 min): reverse drag, stacked boxes cover nothing, numbers match; session labels and interval note fit, no page overflow',
      gm1w.tips.length === 1 && gm1w.inside && gm1w.hits.length === 0 && dm1w.all &&
      m1w.x.length >= 3 && /Intervall: 30 Min\./.test(m1w.note) && m1w.noteRight && o1w.sw <= o1w.w, { gm1w: gm1w.hits, rows: dm1w.rows, m1w, o1w });
    await shot(mp, 'measure-1w-375', { clip: { x: 0, y: 0, width: 375, height: 812 }, note: '1W measurement on a phone' });
    await mp.keyboard.press('Escape');
    await mp.click('#rangeTabs [data-preset="YTD"]');
    const cw = await mp.evaluate(() => { const g = document.getElementById('benchCards').getBoundingClientRect(); return Array.from(document.querySelectorAll('#benchCards .bb-card')).map((c) => Math.round(c.getBoundingClientRect().width - g.width)); });
    check('mobile', 'cards full width', cw.every((d) => Math.abs(d) <= 1), cw);
    await mp.locator('#benchCards').scrollIntoViewIfNeeded();
    await shot(mp, 'cards-375', { note: 'benchmark cards on a phone' });
    const cm = await combos(mp);
    for (const k of ['hold', 'assets']) { const b = mp.locator('#listToggles [data-list="' + k + '"]'); if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click(); }
    await settle(mp);
    const scroll = await mp.evaluate(() => { const s = document.querySelector('#assetBlock .tscroll'); const td = document.querySelector('#assetTable td.sticky'); return { inner: s.scrollWidth > s.clientWidth, sticky: td && getComputedStyle(td).position }; });
    check('mobile', '375: list combinations stack, no page overflow; table scrolls inside its card with a sticky name column',
      cm.every((c) => c.ok) && cm[1].stack && scroll.inner && scroll.sticky === 'sticky', { cm, scroll });
    const pillsFit = await mp.evaluate(() => { const r = document.getElementById('holdPills').getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0; });
    check('mobile', 'period pills fit at 375 px', pillsFit);
    await shot(mp, 'full-375', { fullPage: true, note: 'full page at 375 px, both lists on' });
    const btm = await badText(mp);
    check('general', '375: no console errors, no NaN/undefined', mp.errors.length === 0 && !btm.nan && !btm.undef, { errors: mp.errors.slice(0, 5) });

    // ================================================================= touch screen (375, emulated touch input)
    const tp = await open(browser, 375, 812, true);
    pages.push(tp);
    await chartIntoView(tp);
    const tbox = await tp.locator('#mainChart svg').boundingBox();
    const TL = await tp.evaluate(() => ({ padL: PFApp.charts.main.L.padL, plotW: PFApp.charts.main.L.plotW, top: PFApp.charts.main.L.top, bottom: PFApp.charts.main.L.bottom }));
    const ty = tbox.y + (TL.top + TL.bottom) / 2, tx = (f) => tbox.x + TL.padL + TL.plotW * f;
    const outside = await tp.locator('#legend').boundingBox();
    await tp.touchscreen.tap(tx(0.3), ty);
    await settle(tp);
    const tap1 = await tp.evaluate(() => PFApp.sync.following());
    await tp.touchscreen.tap(outside.x + 10, outside.y + 5);
    await settle(tp);
    const tap2 = await tp.evaluate(() => PFApp.sync.measure === null);
    check('mobile', 'touch: a tapped start point follows; a tap outside the chart removes it', tap1 && tap2, { tap1, tap2 });
    const cdp = await tp.context().newCDPSession(tp);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx(0.25), y: ty }] });
    for (let k = 1; k <= 10; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tx(0.25 + 0.45 * k / 10), y: ty }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settle(tp);
    const tpin = await tp.evaluate(() => PFApp.sync.pinned());
    const tgeo = await chartGeo(tp);
    await tp.touchscreen.tap(outside.x + 10, outside.y + 5);
    await settle(tp);
    const tkeep = await tp.evaluate(() => !!PFApp.sync.pinned());
    await tp.touchscreen.tap(tx(0.5), ty);
    await settle(tp);
    const tclear = await tp.evaluate(() => PFApp.sync.measure === null);
    check('mobile', 'touch: drag pins a measurement (boxes cover nothing); a tap outside keeps it; a tap in the plot clears it',
      !!tpin && tpin.b > tpin.a && tgeo.tips.length === 1 && tgeo.hits.length === 0 && tkeep && tclear, { tpin, tips: tgeo.tips.length, hits: tgeo.hits, tkeep, tclear });
    // touch on the 30-min week: tap sets a start point (label with time), drag pins, a tap in the plot clears
    await tp.evaluate(() => document.getElementById('rangeTabs').scrollIntoView({ block: 'center' }));
    await settle(tp);
    await tp.touchscreen.tap((await tp.locator('#rangeTabs [data-preset="1W"]').boundingBox()).x + 10, (await tp.locator('#rangeTabs [data-preset="1W"]').boundingBox()).y + 10);
    await settle(tp);
    await chartIntoView(tp);
    const tb2 = await tp.locator('#mainChart svg').boundingBox();
    const TL2 = await tp.evaluate(() => ({ key: PFApp.model().iv.key, padL: PFApp.charts.main.L.padL, plotW: PFApp.charts.main.L.plotW, top: PFApp.charts.main.L.top, bottom: PFApp.charts.main.L.bottom }));
    const ty2 = tb2.y + (TL2.top + TL2.bottom) / 2, tx2 = (f) => tb2.x + TL2.padL + TL2.plotW * f;
    await tp.touchscreen.tap(tx2(0.4), ty2);
    await settle(tp);
    const wt1 = await tp.evaluate(() => ({ following: PFApp.sync.following(), help: document.getElementById('chartHelp').textContent }));
    await tp.touchscreen.tap(tx2(0.4), ty2);
    await settle(tp);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx2(0.2), y: ty2 }] });
    for (let k = 1; k <= 10; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tx2(0.2 + 0.6 * k / 10), y: ty2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settle(tp);
    const wtpin = await tp.evaluate(() => PFApp.sync.pinned()), wtgeo = await chartGeo(tp), wtd = await depotBoxCheck(tp);
    await tp.touchscreen.tap(tx2(0.5), ty2);
    await settle(tp);
    const wtclear = await tp.evaluate(() => PFApp.sync.measure === null);
    check('mobile', 'touch 1W (30 min): tap = start point, drag pins (boxes cover nothing, numbers match), tap in the plot clears',
      TL2.key === 'm30' && wt1.following && !!wtpin && wtpin.b > wtpin.a && wtgeo.tips.length === 1 && wtgeo.hits.length === 0 &&
      wtd.all && wtclear, { key: TL2.key, wt1, wtpin, hits: wtgeo.hits, rows: wtd.rows, wtclear });
    check('general', 'touch page: no console errors', tp.errors.length === 0, tp.errors.slice(0, 5));
  } catch (e) {
    check('script', 'acceptance script ran to the end', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | '));
  } finally {
    const failed = results.filter((r) => !r.pass).length;
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ url: URL, at: new Date().toISOString(), browser: browser.version(),
      fonts: FONT_DIR ? 'Selawik injected as "Segoe UI" (Segoe UI metrics)' : 'system fonts', passed: results.length - failed, failed, results, screenshots: shots }, null, 2));
    console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed · ' + path.join(OUT, 'results.json'));
    await browser.close();
    process.exitCode = failed ? 1 : 0;
  }
})();
