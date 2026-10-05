# Yacht portfolio dashboard

Private repository **sn31122/simon**. An offline dashboard (`dashboard.html`) comparing the Yacht portfolio, the real
Scalable depot and benchmark baskets. Plain HTML/CSS/JS with bundled data – no build step, no packages.

- **Always the latest version:** double-click `tools/yacht-live.bat` (Windows) or `tools/yacht-live.command` (Mac) in your
  downloaded repo. It updates that same folder from GitHub (fast-forward of the checked-out branch, only without local
  changes, never overwrites anything), opens its `dashboard.html` and reopens it when GitHub has a newer version. No second
  copy anywhere. A ZIP download (no `.git`) or a computer without Git just opens the page.
- **From a checkout:** open `dashboard.html` directly.

**Self-contained:** the folder holds everything the page needs (data, scripts, styles, logos); no internet, no server,
relative paths only. `python tools/check.py` checks it (section `portable`) along with git, tools, data and tests.

## Setup (once per computer)
| | Windows PC | MacBook (2013 Air, macOS Ventura 13) |
|---|---|---|
| Browser | Edge / Chrome / Firefox | Safari, Chrome or Firefox (Safari 16 or newer) |
| Live view | Git for Windows | Command Line Tools (`xcode-select --install`, offered by the launcher) |
| Python (scripts) | Python 3 from python.org, command `python` | the Command Line Tools' `python3` (3.9); **there is no `python` on the Mac – always type `python3`** |
| Node (tests, Claude hooks) | Node LTS | Node LTS (Node 24 needs Ventura 13.5 or newer, else Node 22) |
| Checkout for agents | `%USERPROFILE%\simon` | `~/simon` |

What you can say to the agent: **"update"** (new Scalable prices + depot snapshot, Claude Code only), **"update depot"**,
**"add benchmark asdf: microsoft 30 nvidia 40 palantir 30"** / "change …" / "remove …", **"import transactions"**, then
**"merge"**. Rules for agents: `AGENTS.md`.
