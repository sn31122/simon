// node --experimental-websocket mbox_mouse.cjs <width> <preset|''> <out-prefix>
// real mouse events through CDP: click-move-click measurement, hit test over the side box, reverse drag
const { spawn } = require('child_process');
const [W = '1920', preset = '', prefix = 'mouse'] = process.argv.slice(2);
const H = 1080, D = __dirname;
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
    if (d.method === 'Log.entryAdded' && /error|warning/.test(d.params.entry.level) && !/favicon/.test(d.params.entry.url || '')) console.log('LOG ' + d.params.entry.level + ':', d.params.entry.text, d.params.entry.url || '');
  };
  await new Promise(r => ws.onopen = r);
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result.exceptionDetails ? { err: r.result.exceptionDetails.text } : r.result.result.value; };
  const mouse = async (type, x, y) => { await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : (type === 'mousePressed' ? 1 : 0), clickCount: 1, pointerType: 'mouse' }); await sleep(40); };
  const drag = async (type, x, y) => { await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: 1, pointerType: 'mouse' }); await sleep(40); };
  await send('Runtime.enable'); await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: +W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.navigate', { url: 'http://localhost:8770/dashboard.html?v=' + Date.now() });
  await sleep(2500);
  if (preset) { await ev(`document.querySelector('#rangeTabs [data-preset="${preset}"]').click()`); await sleep(300); }
  await ev(`window.scrollTo(0, document.querySelector('#mainChart').getBoundingClientRect().top + scrollY - 150)`);
  await sleep(300);
  const r = await ev(`(() => { const b = PFApp.charts.main.svg.getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height }; })()`);
  const X = f => r.l + r.w * f, Y = r.t + 300;
  const state = `(() => { const C = PFApp.charts.main, S = PFApp.sync, t2 = C.tip2, b = t2.getBoundingClientRect();
    const row = t2.querySelectorAll('.tt-dr')[1], rb = row ? row.getBoundingClientRect() : null;
    const hit = rb ? document.elementFromPoint(rb.left + rb.width / 2, rb.top + rb.height / 2) : null;
    return { measure: S.measure, tip: !C.tip.hidden && C.tip.innerText.replace(/\\n+/g, ' | '), side: !t2.hidden && t2.innerText.replace(/\\n+/g, ' | '),
      pinnedCls: t2.classList.contains('is-pinned'), hitOnRow: hit ? (hit.closest('.tt-dr') ? 'row[title]' : hit.tagName) : null,
      rowCenter: rb ? [Math.round(rb.left + rb.width / 2), Math.round(rb.top + rb.height / 2)] : null }; })()`;
  // 1) click at 30 %, move to 60 % (live follow), inspect
  await mouse('mouseMoved', X(0.3), Y); await mouse('mousePressed', X(0.3), Y); await mouse('mouseReleased', X(0.3), Y);
  for (let f = 0.32; f <= 0.6; f += 0.04) await mouse('mouseMoved', X(f), Y);
  await sleep(100);
  const live = await ev(state); console.log('LIVE  ', JSON.stringify(live));
  // moving over the side box while following: the end should keep following (box ignores the pointer)
  if (live.rowCenter) { await mouse('mouseMoved', live.rowCenter[0], live.rowCenter[1]); await sleep(100); console.log('LIVE over box', JSON.stringify((await ev(state)).measure)); }
  await mouse('mouseMoved', X(0.6), Y); await mouse('mousePressed', X(0.6), Y); await mouse('mouseReleased', X(0.6), Y);
  await sleep(100);
  console.log('2nd CLICK', JSON.stringify((await ev(state)).measure));
  // 3) reverse drag 75 % -> 20 % pins the measurement
  await mouse('mouseMoved', X(0.75), Y); await mouse('mousePressed', X(0.75), Y);
  for (let f = 0.73; f >= 0.2; f -= 0.03) await drag('mouseMoved', X(f), Y);
  await mouse('mouseReleased', X(0.2), Y); await sleep(150);
  const pin = await ev(state); console.log('PINNED', JSON.stringify(pin));
  if (pin.rowCenter) { await mouse('mouseMoved', pin.rowCenter[0], pin.rowCenter[1]); await sleep(100); const o = await ev(state); console.log('PINNED over box', JSON.stringify({ measure: o.measure, hitOnRow: o.hitOnRow, side: !!o.side })); }
  await send('Page.captureScreenshot', { format: 'png' }).then(s => require('fs').writeFileSync(D + '/mbox_' + prefix + '_pinned.png', Buffer.from(s.result.data, 'base64')));
  await mouse('mouseMoved', X(0.5), Y); await sleep(80);
  console.log('PINNED + pointer back in plot', JSON.stringify((await ev(state)).measure));
  await mouse('mousePressed', X(0.5), Y); await mouse('mouseReleased', X(0.5), Y); await sleep(100);
  console.log('CLICK ends', JSON.stringify((await ev(state)).measure));
  // 4) Esc clears; then hover only
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(100);
  await mouse('mouseMoved', X(0.45), Y); await sleep(100);
  console.log('HOVER ', JSON.stringify(await ev(state)));
  console.log('scroll', JSON.stringify(await ev(`[document.documentElement.scrollWidth, innerWidth]`)));
  ws.close(); edge.kill(); process.exit(0);
})().catch(e => { console.error(e); edge.kill(); process.exit(1); });
