// PostToolUse hook for the read-only Scalable MCP tools get_portfolio_holdings and get_portfolio_overview (matcher in
// .claude/settings.json). Saves the raw JSON answer to data/incoming/depot/holdings.json or overview.json so that
// data/update_depot.py can rewrite depot.csv, depot_ref.csv and the "Mein Depot" weights without anyone copying numbers.
// The model still sees the answer unchanged. Plain Node, no dependencies.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const NAMES = { get_portfolio_holdings: 'holdings.json', get_portfolio_overview: 'overview.json' };

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
  } catch (e) { process.stderr.write('save-portfolio hook: ' + (e && e.stack || e) + '\n'); }
});
