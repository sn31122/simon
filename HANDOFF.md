# Handoff

Repo `sn31122/simon`, branch `main`; the user works only in Claude Code cloud sessions. Session branches reach `main` via pull request.

## State
<!-- data-status:start (written by update_prices.py --finish) -->
- Data status (update 29.09.2026 04:18 Berlin): 189 trading days 2026-01-02 … 2026-09-28; last row 2026-09-28 = final; history (prices_history.csv): 139 rows 2016-09-30 … 2025-12-29 (month-end + every 2nd trading day); 30-min (intraday.csv): 7 sessions 2026-09-18 … 2026-09-28; 2-h (intraday_2h.csv): 25 sessions 2026-08-25 … 2026-09-28; engine tests: 57 passed, 0 failed; crosscheck: 3335/3335 checks passed.
<!-- data-status:end -->
(Block rewritten by `--finish` / `--finish-add`; do not edit by hand.)

- 77 price series, 32 Yacht positions, real depot 9 positions (`depot.csv`, read 29.09.2026).
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
