---
name: update-quotes
description: Fetches the latest Scalable quotes for every instrument of the yacht dashboard (30-min + 2-h + daily closes), merges them, rebuilds the page data and runs the tests. Use whenever the user says "update", "refresh", "check for new quotes", "new prices", "Kurse aktualisieren", "aktualisieren".
---
# Update quotes (one command)

Run from the repository root (`python`, or `python3` where `python` is missing). Read-only Scalable tools only; never edit
data files by hand. The hook `.claude/hooks/save-chart.cjs` writes every chart answer to `data/incoming/` – nobody copies numbers.

1. **Plan**: `python data/update_prices.py --plan`
   - `WARNING: … more than three_months covers` → stop and ask the user how to proceed.
   - Otherwise it prints one prompt (`--- prompt 1/1 ---`) for all ISINs. Do not print it to the user.
2. **Fetch**: start **one** agent (agent type `price-fetcher`, model `claude-sonnet-5-5`) with the prompt copied exactly.
   Wait for its answer (`SAVED n of m` plus any problem lines).
   - `HOOK NOT ACTIVE` → stop. Tell the user the quote-saving hook did not run: Node must be on PATH, and Claude Code must
     be restarted once after `.claude/settings.json` was added (`/hooks` lists it). Never copy prices by hand.
3. **Merge**: `python data/update_prices.py --finish` (checks, merges, rebuilds, runs the tests, writes the status block in `AGENTS.md`).
   - `FETCH AGAIN …` → start the printed prompt the same way, then `--finish` again (at most 2 rounds per ISIN, then show
     the reason lines to the user).
   - `STOP: …` or `CHECK WITH USER: …` → show those lines to the user (known real moves are listed in `AGENTS.md`).
4. **Depot snapshot**: call `get_portfolio_holdings` and `get_portfolio_overview` (`includeYearToDate: true`, no
   `portfolioId`; the hook saves both), then `python data/update_depot.py`. `STOP: …` → show the line to the user.
5. **Report** in the user's language, 2–4 lines: the `== REPORT ==` lines, the `DEPOT` line (Scalable value, G/V seit
   Kauf), anything that needs the user, and "reload the dashboard (Ctrl+F5)". Skip `note:` lines and known warnings.

## New instrument (only when the user asks)
1. `search_securities` for the exact ISIN (several plausible hits → ask), then a row `isin,name,short,type` in
   `data/instruments.csv` (type = Aktie, ETF, ETC or ETP).
2. `python data/update_prices.py --plan-add ISIN[,ISIN]` → one prompt; start one `price-fetcher` agent with it.
3. `python data/update_prices.py --finish-add ISIN[,ISIN]` → adds the columns, history, 30-min / 2-h points, rebuilds,
   tests. `FETCH AGAIN` → rerun the printed prompt, then `--finish-add` again. `CHECK WITH USER:` → show the line.
A new *position* also needs its row in `positions.csv` and a logo `company-logos/<ISIN>.png` (user instruction only).
