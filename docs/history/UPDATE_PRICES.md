# Price update runbook (written for a fast model such as Haiku)

Project folder: `C:\Users\simon\Downloads\simon\yacht portfolio dashboard permanent`. Run every command from there.
One update fetches, for every ISIN, the 30-minute points of `get_security_chart(..., "seven_days")`. The scripts turn them
into the daily closes (`data/prices_daily.csv`) and the 1T intraday chart (`data/intraday.csv`). The agents only copy numbers;
the scripts do all checks, calculations, tests and the HANDOFF status.

## Hard rules
- Scalable MCP: use **only** `get_security_chart` (and `search_securities` only for a new instrument). Never call order,
  savings-plan, watchlist, price-alert or any other tool that changes something. Omit `portfolioId`.
- Copy `timestampUtc` and `midPrice` **exactly** as returned: no rounding, no reformatting, no extra spaces, no invented points.
- Do not edit `prices_daily.csv`, `intraday.csv`, `portfolio-data.js`, `positions.csv`, `benchmarks.csv` or any code.
- Fetch agents: always agent type `price-fetcher` / model **haiku** with **thinking ON** (Haiku has no effort setting; the
  prompts printed by `--plan` start with the line `Thinking ON: think step by step before each tool call and before writing each file.`).

## Steps for the orchestrator (the session the user talks to) – 3 steps
1. `python data/update_prices.py --plan`
   Empties `data/incoming/` and prints the COPY FROM DATE plus one ready prompt per batch (`--- prompt 1/5 ---` …).
   If it prints `WARNING: ... weekdays since ...`, stop and tell the user (the gap needs the year_to_date procedure in AGENTS.md).
2. Start one agent per printed prompt, **all at once** (agent type `price-fetcher`, model `haiku`), copying each prompt exactly.
   Wait until all of them have answered. (No subagents available? Do the fetch-agent steps yourself, batch by batch.)
3. `python data/update_prices.py --finish`
   It checks the files, merges, rebuilds `data/portfolio-data.js`, runs all tests and updates the status block in `HANDOFF.md`.
   - Ends with `== REPORT ==` and exit code 0 -> give the report lines to the user. Done.
   - `FETCH AGAIN: start N agent(s) ...` -> start one `price-fetcher` agent per printed prompt (all at once), then run
     `--finish` again. After 2 rounds for the same ISIN, stop and show the user the reason line.
   - `STOP: merge refused` or `CHECK WITH USER:` (split / replaced final close) -> show those lines to the user, change nothing.
   - The known big moves in the build warnings are real: Marvell 02.06., D-Wave 21.05., AT&S 15.06., Bloom 30.07.2026
     (> 30 %) and Halbleiter 3x XS3091657729 05.06.2026 (−27 %, 3x a −9 % semiconductor day).
   - `note:` lines (gaps of thinly traded instruments) need no action.

## New instrument (only when the user asks for it) – 4 steps
Every price column is fetched by every normal update and can be picked in the dashboard's benchmark cards.
1. Find the exact ISIN with `search_securities` (several plausible hits → ask the user) and add a row to
   `data/instruments.csv`: `isin,name,short,type` (type = Aktie, ETF, ETC or ETP).
2. `python data/update_prices.py --plan-add ISIN[,ISIN]` → prints one ready prompt per ≤ 3 ISINs.
3. Start one agent per prompt, all at once (agent type `price-fetcher`, model `haiku`), copying each prompt exactly.
4. `python data/update_prices.py --finish-add ISIN[,ISIN]` → checks both files per ISIN (format, closes of year_to_date and
   seven_days agree, no skipped days), adds the columns with the closes of all existing trading days, adds the 30-min points
   to `intraday.csv`, archives the year_to_date file as `data/source/ytd_<ISIN>.csv`, rebuilds and runs the tests.
   `FETCH AGAIN` → run the printed prompt, then `--finish-add` again. `CHECK WITH USER:` → show the line to the user.
A new *position* also needs its row in `positions.csv` and a logo `company-logos/<ISIN>.png` (user instruction only).

## Steps for a backfill agent (new ISIN)
`--plan-add` removed old files of these ISINs, so every file you write is new.
For **each** ISIN of your batch, one after the other:
1. Call `get_security_chart` with `isin` = the ISIN and `timeframe` = `year_to_date`.
   Create the file `data/incoming/ytd/<ISIN>.csv` with the Write tool (full path inside the project folder):
   line 1 `timestamp_utc,price`, then one line per entry of `dataPoints`, in the returned order: `<timestampUtc>,<midPrice>`.
   ALL entries (about 190 lines), no filtering. Ignore `closingReferencePoint`.
2. Call `get_security_chart` with `isin` = the ISIN and `timeframe` = `seven_days`.
   Create the file `data/incoming/<ISIN>.csv` the same way: line 1 `timestamp_utc,price`, then ALL entries of `dataPoints`
   (about 190 lines, no date filter).
Copy `timestampUtc` and `midPrice` exactly (see the hard rules). If Write refuses because the file already exists / was not
read: Read that file once, then Write it again. If the chart tool returns an error: write no file for that step, note the
error, continue.
When the batch is done, answer with one line per file: `<file path> <number of data lines> <first timestamp> <last timestamp>`
(or `<file path> ERROR <message>`). Do not run any scripts; the orchestrator does that.

## Steps for a fetch agent (one batch)
`--plan` emptied `data/incoming/`, so every file you write is new.
For **each** ISIN of your batch, one after the other:
1. Call `get_security_chart` with `isin` = the ISIN and `timeframe` = `seven_days`.
2. From `dataPoints`, keep the points whose `timestampUtc` begins with a date **equal to or later than** the COPY FROM DATE
   (compare the first 10 characters, e.g. `2026-09-24`). Keep them in the returned order. Ignore `closingReferencePoint`.
3. Create the file `data/incoming/<ISIN>.csv` with the Write tool (full path inside the project folder):
   - line 1: `timestamp_utc,price`
   - then one line per kept point: `<timestampUtc>,<midPrice>`

   Example (COPY FROM DATE 2026-09-24):
   ```
   timestamp_utc,price
   2026-09-24T05:30:57.000Z,310.625
   2026-09-24T05:59:39.000Z,310.15
   ...
   2026-09-25T20:59:57.529Z,310.075
   ```
   A full day has about 32 lines; today has fewer (up to the current time).
   If Write refuses because the file already exists / was not read: Read that file once, then Write it again. Never skip an ISIN.
4. If the chart tool returns an error for an ISIN: write no file for it, note the error, continue with the next ISIN.

When the batch is done, answer with one line per ISIN: `<ISIN> <number of data lines> <first timestamp> <last timestamp>`
(or `<ISIN> ERROR <message>`). Do not run any scripts; the orchestrator does that.
