# Task: chart interval per range (30 min / 2 h / daily)

User request (27.09.2026): "The data interval detail in the dashboard chart should be 30 min on the intraday, 30 min on the
weekly, 2h on the monthly, 1d on the 3month and beyond. When typing in a custom date range where the data hasn't been
collected, like for example a weekly range a month ago where no 30min data exists, show daily or 2h data."
User answers: custom ranges pick the interval **by length** (≤ 7 calendar days 30 min, 8–31 days 2 h, longer daily), stepping
down when the finer data is not collected for the whole range; the **main chart (with hover and measurement) and the
drawdown chart** follow the interval; Kennzahlen, Monatsrenditen, tables, list sparklines and benchmark-card returns stay
daily; all collected sub-daily data is kept forever.

## Data (already built, do not change the pipeline)
`window.PORTFOLIO_DATA.grids` (from `data/build_data.py`; every update now fetches seven_days + one_month for every ISIN):

```
grids.m30 = { dates: [iso…], times: ['07:30','08:00',…,'23:00'] (32), asof_utc, px: { ISIN: [price|null per (date, slot), date-major] } }
grids.h2  = { dates: [iso…], times: ['07:30','09:30',…,'21:30','23:00'] (9), asof_utc, px: {…} }
```
- `dates` = every collected session, ascending, each a date of `data.dates`; **not necessarily consecutive** (a session is
  missing when no update covered it). Today: m30 = 18.–25.09.2026 (6 sessions), h2 = 25.08.–25.09.2026 (24 sessions).
- Europe/Berlin slots; a point sits in its nearest slot. On a **final** day the 23:00 slot of every instrument is its daily
  close (from `prices_daily.csv`), so every finished session ends exactly on the daily price. An open last session
  (status `intraday`) can have trailing nulls (the rest of today). Every price column has an array; a null inside a session
  means no trade in that slot.
- `data.intraday` = the last 2 sessions of m30 in the old shape (today's 1T code, `tests/crosscheck.py`). You may move 1T onto
  the general code and drop `data.intraday`: then change only the `data['intraday'] = last_sessions(...)` line and the
  `last_sessions` helper in `data/build_data.py`, rebuild with `python3 data/build_data.py`, and adapt the crosscheck.

## Interval rules
| Range | Interval |
|---|---|
| 1T | 30 min (keep today's look: previous session grey as context + today) |
| 1W | 30 min |
| 1M | 2 h |
| 3M, 6M, YTD, 1J, MAX, Seit Kauf | daily (unchanged) |
| custom (`state.custom`) | calendar days from start date to end date ≤ 7 → 30 min, ≤ 31 → 2 h, else daily |

An interval is usable only if **every session after the range start up to the range end** (daily indices R.start+1 … R.end)
is in that grid's `dates`; otherwise step down 30 min → 2 h → daily (presets too, e.g. 1W falls back to 2 h after a gap).
Put this choice in the engine as a pure function (e.g. `chartInterval(ctx, range, preset|'custom')`) with tests.

## Series semantics (engine, pure functions in `js/engine.js`, with tests)
- Point 0 = the daily close of R.start (the same start value as the daily series, incl. Startwert scaling); then, for each
  session R.start+1 … R.end, its slots (the open last session only up to its last point). Sessions are concatenated without
  night/weekend gaps (like the app's 1W chart).
- Per instrument and session: the previous daily close until the first point, then forward-fill (today's intraday rule).
- For a range whose sessions are all final, the series' last value **equals the daily series' end value** (test it), so the
  headline, KPIs and chart end agree.
- Benchmarks: bought at the close of R.start (same as `E.benchmark(ctx, bench, R.start, R.end, base)`), held; Mein Depot
  fixed holdings. `benchmarkRealPl` and `equalValueWindow` must work on the chosen grid (measurement "Mein Depot" box).
- Drawdown series on the same grid. What-if (`ctx` vs `ctx0`, dashed line) on the same grid.
- Generalize the existing 1T functions (`prepareIntraday`, `intraday`, `intradayBenchmark`, `intradayAsset`,
  `benchmarkRealPl({intraday})`, `intradayWindow`) rather than duplicating them; keep one code path where you can.

## UI (`js/app.js`, `js/charts.js`, CSS)
- `compute()` builds the sub-daily model whenever the interval is 30 min / 2 h (today only for 1T): main chart lines,
  benchmarks, hover, measurement (drag and click-follow-click in both directions, Escape, touch tap), measurement boxes
  (Yacht + Mein Depot "Gleicher Wert"/"Echt"), drawdown chart + readout, both chart modes (Gesamtrendite / Portfoliowert),
  what-if dashed line, empty selection, Startwert.
- Labels: hover and measurement show date + time for multi-day grids (e.g. "Mi 23.09., 14:30"; the start point
  "Fr 18.09., Schluss"); 1T keeps "Heute/Gestern …". X ticks: 1W one per session (weekday + date), 1M dates at a readable
  spacing, 1T unchanged. German de-DE formats.
- A small muted note near the chart states the interval ("Intervall: 30 Min." / "2 Std." / "1 Tag") and, when a custom range
  or preset stepped down, why (e.g. "keine 30-Min-Kurse für diesen Zeitraum"). Keep it unobtrusive and in the app style.
- Everything else stays daily and unchanged. No persistence, no dependencies, classic scripts, no financial math in UI files.
- Must work at 1920/1903, 1400 and 375 px (no horizontal page scroll), hover box fine with up to 3 shown benchmarks.

## Tests and verification
- `node tests/engine.test.cjs` (add tests: interval choice incl. fallback, 1W m30 and 1M h2 series, end value = daily end,
  benchmark buy-and-hold on the grid, real P/L on the grid) and `python3 tests/crosscheck.py && node tests/crosscheck.cjs`
  (add an independent recomputation of at least a 1W 30-min and a 1M 2-h portfolio + Mein Depot + one weights card).
- Browser (Playwright is at `NODE_PATH=/opt/node22/lib/node_modules`, Chromium at `/opt/pw-browsers`): serve **your
  worktree** on your own port (not 8770), check 1T, 1W, 1M, 3M, a custom week inside m30 (30 min), a custom week in early
  September (2 h), a custom week in August before 25.08. (daily), a custom 3-week range (2 h), no console errors, desktop
  and 375 px, drag-measure both directions, touch tap. Then run the regression script
  `SEGOE_UI_FALLBACK_DIR=/tmp/claude-0/-home-user-simon/5f7bb48b-e4e6-52a2-a0e9-b9391fc2dfd3/scratchpad/selawik NODE_PATH=/opt/node22/lib/node_modules node tools/acceptance-check.cjs http://127.0.0.1:<port>/dashboard.html <scratch dir>`
  (all checks must still pass; adjust a check only where the new interval legitimately changes it, and add a few interval
  checks). Do not commit screenshots.
- Update `SPEC.md` (data contract `grids`, engine API, chart behaviour) for what you build.

## Boundaries
Own: `js/engine.js`, `js/app.js`, `js/charts.js`, `css/dashboard.css`, `dashboard.html`, `tests/*`, `tools/acceptance-check.cjs`,
`SPEC.md` (the sections you touch), plus the `data.intraday` line in `build_data.py` as described. Do not touch data CSVs,
`update_prices.py`, `.claude/`, `UPDATE_PRICES.md`, `AGENTS.md`, `HANDOFF.md`, `README.md` (the orchestrator edits those).
