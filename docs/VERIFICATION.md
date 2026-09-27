# Verification guide

## Numerical tests (after every data or math change)

```sh
node --check js/app.js && node --check js/charts.js && node --check js/engine.js
node tests/engine.test.cjs
python3 tests/crosscheck.py && node tests/crosscheck.cjs
```
Python scripts use only the standard library; the JavaScript tests use Node built-ins. `update_prices.py --finish` runs the
tests itself and writes the result into the status block of `HANDOFF.md`.

## Browser acceptance

`tools/acceptance-check.cjs` drives the real page with Playwright (real mouse drags, clicks, keyboard and touch taps, no
programmatic shortcuts) at 1903, 1400 and 375 px: startup and console errors, list toggles and layout, 3M/6M, the section
order, the benchmark-card builder (search, keyboard, validation, duplicate/delete, focus), measurement in both directions,
the Mein Depot box, Startwert scaling, the hover band with 3 benchmarks, the chart interval per range, touch and overflow.
It writes `results.json` and screenshots. Playwright is a test-only tool; the dashboard itself has no dependencies.

```sh
python3 -m http.server 8770 --bind 127.0.0.1
SEGOE_UI_FALLBACK_DIR=<dir with Selawik TTFs> NODE_PATH=<global node_modules with playwright> \
  node tools/acceptance-check.cjs http://127.0.0.1:8770/dashboard.html artifacts/acceptance
```

In Claude Code cloud containers Playwright and Chromium are preinstalled (`NODE_PATH=/opt/node22/lib/node_modules`). Elsewhere:
`npm install --no-save --package-lock=false playwright && npx playwright install chromium`.

Linux has no Segoe UI, and the wider fallback font makes the two lists stack at 1903 px. `tools/segoe-fallback.cjs` therefore
injects Selawik (Microsoft, SIL OFL, metric-compatible with Segoe UI; `Selawik_Release.zip` from github.com/microsoft/Selawik)
as "Segoe UI" into the test browser only; the dashboard files are unchanged. Without the variable the run uses the system font
and the side-by-side check fails for that reason alone. On Windows the variable is not needed.

Evidence of the final run of 27.09.2026 (results + screenshots): `docs/verification/2026-09-27/`.

## Manual checks and diagnostics

After UI changes also look at the page yourself: console errors, desktop and 375 px, drag-to-measure in both directions, the
Gesamtrendite/Portfoliowert toggle, filters incl. empty selection. `window.PFApp` exposes state, update, sync, charts and
model; e.g. `PFApp.sync.measureStart(a); PFApp.sync.measureEnd(b); PFApp.sync.flush();` with indices of the current range.
A programmatically pinned measurement alone is not proof that dragging works. Hard-reload after generated data changes.

`docs/history/windows-test-helpers/` keeps the old Windows helpers (Edge + DevTools protocol, machine-specific paths; they
collide on ports when run in parallel) for local work.
