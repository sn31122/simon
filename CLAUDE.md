# Claude Code entry point

All shared rules are in `AGENTS.md` (also read by Codex); the current state is in `HANDOFF.md`. Claude-only extras:

- **Price update** ("update", "refresh", "check for new quotes", "new prices", "Kurse aktualisieren", "run UPDATE.md"):
  run the skill `update-quotes` (`.claude/skills/update-quotes/SKILL.md`); it ends with the depot snapshot, so "Mein Depot"
  shows Scalable's real value and G/V (user 02.10.2026).
- **Phone page** (user 02.10.2026): `python tools/build_mobile.py` bundles everything into `mobile/yacht-dashboard.html`,
  published as a private artifact https://claude.ai/artifact/FMoijrjc87baLhkc3bXj5g (republish to that URL after every price / depot update).
- **Depot update** ("update depot", "new holdings"): call `get_portfolio_holdings` and `get_portfolio_overview` (no
  `portfolioId`), then `python data/update_depot.py` (the hook `save-portfolio.cjs` saved both answers).
- **Benchmark portfolios** ("add benchmark …", "change energie to …", "remove energie"): skill `benchmarks`.
- **Hooks** (`.claude/settings.json`, need `node` on PATH): `save-chart.cjs` turns every `get_security_chart` answer into a
  file + one `SAVED …` line; `save-portfolio.cjs` saves the depot answers. A chart call that shows raw JSON = hook not active.
- **Subagents:** price lookups go to agent type `price-fetcher` (Claude Sonnet 5.5, `claude-sonnet-5-5`), **one** agent for all ISINs
  (user 02.10.2026), every prompt starts with `Thinking ON: think step by step before each tool call and before writing each file.`
  Everything else is done by the main session itself; other subagents only when the user asks for one (user 02.10.:
  no predefined design/engineering agents). Do not resume old agent IDs.

@AGENTS.md
@HANDOFF.md
