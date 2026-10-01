# Local Mac setup – handoff for a local Claude Code session

Goal (user 30.09.2026): on the Mac, one file on the Desktop that opens the dashboard straight from GitHub `main`
(`tools/yacht-live.command`), plus a working local Claude Code setup so "update" (Kurse aktualisieren) also works there.
The file only opens the dashboard; price updates stay a Claude Code command.

## You (the user) – three steps
1. Open **Terminal** (Cmd+Space, type `Terminal`, Enter).
2. Install Claude Code, then close and reopen Terminal:
   ```sh
   curl -fsSL https://claude.ai/install.sh | bash
   ```
3. Get the repo and start Claude Code in it (if macOS offers to install the "command line developer tools", click
   Install, wait, then run the line again):
   ```sh
   git clone https://github.com/sn31122/simon ~/simon && cd ~/simon && claude
   ```
   Log in with your claude.ai account when asked, then paste this into Claude Code:

   > Read `docs/LOCAL_MAC.md` and do the section "Local session: setup checklist" completely.

## Local session: setup checklist
Work in `~/simon` (this clone). Never work in `~/yacht-live-main`: the launcher hard-resets that folder to `origin/main`
every 60 s, so anything there is lost. Explain each install before running it; the user may be asked for their Mac
password (Homebrew, installers). Tick each step off to the user in one line; stop and ask if anything is unclear.

1. **Tools** – check `git --version`, `node --version` (≥ 18), `python3 --version` (≥ 3.9), `claude --version`
   (≥ 2.1.284, needed for Claude Sonnet 5.5 in `price-fetcher`; else `claude update`).
   Missing Node or Python: install Homebrew if absent (`/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`,
   then add it to the PATH as its output says), then `brew install node python`.
   Node must be on the PATH that Claude Code sees: the price hook `.claude/hooks/save-chart.cjs` runs as `node`.
2. **GitHub login** (for pushing prices): if `git push --dry-run` asks for credentials, `brew install gh`,
   `gh auth login` (GitHub.com, HTTPS, browser), `gh auth setup-git`. Also set the commit author if unset:
   `git config --global user.name` / `user.email` (ask the user).
3. **Tests** – `node tests/engine.test.cjs`, then `python3 tests/crosscheck.py && node tests/crosscheck.cjs`
   (one known 1M_h2 mismatch of a few € while the last row is intraday is pre-existing, see HANDOFF.md).
4. **Scalable connector** – run `/mcp`: a Scalable Capital server must be connected (it comes from the user's
   claude.ai connectors). If missing, tell the user to add it under claude.ai → Settings → Connectors, restart
   `claude`, check again. Read-only tools only (AGENTS.md).
5. **Hook** – `/hooks` must list the PostToolUse hook for `get_security_chart`. If not, restart `claude` once.
6. **Launcher file** – copy it to the Desktop and make it runnable:
   ```sh
   cp tools/yacht-live.command ~/Desktop/ && chmod +x ~/Desktop/yacht-live.command \
     && xattr -d com.apple.quarantine ~/Desktop/yacht-live.command 2>/dev/null; true
   open ~/Desktop/yacht-live.command
   ```
   A Terminal window opens, clones `~/yacht-live-main` on first run and opens `dashboard.html` in the browser.
   Ask the user to confirm the page shows prices and a chart; that window has to stay open for live refresh.
7. **Trial update** – run the skill `update-quotes` (the same as the user typing "update"). Every `price-fetcher`
   must answer `SAVED n of m`; `HOOK NOT ACTIVE` → back to steps 1 and 5. After `--finish`, commit on a new branch
   `local/update-<date>`, push, open a pull request to `main` and, if the user agrees, merge it. The launcher window
   then picks up the new version within 60 s (reload with Cmd+Shift+R).
8. **Finish** – add one line under "Access" in `HANDOFF.md` ("Mac local setup done <date>: …", anything that
   differed from this checklist), commit it with the update, and tell the user in 3 lines:
   - double-click `yacht-live` on the Desktop = dashboard (always the latest `main`);
   - new prices: `cd ~/simon && claude`, then type `update`;
   - start each local session with `git pull` so it works on the latest `main`.
