# Handoff

Repo `sn31122/simon`, branch `main`. The user works in Claude Code cloud sessions and in Codex on Windows; session
branches reach `main` via pull request (protocol: `AGENTS.md`).

## State
<!-- data-status:start (written by update_prices.py --finish) -->
- Data status (update 02.10.2026 00:11 Berlin): 192 trading days 2026-01-02 … 2026-10-01; last row 2026-10-01 = final; history (prices_history.csv): 171 rows 2016-09-30 … 2025-12-30 (month-end + every 2nd trading day); 30-min (intraday.csv): 10 sessions 2026-09-18 … 2026-10-01; 2-h (intraday_2h.csv): 28 sessions 2026-08-25 … 2026-10-01; engine tests: 58 passed, 0 failed; crosscheck: 3273/3273 checks passed.
<!-- data-status:end -->
(Block rewritten by `--finish` / `--finish-add`; do not edit by hand.)

- 108 price series, 32 Yacht positions. Real depot: 7 positions, read 01.10.2026 (`update_depot.py`): Coherent 5 → 123;
  securities 295,459.65 €, total 261,264.91 € (cash ≈ −34,195 €), G/V seit Kauf 61,968.67 €; "Mein Depot" weights from
  the 01.10. closes.
- Depot-Historie replays `depot_transactions.csv` (Scalable export of 02.10.2026 00:10, imported with
  `import_transactions.py`: 240 rows 02.12.2025 … 01.10.2026, incl. the four Coherent buys of 30.09.); its replay ends exactly
  at `depot.csv`.
- Presets: "Mein Depot" card at load; menu: Altes Depot (renamed from Old portfolio 02.10.), Situational Awareness (SharonAI not on Scalable, its
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
  1903/1920, resize switch, 375 1W measure) predate the 30.09. changes; not covered: real Segoe UI/Edge, physical touch.

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

## Open points
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
