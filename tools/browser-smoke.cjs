// Optional test dependency: npm install --no-save --package-lock=false playwright
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const url = process.argv[2] || 'http://127.0.0.1:8770/dashboard.html';
const out = path.resolve(process.argv[3] || 'artifacts/browser');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const options = { headless: true };
  if (process.env.BROWSER_EXECUTABLE) options.executablePath = process.env.BROWSER_EXECUTABLE;
  const browser = await chromium.launch(options);
  const results = [];
  try {
    for (const width of [1920, 1400, 375]) {
      const page = await browser.newPage({ viewport: { width, height: 1080 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      // A missing favicon is unrelated to application startup.
      await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.PFApp && document.querySelector('#benchCards .bb-card'));
      assert.equal(await page.locator('#benchCards .bb-card').count(), 1);
      for (const period of ['3M', '6M']) {
        await page.locator(`#holdPills [data-hp="${period}"]`).click();
        assert.equal(await page.evaluate(() => PFApp.state.preset), period);
      }
      await page.locator('#rangeTabs [data-preset="YTD"]').click();
      const layouts = [];
      for (const [hold, assets] of [[true, false], [true, true], [false, true], [false, false]]) {
        for (const [key, enabled] of [['hold', hold], ['assets', assets]]) {
          const button = page.locator(`#listToggles [data-list="${key}"]`);
          if ((await button.getAttribute('aria-pressed')) !== String(enabled)) await button.click();
        }
        await page.waitForTimeout(100);
        const metrics = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
        assert.ok(metrics.scroll <= metrics.width + 1, `Horizontal overflow ${JSON.stringify(metrics)}`);
        layouts.push({ hold, assets, ...metrics });
      }
      await page.locator('#benchCards [data-act="new"]').click();
      assert.equal(await page.locator('#benchCards .bb-card').count(), 2);
      await page.locator('#benchCards .bb-card:not(.bb-card--fixed) [data-act="del"]').click();
      assert.equal(await page.locator('#benchCards .bb-card').count(), 1);
      await page.locator('#listToggles [data-list="hold"]').click();
      await page.screenshot({ path: path.join(out, `dashboard-${width}.png`), fullPage: true });
      assert.deepEqual(errors, [], `Browser errors at ${width}px`);
      results.push({ width, status: 'passed', layouts, errors });
      await page.close();
    }
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
