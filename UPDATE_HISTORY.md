# Historical daily closes

This pipeline fetches **Close only**, without dividend adjustment, and integrates EUR prices into the dashboard's CSV database. It imports dates strictly before 2026 and before `prices_daily.csv` begins (currently 2026-01-02). The exclusive end defaults to 2026-01-01. The default start is 2016-09-30, matching the existing dashboard. Holdings, benchmarks, depot records, 2026 prices and intraday histories keep their existing update workflows.

The verified import covers 95 instruments with 180,882 closes through 2025-12-31: 14 native EUR listings and 81 foreign listings reconstructed using daily FX. History now contains 2,391 dates, including the existing Scalable fallback. Eleven instruments retain their earlier fallback history because their Yahoo mappings failed identity checks or had no eligible history. Newer instruments have shorter histories; complete ten-year coverage of every instrument is not claimed. The user authorized the FX import on 30 September.

## Setup

Python 3.11+ and Node.js are required. In PowerShell, from the repository root:

```powershell
.\tools\setup-yfinance.ps1
```

This installs the tested yfinance version in `.venv-yfinance`. The hook discovers that environment automatically. It also supports the existing `.yfinance-probe/.venv` environment. Set `YFINANCE_PYTHON` to a Python executable to override discovery. On Linux, create `.venv-yfinance` with `python3 -m venv .venv-yfinance` and install `data/requirements-yfinance.txt` with its Python executable.

## Agent pipeline

Bulk data work uses **GPT-6 Luna, high reasoning**, following the user's 30 September instruction. Each agent owns a disjoint batch of at most 50 ISINs. The main session plans and commits, while agents only trigger fetch requests and report receipts. Use additional concurrent agents when they improve speed: the verified full import used four disjoint batches of 24/24/24/23 instruments. FX series are fetched once per run and shared through an immutable checksum-validated cache with an exclusive writer lock.

1. Create a plan. Currency policy is explicit:

   ```powershell
   python data/yfinance_history.py plan --currency-policy fx --batch-size 24
   ```

   `native` selects only mapped native EUR listings. `fx` also supports mapped foreign listings and reconstructs EUR using daily Yahoo FX closes. The JSON result names a run and `agent-prompts.json`. Disabled identities and excluded currencies are listed explicitly. For a selection, add `--isins ISIN,ISIN`. Date bounds are inclusive `--start` and exclusive `--end`.

2. Assign each generated prompt once to a GPT-6 Luna high subagent. In Claude's hook-capable interface, the agent uses `Write` to create the generated **control JSON** in `data/yfinance/requests/`. The `PostToolUse:Write` hook runs the Python fetcher, which writes native closes, EUR rows, FX evidence and receipts. The agent sees a compact `SAVED` or `NOT SAVED` message and never copies prices.

   In Codex or a runtime without `PostToolUse`, have each subagent run the same hook explicitly:

   ```powershell
   python data/yfinance_history.py trigger RUN_ID --batch 1
   ```

   The trigger invokes the Node hook. It uses the same request validation, fetcher and receipts. Do not merge inside a fetch agent. Ask if the requested GPT-6 Luna high runtime is unavailable; do not silently substitute a different model.

3. After all batches finish, commit through the existing updater:

   ```powershell
   python data/update_prices.py --finish-yfinance RUN_ID
   ```

   Missing/invalid batches refuse the merge. `--allow-partial` explicitly imports only validated instruments and reports every omission. This is useful when Yahoo cannot supply a series, while Scalable fallback remains available.

4. Report coverage, exclusions and the verification receipts. Reload the dashboard with Ctrl+F5.

For a fully scripted run, use `python data/yfinance_history.py run --currency-policy fx`. For bulk work in this project, prefer the disjoint subagent steps above. Use `native` explicitly to limit a future selection to native EUR listings.

## Files and data contract

| File | Purpose |
|---|---|
| `data/yfinance_symbols.csv` | Explicit ISIN-to-symbol/currency registry and original identity evidence. Disabled mismatches are preserved. |
| `data/yfinance/runs/<run>/plan.json` | Immutable date range, currency policy, instrument batches and database hashes. |
| `data/yfinance/runs/<run>/native/<ISIN>.csv` | Original source `date,close`, exchange-local date. No OHLCV or adjusted close. |
| `data/yfinance/runs/<run>/fx/*.csv` | Daily foreign-currency-per-EUR closes when FX conversion is selected. |
| `data/yfinance/runs/<run>/staged/<ISIN>.csv` | Native close plus EUR close and source/FX provenance. |
| `data/yfinance/runs/<run>/receipts/` | Source timestamps, checksums, omissions and overlap validation. |
| `data/yfinance_sources.csv` | Persistent ledger keyed by date and ISIN. Contains only closes and the currency/source fields needed to interpret them. |
| `data/prices_history.csv` | Dashboard-wide EUR history: `date,res,<existing ISIN columns>`. Daily Yahoo closes take priority at imported date/ISIN keys. Other Scalable values remain fallback. |
| `data/yfinance_status.json` | Imported coverage, exclusions, policy and complete daily-grid boundary. |
| `data/portfolio-data.js` | Rebuilt by `build_data.py`. The page remains offline. |

The existing ledger survives subsequent Scalable `--finish-history` and new-instrument backfills: the updater reapplies the authoritative Yahoo observations after merging broker history. A shared lock coordinates the writers.

The dashboard still needs `instruments.csv`, `positions.csv`, `benchmarks.csv`, depot files and the existing intraday CSVs. Price column order, ISINs and array/date alignment are preserved. Historical `res=d` is supported. Risk metrics keep the complete Scalable daily boundary at 2026-01-02 because instruments outside the Yahoo import still have sparse history. Total return, CAGR and drawdown use the full history.

## Validation and recovery

- Each live fetch requires the configured symbol to appear in a current exact-ISIN Yahoo search. The original registry distinguishes reverse-ISIN matches from search-only candidates. A search hit is not independent proof of instrument identity.
- Currency and timezone must match. Close values must be finite, positive, on unique ascending weekdays and inside the requested interval. Missing source closes are recorded and left missing.
- `auto_adjust=False`, `back_adjust=False`, `repair=False`, `actions=False`. Yahoo's `Close` can already reflect stock splits. Dividends and `Adj Close` are not imported. A new run fetches the complete selected historical interval to incorporate source revisions.
- EUR reconstruction uses `native close / foreign-currency-per-EUR rate`. GBp is converted to GBP first. FX must be on or before the stock date and at most four calendar days old; the actual FX date is recorded. These are reconstructed prices, distinct from Scalable quotes.
- Yahoo may append today's live FX row at the requested exclusive end. The provider excludes that specific end-date row and records it in the FX metadata; other out-of-range dates still fail validation. Stored FX files obey the requested interval.
- At least three recent final Scalable dates must overlap. The last ten matching dates must have median absolute deviation <=8% and maximum <=25%. This screens mapping/scale errors; it does not make different venues or FX timings identical.
- Changed plans, corrupt files, duplicate keys, missing batches and changed database snapshots are refused. Repeating an applied run is a no-op if its authoritative datasets still match.
- The merger backs up data, generated files and HANDOFF, writes each file by atomic replacement, rebuilds and runs engine/Python/Node crosschecks. A failed check restores the previous files. Multi-file visibility is not a filesystem-wide atomic transaction.
- Fetch and merge locks identify the owning PID. An interrupted process can leave a stale lock. Verify that process has stopped before removing its lock. Backups are retained under the run's `backup/` directory with `backup-index.json` for recovery after an abrupt process termination. Do not overwrite newer data with an old backup.

`--use-audit` reuses the existing yfinance audit **only while its original fetch is less than 24 hours old**, retaining the original timestamp and source-file hash. It never claims to be a fresh Yahoo fetch. Future runs default to live yfinance.

## Tests

```powershell
python tests/yfinance_history_test.py
node tests/engine.test.cjs
python tests/crosscheck.py
node tests/crosscheck.cjs
```

Browser verification follows `docs/VERIFICATION.md`. The import must preserve 1T/1W/1M charts, cards, selections, measurements and responsive layout.

## Sources

- [yfinance API](https://ranaroussi.github.io/yfinance/reference/api/yfinance.Ticker.history.html)
- [yfinance project](https://github.com/ranaroussi/yfinance)
- [Claude Code hook event and JSON output contract](https://code.claude.com/docs/en/hooks)
