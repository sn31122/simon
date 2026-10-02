# Handoff

Repo `sn31122/simon`, branch `main`. The user works in Claude Code cloud sessions and in Codex on Windows; session
branches reach `main` via pull request (protocol: `AGENTS.md`).

## State
<!-- data-status:start (written by update_prices.py --finish) -->
- Data status (update 02.10.2026 13:38 Berlin): 193 trading days 2026-01-02 … 2026-10-02; last row 2026-10-02 = intraday, asof 2026-10-02T11:38Z; history (prices_history.csv): 4897 rows 2006-10-03 … 2025-12-30 (month-end + every 2nd trading day); 30-min (intraday.csv): 11 sessions 2026-09-18 … 2026-10-02; 2-h (intraday_2h.csv): 29 sessions 2026-08-25 … 2026-10-02; engine tests: 59 passed, 0 failed; crosscheck: 3053/3053 checks passed.
<!-- data-status:end -->
(Block rewritten by `--finish` / `--finish-add`; do not edit by hand.)

- 108 price series, 32 Yacht positions. Real depot: 7 positions, snapshot 02.10.2026 12:28 Berlin (`update_depot.py`):
  securities 298,198.38 €, total 264,003.64 € (cash ≈ −34,195 €), G/V seit Kauf 64,707.40 €, heute +2,738.73 €; "Mein Depot"
  weights from the 01.10. closes.
- Depot-Historie replays `depot_transactions.csv` (Scalable export of 02.10.2026 00:10, imported with
  `import_transactions.py`: 240 rows 02.12.2025 … 01.10.2026, incl. the four Coherent buys of 30.09.); its replay ends exactly
  at `depot.csv`.
- Presets: "Mein Depot" card at load; menu: Situational Awareness (SharonAI not on Scalable, its
  weight went to SanDisk/Micron), Memory, Depot-Historie (Energie removed 02.10.; its weights live on as a fixed
  case in `tests/crosscheck.py`). The page opens on 1T.
- Page (30.09.): card "Yacht-Portfolio" first among the benchmark cards (show/hide only); "Statistik" above the range tabs
  with Start/Ende columns; period pills fixed right of the page (≥ 1500 px), else a slim sticky bar; totals ≠ 100 % are drawn
  as absolute amounts; "Benchmark-Positionen" (off by default) shows P&L per holding of every shown benchmark; MAX = whole
  history from 30.09.2016; menu "Startjahr" (– / 2016 … 2026); "Risikofreier Zins" at the right end of the settings row.
- Price fetching: **one** `price-fetcher` (Claude Sonnet 5.5) for all ISINs (user 02.10.2026): 216 chart calls
  per routine update (324 after more than 5 weekdays).
- Data notes: Astera Labs US04626A1034 history begins 13.11.2025 (Scalable has nothing earlier). Big moves confirmed against
  a second Scalable timeframe are listed in `AGENTS.md` ("Build warnings").
- Acceptance: 93/93 on 29.09. (`docs/verification/2026-09-29/`); 30.09.: 90/94 – the 4 failures (lists side by side at
  1903/1920, resize switch, 375 1W measure) predate the 30.09. changes; 02.10. (Historie): 93/96, the same 3 lists failures; not covered: real Segoe UI/Edge, physical touch.

## Cleanup 01.10.2026
New: `tools/check.py` (session start for Claude Code and Codex), `data/update_depot.py` + hook `save-portfolio.cjs`,
`data/import_transactions.py`; UTF-8 output in all Python scripts (Windows). `AGENTS.md` is the shared rule file, `CLAUDE.md`
only adds Claude extras. Removed: `TEST.md`, `UPDATE.md` (now in README), `tools/open-dashboard.bat` (use
`yacht-live.bat`), `docs/verification/2026-09-27/` (superseded by 2026-09-29).

## Changes 02.10.2026
- `data/benchmarks.py` + skill `benchmarks`: "add benchmark asdf: microsoft 30 nvidia 40 palantir 30", "change energie to
  ge vernova 20 vertiv 80", "rename …", "remove energie", "list benchmarks" (names resolved via `instruments.csv`, 100 % check,
  rebuild + tests; Mein Depot / Depot-Historie protected).
- Instrument search dropdown in the benchmark cards up to 640 px tall (was 320; still limited by the window).
- Removed the predefined subagents `dashboard-designer` and `opus-engineer` (user: will ask personally when needed);
  only `price-fetcher` remains. Merged branches and the Mac project branch were deleted by the user.

- Daily history before 2026 (user 02.10.; `data/import_history.py`): 99 of 108 series (65 stocks, 34 ETFs/ETCs/ETPs) have
  daily closes from finanzen.net, Xetra first (gaps from Frankfurt/gettex/Tradegate/Stuttgart), 03.10.2006 (the site serves
  only 20 years; the user asked for 1995) or their listing … 30.12.2025, merged into `prices_history.csv` as `dh` rows (4,897
  dates). ETFs come from the POST the page makes (`/ajax/FundController_HistoricPriceList[Redesign]/…`, whole period in one
  answer). Bad one-/two-day prints dropped (e.g. Eli Lilly 0.25 € on 14.11.2008); every series checked against the Scalable
  history (ETFs median |dev| 0.2–0.6 %, stocks 0.3–2.2 %: Xetra closes 17:30 vs. gettex 22:00; leveraged ETPs ×3).
  Without daily history (Scalable month-end kept): Western Digital (bad data, ~30 % off before the SanDisk spin-off),
  Applied Optoelectronics, Astera Labs (refused: too noisy), Eaton, Keel, SanDisk (USD only), Alphabet 2x (no page),
  SpaceX and Memory 3x (listed 2026). Risk metrics (vol, Sharpe, VaR …) use the selected range
  incl. the daily history (user 02.10.; `dailyFrom` = 0). Sizes: `prices_history.csv` ~2 MB,
  `prices_history_daily.csv` ~1.8 MB, `portfolio-data.js` 3.6 MB (was 0.7).

- "Mein Depot" top block = Scalable's own numbers (user 02.10.: "the big value … should always reflect its real value and
  pnl taken directly from Scalable"; "display the value of all holdings always"): big value = `valuation.securities` for every
  period (not the total incl. cash), G/V per period = `performance` simpleAbsoluteReturn
  (1T INTRADAY, 1W, 1M, 3M, 6M, YTD, 1J; Seit Kauf / MAX = MAX), label "Scalable · Stand TT.MM. HH:MM", tooltip ≈ % and
  total incl. cash. `depot_ref.csv` gained `pl_1t … pl_1j`; engine `depotNow` no longer recomputes from our quotes, new
  `depotPeriod`; only a free Von/Bis range falls back to `depotChange` (marked). Every price update now ends with the depot
  snapshot (`update-quotes` step 4, `UPDATE_PRICES.md` step 4). Acceptance 93/96 (the 3 known lists failures).
  `tests/crosscheck.cjs`: "1M_h2 end = daily end" is exact for final sessions only (as in `crosscheck.py`); in a live
  session the 2-h and 30-min fetches are seconds apart, so their newest quotes may differ (0.01 % tolerance).

- "Historie" in the "+ Benchmark" menu (user 02.10.): opens a submenu of the 9 phases of the real depot
  (`data/history_phases.csv`, 08.12.2025 … 01.10.2026), each a weighting card. Phases grouped from the 35 trade-to-trade
  holding sets of `depot_transactions.csv`; weights = time-weighted average of the daily closing weights (securities only,
  positions < 1 % dropped, GS Alphabet 2x Factor DE000GX6ZLS7 counted as Leverage Shares 2x Alphabet). Same-day round
  trips never show. "Altes Depot" removed (covered by phase "Big Tech + USA 2x"). The file is regenerated by hand from
  `python data/source/history_phases.py` (phase boundaries + names hard-coded there) when the user asks.

- Phone access (user 02.10.: "can't open it on phone"): `tools/build_mobile.py` → `mobile/yacht-dashboard.html` (4 MB,
  everything inlined incl. 32 logos; sticky bar clears the notch), published as private artifact https://claude.ai/artifact/FMoijrjc87baLhkc3bXj5g
  (opens in a phone browser / the Claude app when logged in). Lives on branch `mobile` (user: separate branch, main
  untouched); rebuilt + republished by `update-quotes` step 5. Checked at 390 px: no errors, no horizontal scroll.

## Open points
- Riot US7672921050: −74 % on 21.01.2009 confirmed real (AspenBio AppyScore trial results 20.01.2009; Q1 2009 range $7.63 → $1.29, per 10-K) – no action.
- Codex has no Scalable connector: price and depot updates stay in Claude Code (see `AGENTS.md`).
- With 2–3 benchmarks the band above the plot reserves hover space (deliberate). Beyond 5 custom cards the palette colours
  get close.
- Decided without asking: custom-range length counts trading days; a day's last point reads "23:00"; "Zeitraum auf
  Auswahl setzen" hidden on 30-min/2-h charts.
- Proposed, awaiting the user: ticker tiers (core / daily-only / on-demand) for more tickers.

## Access
- Live view of `main`: Windows `tools/yacht-live.bat` (clone `%USERPROFILE%\yacht-live-main`, fetch + hard reset every
  60 s, reopens the page on a new version); Mac `tools/yacht-live.command` (`~/yacht-live-main`). Never work in those clones.
- Local work: Windows + Codex → `README.md` ("Working with Codex on Windows"); Mac + Claude Code → `docs/LOCAL_MAC.md`.
- Claude Sonnet 5.5 (price-fetcher) needs Claude Code v2.1.284 or later.
