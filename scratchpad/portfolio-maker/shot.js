/**
 * 포트폴리오 만들기 — 화면 찍어 보기(개발 중 눈으로 확인용). cwd = e2e
 *   node ../scratchpad/portfolio-maker/shot.js [계정] [화면] [단계…]
 * 로컬 데모 서버(BASE/API)에서만. 디자인 저장(PUT)은 가로채 DB 를 바꾸지 않는다.
 */
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require(path.resolve(__dirname, '../../e2e/node_modules/playwright'));
const BASE = process.env.BASE || 'http://localhost:5183';
const API = process.env.API || 'http://localhost:4001/api';
const OUT = path.join(__dirname, 'out');
if (/artlink\.cc|onrender/.test(BASE + API)) { console.error('로컬에서만'); process.exit(1); }

const ACC = { partial: 'nudge.partial@demo.artlink.local', full: 'jinwoo.seo@demo.artlink.local', empty: 'nudge.empty@demo.artlink.local', walk: 'maker.walk@demo.artlink.local' };
const SCREENS = {
  pc: { viewport: { width: 1280, height: 800 } },
  pcl: { viewport: { width: 1440, height: 900 } },
  pixel: devices['Pixel 7'],
  iphone: { ...devices['iPhone 13'], defaultBrowserType: undefined },
  se: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const [accKey = 'full', scrKey = 'pc', ...steps] = process.argv.slice(2);
  const r = await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ACC[accKey] }) });
  const acc = await r.json();
  const browser = await chromium.launch();
  const { defaultBrowserType, ...opts } = SCREENS[scrKey];
  const ctx = await browser.newContext({ ...opts, storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [{ name: 'artlink-auth', value: JSON.stringify({ state: { token: acc.token, user: acc.user, isAuthenticated: true }, version: 0 }) }] }] } });
  const page = await ctx.newPage();
  await page.route('**/api/visits', (q) => q.fulfill({ status: 200, body: '{}' }));
  await page.route('**/api/portfolio/design', (q) => q.fulfill({ status: 200, contentType: 'application/json', body: '{"designConfig":{}}' }));
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  await page.goto(`${BASE}/mypage?tab=portfolio`);
  await page.waitForSelector('[data-testid="portfolio-maker"], [data-testid="portfolio-maker-empty"]', { timeout: 20000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(700);
  const tag = `${accKey}-${scrKey}`;
  await page.screenshot({ path: path.join(OUT, `${tag}-0.png`) });
  let n = 1;
  for (const step of steps) {
    const [kind, arg] = step.split('=');
    if (kind === 'click') await page.getByRole('button', { name: new RegExp(arg) }).first().click();
    else if (kind === 'tab') await page.getByRole('tab', { name: new RegExp(`^${arg}`) }).first().click();
    else if (kind === 'text') await page.getByText(new RegExp(arg)).first().click();
    else if (kind === 'scroll') await page.evaluate((y) => scrollTo(0, Number(y)), arg);
    else if (kind === 'full') { await page.screenshot({ path: path.join(OUT, `${tag}-${n++}-full.png`), fullPage: true }); continue; }
    else if (kind === 'wait') await page.waitForTimeout(Number(arg));
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${tag}-${n++}.png`) });
  }
  if (errs.length) console.log('ERR', errs);
  console.log('ok', tag, n, 'shots');
  await browser.close();
})();
