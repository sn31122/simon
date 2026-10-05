# Claude Code entry point

All shared rules and the current state are in `AGENTS.md` (also read by Codex). Claude-only extras:

- **Price update** ("update", "refresh", "new prices", "Kurse aktualisieren"): skill `update-quotes`; it ends with the
  depot snapshot, so "Mein Depot" shows Scalable's real value and G/V.
- **Depot update** ("update depot"): `get_portfolio_holdings` + `get_portfolio_overview` (no `portfolioId`), then
  `python data/update_depot.py` (the hook `save-portfolio.cjs` saved both answers).
- **Benchmark portfolios** ("add benchmark …", "change … to …", "remove …"): skill `benchmarks`.
- **Routine "Yacht Kurs-Update"** (fired by the launcher): job "Update on launch" in `AGENTS.md`; it merges its own PR.
- **Hooks** (`.claude/settings.json`, need `node` on PATH): `save-chart.cjs` turns every `get_security_chart` answer into a
  file + one `SAVED …` line; `save-portfolio.cjs` saves the depot answers the same way (`SAVED depot …`). A chart or depot
  call that shows raw JSON = hook not active.
- **Subagents:** price lookups go to **one** agent of type `price-fetcher` (Claude Sonnet 5.5, `claude-sonnet-5-5`) for all
  ISINs, with the prompt printed by `update_prices.py` copied exactly. Everything else is done by the main session; other
  subagents only when the user asks. Do not resume old agent IDs.

@AGENTS.md
