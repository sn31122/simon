# Claude Code entry point

All shared rules are in `AGENTS.md` (also read by Codex); the current state is in `HANDOFF.md`. Claude-only extras:

- **Price update** ("update", "refresh", "check for new quotes", "new prices", "Kurse aktualisieren", "run UPDATE.md"):
  run the skill `update-quotes` (`.claude/skills/update-quotes/SKILL.md`).
- **Depot update** ("update depot", "new holdings"): call `get_portfolio_holdings` and `get_portfolio_overview` (no
  `portfolioId`), then `python data/update_depot.py` (the hook `save-portfolio.cjs` saved both answers).
- **Hooks** (`.claude/settings.json`, need `node` on PATH): `save-chart.cjs` turns every `get_security_chart` answer into a
  file + one `SAVED …` line; `save-portfolio.cjs` saves the depot answers. A chart call that shows raw JSON = hook not active.
- **Subagents:** price lookups go to agent type `price-fetcher` (Claude Sonnet 5.5, `claude-sonnet-5-5`), **one** agent for all ISINs
  (user 02.10.2026), every prompt starts with `Thinking ON: think step by step before each tool call and before writing each file.`
  Everything else is done by the main session itself; delegate only when the user asks – then UI design to
  `dashboard-designer` (Sonnet 5.5) and engine work to `opus-engineer` (Opus 5.5). Do not resume old agent IDs.

@AGENTS.md
@HANDOFF.md
