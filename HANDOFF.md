# Handoff

Repo `sn31122/simon`, branch `main`; the user works only in Claude Code cloud sessions. Session branches reach `main` via pull request.

## State
<!-- data-status:start (written by update_prices.py --finish) -->
- Data status (update 29.09.2026 11:52 Berlin): 190 trading days 2026-01-02 … 2026-09-29; last row 2026-09-29 = intraday, asof 2026-09-29T09:52Z; history (prices_history.csv): 171 rows 2016-09-30 … 2025-12-30 (month-end + every 2nd trading day); 30-min (intraday.csv): 8 sessions 2026-09-18 … 2026-09-29; 2-h (intraday_2h.csv): 26 sessions 2026-08-25 … 2026-09-29; engine tests: 57 passed, 0 failed; crosscheck: 3132/3133 checks passed.
<!-- data-status:end -->
(Block rewritten by `--finish` / `--finish-add`; do not edit by hand.)

- 106 price series, 32 Yacht positions, real depot 9 positions (`depot.csv`, read 29.09.2026). On 29.09., four GPT-6 Luna high subagents each received eight distinct requested ISINs; 29 new tracked instruments received the five-timeframe Scalable backfill (2026 daily, 30-min, 2-h, prior-year every second trading day, older month-end), while Amazon, Palantir and Vertiv were already tracked and left untouched. No portfolio positions changed.
- Price fetching (29.09.): `price-fetcher` is pinned to Claude Sonnet 5.5 (`claude-sonnet-5-5`); routine updates, new-instrument backfills and history fetches each use at most 50 ISINs per agent. For 106 price series, a routine update uses 3 agents and 212 chart calls (318 after more than 5 weekdays). Adding 100 new instruments uses 2 backfill agents and 500 one-time chart calls.
- New-price moves confirmed against another Scalable chart timeframe on 29.09.: Applied Optoelectronics US03823U1025 +38.2% (27.02.2026; `year_to_date` = `max`), Atlassian US0494681010 +34.3% (06.08.; `year_to_date` = `one_year`), Super Micro Computer US86800U3023 −31.9% (20.03.; `year_to_date` = `one_year`) and −26.8% (10.06.; `year_to_date` = `six_months`). These are source-confirmed price observations, not independently verified corporate-action assessments.
- Scalable's `max` chart for Astera Labs US04626A1034 returned only 11 monthly points starting 28.11.2025; its merged history begins 13.11.2025 from `one_year`. No earlier prices were available from the requested broker chart timeframes.
- Presets: "Mein Depot" card at load; menu: Energie, Old portfolio, Situational Awareness (SharonAI not on Scalable, its weight went to SanDisk/Micron), Depot-Historie.
- Page (29.09.): legend-only headline, notes under the chart; one measurement box per line; Statistik panel right of the chart; Monatsrenditen and Risiko & Korrelation removed; "Gruppen" table removed (27.09.).
- Acceptance: 93/93 (`docs/verification/2026-09-29/`); not covered: real Segoe UI/Edge, physical touch device, a session in progress.

## Open points
- With 2–3 benchmarks the band above the plot reserves hover space (deliberate).
- Beyond 5 custom cards the palette colours get close.
- Decided without asking: custom-range length counts trading days; a day's last point reads "23:00"; "Zeitraum auf Auswahl setzen" hidden on 30-min/2-h charts.
- Proposed, awaiting the user: ticker tiers (core / daily-only / on-demand) for more tickers.

## Access
- Look at the page: ask for screenshots, or download the ZIP and open `dashboard.html`.
- Windows live view: `tools/yacht-live.bat` (clones to `%USERPROFILE%\yacht-live`, pulls `main` every 60 s).
- Going local: install Claude Code + Node + Python, `git clone https://github.com/sn31122/simon`, start `claude` (or `claude --teleport <session-id>`); the Scalable connector must be available; push local commits.
- Claude Sonnet 5.5 requires Claude Code v2.1.284 or later; update older local installations before running a price fetch.
