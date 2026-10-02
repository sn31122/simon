# Yacht portfolio dashboard – rules for every coding agent (Claude Code, Codex, …)

Repo `sn31122/simon`, branch `main`. This file is the shared source of truth: Codex reads it directly, Claude Code through
`CLAUDE.md` (which adds only Claude-specific extras). Read `HANDOFF.md` (current state) at the start of every session;
`SPEC.md` = features, engine API, metric formulas; `README.md` = overview for the user. Canonical page: `dashboard.html`
(offline; no dependencies, no build step, no ES modules, no network, selections not persisted). Ask the user whenever
something is even slightly unclear. Reply in the user's language.

## Session protocol (so Claude Code and Codex can take turns)
1. **Start:** `python tools/check.py` (Windows `python`, else `python3`). It fetches `origin/main` and says what to do:
   on `main` with newer commits → `git pull --ff-only`; on a branch behind main → `git merge origin/main`. Never start
   work on an outdated checkout. Never work in `yacht-live-main` (the live-view clone is hard-reset every 60 s).
2. **Work** on a branch (`claude/…` or `codex/…`), never commit straight to `main`.
3. **End:** run the tests, commit, push the branch, open a pull request to `main`; merge it when the user asks
   ("merge"). `main` is what the next session – in either tool – and the live view (`tools/yacht-live.*`) see.
4. Keep `HANDOFF.md` current in the same commit (state + open points; the `data-status` block is written by scripts).
5. Generated or derived files are committed, never edited by hand: `data/portfolio-data.js` (`python data/build_data.py`),
   `tests/reference.json` (`python tests/crosscheck.py`).

## The jobs
| User says | What runs | Who can do it |
|---|---|---|
| "update", "refresh", "new prices", "Kurse aktualisieren", "run UPDATE.md" | price update: `python data/update_prices.py --plan` → fetch → `--finish` → depot snapshot (`get_portfolio_holdings` + `get_portfolio_overview` → `update_depot.py`) (`UPDATE_PRICES.md`) | **Claude Code only**: needs the Scalable connector **and** the hook `.claude/hooks/save-chart.cjs`, which writes every chart answer to `data/incoming/` (nobody copies numbers) |
| "update depot", "new holdings" | read `get_portfolio_holdings` + `get_portfolio_overview` (hook saves them) → `python data/update_depot.py` | Claude Code (connector + hook). Elsewhere only with the two JSON answers saved as files: `--holdings F --overview F` |
| "add benchmark asdf: microsoft 30 nvidia 40", "change energie to …", "rename …", "remove energie", "list benchmarks" | `python data/benchmarks.py add / set / rename / remove / list …` (resolves names via `instruments.csv`, checks 100 %) | **any tool** (Claude Code: skill `benchmarks`) |
| "import price history", "history for <ISIN>" (one-time, before 2026) | `python data/import_history.py --fetch [ISIN,…]` (stocks, ETFs, ETCs, ETPs; finanzen.net, Xetra first, from 20 years back – the site's limit; fallback: a CSV exported by hand → `--import FILE --isin ISIN`). Checked against the Scalable history, merged into `prices_history.csv` as `dh` rows | **any tool** (plain HTTP, no connector). The only non-Scalable price source allowed (user 02.10.2026), and only for dates ≤ 31.12.2025 |
| "import transactions", "new export", "historic csv" | `python data/import_transactions.py [FILE]` (default: newest Scalable export in `~/Downloads`) | **any tool**, also Codex on Windows; in a cloud session the user attaches the file |
After any of them: report in 2–4 lines, commit on a branch, PR, merge on request.

**Codex (or any agent without the Claude hook):** never fetch prices by reading chart JSON and typing numbers into files,
and never pull prices from other sources (yfinance etc. was tried and reverted on 30.09.) – except the one-time daily
history before 2026 via `data/import_history.py` (finanzen.net, user 02.10.2026). If prices are stale, tell the user
to run "update" in Claude Code; everything else (UI, engine, tests, transaction import, docs) works the same in both tools.

## Files
| Path | Role | Edit? |
|---|---|---|
| `data/positions.csv` | Yacht holdings: isin, name, short, group, shares, ref_date, ref_price, gv_ref, cost_basis (= shares·ref_price − gv_ref), note, optional logo | only on explicit user instruction |
| `data/benchmarks.csv` | presets: id, name, holdings (`ISIN:20%|…` = 100 %; `transactions` = replay of `depot_transactions.csv`), description, start (`card` = shown at load: only `my_depot`; `menu` = "+ Benchmark" menu) | only via `benchmarks.py` (user instruction); `my_depot` only via `update_depot.py`; every ISIN must be a price column |
| `data/history_phases.csv` | phases of the real depot for the Historie submenu (`id,name,from,to,holdings,description`, holdings `ISIN:62.5%|…` = 100 %, every ISIN a price column; optional); generated from depot_transactions.csv by the main session | not by hand |
| `data/depot.csv`, `data/depot_ref.csv` | real Scalable depot (`isin,name,shares`) + snapshot (`asof_utc,securities_value,total_value,gv_since_buy,pl_1t,pl_1w,pl_1m,pl_3m,pl_6m,pl_ytd,pl_1j,source`) | only via `update_depot.py` |
| `data/depot_transactions.csv` | Scalable transaction export (`;`, German decimals) → preset "Depot-Historie" (config `DEPOT_HISTORY` in `build_data.py`) | only via `import_transactions.py` |
| `data/instruments.csv` | isin, name, short, type for **every** price column | a row per new column (before `--finish-add`) |
| `data/prices_daily.csv` | `date,status,asof_utc,<ISIN>…`, EUR close per trading day; only the last row may be `intraday` | only via `update_prices.py` |
| `data/prices_history.csv` | `date,res,<ISIN>…` before 2026: `dh` daily (99 of 108 series, Xetra via finanzen.net, from 03.10.2006), `m` month-end (~2016–Aug 2025), `2d` every 2nd day (29.09.–29.12.2025) | only via `--finish-history` / `--finish-add` / `import_history.py` |
| `data/prices_history_daily.csv`, `data/history_sources.csv` | daily closes ≤ 31.12.2025 from finanzen.net (source of the `dh` rows) + per-ISIN slug / exchange counts | only via `import_history.py` |
| `data/intraday.csv`, `data/intraday_2h.csv` | `isin,timestamp_utc,price`: 30-min / 2-h points of every session, kept forever | only via `update_prices.py` |
| `data/incoming/` | files written by the hooks (`<ISIN>.csv`, `2h/`, `3m/`, `ytd/`, `1y/`, `max/`, `depot/`); git-ignored | only by the hooks |
| `.claude/hooks/save-chart.cjs`, `save-portfolio.cjs` (+ `.claude/settings.json`) | PostToolUse hooks: save each chart / depot answer | change together with the scripts |
| `UPDATE_PRICES.md`, skill `update-quotes` | price update runbook | keep in sync with `update_prices.py` |
| `data/portfolio-data.js` | generated by `python data/build_data.py` | never by hand |
| `data/source/` | raw fetches, archived rows, one-off scripts | history, do not rerun |
| `js/engine.js` | all math + formatters (`PFEngine`), pure functions | math only here, with tests |
| `dashboard.html`, `css/`, `js/charts.js`, `js/app.js` | UI | no financial math |
| `tests/` | `engine.test.cjs`, `crosscheck.py` → `crosscheck.cjs` | keep green |
| `tools/` | `check.py` (session check), `yacht-live.bat` / `.command` (live view of `main`), `acceptance-check.cjs` (browser test) | |
| `mobile/yacht-dashboard.html` | one self-contained page for phones (CSS, data, JS, logos inlined), generated by `python tools/build_mobile.py`; branch `mobile`; published as a private claude.ai artifact (Claude Code) | never by hand |
| `company-logos/<ISIN>.png` | 128×128 logos (missing → initials) | replace as a folder, then rebuild |

## Scalable (read-only!)
Only `get_security_chart`, `get_security_quote`, `search_securities`, and for "update depot" `get_portfolio_holdings` /
`get_portfolio_overview`. Never order, savings-plan, watchlist, price-alert, portfolio-group or any other write tool. Omit
`portfolioId`.

Timeframes (one ISIN per call): `seven_days` = 30-min points, last point per day (~20:59 UTC) = close; `one_month` = 2-h
points (last point of a day is not the close, except the newest day); `three_months`/`year_to_date` = daily closes;
`one_year` = every 2nd day, `max` = month-end – these two only for `prices_history.csv`. Ignore `closingReferencePoint`.
Never delete old rows. Before 23:00 Berlin today is `intraday`. > ~60 weekdays gap: ask the user.

**New instrument** (only on user instruction): `search_securities` for the exact ISIN → row in `instruments.csv` →
`--plan-add ISIN[,ISIN]` → fetch → `--finish-add ISIN[,ISIN]`. A new position also needs its `positions.csv` row and logo.
Chart error → search by name, ask before replacing an ISIN.

**Build warnings:** a ratio near 2/3/4/5/10/…/200 flagged `SPLIT` → confirm, divide the history before the split, note in
`HANDOFF.md` (already adjusted: FR0010342592 1:200 on 2026-07-09). Moves > 30 % are flagged; confirmed real ones: Marvell
02.06., D-Wave 21.05., AT&S 15.06., Bloom/Nebius/IREN 30.07., SanDisk +31 % 30.07., Halbleiter 3x −27 % 05.06., IREN −24 %
and CleanSpark −25 % 05.02., Applied Digital +37 % 06.02.2026, Applied Optoelectronics +38 % 27.02., Atlassian +34 % 06.08.,
Super Micro −32 % 20.03. / −27 % 10.06.2026, the leveraged ETPs XS2779861082 / XS3388191457; Bloom +193 % / D-Wave +198 %
Nov 2024 (not splits – the `CHECK WITH USER` lines for them need no action); Riot −74 % 21.01.2009 (AspenBio trial results, real).

## Model conventions (details: SPEC.md)
- Backcast with constant share counts, price return in EUR, no dividends; forward-fill gaps, flat at the first quote before it.
- History before 2026 is prepended (`res` per date, `ctx.dailyFrom`); chart, Rendite, p.a., Max. DD use all points, risk
  metrics only daily returns (`d` + `dh` rows; since 02.10.2026 the whole selected range). Long ranges start where ≥ 90 % of today's value has quotes (`coverageStart`), except MAX and
  a "Startjahr" (whole span, titles without quotes flat). YTD starts at the previous year's last price.
- Benchmark cards `{weights: {ISIN: %}}` (or `schedule` for Depot-Historie): bought at the range start, buy and hold,
  normalized to the start value; a total ≠ 100 % counts as absolute amounts (110 % = 1,1 × start value); new rows: first
  100 %, further ones empty, never auto-filled. Startwert empty = all lines start at the Yacht's value; typed = all start there.
- Top blocks: real Yacht (never what-if) and "Mein Depot": **value and G/V always exactly as Scalable reports them**; the big
  value is always the value of all holdings (`valuation.securities`, not the total incl. cash, for every period) (user
  02.10.2026; `depotNow` / `depotPeriod` read the snapshot `depot_ref.csv`, refreshed with every price update – never
  recompute them from our quotes); only a free Von/Bis range (no Scalable figure) falls back to `depotChange`, marked.
- Chart interval: 1T/1W 30 min, 1M 2 h, longer daily; steps down where sessions are missing. Kennzahlen, tables,
  sparklines stay daily.

## Tests
```
node tests/engine.test.cjs
python tests/crosscheck.py && node tests/crosscheck.cjs
```
Browser: `tools/acceptance-check.cjs` (see `docs/VERIFICATION.md`; serve the folder on port 8770). After UI changes check
console errors, desktop + 375 px, drag-to-measure both ways, Gesamtrendite/Portfoliowert toggle, filters incl. empty selection.

## Portability (Windows + Codex)
Python standard library and Node built-ins only – no pip/npm packages. Use `pathlib`, open text files with
`encoding='utf-8'` and write CSVs with `newline=''`; scripts set UTF-8 stdout (Windows consoles are cp1252). Line endings
are normalized by `.gitattributes` (`*.bat` CRLF, everything else LF), so a Windows checkout produces no spurious diffs.
