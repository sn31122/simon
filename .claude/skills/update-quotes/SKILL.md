---
name: update-quotes
description: Fetches the latest Scalable quotes for every instrument of the yacht dashboard (30-min + 2-h + daily closes), merges them, rebuilds the page data and runs the tests. Use whenever the user says "update", "refresh", "check for new quotes", "new prices", "Kurse aktualisieren", "aktualisieren", or asks to run UPDATE.md / update-quotes.
allowed-tools: Bash(python data/update_prices.py:*), Bash(python3 data/update_prices.py:*), Agent
---
# Update quotes (one command)

Run the price update of `UPDATE_PRICES.md` end to end, then give the user a short report. Work from the repository root.
Use `python` (Windows) or `python3` where `python` is missing. Read-only Scalable tools only; never edit data files by hand.

1. **Plan**: `python data/update_prices.py --plan`
   - `WARNING: … more than three_months covers` → stop and ask the user how to proceed.
   - Otherwise it prints one prompt (`--- prompt 1/1 ---`) for all ISINs. Do not print it to the user.
2. **Fetch**: start **one** agent (agent type `price-fetcher`, model `claude-sonnet-5-5`) with the prompt copied exactly
   (user 02.10.2026: one Sonnet 5.5 subagent for all calls; never split it up). Wait for its answer. The hook `.claude/hooks/save-chart.cjs` writes the files; the agent
   only answers `SAVED n of m` plus any problem lines.
   - Any answer `HOOK NOT ACTIVE` → stop. Tell the user the quote-saving hook did not run: Node must be installed and on
     PATH, and Claude Code must be restarted once after `.claude/settings.json` was added (`/hooks` lists it).
     Never fall back to copying prices by hand.
3. **Merge**: `python data/update_prices.py --finish`
   - `FETCH AGAIN …` → start the printed prompt the same way, then `--finish` again (at most 2 rounds per ISIN, then show
     the reason lines to the user).
   - `STOP: …` or `CHECK WITH USER: …` → show those lines to the user and change nothing else.
4. **Report** in the user's language, 2–4 lines: the `== REPORT ==` lines (last price date, 30-min / 2-h coverage,
   tests), anything that needs the user, and "reload the dashboard (Ctrl+F5)". Skip `note:` lines and known warnings.
   Do not commit unless the user asks.
