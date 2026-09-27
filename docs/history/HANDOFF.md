# Handoff – 25 September 2026

Continue in `C:\Users\simon\Downloads\simon\yacht portfolio dashboard permanent`. Read `AGENTS.md` first; `SPEC.md` is the feature/engine reference. `dashboard.html` is canonical. No pending implementation request.

## State
<!-- data-status:start (written by update_prices.py --finish) -->
- Data status (update 27.09.2026 04:16 Berlin): 188 trading days 2026-01-02 … 2026-09-25; last row 2026-09-25 = final; intraday sessions in intraday.csv: 2026-09-24, 2026-09-25; engine tests: 51 passed, 0 failed; crosscheck: 5441/5441 checks passed.
<!-- data-status:end -->
- Data: current dates/status/tests are in the `data-status` block above (written by `update_prices.py --finish`); every row before an `intraday` last row is a Scalable daily close. 32 positions (Stückzahlen vom 02.09.2026, ~556k €), 9 benchmarks (MSCI World, FTSE All-World, S&P 500, Nasdaq-100 = iShares IE00B53SZB19, Halbleiter, DAX, Gold, 9-Ticker-Proxy, Mein Depot). Daily Scalable data only exists from 2026-01-02, so YTD = 1J = MAX for now.
- Benchmark `my_depot` "Mein Depot" (25.09.2026): the user's real Scalable depot (9 holdings, Stückzahlen 25.09., no cash, constant-quantity backcast; ~296.4k € on 25.09. intraday, +7,55 % YTD). New price columns IE00BF4RFH31 (MSCI World Small Cap), JE00B24DK975 (WTI 1x Short), US1912161007 (Coca-Cola), IE00BF01VY89 (Leverage Shares 2x Alphabet – Scalable has no quotes 26.01.–09.04.2026, 52 empty cells, engine forward-fills flat), IE00BK5BZX59 (Leverage Shares 3x Alphabet); raw YTD fetches in `data/source/ytd_<ISIN>.csv`.
- Dashboard: range tabs + custom dates, Gesamtrendite/Portfoliowert toggle, drag-to-measure with "Zeitraum auf Auswahl setzen", benchmarks, Startwert scaling, drawdown chart, holdings list (flat, ⋮ sort menu, own period pills incl. "Seit Kauf" vs Einstand, logos), Kennzahlen, Benchmark-Vergleich, Monatsrenditen, Gruppen (group filter kept on user request), Einzelwerte (filters, sorting, Was-wäre-wenn), Risiko & Korrelation. Exact app colors: bg #101112, green #28ebcf, red #e78e78.
- Browser checks (25.09.): no console messages, no NaN/undefined, no horizontal scroll at 375 px; interactions checked (toggle, list periods and sorting, what-if, empty selection, measure + apply, Esc).
- Visual check: the in-app browser pane often does not draw while the window is in the background; a headless Edge screenshot works: `msedge --headless=new --window-size=1280,3300 --screenshot=out.png http://localhost:8770/dashboard.html`. After data changes a browser may serve cached `portfolio-data.js` from the preview server – hard-reload.
- UI 25.09. (afternoon, on user request): 820px column like the app; chart ~820×490 with red line/area below the baseline, app-style axes; click-to-measure (click = start, pointer = end, click = end) plus drag-to-pin; own TT.MM.JJJJ date fields; sticky full-width top bar with the period pills; pills and chart tabs are one shared period (custom range = no marker); overview value block without sparkline, its change follows the period. Previous UI files in `_backup_2026-09-25_chart/`. Scrolled screenshots: the in-app pane and plain `msedge --screenshot` render scrolled pages black – use a CDP capture (navigate, `scrollTo`, `Page.captureScreenshot`).

- Intraday 25.09. (user request): 1T shows 30-min prices (yesterday grey, today vs. the previous close) from `data/intraday.csv`; every update fetches them via the Haiku runbook `UPDATE_PRICES.md` (27.09.: 5 Haiku agents, 42/42 ISINs, ~3-4 min, ~100-125k tokens each; since then --plan empties data/incoming/ so no Write retries).

## Next data update
Follow `UPDATE_PRICES.md`: `update_prices.py --plan` → one Haiku `price-fetcher` agent per printed prompt → `update_prices.py --finish`.
