# Yacht-Portfolio Dashboard – Spec (v1, 2026-09-25)

Offline portfolio visualizer. Open `dashboard.html` directly from disk (file://) or via `python -m http.server`.
**Hard constraints:** vanilla HTML/CSS/JS, no libraries, no CDN, no build step, no ES modules (classic `<script src>` only, so file:// works), no network requests, no localStorage persistence of selections. UI language German, German number/date formats. Dark theme only.

## Files and ownership

| File | Owner | Content |
|---|---|---|
| `data/portfolio-data.js` | generated (`python data/build_data.py`) | sets `window.PORTFOLIO_DATA` (see Data contract). Never edit by hand. |
| `js/engine.js` | engine agent | all calculations + formatters, global `PFEngine` (also `module.exports` in Node) |
| `tests/engine.test.cjs` | engine agent | `node tests/engine.test.cjs` – unit tests (synthetic) + real-data smoke test |
| `dashboard.html`, `css/dashboard.css`, `js/charts.js`, `js/app.js` | UI agent | markup, styling, SVG charts, state + rendering. **No financial math in UI files** – call `PFEngine`. |

Load order in `dashboard.html`: `data/portfolio-data.js`, `js/engine.js`, `js/charts.js`, `js/app.js`.

## Data contract (`window.PORTFOLIO_DATA`)

```js
{
  meta: { title, currency: "EUR", source, generated_at, first_date: "2026-01-02", last_date: "2026-09-25",
          last_status: "intraday" | "final", last_asof_utc: "2026-09-25T09:20Z" | "", positions_ref_date, notes: [string] },
  dates:  ["2026-01-02", ...],          // ascending trading days (Europe/Berlin), length n (~188)
  status: ["final", ..., "intraday"],   // per date; only the last one can be "intraday"
  groups: ["ETFs", "20 Jahre plus Long Long Term", ...],   // display order
  positions: [{ isin, name, short, group, shares, ref_date, ref_price, gv_ref, cost_basis, note, first_date }],
  benchmarks: [{ id, name, description, holdings: { ISIN: quantity, ... } }],  // presets (benchmarks.csv): only my_depot since 27.09.
  instruments: [{ isin, name, short, type: "Aktie"|"ETF"|"ETC"|"ETP", position: bool }],  // every price column, sorted by short
  prices: { ISIN: [number|null, ...] }, // every price column, aligned with dates; null = no quote that day (e.g. before listing)
  intraday: { dates, times, asof_utc, px: { ISIN: [...] } } | null         // 30-min grid of the last 2 sessions (1T)
}
```
Real data: 32 positions (~556k EUR), 46 instruments (positions + 14 other ETFs/ETPs/stocks, see `data/instruments.csv`), 1 preset benchmark my_depot (real Scalable depot, Stückzahlen 25.09.2026), 2026-01-02..2026-09-25. SpaceX (US84615Q1031) has quotes only from 2026-06-12.

## Engine API (`js/engine.js`, global `PFEngine`)

UMD wrapper: `(function(root){ ... if (typeof module!=='undefined' && module.exports) module.exports = PFEngine; else root.PFEngine = PFEngine; })(typeof window!=='undefined'?window:globalThis);`
Pure functions, no DOM. Index arguments are indices into `data.dates`. Series objects are plain arrays. Never return NaN/Infinity: return `null` for undefined metrics.

- `prepare(data) -> ctx` : `{ data, dates, n, status, positions, benchmarks, groups, px: {ISIN: number[] filled}, firstIdx: {ISIN: int}, lastIdx: n-1 }`.
  Fill rule: forward-fill gaps with the last quote; before the first quote use the first quote (flat, zero return).
- `presetRange(ctx, preset) -> {start, end}` for `'1T','1W','1M','3M','6M','YTD','1J','MAX'`. `end = n-1`. `1T`: start = end-1.
  `1W/1M/3M/6M/1J`: start = last index whose date <= (date[end] minus 7 days / 1 / 3 / 6 / 12 calendar months; day-of-month clamped); if none, 0.
  `YTD`: first index with the year of date[end] (data has no 2025 close, so YTD starts at the 02.01. close). `MAX`: 0.
- `customRange(ctx, fromISO, toISO) -> {start, end} | null` : start = first index with date >= from, end = last index with date <= to; null if end - start < 1.
- `portfolio(ctx, {selected, start, end, startValue}) -> series | null` (null if nothing selected).
  `selected`: array or Set of position ISINs. raw_k = Σ shares_i · px_i[k]. `scale = startValue>0 ? startValue/raw[0] : 1`.
  Returns `{ start, end, dates: [...], idx: [...], raw: [...], scale, value: raw·scale, pl: value - value[0], ret: [value[k]/value[k-1]-1] (length m-1), startValue: value[0] }`.
- `benchmark(ctx, bench, start, end, baseValue) -> series` : same shape (`id`, `name` added); raw = Σ q·px; `value = baseValue · raw/raw[0]`, `pl = value - baseValue`.
  `bench` = `{ holdings: {ISIN: qty} }` (fixed quantities, e.g. my_depot) or `{ weights: {ISIN: % or fraction} }` (benchmark card): weights > 0 of ISINs with prices are normalized to Σ = 1 and bought at `start` (q_i = w_i / px_i[start]), then held – buy and hold, no rebalancing (user, 27.09.); `null` if no valid weight is left. `intradayBenchmark(ctx, bench, baseValue)` buys a weights card at the previous close (the 1T start).
- `equalValueWindow(portfolioValues, benchValues, a, b) -> { base, ret, pl } | null` ("Gleicher Wert" in the measure box): base = portfolio value at min(a, b), ret = benchmark return over the span, pl = base · ret. `benchmarkRealPl(ctx, bench, a, b, {target, intraday})` = real € change of a holdings benchmark × target / `benchmarkValueNow` ("Echt").
- `drawdown(values) -> { dd: [...], maxDD, peak, trough, recovery, current }` : dd_k = v_k / max(v_0..v_k) - 1 (<= 0). maxDD = min dd (0 if none). peak = index of the running max at the trough, trough = argmin (first), recovery = first k > trough with v_k >= v_peak, else null. current = dd_last. Indices relative to the series.
- `stats(series, {rf}) -> {...}` (rf = annual risk-free rate, decimal, default 0.02; rf_d = (1+rf)^(1/252) - 1; r = series.ret, n = r.length):
  `startValue, endValue, pl, totalReturn = end/start - 1, days` (calendar days first->last date),
  `cagr = (1+TR)^(365/days) - 1` (null if days = 0), `cagrReliable = days >= 90`,
  `volAnn = sd(r)·√252` (sample sd, n-1; null if n < 2), `sharpe = mean(r - rf_d)/sd(r)·√252`,
  `sortino = mean(r - rf_d) / sqrt(Σ min(0, r - rf_d)² / n) · √252`,
  `maxDD, maxDDPeakDate, maxDDTroughDate, maxDDRecoveryDate (null = not recovered), currentDD` (from drawdown(value)),
  `calmar = cagr/|maxDD|` (null if maxDD = 0), `bestDay: {ret, date}, worstDay: {ret, date}, pctPositive = #(r>0)/n`,
  `var95 = -q05(r)` (historical 1-day, quantile with linear interpolation like numpy default: h=(n-1)·p), `cvar95 = -mean(r | r <= q05)`,
  `var95EUR = var95·endValue, cvar95EUR = cvar95·endValue`.
- `relative(pSeries, bSeries, {rf}) -> { beta, alpha, corr, r2, trackingError, infoRatio, excessReturn, upCapture, downCapture }` (portfolio vs benchmark, same index range):
  beta = cov(rp,rb)/var(rb); corr = cov/(sd_p·sd_b); r2 = corr²; alpha = (mean(rp-rf_d) - beta·mean(rb-rf_d))·252;
  trackingError = sd(rp-rb)·√252; infoRatio = mean(rp-rb)·252/trackingError; excessReturn = TR_p - TR_b;
  upCapture = mean(rp | rb>0)/mean(rb | rb>0); downCapture = mean(rp | rb<0)/mean(rb | rb<0).
- `monthly(ctx, values) -> [{ month: "2026-01", ret, partial }]` : `values` = full-length series (index 0..n-1). Month return = last value of the month / last value of the previous month - 1; the first month is anchored at values[0] (partial: true); the last month is partial if its last date is the last data date and status is intraday or the month is the current month of last_date.
- `assets(ctx, {selected, start, end, scale}) -> [ ... ]` : one row for EVERY position (selected or not):
  `{ isin, name, short, group, selected, shares, sharesScaled = shares·scale, p0 = px[start], p1 = px[end], v0, v1 (·scale), ret = p1/p0 - 1, pl = v1 - v0,
     contrib = pl / V0 (V0 = scaled start value of the selected set; null if not selected), w0 = v0/V0, w1 = v1/V1 (null if not selected),
     vol, maxDD (on px over the range), listedAfterStart = firstIdx > start, firstDate, costBasis, glSinceBuy = shares·px[n-1] - cost_basis, glSinceBuyPct = glSinceBuy/cost_basis, spark: px[start..end] }`.
  Σ contrib over selected = portfolio totalReturn (buy-and-hold identity – test this).
- `groupSummary(ctx, assetsRows) -> [{ group, n, nSelected, v0, v1, pl, ret, contrib, w1 }]` in `ctx.groups` order, sums over selected rows only (ret null if nothing selected in the group).
- `withShares(ctx, overrides) -> ctx'` (what-if): `overrides = {ISIN: shares >= 0}`. Returns a new ctx that shares prices/dates with the original; positions are cloned with the new shares and `cost_basis` scaled proportionally (average cost unchanged; 0 shares -> 0). Adds `whatIf: {ISIN: {from, to}}` (changed ones only) and `base` (the original ctx). Every function must treat a selection whose start value is 0 (e.g. all selected shares 0) like an empty selection (null), never NaN.
- `correlationMatrix(ctx, {isins, start, end}) -> { isins, m, n }` : Pearson correlation (sample) of daily returns over (start, end]. Pairwise: return k counts for instrument i only if k-1 >= firstIdx_i (real quotes only, so e.g. SpaceX's flat pre-listing days are excluded); `n[a][b]` = number of overlapping returns; diagonal 1; `null` if n < 3 or zero variance.
- `riskContribution(ctx, {selected, start, end}) -> { volAnn, diversificationRatio, rows: [{ isin, weight, vol, mctr, ctr, pctr }] } | null` : weights w = current weights at `end` among the selected positions (v_i(end)/V(end)); Σ = sample covariance of the FILLED daily returns over (start, end] (same fill rule as the portfolio series); volAnn = sqrt(wᵀΣw·252); mctr_i = (Σw)_i / sqrt(wᵀΣw) · √252; ctr_i = w_i·mctr_i; pctr_i = ctr_i / volAnn (Σ pctr = 1); vol_i = sqrt(Σ_ii·252); diversificationRatio = Σ w_i·vol_i / volAnn. Rows = selected positions in ctx.positions order. null if nothing selected, V(end) = 0 or volAnn = 0.
- `fmt` (Intl `de-DE`; null/NaN -> "–"):
  `eur(x, {sign=false, dec=2})` "260.800,05 €" / "+3.982,60 €"; `num(x, dec=2, sign=false)`; `pct(x, {sign=true, dec=2})` input is a fraction: 0.1798 -> "+17,98 %";
  `ratio(x)` 2 decimals; `date(iso, 'long'|'short'|'month'|'monthYear'|'dayMonthShort')` -> "21. Apr. 2026" | "21.04.2026" | "Apr." | "Apr. 2026" | "21.04.";
  `asofBerlin(isoUtc)` -> "11:20" (Europe/Berlin via Intl timeZone); `parseDE(str)` -> number|null accepts "100.000", "100000", "100.000,50", "1,5".

Tests (`tests/engine.test.cjs`, plain `assert`, no deps): synthetic series with hand-computed expectations for every function above (incl. forward/back-fill, presets across month ends, drawdown recovery/no recovery, VaR interpolation, capture ratios, scale invariance of %-metrics, contrib identity, empty selection -> null, no NaN anywhere), plus a real-data smoke test that loads `data/portfolio-data.js` and prints full-range TR, CAGR, vol, Sharpe, maxDD for all positions and each benchmark.

## UI (`dashboard.html` + `css/dashboard.css` + `js/charts.js` + `js/app.js`)

### Design tokens (taken from the broker-app screenshots; do NOT copy any brand name/logo)
```
EXACT app colors measured by the user: --bg #101112 (16,17,18); --accent #28ebcf (40,235,207); --neg #e78e78 (231,142,120).
--panel/--card/--border/--grid: a few steps lighter than --bg (flat look);
--text #f2f3f4; --muted #9aa0a6; --axis #cfd2d4 (axis labels: 11px, font-weight 600);
--accent (teal: portfolio line, active tab + 2px underline, toggle active bg, positive numbers);
--accent-ink #0c1f1b (text on teal); --accent-soft rgba(40,235,207,.10) (measured region); --neg (negative numbers, drawdown, below-baseline segments);
--line-muted #8c9196 (portfolio line while measuring); --tooltip #2c2f33 (border #3a3e42, radius 4px);
font: Inter, "Segoe UI", system-ui, -apple-system, Roboto, sans-serif; numbers: font-variant-numeric: tabular-nums.
benchmark colors in order: #6ea8ff #f5b041 #b39ddb #f48fb1 #aed581 #ff8a65 #cfd8dc #fff176
```
Look: flat dark page, no heavy boxes around the main chart; cards/tables below use --card with 1px --border, radius 10px.

### Layout (top to bottom, 820px content column like the app at 1920×1080 = max-width 868px incl. 24px padding, 16px side padding on mobile)
Order (user, 25.09.): sticky header bar with pills → overview block → chart (range tabs + toggle, headline, chart) → settings row → drawdown → holdings list → analysis sections.
1. **Sticky header bar** (like the app's bar that the page scrolls under): full window width, --bg background, `position: sticky; top: 0` (`.topbar` outside `.page`); title (meta.title) + meta line left (one line with ellipsis on phones), right: the **period pills** `1T 1W 1M YTD 1J Seit Kauf` like the app's Überblick. The what-if banner lives inside this bar.
   **One period for everything** (user, 25.09.): pills and chart tabs (2) are the same switch – state `preset` / `custom` / `sinceBuy`. Pill = tab for 1T/1W/1M/YTD/1J; tabs 3M/6M/MAX leave no pill active; "Seit Kauf" shows the chart at MAX (MAX tab active) and the value block / list vs. Einstand; a custom Von/Bis range leaves no pill and no tab active (markers fade out, .3s, like unselected ones). Default YTD.
1b. **Overview block** (app Überblick): big value "556.394¹³ €" (54px, decimals + € stacked at 22px) = value of the selection at the end of the period, below "+9.159,74 € Heute ⓘ" – change over the selected period (labels Heute / Woche / Monat / 3 Monate / 6 Monate / seit 02.01. / 1 Jahr / seit 02.01.2026 (MAX) / seit Kauf / custom "10.08.–18.09.2026"), € only; % and explanation in the ⓘ tooltip. No sparkline (removed on user request 25.09.).
2. **Range bar** (like the app's Insights): tabs `1T 1W 1M 3M 6M YTD 1J MAX` (14px, ~47.5px each; active = teal text + 2px teal underline). Right side: pill toggle **Gesamtrendite | Portfoliowert**.
3. **Settings row** (below the chart): custom range "Von"/"Bis" as own TT.MM.JJJJ fields (three segments; clicking any segment selects it, typed digits replace it and jump day → month → year; ".", arrows, ↑/↓, Backspace, paste "15.03.2026", calendar button opens the native picker; applied only when the year is complete / Enter / focus leaves; incomplete → reverted, impossible date → hint; editing switches to custom, tabs lose active state) · "Startwert (€)" (placeholder = actual start value; empty = real value; "×0,54 skaliert" hint; reset button) · "Risikofreier Zins" % (default 2,0) · **benchmark chips** (multi-select, default MSCI World, show the benchmark's range return).
4. **Headline** (small like the app, 16px bold): Portfoliowert mode: end value + below "+92.957,95 € (+20,05 %) im Zeitraum …". Gesamtrendite mode: P/L teal/red + % below. Legend row: portfolio + each selected benchmark with color and range return.
5. **Main chart** (SVG ~490px high incl. an ~80px tooltip band on top and x labels, full width, re-render on resize):
   - Portfoliowert mode: y = value (scaled); dashed baseline (#8c9196, dasharray 3 3) at the start value. Gesamtrendite mode: y = pl; dashed baseline at 0. Benchmarks: normalized to the portfolio start value (value) / their pl (Gesamtrendite), 1.5px lines, no fill.
   - Portfolio as in the app: 2px line teal above the baseline and **red (--neg) below** (split exactly at the crossings); area gradient from the line to the baseline, teal .35 → 0 above, red .35 → 0 below. Last-value box at the right edge teal, red when below the baseline, dotted link from the last point.
   - Y labels right-aligned at the right edge just above each grid line (4 nice ticks, always 2 decimals like the app: "40.000,00"). X labels: month abbreviations for ranges ≥ 45 points; shorter ranges like the app: day number at the first trading day of each week ("24", "31", "7. Sept.", "14", "21" – month name where the month changes), every day for ≤ 8 points. X spacing by trading-day index.
   - **Hover**: vertical dotted line, hollow circle on the portfolio line (small dots on benchmark lines), tooltip at the top like the app: date "08.09.2026" (intraday: "25.09.2026, 11:20 (intraday)") + value (Gesamtrendite: teal/red by sign); selected benchmarks / what-if original as small rows below.
   - **Click-to-measure** (user, 25.09., app screenshot): click sets the start point, the end follows the pointer (live measurement box), the next click ends it (Esc too). While active, dragging moves the end point (touch: tap = start/end, drag = move the end).
   - **Drag-to-measure** (press → move → release) still works and stays pinned after release, with the button "Zeitraum auf Auswahl setzen" under the chart; click or Esc clears it.
   - Measurement look (both modes): portfolio line turns --line-muted, region between A and B shaded --accent-soft, two vertical dotted white lines with hollow white circles on the portfolio line, tooltip box on top spanning the two lines: left date / value, center delta (teal/red) with "+17,98 % · 57 Handelstage" and each selected benchmark's % over A..B, right date / value. Values in the active mode. Works right-to-left too.
   - **Mein Depot simuliert / echt** (user, 26.09.): in the measure box the my_depot benchmark carries the label "simuliert" (its € = the benchmark line, normalized to the portfolio start); below it "(echt +… €)" = real € change of its holdings (`PFEngine.benchmarkRealPl`, daily or intraday) × (field "Mein Depot (€)" ÷ `benchmarkValueNow`). The field defaults to the holdings value (no cash) and changes nothing else.
   - Empty selection: show "Keine Position ausgewählt" and render no series (no NaN).
   - **1T intraday** (user, 25.09., app screenshot): when `data.intraday` ends on the last daily date, 1T shows the 30-min grid of the last two sessions (`PFEngine.intraday` / `intradayBenchmark` / `intradayAsset` / `intradayWindow`): the earlier session as a grey context line, today teal/red against the previous close with area, dashed baseline only under today, rest of the day empty (x spans the full 07:30–23:00 session), value box at the last point. X labels "Gestern · 15:15 · Heute · 15:15" ("Heute"/"Gestern" by Berlin calendar date, otherwise the weekday); tooltip "Gestern, 20:00" + value; measure box with slot labels and "2 Std. 30 Min." / "über Nacht"; no "Zeitraum auf Auswahl setzen". Drawdown chart and holdings-list sparklines (1T) use the same grid; headline note "30-Minuten-Kurse bis 14:07 Uhr". KPIs/tables stay daily (2 points).
6. **Drawdown chart** (SVG ~150px, same x-scale, synced hover line): red area (--neg, gradient .45 -> .05) from 0 down; selected benchmarks' drawdowns as thin lines; y labels in % (0 %, −10 %, …); marker + label at max drawdown ("Max. −23,41 % am 12.03.2026"). Shade the measured region too when a measurement is pinned.
6b. **Portfolio-Liste** (overview list like the app's holdings screen, under the drawdown chart, one flat list, no groups): period = the shared period (1) incl. custom ranges and 3M/6M/MAX.
   - Header: "Portfolio" + "⋮" sort menu and the total value in grey below (like the app); the big value / period change / mini chart moved to the overview block (1b). Sort menu ("SORTIEREN NACH": Name (A-Z), Name (Z-A), Niedrigste Rendite, Höchste Rendite, Kleinste Position, Größte Position (default); Rendite = period return), total current value with superscript decimals, below it the period gain/loss "+19.574,90 € (+8,13 %) Monat ⓘ" (labels Tag/Woche/Monat/3 Monate/6 Monate/seit 02.01./1 Jahr (Daten ab 02.01.2026)/seit Kauf), mini portfolio chart on the right (teal above / red below the period start).
   - Rows: round company logo (`positions[].logo`, PNG from `company-logos/`, circle-cropped; initials avatar as fallback), name + current position value, sparkline over the period (dashed baseline at the period start, teal above / red below; 1T: grey ~21-day context + colored last segment), period % (+ € change small), current price with superscript decimals ("311⁷⁸").
   - Data: `presetRange` + `portfolio(startValue null)` + `assets(scale 1)`; "Seit Kauf" = `glSinceBuy`/`glSinceBuyPct` (header: Σ glSinceBuy / Σ costBasis). Real EUR (no Startwert scaling); unselected rows dimmed and excluded from totals.
7. **Kennzahlen** (card grid, 2–4 columns responsive): Gesamtrendite (EUR + %), Rendite p.a. (greyed + "wenig aussagekräftig < 3 Monate" if !cagrReliable), Volatilität p.a., Sharpe, Sortino, Max. Drawdown (+ peak→trough dates, recovery date or "nicht erholt"), Calmar, VaR 95 % (1 Tag, % and €), CVaR 95 %, Bester Tag / Schlechtester Tag (with date), Positive Tage, Aktueller Drawdown. Each card: sub-line with the FIRST selected benchmark's value. Card `title` attribute = short formula.
8. **Benchmark-Vergleich** table: rows Portfolio + each selected benchmark. Columns: Rendite, p.a., Vol. p.a., Sharpe, Sortino, Max. DD, then portfolio-vs-this-benchmark: Beta, Korrelation, Alpha p.a., Tracking Error, Info-Ratio, Up-/Down-Capture, Mehrrendite (portfolio row shows "–" there).
9. **Monatsrenditen** table: rows Portfolio + selected benchmarks, columns = months of the FULL data (engine.monthly on full series with current position filter), cells tinted teal/red by sign and magnitude, partial months marked (e.g. "Jan.*", "Sept.*" + footnote "* Teilmonat").
10. **Gruppen** table (engine.groupSummary): checkbox per group = toggle all its positions (indeterminate state when partial), Positionen (x/y), Wert Ende, Gewicht, Rendite, G/V €, Beitrag.
11. **Einzelwerte** table (engine.assets): checkbox per row (= position filter), Name (short bold + full name small + group tag; badge "ab 12.06." if listedAfterStart), Stück, Kurs Start, Kurs Ende, Wert Ende, Gewicht, Rendite, G/V €, Beitrag (%-points with a small inline bar, teal/red), Vol. p.a., Max. DD, Sparkline (inline SVG 80×22 of px over the range), G/V seit Kauf (€ and %; header tooltip: "gegenüber Einstand, letzter Kurs, unabhängig vom Zeitraum"). Sortable by clicking headers (default: Beitrag desc). Buttons "Alle" / "Keine". Unselected rows stay visible, dimmed (opacity .45), still show their own return. Totals row for the selection.
11b. **Was-wäre-wenn** (user-approved extra): toggle button "Was-wäre-wenn" in the Einzelwerte header turns the Stück cells into inputs (fmt.parseDE, >= 0, 0 = verkauft; optionally a € target value converted at the latest price); changed rows highlighted with per-row reset. While active: slim sticky banner at the top "Was-wäre-wenn aktiv · 3 Positionen geändert · Wert heute 512.300,00 € (Original 556.394,13 €) · Zurücksetzen"; the main chart additionally draws the original portfolio as a dashed grey line "Original"; every section (list, KPIs, tables, risk, drawdown) is computed on `PFEngine.withShares(ctx, overrides)`. Not persisted.
11c. **Risiko & Korrelation** (user-approved extra; uses the main range, filters and what-if): header KPIs "Vol. p.a. (aktuelle Gewichte)", "Diversifikations-Ratio", "Top 3 = x % des Risikos"; horizontal bars per selected position sorted by pctr desc showing Gewicht vs Risikoanteil side by side (+ values); correlation heatmap of the selected positions ordered by current weight desc, diverging colors (−1 --neg … 0 neutral … +1 --accent), hover tooltip "Micron × SK Hynix: 0,82 (184 Tage)", short names on both axes, average pairwise correlation shown; scrolls inside its card on mobile.
12. **Hinweise** footer: meta.notes, data source, generated_at, "Keine Anlageberatung".

### Behaviour
- State (in `app.js`): `{ preset:'YTD', custom:null, mode:'value'|'pl', startValue:null, rf:0.02, benchmarks:['msci_world'], selected:Set(all ISINs), sort:{key:'contrib', dir:-1}, measure:null, hover:null }`. Every change -> recompute via PFEngine -> render all sections. Defaults at load: all positions on, YTD, Portfoliowert.
- `1J` and `MAX` equal YTD with the current data (only 2026 daily data) – fine.
- Responsive: <= 720px: tables scroll horizontally inside their card (not the page), cards 2 per row, range bar wraps, charts full width. No horizontal page scroll at 375px.
- Performance: re-render on pointermove throttled with requestAnimationFrame; only the overlay layer (hover/measure) should re-render on pointermove, not the whole chart.
- No console errors; guard every division; format null as "–".
