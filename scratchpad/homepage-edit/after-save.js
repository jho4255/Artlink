/** 사진만 올리고 → [소개]에 작가노트 → [저장] 뒤 주인이 보는 공개 홈페이지 (로컬 데모 DB 전용, after-upload.js 와 같은 계정) */
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const { chromium, devices } = require(path.resolve(__dirname, '../../e2e/node_modules/playwright'));
const BASE = 'http://localhost:5173', API = 'http://localhost:4000/api';
const OUT = path.join(__dirname, 'out-upload'); const BACKEND = path.resolve(__dirname, '../../backend');
const imgs = fs.readdirSync(path.join(BACKEND, 'uploads')).filter((f) => /^(pdf-sample|pdf-vary)-\d+\.jpg$/.test(f)).slice(0, 6).map((f) => path.join(BACKEND, 'uploads', f));
(async () => {
  const browser = await chromium.launch();
  for (const [name, dev] of Object.entries({ pc: { viewport: { width: 1280, height: 800 } }, iphone: devices['iPhone 13'] })) {
    execSync('npx tsx scripts/seed-nudge-demo.ts', { cwd: BACKEND, stdio: 'pipe' });
    const acc = await (await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nudge.empty@demo.artlink.local' }) })).json();
    const ctx = await browser.newContext({ ...dev, storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [{ name: 'artlink-auth', value: JSON.stringify({ state: { token: acc.token, user: acc.user, isAuthenticated: true }, version: 0 }) }] }] } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/mypage?tab=homepage-edit`);
    await page.locator('input[type=file]').first().setInputFiles(imgs);
    await page.getByText(`작품 ${imgs.length}점을 올렸어요`).waitFor({ timeout: 60000 });
    await page.getByRole('tablist', { name: '홈페이지 편집' }).getByRole('tab', { name: /^소개/ }).click();
    await page.locator('#hpe-field-statement').fill('무의식을 다양한 매체로 의식화하여 다면적으로 드러냅니다. '.repeat(20));
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.waitForURL(/\/(portfolio|@)/, { timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${name}-3-after-save.png` });
    const text = await page.evaluate(() => document.body.innerText);
    console.log(name, page.url().replace(BASE, ''), '| 정보 안내:', /정보가 없|작품 정보/.test(text), '| PDF 안내:', /PDF/.test(text));
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
