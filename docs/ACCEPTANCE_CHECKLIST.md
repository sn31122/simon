# Completion checklist

Mark each item with observed evidence in the final handoff. A historical agent claim is not a new pass.

## Data and numerical correctness

- [ ] Run the four-ISIN --finish-add command before any planning command clears incoming input.
- [ ] 50 merged price series; all four new stocks appear in D.instruments/search; Bloom is not duplicated.
- [ ] Final row remains 2026-09-25 final; 188 daily rows; intraday September 24/25 display correctly.
- [ ] Catalog and merged columns agree; future normal update discovers all 50. Inspect rather than running destructive --plan just to check.
- [ ] 51 engine tests and 5,441 crosschecks pass (or explain any deliberate new test count).
- [ ] app.js/charts.js/engine.js syntax passes; no manual edits to generated data or source holdings.
- [ ] Preserve fixed-quantity backcast, gap rules, split handling, buy-and-hold weighted benchmarks and correct span calculations.

## Benchmark cards

- [ ] Initially only locked Mein Depot; show/hide works; cannot edit/delete it.
- [ ] New custom card focuses an empty instrument field; name/percent edits retain focus/caret.
- [ ] Search by short name/full name/ISIN; prefix ordering; dropdown outside card clipping.
- [ ] Arrow keys, Enter, Escape, Tab, mouse selection and exact-ISIN blur behave correctly.
- [ ] Duplicate instruments excluded within a card; same instrument can appear in separate cards.
- [ ] German decimals, empty/negative/invalid input, missing instrument, 99/100/101% and tolerance boundaries behave correctly.
- [ ] Invalid cards excluded consistently from every chart/table/metric.
- [ ] Add/remove/clear rows; rename; duplicate; delete; show/hide; focus after structural edits.
- [ ] Custom weights buy at period start; 1T uses previous close; no daily rebalance or subwindow rebuy.
- [ ] Legend, hover, main/drawdown charts, first-visible comparison, monthly and benchmark tables agree.
- [ ] Reload resets all custom cards and selections as intended; no local persistence introduced.

## Measurements and charts

- [ ] YTD and 1T; forward/reverse; click-follow-click and real pointer drag-to-pin; Escape/hover restoration.
- [ ] Portfoliowert and Gesamtrendite; Startwert empty/10,000/1,000,000; Mein Depot shown/hidden.
- [ ] Gleicher Wert uses Yacht capital at span start; Echt uses actual depot quantities and field scaling.
- [ ] Changing Mein Depot (€) updates an already-open box; no hard-coded 298k amount.
- [ ] Desktop left/right edge spans and full-range span do not clip/cover plot lines.
- [ ] Mobile boxes stack; no missing/NaN/undefined values; only Mein Depot in side measurement.
- [ ] Multiple benchmark hover behavior assessed; preserve synchronized drawdown hover and pad alignment.

## Lists, layout and regression

- [ ] Top 3M/6M pills and chart tabs update each other, labels and holdings; other periods/Seit Kauf still work.
- [ ] Portfolio on/Einzelwerte off default; all four toggle combinations; both-off hint.
- [ ] Both lists fit side by side at 1903/1920px; stack at 1400/375; resize switches correctly.
- [ ] No horizontal page overflow at 375; table scrolls internally and sticky name column works.
- [ ] Sorting, selection, Alle/Keine, quantity what-if/reset, hidden-list refresh and focus preservation.
- [ ] Empty-selection hint is actionable when Einzelwerte is hidden.
- [ ] Correct order: lists, Benchmark-Vergleich, Drawdown, Monatsrenditen, Kennzahlen, Risiko, Hinweise.
- [ ] No runtime errors and no visible NaN/undefined; financial missing values displayed deliberately.

## Documentation and handback

- [ ] SPEC/HANDOFF accurately describe current cards, boxes, presets and ordering.
- [ ] Updated screenshots and test results, with viewport and tested actions recorded.
- [ ] Commit working branch; give user summary, branch/commit, remaining issues and any blocked checks.
- [ ] Keep private repository; no public deployment or broker writes.
