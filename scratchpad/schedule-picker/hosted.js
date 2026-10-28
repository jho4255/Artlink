/** 아트링크 주최 공모 등록 폼 — 갤러리 폼과 같은 틀인지 찍어 본다(데모 5183 전용). node scratchpad/schedule-picker/hosted.js */
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require(path.resolve(__dirname, '../../e2e/node_modules/playwright'));
const BASE = 'http://localhost:5183', API = 'http://localhost:4000/api', OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const acc = await (await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@artlink.com' }) })).json();
  const st = { cookies: [], origins: [{ origin: BASE, localStorage: [{ name: 'artlink-auth', value: JSON.stringify({ state: { token: acc.token, user: acc.user, isAuthenticated: true }, version: 0 }) }] }] };
  const b = await chromium.launch();
  for (const [scr, dev] of [['pc', { viewport: { width: 1280, height: 900 } }], ['phone', (({ defaultBrowserType, ...d }) => d)(devices['iPhone 13'])]]) {
    const ctx = await b.newContext({ ...dev, storageState: st });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${BASE}/mypage?tab=hosted-exhibitions`);
    await p.getByRole('button', { name: '주최 공모 등록' }).click();
    await p.locator('#hosted-start').waitFor();
    await p.locator('section', { hasText: '공고 내용' }).locator('input[type="file"]').first().setInputFiles(path.resolve(__dirname, '../../frontend/public/demo-art/water-memory.jpg'));
    await p.getByTestId('hero-image-preview').waitFor({ timeout: 20000 });
    await p.waitForTimeout(800);
    const ox = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    await p.screenshot({ path: path.join(OUT, `hosted-${scr}.png`), fullPage: true });
    console.log(scr, '가로 넘침', ox, '오류', errs.length);
    await ctx.close();
  }
  await b.close();
})();
