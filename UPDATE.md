# Update quotes

For **historical daily closes before 2026 with yfinance**, use [UPDATE_HISTORY.md](UPDATE_HISTORY.md). The existing routine below continues to supply recent Scalable daily and intraday quotes.

Say **"update"**, **"refresh"**, **"check for new quotes"** or **"Kurse aktualisieren"** (or "run UPDATE.md") in Claude Code
in this folder. Claude then runs the skill `.claude/skills/update-quotes/SKILL.md`: it fetches the newest Scalable quotes for
every instrument (30-minute points of the last ~6 trading days, 2-hour points of the last month, and after a longer break the
missing daily closes), merges them, rebuilds `data/portfolio-data.js`, runs the tests and reports in a few lines.
Afterwards reload the dashboard (Ctrl+F5).

For Claude: follow `.claude/skills/update-quotes/SKILL.md` exactly (details: `UPDATE_PRICES.md`).
