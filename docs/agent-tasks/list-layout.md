# Lists toggle + order (Opus)

Historical dispatch: 2026-09-27T02:05:11.762Z; model opus.
Original ownership boundaries are historical. Continue from current files; no original agents are alive in this repository. Local scratch paths in this record are unavailable in the cloud; see docs/VERIFICATION.md and docs/references.

Project: offline HTML dashboard for the "yacht" portfolio in `<repository-root>` (canonical page `dashboard.html`). Read `AGENTS.md` (rules) first and the parts of `SPEC.md` you need. Vanilla JS classic scripts, no dependencies, no build step, no network; hand-written SVG charts; German UI with de-DE number formats; dark theme copying the Scalable Capital app (bg #101112, green #28ebcf = --accent, red #e78e78 = --neg). All financial math lives in `js/engine.js` (PFEngine, unit-tested); the UI files (dashboard.html, css/dashboard.css, js/charts.js, js/app.js) only pick inputs, format and lay out.

PARALLEL WORK – IMPORTANT: another agent edits other parts of js/app.js, js/charts.js and css/dashboard.css at the same time (the measurement box of the main chart), and later a third agent rebuilds the benchmark selection in the settings area. Therefore:
- Use only the Edit tool on shared files (never Write/overwrite a whole existing file). Keep each edit inside your own functions/sections. If an Edit fails because the file changed since you read it, Read the relevant part again and retry.
- Do not edit SPEC.md, AGENTS.md, HANDOFF.md (the orchestrator documents your changes from your report). Do not rename shared state or model shapes.

YOUR TASK: layout changes. The decisions were already made with the user – implement exactly this.

1. Top-bar period pills (#holdPills in dashboard.html: 1T 1W 1M YTD 1J "Seit Kauf"): add "3M" and "6M" between 1M and YTD (data-hp="3M" / "6M"). The pills and the chart tabs (#rangeTabs, which already have 3M/6M) are one shared period: setPeriod/periodKey/holdPeriod/periodLabel in js/app.js, and HOLD_LABEL already has '3 Monate'/'6 Monate'. Make sure everything works for 3M/6M: the value-block label, the holdings list, the pill and chart-tab markers. On mobile (375 px) the pills must still fit without horizontal scroll.

2. New page order below the settings row (.settings stays where it is, right after the chart):
   list section (see 3) → Benchmark-Vergleich → Drawdown → Monatsrenditen → Kennzahlen → Risiko & Korrelation → Hinweise (footer.notes).
   Today it is: settings → Drawdown → Portfolio list → Kennzahlen → Benchmark-Vergleich → Monatsrenditen → Einzelwerte → Risiko → notes. The drawdown chart is synced with the main chart (hover/measure via C.Sync, padR taken from the main chart); keep that working after moving it.

3. List section: two independent on/off toggle pills, "Portfolio" and "Einzelwerte", at the start of the section. Portfolio is ON by default, Einzelwerte OFF by default; the state is not persisted, like all selections. "Portfolio" = the holdings list block (section.holdings: title, ⋮ sort menu, total, #holdList). "Einzelwerte" = the asset table block (title, sub text, Alle/Keine buttons, #assetTable in its .card--wide).
   - Only one on: that block alone, as today. Portfolio sits in the 820 px column; Einzelwerte is the wide card that sticks out of the column on both sides, centred, at its natural width of ≈ 1.365 px.
   - Both on: side by side. Portfolio LEFT (≈ 480 px wide, without its mini-chart column .hr-spark so the names fit), Einzelwerte RIGHT at its natural width. Together they stick out of the 820 px column on both sides, centred, like the wide card (max width = window − 32 px). At 1920×1080 (the user's screen, ≈ 1.903 px viewport) both must fit side by side. If the window is too narrow for side by side, stack them (Portfolio above in the normal column, Einzelwerte below as the wide card).
   - Both off: only the toggles, plus a muted one-line hint.
   Approved sketch:
           [● Portfolio] [○ Einzelwerte]
   ┌─ Portfolio ─────────┐ ┌─ Einzelwerte ──────────────────────────────┐
   │ ◯ Micron      +4,1 % │ │ Name  Stück  Kurs  Wert  Gewicht  Rendite …   │
   └─────────────────────┘ └──────────────────────────────────────────────┘
   Style the toggles like the app's pills (.pills/.pill and .seg in css/dashboard.css; accent = on). Keep everything the lists do today:
   - sorting (the ⋮ menu and the table headers);
   - the always-editable Stück inputs (what-if);
   - the selection checkboxes and Alle/Keine, which drive the whole dashboard;
   - keepFocus, the sticky name column, the 1T intraday sparklines and "Seit Kauf".
   A hidden list may skip rendering, but it must be correct as soon as it is switched on.

4. Mobile (375 px): the toggles fit, the lists stack, and there is no horizontal page scroll (the table scrolls inside its card, as today).

Your files/regions:
- dashboard.html: #holdPills and the sections below .settings (order + list section markup). NOT the .settings block itself.
- js/app.js: ONLY state additions for the toggles, renderHoldings/holdRow/renderAssets (visibility, widths) and new bind handlers for the toggles.
- css/dashboard.css: ONLY the holdings/asset-table/list-section styles, plus media queries for them.
Do NOT touch: the .settings block and benchmark chips (.set-bench, #benchChips, renderChips, BENCH_COLORS, bench bind); the measurement/hover box code (ttRow, cmpItem, realLine, hoverHTML, measureHTML, intraMeasureHTML, intraHoverHTML) and its CSS (.pc-tip, .tt-*); js/charts.js; js/engine.js; tests/; data/. Other agents own them.

Verification (required):
- The preview server is already running: http://localhost:8770/dashboard.html serves the project folder. Hard-reload after edits: cache is disabled in shot.cjs; in a browser append ?v=N.
- Screenshots: `node --experimental-websocket "C:\Users\simon\AppData\Local\Temp\claude\C--Users-simon-Downloads\6431a1ba-d884-42f1-93ea-bc0a95bf3595\scratchpad\shot.cjs" <url> <out.png> <width> <height> <scrollY> ["<js run before the shot>"]`. This drives headless Edge via CDP and is safe to run in parallel with other agents. Write your PNGs into that scratchpad folder with the prefix `lists_`, then Read them to look at them. Use scrollY or scrollIntoView in the js argument to reach the lists. Prefer shot.cjs over the shared in-app browser pane; if you do use the Browser tools, create your own tab (tabs_create) and always pass its tabId.
- Debug handle: `window.PFApp` = { state, update, sync, charts: { main, dd }, model() }.
- Check: no console errors; no NaN or undefined; both toggles in all 4 combinations; 1920×1080 (side by side) and a ~1400 px window (stacked); 375 px mobile width without horizontal page scroll; the 3M/6M pills; selection via checkboxes and Alle/Keine still updates everything; the Stück input still works (what-if banner appears); drawdown hover still synced with the main chart.
- Run `node tests/engine.test.cjs` at the end (must stay green).

Final report: what you changed (files and functions), what you verified (with screenshot paths), open issues. Keep it concise.