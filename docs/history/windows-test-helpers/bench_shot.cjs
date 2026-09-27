// node shot.cjs <url> <out.png> <width> <height> <scrollY> [js-before-scroll]
const { spawn } = require('child_process');
const [url, out, W = '1600', H = '900', Y = '0', pre = ''] = process.argv.slice(2);
const port = 9300 + Math.floor(Math.random() * 600);   // random port + own profile: several agents can shoot at once
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
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; } };
  await new Promise(r => ws.onopen = r);
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Emulation.setDeviceMetricsOverride', { width: +W, height: +H, deviceScaleFactor: 1, mobile: +W < 600 });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable'); ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown') console.log('EXC:', JSON.stringify(d.params.exceptionDetails).slice(0, 600)); if (d.method === 'Runtime.consoleAPICalled' && /error|warn/.test(d.params.type)) console.log('CONSOLE', d.params.type, JSON.stringify(d.params.args.map(a => a.value || a.description)).slice(0, 600)); });
  await send('Page.navigate', { url });
  await sleep(2500);
  if (pre) { const r = await send('Runtime.evaluate', { expression: pre, awaitPromise: true, returnByValue: true }); console.log('pre:', JSON.stringify(r.result && r.result.result && r.result.result.value)); await sleep(500); }
  await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${+Y})` });
  await sleep(800);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', out);
  ws.close(); edge.kill();
  process.exit(0);
})().catch(e => { console.error(e); edge.kill(); process.exit(1); });
