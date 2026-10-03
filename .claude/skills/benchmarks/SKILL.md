---
name: benchmarks
description: "Adds, changes, renames or removes benchmark portfolios (presets of the '+ Benchmark' menu) of the yacht dashboard. Use whenever the user says things like 'remove energie', 'change energie to ge vernova 20 vertiv 80', 'add new benchmark called asdf: microsoft 30 nvidia 40 palantir 30', 'rename memory to Speicher', 'list benchmarks'."
allowed-tools: Bash(python data/benchmarks.py:*), Bash(python3 data/benchmarks.py:*)
---
# Benchmark portfolios (one command)

Translate the request into one call of `python data/benchmarks.py` (`python3` where `python` is missing), from the repo root:

| User says | Command |
|---|---|
| "list benchmarks" | `list` |
| "add new benchmark called asdf: microsoft 30 nvidia 40 palantir 30" | `add "asdf" "microsoft 30 nvidia 40 palantir 30"` |
| "change energie to ge vernova 20 vertiv 80" | `set energie "ge vernova 20 vertiv 80"` |
| "rename memory to Speicher" | `rename memory "Speicher"` |
| "remove energie" | `remove energie` |

Pass the instrument words as the user wrote them; the script resolves them against `data/instruments.csv` and checks that
the weights total 100 %. Never edit `benchmarks.csv` by hand.
- `STOP: … ambiguous: …` → ask the user which one (show the listed choices).
- `STOP: no tracked instrument matches …` → ask whether to add it as a new instrument (skill `update-quotes`, "New
  instrument"), then rerun.
- `STOP: weights total …` → ask for the corrected weights. "Mein Depot" and "Depot-Historie" cannot be changed here.
Report in one or two lines (the script's first line + tests), then commit on a branch, PR, merge on request (`AGENTS.md`).
