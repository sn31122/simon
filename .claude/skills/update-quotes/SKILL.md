---
name: update-quotes
description: Fetches the latest Scalable quotes for every instrument of the yacht dashboard (30-min points + daily closes; 2-h points only after a gap) and the depot snapshot, merges them, rebuilds the page data and runs the tests. Use whenever the user says "update", "refresh", "check for new quotes", "new prices", "Kurse aktualisieren", "aktualisieren".
---
# Update quotes (one command)

Run from the repository root (`python`, or `python3` where `python` is missing). Read-only Scalable tools only; never edit
data files by hand. The hooks `.claude/hooks/save-chart.cjs` / `save-portfolio.cjs` write every answer to `data/incoming/` –
nobody copies numbers.

1. **Plan**: `python data/update_prices.py --plan`
   - `WARNING: … more than three_months covers` → stop and ask the user how to proceed.
   - Otherwise it prints one prompt (`--- prompt 1/1 ---`) for all ISINs; normally only `seven_days` (the 1M chart takes its
     2-h points from the 30-min points), `one_month` / `three_months` are added after a gap of > 5 weekdays. Do not print it
     to the user.
2. **Fetch**: start **one** agent (agent type `price-fetcher`, model `claude-sonnet-5-5`) with the prompt copied exactly. It
   makes one chart call per ISIN and timeframe plus the two depot calls. Wait for its answer (`SAVED n of m` plus any problem lines).
   - `HOOK NOT ACTIVE` → stop. Tell the user the saving hook did not run: Node must be on PATH, and Claude Code must be
     restarted once after `.claude/settings.json` was added (`/hooks` lists it). Never copy prices by hand.
3. **Finish**: `python data/update_prices.py --finish` (checks, merges, rebuilds, depot snapshot via `update_depot.py`, tests,
   status block in `AGENTS.md`).
   - `FETCH AGAIN …` → start the printed prompt the same way, then `--finish` again (at most 2 rounds per ISIN, then show
     the reason lines to the user).
   - `DEPOT MISSING` → call `get_portfolio_holdings` and `get_portfolio_overview` (`includeYearToDate: true`, no
     `portfolioId`) yourself, then `python data/update_depot.py`.
   - `STOP: …` or `CHECK WITH USER: …` → show those lines to the user (known real moves are listed in `AGENTS.md`).
4. **Report** in the user's language, 2–4 lines: the `== REPORT ==` lines, the `DEPOT` line (Scalable value, G/V seit
   Kauf), anything that needs the user, and "reload the dashboard (Ctrl+F5)". Skip `note:` lines and known warnings.

## New instrument (only when the user asks)
1. `search_securities` for the exact ISIN (several plausible hits → ask), then a row `isin,name,short,type` in
   `data/instruments.csv` (type = Aktie, ETF, ETC or ETP).
2. `python data/update_prices.py --plan-add ISIN[,ISIN]` → one prompt; start one `price-fetcher` agent with it.
3. `python data/update_prices.py --finish-add ISIN[,ISIN]` → adds the columns, history, 30-min / 2-h points, rebuilds,
   tests. `FETCH AGAIN` → rerun the printed prompt, then `--finish-add` again. `CHECK WITH USER:` → show the line.
A new *position* also needs its row in `positions.csv` and a logo `company-logos/<ISIN>.png` (user instruction only).
