# Yacht portfolio dashboard

Private repository containing financial portfolio data: **sn31122/simon**, branch `main` (the local **Yacht scalable** project, continued and finished in a Claude Code cloud session on 27 September 2026).

**Start with [HANDOFF.md](HANDOFF.md)** (state, open points, first steps on the local machine). **New quotes:** say "update" (or "refresh", "check for new quotes", "Kurse aktualisieren", "run UPDATE.md") in Claude Code in this folder, see [UPDATE.md](UPDATE.md).

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

Python 3 and Node.js required; no pip/npm packages for these checks. Browser acceptance (Playwright, test-only): [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Read order

1. `CLAUDE.md`, `AGENTS.md`, `HANDOFF.md`: instructions and current state.
2. `SPEC.md`: data contract, engine formulas and UI behaviour.
3. `UPDATE_PRICES.md`: data workflow (hook, skill, scripts).
4. `docs/VERIFICATION.md`, `docs/verification/`: browser acceptance tool and the evidence of 27.09.2026.
5. `docs/references/`: the user's reference images of 27.09.2026; `docs/history/windows-test-helpers/`: the old Windows (Edge/CDP) test helpers, kept for local work.

Older handoff, requirement and agent-report files were removed on 27.09.2026 (still in the git history).
