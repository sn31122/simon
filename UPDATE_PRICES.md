# Price update runbook (price-fetcher uses Claude Sonnet 5.5)

Project folder: `<repository-root>`. Run every command from there (`python`; use `python3` where `python` is missing).
One update fetches, for every ISIN, `get_security_chart(..., "seven_days")` (30-minute points of ~6 sessions) and
`get_security_chart(..., "one_month")` (2-hour points of ~1 month); after a break of more than 5 weekdays also
`three_months` (daily closes). A hook saves every result to a file, so **nobody copies numbers**. The scripts turn the files
into the daily closes (`data/prices_daily.csv`), the 30-minute history (`data/intraday.csv`) and the 2-hour history
(`data/intraday_2h.csv`), and do all checks, tests and the HANDOFF status. Both histories keep every collected session.

Shortcut: the skill `update-quotes` (`.claude/skills/update-quotes/SKILL.md`; the user says "update", "refresh",
"check for new quotes", "Kurse aktualisieren") runs the orchestrator steps below.

## The hook (writes the files)
`.claude/settings.json` runs `.claude/hooks/save-chart.cjs` (Node, no dependencies) after every `get_security_chart` call,
also inside subagents. It writes the points verbatim (first line `timestamp_utc,price`, then `<timestampUtc>,<midPrice>`
ascending; `closingReferencePoint` ignored):

| timeframe | file | used for |
|---|---|---|
| `seven_days` | `data/incoming/<ISIN>.csv` | closes of new days (last point per Berlin date) + `intraday.csv` |
| `one_month` | `data/incoming/2h/<ISIN>.csv` | `intraday_2h.csv` (its last point of a day, ~19:30 UTC, is not the close) |
| `three_months` | `data/incoming/3m/<ISIN>.csv` | closes of new days that seven_days no longer covers |
| `year_to_date` | `data/incoming/ytd/<ISIN>.csv` | new-instrument backfill |
| `one_year` | `data/incoming/1y/<ISIN>.csv` | every 2nd trading day of the last year, for history before 2026 |
| `max` | `data/incoming/max/<ISIN>.csv` | month-end history back to ~2016 |

The model then sees one line instead of the chart:
`SAVED <ISIN> <timeframe>: <n> points on <d> days, <first> .. <last> UTC, last <price> EUR -> <file>. Nothing to copy.`
`NO DATA …` / `NOT SAVED …` = nothing written (report the line). Other timeframes (`one_day`, `six_months`)
and error messages pass through unchanged. A chart call outside an update only leaves a file that the next `--plan`
deletes. **If a call shows the raw chart JSON instead of such a line, the hook is not running** (Node missing from PATH,
or Claude Code started before `.claude/settings.json` existed: restart it, check `/hooks`). Then stop; never copy by hand.

## Hard rules
- Scalable MCP: use **only** `get_security_chart` (and `search_securities` only for a new instrument). Never call order,
  savings-plan, watchlist, price-alert or any other tool that changes something. Omit `portfolioId`.
- Do not write or edit `data/incoming/` files, `prices_daily.csv`, `intraday*.csv`, `portfolio-data.js`, `positions.csv`,
  `benchmarks.csv` or any code by hand. The hook writes the fetch files, the scripts everything else.
- Fetch agents: always agent type `price-fetcher` / model **`claude-sonnet-5-5`** with **thinking ON** (the
  prompts printed by `--plan` start with the line `Thinking ON: think step by step before each tool call and before writing each file.`).

## Steps for the orchestrator (the session the user talks to) – 3 steps
1. `python data/update_prices.py --plan`
   Empties `data/incoming/` (not `ytd/`) and prints `TIMEFRAMES:` plus one ready prompt for **one** agent with all ISINs
   (`--- prompt 1/1 ---`; user 02.10.2026: a single Sonnet 5.5 agent handles all calls).
   - `NOTE: … three_months fills the closes in between` = longer break, handled automatically (the prompts include it).
   - `WARNING: … more than three_months covers` → stop and ask the user.
2. Start one agent with the printed prompt (agent type `price-fetcher`, model `claude-sonnet-5-5`), copying each prompt exactly.
   Wait until it has answered. An answer `HOOK NOT ACTIVE` → stop and tell the user (see "The hook").
   (No subagents available? Do the fetch-agent steps yourself.)
3. `python data/update_prices.py --finish`
   It checks the files, merges, rebuilds `data/portfolio-data.js`, runs all tests and updates the status block in `HANDOFF.md`.
   - Ends with `== REPORT ==` and exit code 0 -> give the report lines to the user. Done.
   - `FETCH AGAIN: start N agent(s) ...` -> start one `price-fetcher` agent with the printed prompt, then run
     `--finish` again. After 2 rounds for the same ISIN, stop and show the user the reason line.
   - `STOP: merge refused` or `CHECK WITH USER:` (split / replaced final close) -> show those lines to the user, change nothing.
   - The known big moves in the build warnings are real: Marvell 02.06., D-Wave 21.05., AT&S 15.06., Bloom 30.07.,
     Nebius 30.07., IREN 30.07.2026 (> 30 %), Halbleiter 3x XS3091657729 05.06.2026 (−27 %, 3x a −9 % semiconductor day)
     and IREN 05.02.2026 (−24 %).
   - `note:` lines (gaps of thinly traded instruments) need no action.

## New instrument (only when the user asks for it) – 4 steps
Every price column is fetched by every normal update and can be picked in the dashboard's benchmark cards.
1. Find the exact ISIN with `search_securities` (several plausible hits → ask the user) and add a row to
   `data/instruments.csv`: `isin,name,short,type` (type = Aktie, ETF, ETC or ETP).
2. `python data/update_prices.py --plan-add ISIN[,ISIN]` → prints one ready prompt (5 chart calls per ISIN, one agent).
3. Start one agent with the prompt (agent type `price-fetcher`, model `claude-sonnet-5-5`), copying each prompt exactly.
4. `python data/update_prices.py --finish-add ISIN[,ISIN]` → checks the five files per ISIN (format, closes of year_to_date
   and seven_days agree, no skipped days), adds the columns with the closes of all existing trading days, adds the 30-min and
   2-h points to `intraday.csv` / `intraday_2h.csv`, archives the year_to_date file as `data/source/ytd_<ISIN>.csv`, rebuilds
   and runs the tests. `FETCH AGAIN` → run the printed prompt, then `--finish-add` again. `CHECK WITH USER:` → show the line.
A new *position* also needs its row in `positions.csv` and a logo `company-logos/<ISIN>.png` (user instruction only).

## Daily history before 2026 from finanzen.net (user 02.10.2026)
`python data/import_history.py --fetch [ISIN,…]` (default: every stock not fetched yet) gets the daily Xetra closes (gaps
from Frankfurt / gettex / Tradegate) from 20 years back to 31.12.2025, checks them against the Scalable history and merges
them into `prices_history.csv` (`dh` rows). ETFs/ETPs: the user exports a CSV by hand, then
`--import FILE --isin ISIN`. `--finish-history` / `--finish-add` re-merge these daily closes automatically.

## History before 2026 (only on user instruction; done 28.09.2026 for all columns)
`python data/update_prices.py --plan-history [ISIN,…]` (default: every column) → one `price-fetcher` agent per printed prompt
(one agent; TIMEFRAMES `one_year max`; the hook writes `data/incoming/1y/` and `data/incoming/max/`) → `--finish-history` (checks the
points against the final daily closes, writes `data/prices_history.csv`, archives the raw files in
`data/source/history_<date>/`, rebuilds, tests). New instruments get their history in `--plan-add` / `--finish-add`.

## Steps for a fetch agent (one batch)
Your task names the TIMEFRAMES and your ISINs. The hook saves every result; you only make the calls.
1. For **each** ISIN and **each** timeframe, call `get_security_chart` with `isin` = the ISIN and `timeframe` = the timeframe.
   You may put several calls into one message (e.g. both timeframes of 5 ISINs at once). Never skip a call.
2. Each call answers with one line starting with `SAVED`, `NO DATA` or `NOT SAVED`. Do not write any file.
   - If a call returns the raw chart data (JSON with `dataPoints`) instead: stop at once, make no further calls, write
     nothing, and answer only `HOOK NOT ACTIVE`.
   - If a call returns an error: call it once more; if it fails again, note the error and continue.
3. When all calls are done, answer with one line `SAVED <number of SAVED lines> of <number of calls>`, followed by every line
   that did not start with `SAVED` (ISIN, timeframe and the message). Do not run any scripts; the orchestrator does that.

## Steps for a backfill agent (new ISIN)
Same as a fetch agent, with the five timeframes `year_to_date`, `seven_days`, `one_month`, `one_year` and `max` for each ISIN
of your task (the last two are the history before 2026: every 2nd trading day of the last year and month-end closes).
