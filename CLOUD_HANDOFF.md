# Yacht dashboard: complete cloud handoff

Snapshot: **27 September 2026**. Source conversation: **Yacht scalable**, local session `6431a1ba-d884-42f1-93ea-bc0a95bf3595`. This is the current continuation guide. Historical agent reports describe earlier moments in a shared working tree; they do not prove that every reported issue remains.

## Goal and working boundary

Finish the September 27 dashboard changes, integrate four completed stock backfills, and verify the combined result. The user wants to finish in the cloud without the original large conversation or live agents. This is a static portfolio analysis app with German labels, EUR prices and de-DE formatting.

The repository root replaces the original `C:\Users\simon\Downloads\simon\yacht portfolio dashboard permanent`. All runtime files/data are included. Cloud changes do not automatically update that local folder: commit the branch and provide a handback. No original preview server or agent transfers here.

The original session stopped on a Claude usage limit. The benchmark agent stopped during interaction verification after making substantial changes. Measurement/list agents and the two latest Haiku fetch agents produced outputs before the stop. The old HANDOFF claim that nothing remained was stale.

## Snapshot state

| Component | Packaging evidence | Next action |
|---|---|---|
| Static application | Current HTML/CSS/JS/assets copied intact | Continue existing code |
| Financial engine | Syntax passes; 51 engine tests, 5,441 crosschecks pass | Re-run after edits |
| Daily data | 188 dates, 2026-01-02 through 2026-09-25, final; 46 merged series | Merge four staged stocks |
| Instrument catalog | 50 rows, including four not yet merged | Preserve exact ISINs |
| Holdings | 32 Yacht positions; separate nine-holding Mein Depot | Preserve quantities/cost basis |
| Intraday | Generated app contains September 24 and 25 sessions | Preserve through merge |
| Requested funds/ETPs | Memory Chips, USA Momentum, Semiconductor 3x, Nasdaq 3x merged; Nasdaq 2x already existed | Verify search/update universe |
| Four stock backfills | Eight incoming CSVs; successful disposable-copy trial | Run --finish-add |
| Measurement boxes | Implemented; agent reported extensive checks | Verify combined snapshot |
| Lists and 3M/6M | Implemented; agent reported extensive checks | Verify combined snapshot |
| Benchmark cards | Substantial implementation; agent interrupted while testing | Review, finish and verify |
| Documentation | Historical UI descriptions conflict with new requirements | Synchronize after completion |

The pending stock merge was **not applied to the shipped snapshot**. A disposable-copy trial returned exit 0, 50 price series, 4,235 intraday points, 51 engine tests and 5,441 crosschecks passing. See `docs/BACKFILL_TRIAL.txt`. Raw pending inputs are retained for the cloud continuation.

Baseline results: `docs/BASELINE_TEST_RESULTS.json`. The supplied snapshot's full-range backcast printed Yacht EUR 243,947.59 → EUR 553,343.99 (+126.83%) and Mein Depot +8.43%. These are dated calculations from bundled data, not live account valuations or transaction-based returns.

## First actions: pending integration

Read AGENTS.md, run README's baseline checks, then merge. **Do not run --plan or --plan-add first: those clear incoming input.**

```sh
python3 data/update_prices.py --finish-add US19247G1076,US55024U1097,US5949181045,US67066G1040
```

| ISIN | Instrument | State |
|---|---|---|
| US19247G1076 | Coherent | catalog row + incoming/YTD; not merged |
| US55024U1097 | Lumentum Holdings | same |
| US5949181045 | Microsoft | same |
| US67066G1040 | NVIDIA | same |
| US0937121079 | Bloom Energy A | Already a holding and merged series; do not duplicate |

Each pending instrument has `data/incoming/<ISIN>.csv` and `data/incoming/ytd/<ISIN>.csv`. The script validates, merges daily/intraday, archives YTD input, rebuilds the bundle, runs tests, updates HANDOFF's generated data-status block and removes consumed input on success. Do not hand edit generated outputs. Normal updates discover merged columns automatically.

Already integrated requested instruments: FR0010342592 Nasdaq-100 2x; IE00BLRPRL42 WisdomTree Nasdaq-100 3x (user chose this over XS2472197065); LU2023678282 Amundi Global Memory Chips; IE00BD1F4N50 iShares USA Momentum; XS3091657729 WisdomTree PHLX Semiconductor 3x. Use catalog identity rather than ticker guesses.

## Approved UI decisions

### Measurement boxes

Keep Yacht's Scalable-style box. A separate Mein Depot box sits beside it on desktop and stacks on narrow screens. Reserve enough band above the plot to avoid covering chart lines. Only Mein Depot appears in this side measurement box; other benchmarks remain in legend/hover.

- `Gleicher Wert`: Mein Depot return over the measured span × Yacht value at the **span start**. Use `PFEngine.equalValueWindow`; normalized chart-line distance is a different quantity.
- `Echt`: actual fixed-quantity benchmark P/L over the span, scaled by `Mein Depot (€)` relative to the benchmark's current holdings value. Use `benchmarkRealPl` and `benchmarkValueNow`.
- Do not hard-code EUR 298k/298,811; those were illustrative/current values in the prior session. Default comes from data.
- Preserve forward/reverse measurement, click-follow-click, drag-to-pin and Escape, daily and 1T, both chart modes, with/without Mein Depot and Startwert scaling.
- Mobile stacking deliberately reduces plot height. Pinned side-box rows accept pointer events for explanatory tooltips; clicking plot or Escape ends measurement.

Implementation: app.js `measureBox`, `depotBoxHTML`, `measureHTML`, `intraMeasureHTML`; charts.js MainChart `tip2`, `_band`, positioning; `.pc-tip`/`.tt-*` CSS. Full task: `docs/agent-tasks/measurement-boxes.md`.

### Lists and time presets

Add **3M and 6M** to top pills, synchronized with chart tabs/labels. Portfolio on and Einzelwerte off by default. Two independent toggle pills above lists. Both on: Portfolio left (~480px, can shrink), Einzelwerte right, centered beyond the 820px main column. Narrower screens stack; 375px has no horizontal page scroll, with table scrolling inside its card. Both off shows a hint.

Preserve sorting, checkboxes, Alle/Keine, editable Stück what-if inputs, focus/caret, Seit Kauf and intraday sparklines. No persistence.

Final order below settings/cards: **Lists → Benchmark-Vergleich → Drawdown → Monatsrenditen → Kennzahlen → Risiko & Korrelation → Hinweise**. Earlier proposed orders are superseded.

Implementation: `#listToggles`, `#listsRow`, `#holdBlock`, `#assetBlock`, `state.showHold/showAssets`, `layoutLists`, `bindLists`, list CSS. Task: `docs/agent-tasks/list-layout.md`.

### Benchmark card builder

This later decision supersedes the initial chips/dropdown request. Full specification: `docs/agent-tasks/benchmark-builder.md`.

- Below chart settings, wrapping ~300px cards and + Benchmark tile; full width on mobile.
- **Only Mein Depot is a preset**: locked real quantities, initially shown, cannot be deleted/edited, can be hidden. Do not restore archived presets.
- Custom cards: name, distinct color, show/hide, duplicate/delete; instrument + percentage rows with add/remove/clear; percentage total/validation.
- Only valid cards totaling 100% within 0.01 participate. German decimal input; empty means zero; no duplicate instrument in one card.
- Search only instruments with merged prices. Case-insensitive short/full name and ISIN, prefix matches first. Bold short name, muted full name/ISIN/type. Overlay avoids clipping. Support arrows, Enter, Escape, Tab and mouse.
- New card starts with one empty row, focused instrument field. Preserve focus/caret while updating. No storage: reload resets to Mein Depot only.
- Buy percentages at selected-period start and **hold without rebalancing**. For 1T, purchase at previous close.
- Measurement subwindows use the already computed period series (`benchWin`), not a fresh purchase at the subwindow start.
- Keep every consumer consistent: headline legend, main chart, hover, first-visible benchmark metrics, comparison table, monthly table, drawdown/readout and 1T series.
- Omit rebalance options/offset/bands, drag percentage, total-return checkbox, gear, Analyze further, download and custom-card lock controls from the Testfolio reference.

Implementation: app.js `state.cards`, `fixedOn`, `benchDefs`, `cardInfo`, `renderBenchCards`, `bindBench`, search helpers and `benchWin`; `#benchCards`, `#bbDrop`; `.bb-*` CSS. Agent last reported hide/show, row removal, blur commit and duplicate exclusion working, then stopped before finishing copy-card deletion. Re-test the full flow.

## Financial and data contracts

Financial math belongs in `js/engine.js` (`PFEngine`); UI only selects/formats/layouts. SPEC.md describes formulas. Constant quantities are backcast across history; returns are EUR price returns, without distributing dividends/cash or transaction reconstruction. Preserve positions/cost basis.

Forward-fill gaps; before an instrument's first quote it stays flat at that first quote. SpaceX begins 2026-06-12. IE00BF01VY89 has 52 missing daily cells Jan 26–Apr 9; flat filling is deliberate. YTD/1J/MAX are limited to 2026 data. Never fabricate older history.

`E.benchmark(ctx, bench, start, end, baseValue)` and `E.intradayBenchmark(ctx, bench, baseValue)` accept fixed `holdings` or `{id,name,weights:{ISIN:percent}}`. Engine normalizes usable weights; UI enforces 100%. Model shapes: `M.benches/M.selB` entries `{id,b,name,color,s,st,rel,dd,monthly}`; intraday entries `{x,s,dd}`. Real-depot ID is `my_depot`.

Scalable `year_to_date` supplies daily closes; `seven_days` supplies 30-minute data. One-month/one-year sampling cannot replace daily rows. Ignore closingReferencePoint; preserve timestamps/midPrices verbatim in incoming files. Omit portfolioId. Only read-only broker tools.

Known build warnings already reviewed in the source session: Marvell June 2, D-Wave May 21, AT&S June 15, Bloom July 30 and semiconductor 3x June 5. FR0010342592 is already adjusted for the July 9 1:200 split; do not adjust again.

## Agent workflow

The user wanted a concise orchestrator and specialist delegation. Definitions in `.claude/agents/`: `dashboard-designer` (Opus/xhigh), `opus-engineer` (Opus/high), `price-fetcher` (Haiku). Confirm cloud model/settings support; do not silently substitute a model for delegated coding. The thinking-on text is a preserved preference, not proof of a runtime setting.

Haiku only copies prices: up to ten ISINs per normal batch, three per YTD backfill. It writes assigned incoming files and never merges. Orchestrator validates/merges. Delegated non-price tasks use Opus 5.5 high/xhigh where supported.

Original ownership boundaries are in task files; no original agents are running here. If delegating, give disjoint regions and require workers to accommodate concurrent changes. Do not overwrite shared files or revert others. Old Windows helpers should run serially because of port collisions.

Immediate integration requires **no new MCP access**. Do not assume the cloud has the local Scalable connector. If fresh data becomes necessary, ask for that specific access/files and continue offline UI work. Credentials are not included.

## Historical issues to assess

- Full builder acceptance is still open despite syntax/math tests passing.
- Measurement agent noted hover boxes can exceed the reserved band with multiple benchmarks. Test current multi-card behavior; do not claim fixed without evidence.
- Reduced mobile plot height with stacked boxes was approved.
- `.tt-ghost` was reported unused; verify before optional cleanup.
- List agent reported an empty-selection hint pointing to a hidden table. Current renderHeadline already mentions showing the list below; verify rather than blindly reapplying a fix.
- Temporary `benchDefs is not defined`, `_band is not a function`, `cmpItem is not defined` errors occurred during parallel edits; later agents said they were gone. Regression targets, not confirmed current failures.
- SPEC has old simulated/real box, chip, top-pill and section-order text. Update it after integration.

## Verification and handback

Use docs/VERIFICATION.md and docs/ACCEPTANCE_CHECKLIST.md. Distinguish new verification from historical reports. Numerical tests do not certify visual layout, keyboard search or pointer behavior.

Completion requires all requested behavior; four new stocks selectable and included in update universe; tests passing; desktop 1920/1903, 1400 and mobile 375 browser checks; accurate docs; committed branch and concise handback including any blocked checks. Keep repo private; public deployment needs a new user request.

## Evidence and exclusions

- `docs/REQUIREMENTS_SOURCE.md`: user requests/answers.
- `docs/agent-tasks/`: full important dispatch specifications.
- `docs/AGENT_REPORTS.md`: original completion/failure reports.
- `docs/references/`: available latest user images and selected historical captures, not newly verified screenshots.
- `docs/history/`: original docs and Windows-specific browser helpers.
- `docs/SOURCE_SNAPSHOT.json`: copied-file hashes before migration doc changes.

Excluded: raw 26MB transcript, unrelated Downloads files, credentials/local settings, node_modules/caches, whole-folder backups and bulky logo-production tooling. Finished company PNGs are included. Omitted tooling is not required to render or run numerical tests.

## Launch in cloud

Open https://claude.ai/code or Desktop Code → Cloud, select **sn31122/simon**, branch **cloud-handoff-2026-09-27**, then paste CLOUD_PROMPT.md. If missing from the selector, grant the Claude GitHub App access to this repository.

Official reference checked 27 September 2026: https://code.claude.com/docs/en/claude-code-on-the-web . A new session with this committed handoff suffices; no live-agent migration needed. Cloud work still uses the account's Claude allowance.

## Git destination and packaging browser verification

Repository: https://github.com/sn31122/simon (verified private). The handoff branch is based on main commit 27817c1. main originally contained only a README, archived in docs/history/REPOSITORY_README.md. The existing yacht-real-pnl branch is a different snapshot and is untouched. Start this continuation from cloud-handoff-2026-09-27.

Packaging browser smoke passed in headless Edge at 1920, 1400 and 375px, with no runtime errors or horizontal overflow across all list-toggle combinations. It also checked 3M/6M and card create/delete. Evidence: docs/BROWSER_SMOKE_RESULTS.json. Full acceptance remains outstanding.
