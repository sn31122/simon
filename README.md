# Yacht portfolio dashboard — cloud continuation

Cloud handoff: **sn31122/simon → cloud-handoff-2026-09-27**. Private repository containing financial portfolio data. Snapshot of the local **Yacht scalable** project, captured 27 September 2026.

**Start with [CLOUD_HANDOFF.md](CLOUD_HANDOFF.md).** Paste [CLOUD_PROMPT.md](CLOUD_PROMPT.md) into a new Claude Code cloud session on branch `cloud-handoff-2026-09-27`. No original chat or live agents are required.

## Run

Plain HTML, CSS and classic JavaScript with bundled data. No app dependencies or build required.

```sh
python3 -m http.server 8770 --bind 0.0.0.0
```

Open the cloud preview for `/dashboard.html`. Locally: http://localhost:8770/dashboard.html. Directly opening dashboard.html also works. On Windows use `python` instead of `python3`.

## Verify

```sh
node --check js/app.js
node --check js/charts.js
node --check js/engine.js
node tests/engine.test.cjs
python3 tests/crosscheck.py
node tests/crosscheck.cjs
```

Python 3 and Node.js required; no pip/npm packages for these checks. Optional browser smoke instructions: [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Read order

1. `CLAUDE.md`, `AGENTS.md`, `CLOUD_HANDOFF.md`: instructions and current state.
2. `docs/ACCEPTANCE_CHECKLIST.md`: definition of done.
3. `SPEC.md`: engine formulas/reference; historical UI text is marked as superseded.
4. `UPDATE_PRICES.md`: data workflow.
5. `docs/agent-tasks/`, `docs/AGENT_REPORTS.md`, `docs/REQUIREMENTS_SOURCE.md`: full task specifications and evidence.
6. `docs/references/`: user references and historical screenshots.

The app and pending data were copied intact. Migration changes concern documentation and verification support. Original snapshot hashes are in `docs/SOURCE_SNAPSHOT.json`; original docs are archived in `docs/history/`.
