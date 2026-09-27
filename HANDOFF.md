# Handoff — 27 September 2026 (cloud session finished)

Branch `cloud-handoff-2026-09-27` of the private repo `sn31122/simon`. It replaces the local folder
`C:\Users\simon\Downloads\simon\yacht portfolio dashboard permanent` once pulled there (cloud changes do not reach that
folder by themselves). Earlier handoffs: `CLOUD_HANDOFF.md` (the cloud task, now done), `docs/history/HANDOFF.md`.

## State
<!-- data-status:start (written by update_prices.py --finish) -->
- Data status (update 27.09.2026 06:18 Berlin): 188 trading days 2026-01-02 … 2026-09-25; last row 2026-09-25 = final; 30-min (intraday.csv): 6 sessions 2026-09-18 … 2026-09-25; 2-h (intraday_2h.csv): 24 sessions 2026-08-25 … 2026-09-25; engine tests: 51 passed, 0 failed; crosscheck: 5441/5441 checks passed.
<!-- data-status:end -->
(The block above is rewritten by `--finish` / `--finish-add`; do not edit it by hand.)

- **Data:** 50 price series (46 + Coherent, Lumentum, Microsoft, NVIDIA merged with `--finish-add`), all selectable in the
  benchmark search and fetched by every update. 32 Yacht positions and the 9-holding "Mein Depot" unchanged.
- **Dashboard (27.09. requests, all verified in a browser):** benchmark cards (only "Mein Depot" as locked preset, custom
  cards with instrument search and % rows, buy and hold), measurement boxes (Yacht + "Mein Depot" with Gleicher Wert / Echt),
  hover band that keeps the plot height with up to 3 shown benchmarks, list toggles (Portfolio / Einzelwerte, side by side
  from ~1900 px), 3M/6M pills, section order Lists → Benchmark-Vergleich → Drawdown → Monatsrenditen → Kennzahlen → Risiko &
  Korrelation → Hinweise, touch: a tap outside the chart ends a tapped measurement. Details: `SPEC.md`.
- **Chart interval per range:** 1T and 1W 30 min, 1M 2 h, 3M and longer daily; custom ranges by length (≤ 7 days 30 min,
  ≤ 31 days 2 h, else daily), stepping down where finer data was not collected. Main chart, hover, measurement and drawdown
  follow the interval; Kennzahlen, Monatsrenditen, tables and sparklines stay daily. Details: `SPEC.md`.
- **Quote update in one sentence:** say "update", "refresh", "check for new quotes" or "Kurse aktualisieren" (or "run
  UPDATE.md"). The skill `update-quotes` runs `--plan` → 2 Haiku `price-fetcher` agents (seven_days + one_month per ISIN;
  three_months after a break of > 5 weekdays) → `--finish`. The PostToolUse hook `.claude/hooks/save-chart.cjs` writes every
  chart result to `data/incoming/` and shows the model one line, so a full update costs ~2 × 55k Haiku tokens (before: ~5 ×
  100k). 30-min and 2-h points are kept forever (`data/intraday.csv`, `data/intraday_2h.csv`). Runbook: `UPDATE_PRICES.md`.

## First steps on the local machine
1. Pull the branch into the local folder (or download it) and hard-reload `dashboard.html` (Ctrl+F5).
2. Restart Claude Code in that folder once, so it loads `.claude/settings.json` (the hook; `/hooks` lists it). Node.js must
   be on PATH (it already runs the tests). If an update agent answers `HOOK NOT ACTIVE`, one of these two is missing.
3. Say "update" to fetch the quotes of 28.09. onwards.

## Verification
- `node tests/engine.test.cjs`, `python tests/crosscheck.py && node tests/crosscheck.cjs` (numbers in the status block).
- Browser acceptance: `tools/acceptance-check.cjs` (Playwright, real mouse/keyboard/touch at 1903/1400/375 px); results
  and screenshots of the final run in `docs/verification/2026-09-27/`, per-item evidence in `docs/ACCEPTANCE_CHECKLIST.md`.
  Usage and the Segoe UI font fallback for Linux: `docs/VERIFICATION.md`.

## Open points (for the user)
- The "Gruppen" table stays removed (user, 27.09.); its unused CSS was deleted.
- With 2 or 3 benchmarks shown, the band above the plot reserves room for the hover box, so there is empty space between the
  measurement boxes and the plot while nothing is hovered (deliberate: the plot keeps its height and nothing covers lines).
- "Monatsrenditen" buys custom cards on the first data day (02.01.2026), not at the selected period start; the chart and
  tables use the period start.
- Beyond 5 custom cards the colours of the palette get closer to each other.
- A `.cmd` launcher for a double-click update outside a chat was not built (it would need a non-interactive `claude -p` run
  with pre-approved tools and the Scalable connector locally; untested here).
