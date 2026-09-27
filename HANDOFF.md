# Handoff — 27 September 2026 (cloud session finished)

Branch `cloud-handoff-2026-09-27` of the private repo `sn31122/simon`. From 27.09.2026 the user works only here, in Claude
Code cloud sessions (claude.ai/code, the Desktop app's Cloud mode or the Claude app → repo `sn31122/simon`, this branch).
The former local folder `C:\Users\simon\Downloads\simon\yacht portfolio dashboard permanent` is no longer updated.

## State
<!-- data-status:start (written by update_prices.py --finish) -->
- Data status (update 27.09.2026 06:51 Berlin): 188 trading days 2026-01-02 … 2026-09-25; last row 2026-09-25 = final; 30-min (intraday.csv): 6 sessions 2026-09-18 … 2026-09-25; 2-h (intraday_2h.csv): 24 sessions 2026-08-25 … 2026-09-25; engine tests: 57 passed, 0 failed; crosscheck: 7492/7492 checks passed.
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
  ≤ 31 days 2 h, else daily), stepping down where finer data was not collected (a note under the chart shows the interval
  and why it stepped down). Main chart, hover, measurement boxes and drawdown follow the interval; Kennzahlen,
  Monatsrenditen, tables and sparklines stay daily. Details: `SPEC.md`.
- **Quote update in one sentence:** say "update", "refresh", "check for new quotes" or "Kurse aktualisieren" (or "run
  UPDATE.md"). The skill `update-quotes` runs `--plan` → 2 Haiku `price-fetcher` agents (seven_days + one_month per ISIN;
  three_months after a break of > 5 weekdays) → `--finish`. The PostToolUse hook `.claude/hooks/save-chart.cjs` writes every
  chart result to `data/incoming/` and shows the model one line, so a full update costs ~2 × 55k Haiku tokens (before: ~5 ×
  100k). 30-min and 2-h points are kept forever (`data/intraday.csv`, `data/intraday_2h.csv`). Runbook: `UPDATE_PRICES.md`.

## Working on it
- Start a cloud session on this repo and branch; Claude reads `CLAUDE.md` → `AGENTS.md` + this file by itself. Say "update"
  for new quotes. Every session commits and pushes to this branch, so the next session continues from there.
- To look at the dashboard: ask Claude for screenshots, or download the branch (GitHub → Code → Download ZIP) and open
  `dashboard.html` (works offline, no install).

## Going local again (optional)
1. Install Claude Code (CLI or Desktop app) on the PC and sign in with the same claude.ai account; Node.js and Python must
   be on PATH, and the Scalable connector must be available there (it was in the original local session).
2. Clone the repo (e.g. into the old folder): `git clone https://github.com/sn31122/simon` and `git checkout
   cloud-handoff-2026-09-27`, or `git pull` in an existing clone.
3. Either continue a specific cloud chat with its full history: `claude --teleport` in that folder (picker) or
   `claude --teleport <session-id>` (claude.ai/code → session menu → Open in → Terminal copies the command). The local copy
   then continues on its own; later cloud chats only see what was pushed. Or simply start `claude` there: the repo files
   carry all the context a new chat needs.
4. The hook works locally as well (`/hooks` lists it; restart Claude Code once if it is missing). Push local commits so
   cloud sessions see them again.

## Verification
- `node tests/engine.test.cjs`, `python tests/crosscheck.py && node tests/crosscheck.cjs` (numbers in the status block).
- Browser acceptance: `tools/acceptance-check.cjs` (Playwright, real mouse/keyboard/touch at 1903/1400/375 px); final run
  27.09.2026: 91 of 91 checks passed (Chromium 141, Segoe UI metrics via Selawik), results and screenshots in
  `docs/verification/2026-09-27/`. Not covered: real Segoe UI on Windows, Edge, a physical touch device, a session still
  in progress (only unit-tested).
  Usage and the Segoe UI font fallback for Linux: `docs/VERIFICATION.md`.

## Open points (for the user)
- The "Gruppen" table stays removed (user, 27.09.); its unused CSS was deleted.
- With 2 or 3 benchmarks shown, the band above the plot reserves room for the hover box, so there is empty space between the
  measurement boxes and the plot while nothing is hovered (deliberate: the plot keeps its height and nothing covers lines).
- "Monatsrenditen" buys custom cards on the first data day (02.01.2026), not at the selected period start; the chart and
  tables use the period start.
- Beyond 5 custom cards the colours of the palette get closer to each other.
- Chart interval details decided without asking (change on request): a custom range's length counts from its first to its
  last trading day, not the typed dates (a Saturday-to-Saturday week = Mon–Fri, 30 min); the last point of a day reads
  "23:00" in hover/measurement (only a chart's start point reads "Schluss"); "Zeitraum auf Auswahl setzen" stays hidden on
  30-min / 2-h charts, as it already was for 1T.
- All work is on branch `cloud-handoff-2026-09-27`; `main` still holds only the original README. Merging the branch into
  `main` (via a pull request) would let new sessions start on the default branch.
