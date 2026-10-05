# Yacht portfolio dashboard

Private repository **sn31122/simon**. An offline dashboard (`dashboard.html`) comparing the Yacht portfolio, the real
Scalable depot and benchmark baskets. Plain HTML/CSS/JS with bundled data – no build step, no packages.

- **Always the latest `main`:** double-click `tools/yacht-live.bat` (Windows) or `tools/yacht-live.command` (Mac); it keeps
  its own copy in `yacht-live-main` and reopens the page when `main` changes. Never edit files in that folder.
- **From a checkout:** open `dashboard.html` directly.

What you can say to the agent: **"update"** (new Scalable prices + depot snapshot, Claude Code only), **"update depot"**,
**"add benchmark asdf: microsoft 30 nvidia 40 palantir 30"** / "change …" / "remove …", **"import transactions"**, then
**"merge"**. Rules for agents: `AGENTS.md`.
