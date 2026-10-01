# Yacht portfolio dashboard

Private repository **sn31122/simon** (branch `main`). An offline dashboard (`dashboard.html`) comparing the Yacht
portfolio, your real Scalable depot and benchmark baskets. Plain HTML/CSS/JS with bundled data, no build step and no
packages.

## Open the dashboard
- **Always the latest `main`:** double-click `tools/yacht-live.bat` (Windows) or `tools/yacht-live.command` (Mac). It
  keeps its own copy in `yacht-live-main`, checks GitHub every 60 s and reopens the page when `main` changes. Leave the
  window open. Never edit files in that folder.
- **From a checkout:** open `dashboard.html` directly, or run `python -m http.server 8770` and open
  http://localhost:8770/dashboard.html.

## The three jobs
| You say | What happens | Where |
|---|---|---|
| **"update"** (or "refresh", "Kurse aktualisieren") | Scalable quotes for all 108 series (30-min, 2-h, daily closes) → merge → rebuild → tests | Claude Code (needs the Scalable connector) |
| **"update depot"** | reads your Scalable holdings + valuation (read-only) → `depot.csv`, `depot_ref.csv`, "Mein Depot" weights → rebuild → tests | Claude Code |
| **"import transactions"** | takes the newest Scalable transaction export from your Downloads folder (or a file you attach) → `depot_transactions.csv` ("Depot-Historie") → rebuild → tests | Claude Code **or** Codex |

Then say **"merge"**: the agent opens a pull request to `main` and merges it, and the live view shows it within a minute.
To get the transaction export: Scalable → Transactions → Export (CSV).

## Switching between Claude Code and Codex
Both tools follow the same rules in `AGENTS.md`. Each session starts with `python tools/check.py` (pulls/merges the newest
`main`, checks the tools and data, runs the tests) and ends with a pull request to `main`. So whatever one tool merged,
the next session in the other tool starts from it.

What differs: price and depot updates need the Scalable connector **and** the Claude Code hook that saves every answer
to a file. Codex has neither, so do those in Claude Code. Everything else works in both tools: transaction import, UI,
engine, tests and docs.

### Working with Codex on Windows (one-time setup)
1. Install [Git for Windows](https://git-scm.com/download/win), [Python 3](https://www.python.org/downloads/) (tick
   "Add python.exe to PATH") and [Node.js LTS](https://nodejs.org/).
2. Clone a **working copy**, separate from the live-view folder:
   `git clone https://github.com/sn31122/simon %USERPROFILE%\simon`
3. Start Codex in `%USERPROFILE%\simon`. It reads `AGENTS.md` by itself. Your first message can simply be:
   "Run python tools/check.py and tell me the state."
4. When Codex is done: "commit, push, open a PR and merge". Codex needs GitHub push rights (Git Credential Manager signs
   in on the first push).

## Folder map
| Path | What |
|---|---|
| `dashboard.html`, `css/`, `js/` | the page (`js/engine.js` = all math, `js/charts.js`, `js/app.js` = UI) |
| `data/*.csv` | inputs: prices, positions, depot, transactions, benchmarks, instruments |
| `data/portfolio-data.js` | generated from the CSVs by `python data/build_data.py` |
| `data/update_prices.py`, `update_depot.py`, `import_transactions.py` | the three jobs above |
| `data/source/` | archived raw fetches (history only) |
| `.claude/` | Claude Code: hooks, the `update-quotes` skill, subagents |
| `tests/` | `engine.test.cjs`, `crosscheck.py` + `crosscheck.cjs` |
| `tools/` | `check.py`, live-view launchers, browser acceptance test |
| `docs/` | `VERIFICATION.md`, `LOCAL_MAC.md`, reference images, test evidence |

## Read order for agents
`AGENTS.md` (rules) → `HANDOFF.md` (state) → `SPEC.md` (data contract, formulas, UI) → `UPDATE_PRICES.md` (price runbook)
→ `docs/VERIFICATION.md`.

## Verify
```sh
python tools/check.py
```
Or run the tests one by one: `node tests/engine.test.cjs`, `python tests/crosscheck.py`, `node tests/crosscheck.cjs`.
