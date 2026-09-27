// node --experimental-websocket mbox_shot.cjs <url> <out.png> <width> <height> <scrollY|chart> [js-before-shot]
// like shot.cjs, plus: prints console errors/warnings + exceptions; scrollY "chart" scrolls #mainChart into view
const { spawn } = require('child_process');
const [url, out, W = '1600', H = '900', Y = '0', pre = ''] = process.argv.slice(2);
const port = 9300 + Math.floor(Math.random() * 600);
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--window-size=${W},${H}`,
   '--user-data-dir=' + require('os').tmpdir() + '\\edge-shot-' + port, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let list;
  for (let k = 0; k < 40; k++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch (e) { await sleep(250); } }
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = {};
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; return; }
    if (d.method === 'Runtime.exceptionThrown') console.log('EXCEPTION:', JSON.stringify(d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description || d.params.exceptionDetails.text));
    if (d.method === 'Runtime.consoleAPICalled' && /error|warn/.test(d.params.type)) console.log('CONSOLE ' + d.params.type + ':', d.params.args.map(a => a.value || a.description).join(' '));
    if (d.method === 'Log.entryAdded' && /error|warning/.test(d.params.entry.level)) console.log('LOG ' + d.params.entry.level + ':', d.params.entry.text, d.params.entry.url || '');
  };
  await new Promise(r => ws.onopen = r);
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: +W, height: +H, deviceScaleFactor: 1, mobile: +W < 600 });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.navigate', { url });
  await sleep(2500);
  if (Y === 'chart') await send('Runtime.evaluate', { expression: `window.scrollTo(0, document.querySelector('#mainChart').getBoundingClientRect().top + window.scrollY - 150)` });
  else await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${+Y})` });
  await sleep(400);
  if (pre) { const r = await send('Runtime.evaluate', { expression: pre, awaitPromise: true, returnByValue: true }); console.log('pre:', JSON.stringify(r.result && (r.result.exceptionDetails ? r.result.exceptionDetails : r.result.result && r.result.result.value))); await sleep(600); }
  let params = { format: 'png' };
  if (process.env.ZOOM) {       // clip to the main chart (+ 40px above for the legend), at 2x
    const r = await send('Runtime.evaluate', { expression: `(() => { const b = document.querySelector('#mainChart').getBoundingClientRect(); return [b.left - 4 + scrollX, b.top - 40 + scrollY, b.width + 8, b.height + 44]; })()`, returnByValue: true });
    const [x, y, w, h] = r.result.result.value;
    params.clip = { x, y, width: w, height: h, scale: +process.env.ZOOM };
    params.captureBeyondViewport = true;
  }
  const shot = await send('Page.captureScreenshot', params);
  require('fs').writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', out);
  ws.close(); edge.kill();
  process.exit(0);
})().catch(e => { console.error(e); edge.kill(); process.exit(1); });
