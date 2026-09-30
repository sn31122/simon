// A Write of a small validated request triggers the file-owning Python fetcher.
// No prices appear in hook output. Unrelated writes do nothing.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const REQUESTS = path.join(ROOT, 'data', 'yfinance', 'requests');
const RUN_RE = /^\d{8}T\d{6}Z-[a-f0-9]{12}$/;

function pythonCommand(explicit) {
  if (explicit || process.env.YFINANCE_PYTHON) return explicit || process.env.YFINANCE_PYTHON;
  for (const folder of ['.venv-yfinance', path.join('.yfinance-probe', '.venv')]) {
    const file = path.join(ROOT, folder, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    if (fs.existsSync(file)) return file;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

function fetchRequest(file, explicitPython) {
  const absolute = path.resolve(ROOT, file);
  if (path.dirname(absolute) !== REQUESTS || fs.realpathSync(path.dirname(absolute)) !== fs.realpathSync(REQUESTS)) {
    throw new Error('Request must be directly inside data/yfinance/requests');
  }
  if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error('Symlink requests are refused');
  const request = JSON.parse(fs.readFileSync(absolute, 'utf8').replace(/^\uFEFF/, ''));
  if (!RUN_RE.test(request.run_id) || !Number.isInteger(request.batch) || request.batch < 1) {
    throw new Error('Invalid run ID or batch');
  }
  if (path.basename(absolute) !== `${request.run_id}--${request.batch}.json`) throw new Error('Request filename mismatch');
  const directory = path.join(ROOT, 'data', 'yfinance', 'runs', request.run_id);
  if (fs.lstatSync(directory).isSymbolicLink() || fs.realpathSync(directory) !== directory) {
    throw new Error('Run must be a real directory inside this checkout');
  }
  const planFile = path.join(directory, 'plan.json');
  const hash = require('node:crypto').createHash('sha256').update(fs.readFileSync(planFile)).digest('hex');
  if (request.plan_sha256 !== hash) throw new Error('Request refers to a changed plan');
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  if (plan.run_id !== request.run_id || request.batch > plan.batches.length) throw new Error('Batch is outside this plan');
  const result = spawnSync(pythonCommand(explicitPython),
    [path.join(ROOT, 'data', 'yfinance_history.py'), 'fetch', request.run_id, '--batch', String(request.batch)],
    { cwd: ROOT, encoding: 'utf8', timeout: 1750000, maxBuffer: 4 * 1024 * 1024,
      windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  if (result.error) throw result.error;
  let receipt;
  try { receipt = JSON.parse(result.stdout.trim()); }
  catch { throw new Error('Fetcher returned no JSON receipt; check Python/yfinance installation'); }
  if (result.status !== 0 || receipt.status !== 'saved') {
    throw new Error(JSON.stringify(receipt));
  }
  return receipt;
}

function hook(raw) {
  const input = JSON.parse(raw);
  if (input.hook_event_name && input.hook_event_name !== 'PostToolUse') return null;
  if (input.tool_name !== 'Write') return null;
  if (input.tool_response && (input.tool_response.is_error || input.tool_response.error)) return null;
  const file = input.tool_input && input.tool_input.file_path;
  if (typeof file !== 'string' || path.dirname(path.resolve(input.cwd || ROOT, file)) !== REQUESTS) return null;
  let message;
  try {
    const receipt = fetchRequest(path.resolve(input.cwd || ROOT, file));
    message = `SAVED ${receipt.saved}/${receipt.expected} ISINs, ${receipt.rows} daily closes; run ${receipt.run_id}, batch ${receipt.batch}. Nothing to copy. Merge only after all batches finish.`;
  } catch (error) {
    message = `NOT SAVED: ${error.message}`;
  }
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message } };
}

if (require.main === module) {
  const index = process.argv.indexOf('--request');
  if (index >= 0) {
    try {
      const pi = process.argv.indexOf('--python');
      console.log(JSON.stringify(fetchRequest(process.argv[index + 1], pi >= 0 ? process.argv[pi + 1] : undefined)));
    } catch (error) {
      console.log(JSON.stringify({ status: 'error', error: error.message }));
      process.exitCode = 1;
    }
  } else {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', part => { raw += part; });
    process.stdin.on('end', () => {
      try { const result = hook(raw); if (result) console.log(JSON.stringify(result)); }
      catch (error) { console.error(`fetch-yfinance hook: ${error.message}`); process.exitCode = 1; }
    });
  }
}
module.exports = { fetchRequest, hook, pythonCommand };
