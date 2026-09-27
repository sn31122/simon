# Verification guide

## Baseline already run during packaging

`BASELINE_TEST_RESULTS.json` records syntax checks, 51 engine tests and 5,441 independent crosschecks of the migration snapshot. `BACKFILL_TRIAL.txt` records a successful merge/test run in a disposable copy (the pending inputs were merged on 27.09.2026).

Run commands from README after integration and after mathematical changes. Python scripts use only the standard library; JavaScript numerical tests use Node built-ins.

## Browser acceptance (27.09.2026)

`tools/acceptance-check.cjs` drives the real page with Playwright (real mouse drags, clicks, keyboard and touch taps, no
programmatic shortcuts) at 1903, 1400 and 375 px: startup and console errors, list toggles and layout, 3M/6M, the section
order, the benchmark-card builder (search, keyboard, validation, duplicate/delete, focus), measurement in both directions
(daily and sub-daily), the Mein Depot box, Startwert scaling, the hover band with 3 benchmarks, the chart interval per range,
touch and overflow. It writes `results.json` and screenshots.

```sh
python3 -m http.server 8770 --bind 127.0.0.1
SEGOE_UI_FALLBACK_DIR=<dir with Selawik TTFs> NODE_PATH=<global node_modules with playwright> \
  node tools/acceptance-check.cjs http://127.0.0.1:8770/dashboard.html artifacts/acceptance
```

Linux containers have no Segoe UI, and the wider fallback font makes the two lists stack at 1903 px. `tools/segoe-fallback.cjs`
therefore injects Selawik (Microsoft, SIL OFL, metric-compatible with Segoe UI; `Selawik_Release.zip` from
github.com/microsoft/Selawik) as "Segoe UI" into the test browser only; the dashboard files are unchanged. Without the variable
the run uses the system font and the side-by-side check fails for that reason alone. Evidence of the final run:
`docs/verification/2026-09-27/`.

## Optional portable browser smoke

The static app needs no npm packages. This optional verification helper uses Playwright only for testing:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
python3 -m http.server 8770 --bind 0.0.0.0
# In another terminal:
node tools/browser-smoke.cjs http://127.0.0.1:8770/dashboard.html artifacts/browser
```

If Linux Chromium reports missing OS dependencies, use the environment's browser tooling or install supported Playwright dependencies according to that environment's permissions. Do not claim browser tests passed if the browser cannot start.

Optional environment variable `BROWSER_EXECUTABLE` selects an installed compatible browser. On Windows it can point to Edge. The helper checks startup, period buttons, list combinations, simple card creation/deletion, page overflow and runtime errors at 1920/1400/375px, and saves screenshots/results. It is a smoke check, not the full acceptance checklist: manually verify realistic search/percentage editing, measurement pointer gestures, math and appearance.

## Interactive and visual checks

Use docs/ACCEPTANCE_CHECKLIST.md, including real pointer/keyboard actions. `window.PFApp` exposes state, update, sync, charts and model for diagnostics. A programmatically pinned measurement alone is not proof that dragging works.

Useful diagnostic call: `PFApp.sync.measureStart(a); PFApp.sync.measureEnd(b); PFApp.sync.flush();`, where indices belong to the currently selected range. Use `#rangeTabs [data-preset="1T"]` for intraday. Hard-reload after generated data changes.

Use desktop 1920 or 1903px, intermediate 1400px, mobile 375px. Capture cards, measurement boxes and lists, not just top-of-page. Record runtime errors and check horizontal overflow. Keep screenshots in ignored artifacts/ while testing; copy only relevant final evidence into docs if desired.

`docs/history/windows-test-helpers/` retains original Edge/CDP helper code as historical evidence. It includes machine-specific paths and is not the cloud entry point. Some helpers collide on ports if run in parallel.

## Packaging browser result — 27 September 2026

The shipped helper passed on local headless Edge at 1920, 1400 and 375px. All four list-toggle combinations had no horizontal overflow; startup, 3M/6M, card creation/deletion and runtime-error checks passed. See BROWSER_SMOKE_RESULTS.json. This limited functional run does not replace the full visual/pointer/keyboard checklist after integration.
