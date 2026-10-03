/**
 * 포트폴리오 만들기 — 실제로 저장해 본다(바로 내려받기). cwd = e2e
 *   node ../scratchpad/portfolio-maker/export.js [works=10|30] [screen=pc|pixel|iphone] [throttle=1] [engine=chromium|webkit] [acc=이메일]
 * 로컬 데모 서버에서만. 디자인 저장·저장 기록은 가로채 DB 를 바꾸지 않는다.
 *   engine=webkit — 사파리 엔진(`~/.cache/wk-deps/run.sh`, 준비는 scratchpad/hero/setup-webkit.sh). CPU 느리게(throttle)는 크롬만 된다.
 *   acc — 기본은 데모 작가(jinwoo.seo, 작품 10점). 하니스 작가는 acc=maker.walk@demo.artlink.local (walk.js 가 만든다)
 */
const fs = require('fs');
const path = require('path');
const { chromium, webkit, devices } = require(path.resolve(__dirname, '../../e2e/node_modules/playwright'));
const WEBKIT_RUN = path.join(process.env.HOME, '.cache/wk-deps/run.sh');
const BASE = process.env.BASE || 'http://localhost:5183';
const API = process.env.API || 'http://localhost:4001/api';
const OUT = path.join(__dirname, 'out');
if (/artlink\.cc|onrender/.test(BASE + API)) { console.error('로컬에서만'); process.exit(1); }
const arg = (k, d) => (process.argv.slice(2).find((a) => a.startsWith(k + '=')) || `${k}=${d}`).split('=')[1];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const works = Number(arg('works', 10)), scr = arg('screen', 'pc'), throttle = Number(arg('throttle', 1)), engine = arg('engine', 'chromium');
  const acc = await (await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: arg('acc', 'jinwoo.seo@demo.artlink.local') }) })).json();
  const browser = engine === 'webkit' ? await webkit.launch({ executablePath: WEBKIT_RUN }) : await chromium.launch();
  const { defaultBrowserType: _dbt, ...opts } = scr === 'pixel' ? devices['Pixel 7'] : scr === 'iphone' ? devices['iPhone 13'] : { viewport: { width: 1280, height: 800 } };
  const ctx = await browser.newContext({ ...opts, acceptDownloads: true, storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [{ name: 'artlink-auth', value: JSON.stringify({ state: { token: acc.token, user: acc.user, isAuthenticated: true }, version: 0 }) }] }] } });
  const page = await ctx.newPage();
  await page.route('**/api/visits', (q) => q.fulfill({ status: 200, body: '{}' }));
  await page.route('**/api/portfolio/design', (q) => q.fulfill({ status: 200, contentType: 'application/json', body: '{"designConfig":{}}' }));
  const logged = [];
  await page.route('**/api/portfolio/exports', (q) => { logged.push(JSON.parse(q.request().postData() || '{}')); return q.fulfill({ status: 204, body: '' }); });
  await page.route('**/api/portfolio', async (q) => {
    if (q.request().method() !== 'GET' || works <= 10) return q.continue();
    const res = await q.fetch(); const j = await res.json();
    const imgs = []; for (let k = 0; imgs.length < works; k++) for (const im of j.images) { if (imgs.length < works) imgs.push({ ...im, id: im.id + k * 10000, order: imgs.length }); }
    return q.fulfill({ response: res, json: { ...j, designConfig: null, images: imgs } });
  });
  if (throttle > 1 && engine !== 'webkit') { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
  await page.goto(`${BASE}/mypage?tab=portfolio`);
  await page.waitForSelector('[data-testid="portfolio-maker"]');
  await page.waitForLoadState('networkidle').catch(() => {});
  const status = await page.getByTestId('maker-status').textContent();
  await page.getByRole('button', { name: /^PDF 저장/ }).click();
  const dlg = page.getByRole('dialog', { name: 'PDF 저장' });
  await dlg.waitFor();
  const t0 = Date.now();
  const labels = [];
  const poll = setInterval(async () => { try { const t = await dlg.locator('[role="status"] p').first().textContent({ timeout: 300 }); if (t && labels[labels.length - 1] !== t.trim()) labels.push(t.trim()); } catch { /* 넘어감 */ } }, 150);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 600000 }), dlg.getByRole('button', { name: 'PDF 내려받기' }).click()]);
  const file = path.join(OUT, `export-${works}-${scr}${engine === 'webkit' ? '-webkit' : ''}${throttle > 1 ? '-x' + throttle : ''}.pdf`);
  await dl.saveAs(file);
  await dlg.getByTestId('save-result').waitFor({ timeout: 60000 });
  clearInterval(poll);
  const ms = Date.now() - t0;
  const result = (await dlg.getByTestId('save-result').innerText()).replace(/\n+/g, ' | ');
  await page.screenshot({ path: path.join(OUT, `export-${works}-${scr}-result.png`) });
  console.log(JSON.stringify({ status, engine, works, scr, throttle, ms, fileMB: +(fs.statSync(file).size / 1048576).toFixed(2), name: dl.suggestedFilename(), logged, phases: labels.filter((l, i) => i === 0 || i === labels.length - 1 || /1\/|중 \d+\/\d+$/.test(l)).slice(0, 6), result: result.slice(0, 260), errs }, null, 1));
  await browser.close();
})();
