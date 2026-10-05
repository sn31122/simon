# Yacht portfolio dashboard – rules for every coding agent (Claude Code, Codex, …)

Repo `sn31122/simon`, branch `main`. This is the one shared rule + state file (Claude Code reads it through `CLAUDE.md`).
Canonical page: `dashboard.html` – offline, no dependencies, no build step, no ES modules, no network, selections not
persisted. Ask the user whenever something is even slightly unclear. Reply in the user's language.

## Session protocol
1. **Start:** `python tools/check.py` (Windows `python`, else `python3`): fetches `origin/main` and says what to do
   (`git pull --ff-only` on main, `git merge origin/main` on a branch behind it). Never work in `yacht-live-main` (the
   live-view clone is hard-reset every 60 s).
2. **Work** on a branch (`claude/…` or `codex/…`), never commit straight to `main`.
3. **End:** `node tests/engine.test.cjs`, commit, push, pull request to `main`; merge when the user says "merge".
   Keep the "State" section below current in the same commit (the `data-status` block is written by `update_prices.py`).
4. Generated files are committed, never edited by hand: `data/portfolio-data.js` (`python data/build_data.py`).

## The jobs
| User says | What runs | Who |
|---|---|---|
| "update", "refresh", "new prices", "Kurse aktualisieren" | skill `update-quotes`: `update_prices.py --plan` → one `price-fetcher` agent (one `seven_days` chart call per ISIN + the two depot calls) → `--finish` (merge, rebuild, `update_depot.py`, tests, status) | **Claude Code only** (Scalable connector + hooks `.claude/hooks/*.cjs`) |
| "update depot" | `get_portfolio_holdings` + `get_portfolio_overview` (hook saves them) → `python data/update_depot.py` | Claude Code |
| "add benchmark asdf: microsoft 30 nvidia 40", "change …", "rename …", "remove …", "list benchmarks" | `python data/benchmarks.py add / set / rename / remove / list …` (names via `instruments.csv`, 100 % check) | any tool (Claude Code: skill `benchmarks`) |
| "import transactions" | `python data/import_transactions.py [FILE]` (default: newest Scalable export in `~/Downloads`) | any tool |
After any of them: report in 2–4 lines, commit on a branch, PR, merge on request.

**Without the Claude hook (Codex …):** never fetch prices by reading chart JSON and typing numbers, never use other price
sources. Stale prices → tell the user to run "update" in Claude Code. Everything else works the same in every tool.

## Files
| Path | Role | Edit? |
|---|---|---|
| `data/positions.csv` | Yacht holdings: isin, name, short, group, shares, ref_date, ref_price, gv_ref, cost_basis, note, logo | only on user instruction |
| `data/benchmarks.csv` | "+ Benchmark" presets: id, name, holdings (`ISIN:30%|…` = 100 %, whole percents; `transactions` = replay of `depot_transactions.csv`), description, start (`card` = shown at load, only `my_depot`; `menu`) | only via `benchmarks.py`; `my_depot` only via `update_depot.py` |
| `data/history_phases.csv` | the 9 phases of the real depot ("Historie" submenu), whole percents | not by hand |
| `data/depot.csv`, `data/depot_ref.csv` | real Scalable depot (`isin,name,shares`) + snapshot (value, total, G/V per period) | only via `update_depot.py` |
| `data/depot_transactions.csv` | Scalable transaction export → preset "Depot-Historie" | only via `import_transactions.py` |
| `data/instruments.csv` | isin, name, short, type for **every** price column | a row per new column |
| `data/prices_daily.csv` | `date,status,asof_utc,<ISIN>…` EUR close per trading day since 02.01.2026; only the last row may be `intraday` | only via `update_prices.py` |
| `data/prices_history.csv` | `date,res,<ISIN>…` before 2026: `dh` daily (finanzen.net, from 2006, one-time import 02.10.2026), `m` month-end, `2d` every 2nd day | only via `update_prices.py --finish-add` |
| `data/intraday.csv`, `data/intraday_2h.csv` | `isin,timestamp_utc,price`: 30-min points (every update) / 2-h points (`one_month`, only after a gap; fill days without 30-min points), kept forever | only via `update_prices.py` |
| `data/incoming/` | hook output (git-ignored) | only by the hooks |
| `.claude/hooks/*.cjs` + `.claude/settings.json` | PostToolUse hooks saving chart / depot answers | change together with the scripts |
| `js/engine.js` | all math + formatters (`PFEngine`), pure functions | math only here, with a test |
| `dashboard.html`, `css/`, `js/charts.js`, `js/app.js` | UI | no financial math |
| `tests/engine.test.cjs` | core engine tests | keep green |
| `tools/check.py`, `tools/yacht-live.bat` / `.command` | session check; live view of `main` (Windows / Mac) | |
| `company-logos/<ISIN>.png` | 128×128 logos (missing → initials) | |

## Scalable (read-only!)
Only `get_security_chart`, `get_security_quote`, `search_securities`, and for the depot `get_portfolio_holdings` /
`get_portfolio_overview`. Never any order, savings-plan, watchlist, price-alert, portfolio-group or other write tool. Omit
`portfolioId`. Timeframes (one ISIN per call): `seven_days` = 30-min points (last of a day = close; the 1M chart's 2-h points
come from them), `one_month` = 2-h points (only after a gap of > 5 weekdays), `three_months` / `year_to_date` = daily closes,
`one_year` / `max` = every 2nd day / month-end (history only).
Before 23:00 Berlin today is `intraday`. Never delete old rows. > ~60 weekdays gap: ask the user.

**Build warnings:** `SPLIT` (ratio near 2/3/4/5/10/…) → confirm with the user, divide the history before the split, note
it below (done: FR0010342592 1:200 on 2026-07-09). Moves > 30 % are flagged; confirmed real: Marvell 02.06., D-Wave 21.05.,
AT&S 15.06., Bloom/Nebius/IREN 30.07., SanDisk 30.07., Halbleiter 3x 05.06., IREN / CleanSpark 05.02., Applied Digital
06.02., Applied Optoelectronics 27.02., Atlassian 06.08., Super Micro 20.03. / 10.06.2026, the leveraged ETPs XS2779861082 /
XS3388191457, Bloom / D-Wave Nov 2024, Riot −74 % 21.01.2009 (its `CHECK WITH USER` line needs no action).

## Model conventions
- Backcast with constant share counts, price return in EUR, no dividends; forward-fill gaps, flat at the first quote before it.
- History before 2026 is prepended (`res` per date). Chart, Rendite, p.a., Max. DD use all points; risk metrics (vol,
  Sharpe) the daily returns of the selected range. Long ranges start where ≥ 90 % of today's value has quotes, except MAX
  and "Startjahr". YTD starts at the previous year's last price.
- Benchmark cards `{weights: {ISIN: %}}` (or `schedule` for Depot-Historie): bought at the range start, held, normalized
  to the start value; a total ≠ 100 % counts as absolute amounts (110 % = 1.1 × start value).
- Top blocks: the real Yacht, and "Mein Depot" with value and G/V **exactly as Scalable reports them** (`depot_ref.csv`,
  refreshed with every price update; big value = `valuation.securities`); only a free Von/Bis range falls back to our
  own computation (marked).
- Chart interval: 1T/1W 30 min, 1M 2 h (the 30-min point nearest each 2-h slot; days without 30-min points from
  `intraday_2h.csv`), longer daily; steps down where sessions are missing. Daily charts can be thinned
  with the price-interval pills under the period pills (1 Tag / 2 Tage / 1 Woche / 1 Monat, `E.thinIndices`; first and
  last point always kept). Kennzahlen, tables and lists stay daily.

## Portability (Windows + Codex)
Python standard library and Node built-ins only. `pathlib`, `encoding='utf-8'`, CSVs with `newline=''`, UTF-8 stdout.
`.gitattributes` normalizes line endings (`*.bat` CRLF, else LF). Codex on Windows: install Git, Python 3, Node LTS; clone
to `%USERPROFILE%\simon` (not the live-view folder); first message "Run python tools/check.py and tell me the state".

## State
<!-- data-status:start (written by update_prices.py --finish) -->
- Data status (update 05.10.2026 07:14 Berlin): 194 trading days 2026-01-02 … 2026-10-05; last row 2026-10-05 = intraday, asof 2026-10-05T05:13Z; history (prices_history.csv): 4897 rows 2006-10-03 … 2025-12-30 (daily); 30-min (intraday.csv): 12 sessions 2026-09-18 … 2026-10-05; 2-h (intraday_2h.csv): 29 sessions 2026-08-25 … 2026-10-02; engine tests: 18 passed, 0 failed.
<!-- data-status:end -->
- 108 price series, 32 Yacht positions; real depot 7 positions (snapshot 02.10.2026 23:00). Presets: "Mein Depot" card
  at load; menu: Situational Awareness, Memory, Depot-Historie, Historie (9 phases). The page opens on 1T.
- Slimmed down 03.10.2026 (user): removed the phone page, the browser acceptance suite + screenshots, the Python
  crosscheck, raw archives (`data/source/`), the finanzen.net importer (its data stays in `prices_history.csv`), the
  history-fetch mode of `update_prices.py`, SPEC / UPDATE_PRICES / HANDOFF (merged here); engine tests cut to the core;
  Kennzahlen without Calmar, VaR, CVaR, Aktueller Drawdown. New: price-interval pills for daily charts.
- Optimized 05.10.2026: `portfolio-data.js` stores price series packed (a negative integer −k = k dates without a quote,
  `engine.fillPrices` unpacks; 3,6 → 2,4 MB), sparklines keep at most 2 points per pixel column (`charts.sparkIndices`;
  MAX/Seit Kauf update ~3× faster, same picture), `build_data.py` 5 s → 1,6 s (date index instead of list scans), footer
  notes come from the data (`build_data.notes`), dead title-bar code removed. Tests: + packed prices, + sparkline thinning.
- Update pipeline 05.10.2026: a normal update is 108 chart calls (`seven_days` only) instead of 216; `one_month` /
  `three_months` only after a gap of > 5 weekdays (`--plan` decides and says why). The depot snapshot is fetched by the same
  `price-fetcher` agent (`DEPOT: yes`) and merged by `--finish` (`update_depot.py --no-tests`), so the main session runs
  plan → one agent → finish → report. `save-portfolio.cjs` answers one `SAVED depot …` line (full JSON in
  `data/incoming/depot/`). Both hooks also run in cloud (Projects) sessions, so an update can run there too.
- Data notes: Astera Labs history begins 13.11.2025. No daily history before 2026 (month-end only): Western Digital,
  Applied Optoelectronics, Astera Labs, Eaton, Keel, SanDisk, Alphabet 2x, SpaceX, Memory 3x.

## Open points
- Codex has no Scalable connector: price and depot updates stay in Claude Code.
- At ~1500–1650 px window width the fixed period pills touch the end of the "Mein Depot" label.
- Proposed, awaiting the user: ticker tiers (core / daily-only / on-demand) for more tickers.
- Proposed 05.10.2026, awaiting the user: a routine that runs "update" every trading day after 23:00 Berlin in a cloud
  session (PR; merge when the tests are green) so nobody has to say "update".
