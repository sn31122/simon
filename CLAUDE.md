# Claude Code entry point

**Historical daily closes:** follow `UPDATE_HISTORY.md`. Bulk data work uses GPT-6 Luna high per the current user override in `AGENTS.md`; ask if that runtime is unavailable. The `Write` hook fetches control requests, while Codex subagents can invoke the same hook with the `trigger` command.

**Quote updates:** when the user says "update", "refresh", "check for new quotes", "new prices", "Kurse aktualisieren" or "run UPDATE.md", run the skill `update-quotes` (`.claude/skills/update-quotes/SKILL.md`).

@AGENTS.md
@HANDOFF.md

This checkout is self-contained: the GitHub repository `sn31122/simon` is the place to work (cloud sessions); use the repository root. Do not resume old agent IDs.
