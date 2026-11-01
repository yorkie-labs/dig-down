// Headless playtest driver (after scary-island's): opens the game in its own headless Chrome, runs
// a scenario (a JS file evaluated in the page, helpers from scenarios/_lib.js) and saves
// screenshots. Its own browser, so review never sends keys into a tab someone is playing in.
// Needs a dev server (the DEV-only window.__dd hook): `npm run dev -- --port 5188`, then
//   node scripts/e2e.mjs scripts/scenarios/smoke.js [outDir]
// Env: GAME_URL (default http://localhost:5188/3d.html; query string = the scene, e.g. ?depth=120),
//      MOBILE=1 (iPhone 15 Pro viewport, DPR 3, touch), VIEWPORT=WxH (desktop size, default
//      1100x800), CHROME (browser binary).
import puppeteer, { KnownDevices } from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';

const [scenarioPath, outDir = '/tmp/dig-down-shots'] = process.argv.slice(2);
if (!scenarioPath) { console.error('usage: node scripts/e2e.mjs <scenario.js> [outDir]'); process.exit(2); }
const url = process.env.GAME_URL ?? 'http://localhost:5188/3d.html';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  protocolTimeout: 300000,
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
if (process.env.MOBILE) await page.emulate(KnownDevices['iPhone 15 Pro']);
else {
  const [w, h] = (process.env.VIEWPORT ?? '1100x800').split('x').map(Number);
  await page.setViewport({ width: w, height: h });
}
const logs = [];
// navigator.vibrate before a tap is Chrome's user-activation rule, not a bug (the game guards it)
const NOISE = /navigator\.vibrate/;
page.on('console', (m) => { if (['error', 'warn', 'warning'].includes(m.type()) && !NOISE.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
mkdirSync(outDir, { recursive: true });
// a clean profile each run: no saved progress, no service worker from an earlier visit
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => localStorage.clear());
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
try {
  await page.waitForFunction(() => window.__dd && !document.getElementById('loading'), { timeout: 60000 });
} catch {
  console.log('LOAD FAILED (is the dev server up? __dd is DEV-only)\n' + logs.join('\n'));
  await browser.close();
  process.exit(1);
}
await page.exposeFunction('shot', async (name) => {
  const path = `${outDir}/${name}.png`;
  await page.screenshot({ path });
  return path;
});
// real key events into this headless page (keyboard.down/up, so held keys repeat like a player's)
await page.exposeFunction('keyDown', (code) => page.keyboard.down(code));
await page.exposeFunction('keyUp', (code) => page.keyboard.up(code));
const lib = readFileSync(new URL('./scenarios/_lib.js', import.meta.url), 'utf8');
const body = readFileSync(scenarioPath, 'utf8');
const result = await page.evaluate(`(async () => { ${lib}\ntry {\n${body}\n} catch (e) { log.push(['ERROR', e.message, e.stack?.split('\\n')[1]]); }\nreturn log; })()`);
console.log(JSON.stringify(result, null, 1));
const errors = [...new Set(logs)];
if (errors.length) console.log('CONSOLE:\n' + errors.slice(0, 30).join('\n'));
await browser.close();
process.exit(result.some((r) => r[0] === 'ERROR' || r[0] === 'FAIL') || logs.some((l) => l.startsWith('[pageerror]')) ? 1 : 0);
