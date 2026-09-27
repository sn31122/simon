// Test-only helper: gives a Playwright page Segoe UI metrics on machines without Segoe UI (Linux CI/cloud containers).
// Selawik (Microsoft, SIL OFL) is metric-compatible with Segoe UI; its faces are prepended as @font-face "Segoe UI" to
// css/dashboard.css in the test browser only, so layout checks (e.g. lists side by side at 1903 px) match Windows.
// The dashboard files are unchanged. dir must contain selawk.ttf, selawkl.ttf, selawksl.ttf, selawksb.ttf, selawkb.ttf
// (https://github.com/microsoft/Selawik/releases, Selawik_Release.zip).
const fs = require('node:fs');
const path = require('node:path');

function segoeFallbackCSS(dir) {
  const faces = [['selawkl.ttf', 300], ['selawksl.ttf', 350], ['selawk.ttf', 400], ['selawksb.ttf', 600], ['selawkb.ttf', 700]];
  return faces.filter(([f]) => fs.existsSync(path.join(dir, f))).map(([f, w]) =>
    '@font-face{font-family:"Segoe UI";font-weight:' + w + ';font-style:normal;font-display:block;src:url(data:font/ttf;base64,' +
    fs.readFileSync(path.join(dir, f)).toString('base64') + ') format("truetype");}').join('\n');
}

/**
 * Call before page.goto(). After the page has loaded, await fontsReady(page) so the app re-lays out with the font.
 * Returns false (and changes nothing) when dir has no Selawik files.
 */
async function addSegoeFallback(page, dir) {
  const css = dir ? segoeFallbackCSS(dir) : '';
  if (!css) return false;
  await page.route('**/css/dashboard.css', async (route) => {
    const resp = await route.fetch();
    await route.fulfill({ response: resp, body: css + '\n' + (await resp.text()), contentType: 'text/css; charset=utf-8' });
  });
  return true;
}

/** Waits for the fonts, then lets the dashboard re-render/re-measure (list layout, chart band). */
async function fontsReady(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    if (window.PFApp) window.PFApp.update();
    window.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(150);
}

module.exports = { addSegoeFallback, fontsReady, segoeFallbackCSS };
