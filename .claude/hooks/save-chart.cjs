// PostToolUse hook for the Scalable MCP tool get_security_chart (matcher in .claude/settings.json).
// Saves the chart points straight to the fetch files of the price update and replaces what the model sees with one line,
// so a fetch agent sees about 150 tokens of chart output per call instead of ~6k (estimates) and never copies numbers by hand.
//
//   seven_days   -> data/incoming/<ISIN>.csv      30-min points (6 sessions): closes + 30-min history
//   one_month    -> data/incoming/2h/<ISIN>.csv   2-hour points (~1 month): 2-h history
//   three_months -> data/incoming/3m/<ISIN>.csv   daily closes: gap fill after a longer break
//   year_to_date -> data/incoming/ytd/<ISIN>.csv  daily closes since 1 January: new-instrument backfill
//   one_year     -> data/incoming/1y/<ISIN>.csv   every 2nd trading day of the last year: history before 2026 (--plan-history)
//   max          -> data/incoming/max/<ISIN>.csv  month-end closes back to ~2016: history before 2026 (--plan-history)
// File format (read by data/update_prices.py): first line "timestamp_utc,price", then "<timestampUtc>,<midPrice>" ascending,
// values verbatim from the tool. Other timeframes, errors and anything unexpected pass through unchanged.
// Plain Node, no dependencies; paths are built with path.join, so it also runs on Windows.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEST = { seven_days: 'incoming', one_month: path.join('incoming', '2h'), three_months: path.join('incoming', '3m'),
               year_to_date: path.join('incoming', 'ytd'), one_year: path.join('incoming', '1y'), max: path.join('incoming', 'max') };
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

function reply(text) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: text } }));
}

// tool_response is the JSON text of the chart today; content-block arrays / objects are handled too
function payload(resp) {
  if (resp == null) return null;
  if (typeof resp === 'string') { try { return payload(JSON.parse(resp)); } catch (e) { return null; } }
  if (Array.isArray(resp)) {
    for (const x of resp) { const p = payload(x && typeof x === 'object' && 'text' in x ? x.text : x); if (p) return p; }
    return null;
  }
  if (typeof resp === 'object') {
    if (Array.isArray(resp.dataPoints)) return resp;
    for (const k of ['structuredContent', 'content', 'result', 'data', 'text']) {
      if (k in resp) { const p = payload(resp[k]); if (p) return p; }
    }
  }
  return null;
}

function num(v) {
  const s = String(v);
  return /e/i.test(s) ? v.toFixed(10).replace(/\.?0+$/, '') : s;
}

function main(raw) {
  const inp = JSON.parse(raw);
  const ti = inp.tool_input || {};
  const isin = String(ti.isin || '').trim().toUpperCase(), tf = ti.timeframe;
  if (!DEST[tf] || !ISIN_RE.test(isin)) return;                          // not a fetch timeframe: leave the output alone
  if (!fs.existsSync(path.join(ROOT, 'data', 'update_prices.py'))) return;
  const p = payload(inp.tool_response);
  if (!p) return;                                                        // error text etc.: the model sees it unchanged
  if (p.isin && String(p.isin).toUpperCase() !== isin) return reply(`NOT SAVED ${isin} ${tf}: the response is for ${p.isin}.`);
  if (p.currency && p.currency !== 'EUR') return reply(`NOT SAVED ${isin} ${tf}: currency ${p.currency}, expected EUR.`);
  const byTs = new Map();
  let bad = 0;
  for (const d of p.dataPoints) {
    const t = d && d.timestampUtc, v = d && d.midPrice;
    if (typeof t !== 'string' || !TS_RE.test(t) || typeof v !== 'number' || !isFinite(v) || v <= 0) { bad++; continue; }
    byTs.set(t, v);                                                      // ignores closingReferencePoint (not in dataPoints)
  }
  const pts = [...byTs].sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]));
  if (!pts.length) return reply(`NO DATA ${isin} ${tf}: the chart has no usable points - nothing saved.`);
  const dir = path.join(ROOT, 'data', DEST[tf]);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, isin + '.csv'), tmp = file + '.tmp';
  fs.writeFileSync(tmp, 'timestamp_utc,price\n' + pts.map(([t, v]) => t + ',' + num(v)).join('\n') + '\n');
  fs.renameSync(tmp, file);
  const days = new Set(pts.map(([t]) => t.slice(0, 10))).size;
  const rel = path.join('data', DEST[tf], isin + '.csv').split(path.sep).join('/');
  reply(`SAVED ${isin} ${tf}: ${pts.length} points on ${days} days, ${pts[0][0].slice(0, 16)} .. ${pts[pts.length - 1][0].slice(0, 16)} UTC, ` +
        `last ${num(pts[pts.length - 1][1])} EUR -> ${rel}` + (bad ? ` (${bad} unusable points skipped)` : '') +
        '. Nothing to copy.');
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  try { main(raw); } catch (e) { process.stderr.write('save-chart hook: ' + (e && e.stack || e) + '\n'); }
});
