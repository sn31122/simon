# Benchmark builder UI (Opus)

Historical dispatch: 2026-09-27T02:10:20.122Z; model opus.
Original ownership boundaries are historical. Continue from current files; no original agents are alive in this repository. Local scratch paths in this record are unavailable in the cloud; see docs/VERIFICATION.md and docs/references.

Project: offline HTML dashboard for the "yacht" portfolio in `<repository-root>` (canonical page `dashboard.html`). Read `AGENTS.md` (rules) first and the parts of `SPEC.md` you need. Vanilla JS classic scripts, no dependencies, no build step, no network; hand-written SVG charts; German UI with de-DE number formats; dark theme copying the Scalable Capital app (bg #101112, green #28ebcf = --accent, red #e78e78 = --neg). All financial math lives in `js/engine.js` (PFEngine, unit-tested); the UI files (dashboard.html, css/dashboard.css, js/charts.js, js/app.js) only pick inputs, format and lay out.

PARALLEL WORK – IMPORTANT: two other agents are editing other parts of js/app.js, js/charts.js, css/dashboard.css and dashboard.html right now. One rebuilds the main chart's measurement box (functions ttRow/cmpItem/realLine/hoverHTML/measureHTML/intraMeasureHTML/intraHoverHTML, js/charts.js, CSS .pc-tip/.tt-*). The other does the list section (3M/6M pills in #holdPills, Portfolio/Einzelwerte toggles, section order below .settings, renderHoldings/renderAssets). The orchestrator is changing js/engine.js, tests/ and data/. Therefore:
- Use only the Edit tool on shared files (never Write/overwrite a whole existing file). Keep each edit inside your own functions/sections. If an Edit fails because the file changed since you read it, Read the relevant part again and retry.
- Do not edit SPEC.md, AGENTS.md, HANDOFF.md (the orchestrator documents your changes from your report). Do not edit js/engine.js, tests/, data/ or js/charts.js.

YOUR TASK: replace the benchmark chips with a testfolio-style benchmark builder. The decisions were made with the user – implement exactly this.

Background: today the settings row under the chart (div.settings in dashboard.html) ends with ".set-bench": the label "Benchmarks" plus chips (#benchChips, rendered by renderChips() in js/app.js) that toggle fixed benchmarks from data/benchmarks.csv on the chart (state.benchmarks = list of ids, default ['my_depot']). The user wants a builder like testfolio.io's portfolio cards instead, plus the search dropdown shown in `C:\Users\simon\AppData\Local\Temp\claude\C--Users-simon-Downloads\6431a1ba-d884-42f1-93ea-bc0a95bf3595\images\30.png` for picking an instrument (read that image). The user's testfolio screenshots are not on disk; the reference card looks like this (dark theme):
- a rounded dark card with icons at the top right (duplicate, …, trash);
- a name field with a small label above it (label "Portfolio 2", value "Benchmark example");
- rows, each with a wide dark ticker field, a percent field ("50" with a big "%" suffix) and "×" to remove the row;
- above the rows a "+" (add row) on the left and a "×" (clear all) on the right;
- below the rows the total percent ("100 %", green border when it is exactly 100).
LEAVE OUT (user): rebalance dropdown/offset, drag %, total return checkbox, rebalance bands, gear menu, "Analyze further…", and the download/lock icons.

Decisions:
1. Placement: where the chips are now, below the chart settings (Von/Bis, Startwert, Mein Depot (€), Zins). A wrapping row of cards (~300 px each), with a "+ Benchmark" tile at the end.
2. Presets: NO presets except the user's real portfolio "Mein Depot". That is benchmark id 'my_depot' in data/benchmarks.csv, the only row left there after the orchestrator's change. It is a locked card: not editable (real quantities, needed for the "Echt" P/L in the measurement box), shown by default, cannot be deleted, but has an on/off (show in chart) switch. It may show a compact summary (e.g. "echte Stückzahlen · 9 Positionen" and today's value). Everything else is user-built cards.
3. Custom card:
   - header: colour dot (its chart colour), name field (default "Benchmark 1", "Benchmark 2", …), its return in the selected period (like the chips showed);
   - icons: show/hide in chart (on by default), duplicate, delete;
   - rows: instrument field + percent field + × (remove row); "+" adds a row, "×" clears all rows;
   - footer: total % (plain sum of the rows), green at 100 %, red otherwise with a short hint.
   Only a card with a total of 100 % (±0,01) and at least one instrument is drawn or used anywhere. A new card starts with one empty row and the focus in its instrument field.
4. Instrument field = search combobox like 30.png, but in the dashboard's dark style (not white). Typing filters the list below the input. Each entry = the short name in bold plus a grey subtitle (full name · ISIN · type). Highlight the first / keyboard-selected entry; support ↑/↓/Enter/Esc/Tab; click selects. Matching is case-insensitive on short name, name and ISIN, prefix matches first. Only instruments with price data can be chosen (user decision), i.e. `D.instruments` (see contracts); the same instrument cannot appear twice in one card. The dropdown must not be clipped by the card: position it as an overlay.
5. Percent field: German decimal input ("12,5"); empty = 0.
6. Semantics (user): the percentages are bought on the first day of the selected period (the backtest start) and then held (buy and hold, no rebalancing). This is implemented in the engine, see contracts.
7. Not saved (user): every reload starts with only the Mein Depot card (shown). Changes apply immediately (update({ keepMeasure: true }), like the chips did) without losing the focus/caret of the field being typed in. Re-render only what's needed; never rebuild the input the user is typing in.
8. Colours: Mein Depot keeps white (#f2f3f4). Custom cards get distinct colours from a palette in creation order (extend the existing BENCH_COLORS to ~12; avoid colours close to --accent #28ebcf and --neg #e78e78).
9. Everything that shows benchmarks today must work with the cards: chart lines, the legend under the headline, the hover box, the Kennzahlen bench line (first visible benchmark), the Benchmark-Vergleich table (update its empty-state text, which mentions chips), the Monatsrenditen rows, the drawdown chart lines/readout, and the 1T intraday lines. Keep the model shapes: M.benches / M.selB entries {id, b, name, color, s, st, rel, dd, monthly} and M.intra.benches entries {x, s, dd}. The measurement-box agent uses the selB/intra entry with id 'my_depot'.
10. benchWin(x, a, b) and similar sub-windows must use the already computed period series (value[b] / value[a] − 1) instead of calling E.benchmark again from a – with buy-and-hold, a re-buy at a would be wrong.
11. Mobile 375 px: cards full width; no horizontal page scroll.

Contracts provided by the orchestrator, being implemented right now in parallel. Check them in the code/data before you rely on them; if something is still missing when you need it, wait a few minutes and re-check. Do not implement them yourself.
- `E.benchmark(ctx, bench, start, end, baseValue)` and `E.intradayBenchmark(ctx, bench, baseValue)` accept a custom benchmark object `{ id, name, weights: { ISIN: number } }`. Weights may be % or fractions: the engine normalizes by their sum, ignores ISINs without prices, and returns null if nothing valid is left. They are bought at `start` (for 1T at the previous close), then held. Quantity benchmarks (`holdings`, e.g. Mein Depot) work as before.
- `D.instruments` in data/portfolio-data.js: [{ isin, name, short, type ('Aktie'|'ETF'|'ETC'|'ETP'), position: true|false }] for every price column (~46), sorted by short name. `D.benchmarks` = [Mein Depot] only. `D.prices` covers all instruments.

Your files/regions:
- dashboard.html: ONLY the .set-bench block inside .settings.
- js/app.js: BENCH_COLORS/BIDX/colorOf, state.benchmarks (+ new state for the cards), the benchmark part of compute(), benchWin, renderChips (replace it), the call in renderSettings, the benchmark handler in bind(), renderBenchTable's empty-state text, and your new functions.
- css/dashboard.css: the chips section (.set-bench/.chips/.chip) → your card and dropdown styles, plus media queries for them.

Verification (required):
- The preview server is already running: http://localhost:8770/dashboard.html serves the project folder. Hard-reload after edits: cache is disabled in shot.cjs; in a browser append ?v=N.
- Screenshots: `node --experimental-websocket "C:\Users\simon\AppData\Local\Temp\claude\C--Users-simon-Downloads\6431a1ba-d884-42f1-93ea-bc0a95bf3595\scratchpad\shot.cjs" <url> <out.png> <width> <height> <scrollY> ["<js run before the shot>"]`. This drives headless Edge via CDP and is safe to run in parallel with other agents. Write your PNGs into that scratchpad folder with the prefix `bench_`, then Read them to look at them. For interactive checks (typing into the combobox, keyboard navigation) use the Browser tools in your OWN tab: tabs_create, then always pass its tabId. The pane is shared with other agents.
- Debug handle: `window.PFApp` = { state, update, sync, charts: { main, dd }, model() }.
- Check: no console errors; no NaN or undefined; create/rename/duplicate/delete cards; add/remove/clear rows; total ≠ 100 % → not drawn; hide/show Mein Depot; the 1T intraday view with a custom card; the Gesamtrendite/Portfoliowert toggle; a Startwert set; 1920×1080 and 375 px mobile; focus is kept while typing.
- Run `node tests/engine.test.cjs` at the end (must stay green).

Final report: what you changed (files and functions), what you verified (with screenshot paths), open issues. Keep it concise.