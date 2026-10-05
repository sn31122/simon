// PostToolUse hook for the read-only Scalable MCP tools get_portfolio_holdings and get_portfolio_overview (matcher in
// .claude/settings.json). Saves the raw JSON answer to data/incoming/depot/holdings.json or overview.json so that
// data/update_depot.py can rewrite depot.csv, depot_ref.csv and the "Mein Depot" weights without anyone copying numbers.
// The model sees one line "SAVED depot ..." with the key figures and the file path instead of the ~5k-token answer (the fetch
// agent of the skill update-quotes calls both tools; the full answer stays in the file). Plain Node, no dependencies.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const NAMES = { get_portfolio_holdings: 'holdings.json', get_portfolio_overview: 'overview.json' };

function reply(text) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: text } }));
}

function eur(v) {
  return typeof v === 'number' && isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '?';
}

// one line with the figures update_depot.py checks (positions, shares x quote; securities / total value, G/V since buy)
function summary(name, p) {
  if (name === 'holdings.json') {
    const held = (p.holdings || []).filter((h) => h && h.position && h.position.filled > 0);
    const val = held.reduce((s, h) => s + h.position.filled * (((h.currentQuote || {}).midPrice) || 0), 0);
    const crypto = (p.cryptoHoldings || []).filter((c) => c && c.position && c.position.filled > 0).length;
    return `SAVED depot holdings: ${held.length} positions, shares x quote ${eur(val)} EUR` + (crypto ? `, ${crypto} crypto` : '');
  }
  const v = p.valuation || {}, max = (p.performance || []).find((x) => x && x.timeframe === 'MAX') || {};
  const asof = String((p.timestamps || {}).valuationTimestampUtc || '').slice(0, 16);
  return `SAVED depot overview: securities ${eur(v.securities)} EUR, total ${eur(v.total)} EUR, G/V since buy ${eur(max.simpleAbsoluteReturn)} EUR`
    + (asof ? `, as of ${asof}Z` : '');
}

function payload(resp) {
  if (resp == null) return null;
  if (typeof resp === 'string') { try { return payload(JSON.parse(resp)); } catch (e) { return null; } }
  if (Array.isArray(resp)) {
    for (const x of resp) { const p = payload(x && typeof x === 'object' && 'text' in x ? x.text : x); if (p) return p; }
    return null;
  }
  if (typeof resp === 'object') {
    if (resp.portfolioId && (resp.holdings || resp.valuation)) return resp;
    for (const k of ['structuredContent', 'content', 'result', 'data', 'text']) {
      if (k in resp) { const p = payload(resp[k]); if (p) return p; }
    }
  }
  return null;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  try {
    const inp = JSON.parse(raw);
    const name = NAMES[String(inp.tool_name || '').split('__').pop()];
    if (!name || !fs.existsSync(path.join(ROOT, 'data', 'update_depot.py'))) return;
    const p = payload(inp.tool_response);
    if (!p) return;
    const dir = path.join(ROOT, 'data', 'incoming', 'depot');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file + '.tmp', JSON.stringify({ saved_utc: new Date().toISOString(), response: p }, null, 1) + '\n');
    fs.renameSync(file + '.tmp', file);
    reply(summary(name, p) + ` -> data/incoming/depot/${name} (full answer in the file). Nothing to copy.`);
  } catch (e) { process.stderr.write('save-portfolio hook: ' + (e && e.stack || e) + '\n'); }
});
