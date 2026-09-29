# Handoff — 27 September 2026 (cloud session finished)

Branch `main` of the private repo `sn31122/simon` (the work of 27.09.2026 came in via a pull request from branch
`cloud-handoff-2026-09-27`; until that is merged, the same content is on that branch). From 27.09.2026 the user works only
here, in Claude Code cloud sessions (claude.ai/code, the Desktop app's Cloud mode or the Claude app → repo `sn31122/simon`).
The former local folder `C:\Users\simon\Downloads\simon\yacht portfolio dashboard permanent` is no longer updated.

## State
<!-- data-status:start (written by update_prices.py --finish) -->
- Data status (update 29.09.2026 00:59 Berlin): 189 trading days 2026-01-02 … 2026-09-28; last row 2026-09-28 = intraday, asof 2026-09-28T19:20Z; 30-min (intraday.csv): 7 sessions 2026-09-18 … 2026-09-28; 2-h (intraday_2h.csv): 25 sessions 2026-08-25 … 2026-09-28; engine tests: 60 passed, 0 failed; crosscheck: 7968/7969 checks passed.
<!-- data-status:end -->
(The block above is rewritten by `--finish` / `--finish-add`; do not edit it by hand.)

- **Design (29.09.):** no headline figure above the chart any more (only the legend with each line's %; period and notes
  in a muted line under the chart); measurement = one caption with the span + one equal box per line (Portfolio first):
  "● name %", "start → end" in € as drawn (Startwert applies), € change; "Gleicher Wert" removed.
- **Depot-Historie (29.09.):** preset in the "+ Benchmark" menu – the real depot replayed from the transaction export
  `data/depot_transactions.csv` (securities value from 17.03.2026, ends at today's holdings). A newer export replaces the
  file; `python data/build_data.py` rebuilds it.
- **Depot + Startwert (29.09.):** `data/depot.csv` / `depot_ref.csv` = the real Scalable depot (9 positions, read with
  get_portfolio_holdings/overview on 29.09.; "update depot" refreshes them). The top shows the real Yacht and "Mein Depot"
  (value + G/V seit Kauf) side by side. Startwert: empty = all lines start at the Yacht's value, buttons "Yacht" / "Mein
  Depot", a typed value applies to all lines ("nur Benchmarks" removed). "Statistik" panel: Wert, Rendite, p.a., Vol.,
  Sharpe, Max. DD, as wide as the space right of the chart.
- **History (28.09.):** `data/prices_history.csv` – month-end closes back to ~2016 and every 2nd trading day
  29.09.–29.12.2025 for all columns (except SpaceX); long ranges start where ≥ 90 % of today's value has quotes (all
  positions: 31.05.2021), risk metrics use only the daily data from 02.01.2026. 28.09.: + 9 instruments for the preset
  "Situational Awareness" (SanDisk, STMicro, Applied Digital, Riot, CleanSpark, Keel Infrastructure, WhiteFiber, Bitdeer,
  T1 Energy; 74 series; SharonAI is not on Scalable, its 2.3 % and the missing 1 % went to SanDisk/Micron).
- **Data:** 64 price series (46 + Coherent, Lumentum, Microsoft, NVIDIA + on 27.09. Nebius, CoreWeave, Core Scientific, IREN,
  GE Vernova, Vertiv, Constellation, AEP, Vistra, DTE, FirstEnergy, NRG, CMS, Solaris Energy), all selectable in the
  benchmark search and fetched by every update. Presets (28.09.): only "Mein Depot" is a card at load; "Energie" (11 names incl. Bloom) and
  "Old portfolio" (60 % MSCI USA 2x, 16 % NVIDIA, 14 % Microsoft, 10 % Alphabet) are picked from the "+ Benchmark" menu;
  preset fields show whole %, the exact weights count until edited. 32 Yacht positions unchanged. 28.09.: + FR0010755611 Amundi MSCI USA Daily (2x)
  Leveraged (65 series); "Mein Depot" is now an editable % card (share counts of 25.09. × prices of 28.09.), shown by default.
- **Dashboard (27.09. requests, all verified in a browser):** benchmark cards (presets Mein Depot + Energie, custom
  cards with instrument search and % rows, buy and hold), measurement boxes (Yacht + one box per shown benchmark with % / Gleicher Wert, 28.09.),
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
- Start a cloud session on this repo (branch `main`); Claude reads `CLAUDE.md` → `AGENTS.md` + this file by itself. Say
  "update" for new quotes. Work that a session pushes to its own branch reaches `main` through a pull request, so the next
  session continues from there.
- To look at the dashboard: ask Claude for screenshots, or download the branch (GitHub → Code → Download ZIP) and open
  `dashboard.html` (works offline, no install).
- Live view on Windows (user 28.09.): `tools/yacht-live.bat` (copy anywhere, e.g. Downloads, and double-click; needs Git for
  Windows) clones the repo once to `%USERPROFILE%\yacht-live`, opens `dashboard.html` and pulls `main` every 60 s while
  its window stays open – F5 in the browser shows every merged change. `BRANCH`/`WAIT`/`DIR` are set at the top.

## Going local again (optional)
1. Install Claude Code (CLI or Desktop app) on the PC and sign in with the same claude.ai account; Node.js and Python must
   be on PATH, and the Scalable connector must be available there (it was in the original local session).
2. Clone the repo (e.g. into the old folder): `git clone https://github.com/sn31122/simon` (branch `main`), or `git pull`
   in an existing clone.
3. Either continue a specific cloud chat with its full history: `claude --teleport` in that folder (picker) or
   `claude --teleport <session-id>` (claude.ai/code → session menu → Open in → Terminal copies the command). The local copy
   then continues on its own; later cloud chats only see what was pushed. Or simply start `claude` there: the repo files
   carry all the context a new chat needs.
4. The hook works locally as well (`/hooks` lists it; restart Claude Code once if it is missing). Push local commits so
   cloud sessions see them again.

## Verification
- `node tests/engine.test.cjs`, `python tests/crosscheck.py && node tests/crosscheck.cjs` (numbers in the status block).
- Browser acceptance: `tools/acceptance-check.cjs` (Playwright, real mouse/keyboard/touch at 1903/1400/375 px); rewritten
  29.09.2026 for the current dashboard (menu presets, one measurement block, legend-only headline, Startwert buttons; dates
  and counts read from the data, the chart scrolled into view on phones): 92 of 92 checks passed (Segoe UI metrics via
  Selawik – without it the list-width checks fail), results and screenshots in `docs/verification/2026-09-29/`. Not covered: real Segoe UI on Windows, Edge, a physical touch device, a session still
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
- Branches: `main` is the dashboard. Cloud sessions may push to a branch of their own; merge those back into `main` with a
  pull request so the work stays in one place. A different project belongs in its own repository, not in a branch.
