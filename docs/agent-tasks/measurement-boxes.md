# Measure boxes redesign (Opus)

Historical dispatch: 2026-09-27T02:04:52.185Z; model opus.
Original ownership boundaries are historical. Continue from current files; no original agents are alive in this repository. Local scratch paths in this record are unavailable in the cloud; see docs/VERIFICATION.md and docs/references.

Project: offline HTML dashboard for the "yacht" portfolio in `<repository-root>` (canonical page `dashboard.html`). Read `AGENTS.md` (rules) first and the parts of `SPEC.md` you need. Vanilla JS classic scripts, no dependencies, no build step, no network; hand-written SVG charts; German UI with de-DE number formats; dark theme copying the Scalable Capital app (bg #101112, green #28ebcf = --accent, red #e78e78 = --neg). All financial math lives in `js/engine.js` (PFEngine, unit-tested); the UI files (dashboard.html, css/dashboard.css, js/charts.js, js/app.js) only pick inputs, format and lay out.

PARALLEL WORK – IMPORTANT: another agent edits other parts of js/app.js, css/dashboard.css and dashboard.html at the same time (the list section: 3M/6M pills, Portfolio/Einzelwerte toggles, section order), and later a third agent rebuilds the benchmark selection in the settings area. Therefore:
- Use only the Edit tool on shared files (never Write/overwrite a whole existing file). Keep each edit inside your own functions/sections. If an Edit fails because the file changed since you read it, Read the relevant part again and retry.
- Do not edit SPEC.md, AGENTS.md, HANDOFF.md (the orchestrator documents your changes from your report). Do not rename shared state or model shapes (M.selB entries {id,b,name,color,s,st,...}, M.intra.benches entries {x,s,dd}).

YOUR TASK: declutter the measurement box of the main chart. The design decisions were already made with the user – implement exactly this.

Current state: clicking in the main chart (#mainChart, class MainChart in js/charts.js) starts a measurement, moving the pointer / a second click pins it; dragging also works. The box at the top (`.pc-tip.pc-tip--measure`, HTML from `measureHTML(a, b)` / `intraMeasureHTML(a, b)` in js/app.js, grid classes `.tt-m .l1/.r1/.l2/.c2/.r2/.c3/.c4` in css/dashboard.css) shows start/end date, start/end value, € change and % change, then for every selected benchmark "· Name [simuliert] +x € (+y %)" (cmpItem), the what-if "Original", and under it "(echt +13.887,39 €)" (realLine) for the benchmark `my_depot` ("Mein Depot" = the user's real Scalable depot). The user finds this cluttered, and the box covers the top of the plot. Look at the user's screenshot: `C:\Users\simon\AppData\Local\Temp\claude\C--Users-simon-Downloads\6431a1ba-d884-42f1-93ea-bc0a95bf3595\images\28.png`.

New design (approved by the user):
1. Yacht box = exactly the Scalable-app original. Row 1: start date/time left, end date/time right. Row 2: start value left, € change centred (pos/neg colour), end value right. Row 3: % change centred (pos/neg colour). Nothing else in it: no benchmark items and no "Original". User decision: during a measurement ONLY Mein Depot is shown (in its own box); other benchmarks stay in the legend and the hover box.
2. A separate "Mein Depot" box BESIDE the yacht box, in the same row with the same top and the same height. It goes right of the yacht box, or left of it when there is no room on the right. Show it only when the benchmark `my_depot` is selected (it is by default) and has a series in the current model. Daily: the `M.selB` entry with id 'my_depot' → `x.s.value`. 1T intraday: the `M.intra.benches` entry with `o.x.id === 'my_depot'` → `o.s.value`. Content:
   - Row 1: "● Mein Depot" (dot in its chart colour, currently white #f2f3f4) left; its % change over the span right (pos/neg colour).
   - Row 2: "Gleicher Wert" left; € right (pos/neg colour) = `E.equalValueWindow(portfolioValues, depotValues, a, b).pl`. That is the depot's P/L if it had had the yacht's size at the start of the span (user decision; this engine function already exists and is tested). Use the VALUE arrays (p.value or I.value, and x.s.value or o.s.value), also in "Gesamtrendite" mode. The % in row 1 = `.ret` of the same call.
   - Row 3: "Echt (298.811 €)" left; € right (pos/neg colour) = `E.benchmarkRealPl(ctx0, 'my_depot', i, j, { intraday: <is 1T>, target: depotTarget() })`, with i/j = daily indices into ctx (M.R.start + a/b) or intraday slots, exactly as `realLine()` computes it today. The amount in the label is depotTarget() as whole euros, e.g. "298.811 €": the "Mein Depot (€)" field, or its default = the current value of the depot holdings.
   - German title tooltips explaining both lines, e.g. "Gleicher Wert: Veränderung von „Mein Depot“, wenn es zu Beginn der Messung genauso groß gewesen wäre wie das Portfolio" and "Echt: tatsächliche Veränderung deines Depots, hochgerechnet auf den Wert aus „Mein Depot (€)“".
   Approved sketch:
   ┌ Donnerstag, 13:30 ─────── Freitag, 12:00 ┐ ┌ ● Mein Depot          +4,91 % ┐
   │ 539.343,20 €  +17.042,19 €  556.385,40 € │ │ Gleicher Wert    +26.481,75 € │
   │               +3,16 %                    │ │ Echt (298.811 €) +13.887,39 € │
   └──────────────────────────────────────────┘ └───────────────────────────────┘
       ┊                                  ┊        (dotted measure lines start below the boxes)
3. Gaps: the band above the plot (MainChart.render: `var top = compact ? 62 : 80`) must be tall enough that no box ever covers the plot or its lines. Derive it from the real height of a 3-row box plus a small margin (≈ 90 px on desktop). Keep the chart height (490 px). The dotted measure lines still start at the lower edge of the boxes.
4. Positioning: keep the current yacht-box logic (it reaches 40 px past both measure lines, is centred when narrower than its natural width, and is clamped to the chart). Then place the Mein Depot box next to it; the pair must stay inside the chart width (shift both if needed). For charts narrower than both boxes together (mobile 375 px, `compact` < 560 px), stack the Mein Depot box under the yacht box and make the compact band tall enough, or find another clean solution. The plot must never be covered.
5. The 1T intraday view (intraMeasureHTML, slot labels like "Gestern, 20:00") gets the same two boxes.
6. The single-point hover box (hoverHTML/intraHoverHTML) stays as it is. The "(echt …)" and "simuliert" styles and cmpItem become unused: remove the dead code and CSS.
7. The field "Mein Depot (€)" (onDepotValue) already forces a rebuild of an open measure box (`mainChart.tipKey = ''; sync.draw()`); keep that working. If you add a second tip element, make it respect the same invalidation.

Your files/regions:
- js/charts.js: MainChart render band, drawOverlay, _setTip, showMeasureTip, showHoverTip. You may create a second tip element.
- js/app.js: ONLY the functions ttRow/cmpItem/REAL_ID/depotDefault/depotTarget/realLine/intraHoverHTML/intraMeasureHTML/hoverHTML/measureHTML, plus small new helpers next to them.
- css/dashboard.css: ONLY the "tooltip (hover + measurement)" section (.pc-tip, .tt-*).
Do NOT touch: dashboard.html, js/engine.js, tests/, data/, the holdings/Einzelwerte list code, or the benchmark chips/settings code (renderChips, BENCH_COLORS, bind). Other agents own them.

Verification (required):
- The preview server is already running: http://localhost:8770/dashboard.html serves the project folder. Hard-reload after edits: cache is disabled in shot.cjs; in a browser append ?v=N.
- Screenshots: `node --experimental-websocket "C:\Users\simon\AppData\Local\Temp\claude\C--Users-simon-Downloads\6431a1ba-d884-42f1-93ea-bc0a95bf3595\scratchpad\shot.cjs" <url> <out.png> <width> <height> <scrollY> ["<js run before the shot>"]`. This drives headless Edge via CDP and is safe to run in parallel with other agents. Write your PNGs into that scratchpad folder with the prefix `mbox_`, then Read them to look at them. Prefer shot.cjs over the shared in-app browser pane; if you do use the Browser tools, create your own tab (tabs_create) and always pass its tabId.
- Debug handle: `window.PFApp` = { state, update, sync, charts: { main, dd }, model() }. Pin a measurement with `PFApp.sync.measureStart(a); PFApp.sync.measureEnd(b); PFApp.sync.flush();` (indices into the current range), e.g. as shot.cjs's js argument. Switch the period with `document.querySelector('#rangeTabs [data-preset="1T"]').click()` (1T = 30-min intraday view of the last 2 sessions). Measure in both directions, in "Portfoliowert" and "Gesamtrendite" mode (#modeToggle), with and without Mein Depot selected (click its chip in #benchChips), and with a Startwert set (#startValue).
- Check: no console errors; no NaN, undefined or "–" where numbers belong; the boxes never overlap the plot lines; desktop 1920×1080 (the user's screen) and 375 px mobile width, without horizontal page scroll.
- Run `node tests/engine.test.cjs` at the end (must stay green).

Final report: what you changed (files and functions), what you verified (with screenshot paths), open issues. Keep it concise.