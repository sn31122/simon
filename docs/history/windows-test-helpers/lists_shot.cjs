// node lists_shot.cjs <url> <out.png> <width> <height> <scrollY|-1> [js-before-shot]
// like shot.cjs, plus: console/exception capture from the start, scrollY -1 = keep the scroll position the js set
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
  let id = 0; const pending = {}; const logs = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; return; }
    if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description || d.params.exceptionDetails.text));
    if (d.method === 'Runtime.consoleAPICalled') logs.push(d.params.type + ' ' + d.params.args.map(a => a.value || a.description).join(' '));
    if (d.method === 'Log.entryAdded') logs.push('LOG ' + d.params.entry.level + ' ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
  };
  await new Promise(r => ws.onopen = r);
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Emulation.setDeviceMetricsOverride', { width: +W, height: +H, deviceScaleFactor: 1, mobile: +W < 600 });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.navigate', { url });
  await sleep(2500);
  if (pre) {
    const r = await send('Runtime.evaluate', { expression: pre, awaitPromise: true, returnByValue: true });
    const res = r.result;
    console.log('pre:', JSON.stringify(res && res.exceptionDetails ? res.exceptionDetails : res && res.result && res.result.value));
    await sleep(600);
  }
  if (process.env.RESIZE) {           // RESIZE=w,h then POST=<js> evaluated after the resize
    const [rw, rh] = process.env.RESIZE.split(',').map(Number);
    await send('Emulation.setDeviceMetricsOverride', { width: rw, height: rh, deviceScaleFactor: 1, mobile: rw < 600 });
    await sleep(500);
    if (process.env.POST) {
      const r2 = await send('Runtime.evaluate', { expression: process.env.POST, awaitPromise: true, returnByValue: true });
      console.log('post:', JSON.stringify(r2.result && r2.result.result && r2.result.result.value));
    }
  }
  if (+Y >= 0) await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${+Y})` });
  await sleep(700);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('console:', logs.length ? logs.join('\n  ') : '(none)');
  console.log('saved', out);
  ws.close(); edge.kill();
  process.exit(0);
})().catch(e => { console.error(e); edge.kill(); process.exit(1); });
