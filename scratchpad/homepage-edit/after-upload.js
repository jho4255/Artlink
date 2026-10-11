/**
 * 사진을 올린 직후 화면 — 무엇이 보이는가 (2026-10-11, 실서버 '초원·박경연' 이 사진만 올리고 정보를 비운 원인 조사)
 * 로컬 데모 DB 전용. seed-nudge-demo 의 '작품없음' 계정으로 N장 올리고 → 첫 화면 → [소개] → 저장 뒤 화면을 찍는다.
 * 사용: node scratchpad/homepage-edit/after-upload.js [장수=6]
 */
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const { chromium, devices } = require(path.resolve(__dirname, '../../e2e/node_modules/playwright'));
const BASE = 'http://localhost:5173', API = 'http://localhost:4000/api';
const OUT = path.join(__dirname, 'out-upload'); const BACKEND = path.resolve(__dirname, '../../backend');
const N = Number(process.argv[2] || 6);
const env = fs.readFileSync(path.join(BACKEND, '.env'), 'utf8').match(/^DATABASE_URL=(.*)$/m)[1].replace(/^["']|["']$/g, '');
if (/prod/i.test(env)) { console.error('데모 DB 전용'); process.exit(1); }
const imgs = fs.readdirSync(path.join(BACKEND, 'uploads')).filter((f) => /^(pdf-sample|pdf-vary)-\d+\.jpg$/.test(f)).slice(0, N).map((f) => path.join(BACKEND, 'uploads', f));
const SCREENS = { pc: { viewport: { width: 1280, height: 800 } }, iphone: devices['iPhone 13'] };

(async () => {
  const browser = await chromium.launch();
  for (const [name, dev] of Object.entries(SCREENS)) {
    execSync('npx tsx scripts/seed-nudge-demo.ts', { cwd: BACKEND, stdio: 'pipe' });
    const acc = await (await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nudge.empty@demo.artlink.local' }) })).json();
    const ctx = await browser.newContext({ ...dev, storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [{ name: 'artlink-auth', value: JSON.stringify({ state: { token: acc.token, user: acc.user, isAuthenticated: true }, version: 0 }) }] }] } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/mypage?tab=homepage-edit`);
    await page.getByRole('button', { name: /작품 사진 올리기/ }).first().waitFor();
    await page.screenshot({ path: `${OUT}/${name}-0-before.png` });
    await page.locator('input[type=file]').first().setInputFiles(imgs);
    await page.getByRole('dialog', { name: '작품 정보' }).or(page.getByText(`작품 ${imgs.length}점을 올렸어요`)).first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${OUT}/${name}-1-after-upload.png` });
    await page.screenshot({ path: `${OUT}/${name}-1-after-upload-full.png`, fullPage: true });
    const where = await page.evaluate(() => {
      const find = (re) => { const el = [...document.querySelectorAll('body *')].find((e) => e.children.length === 0 && re.test(e.textContent || '')); if (!el) return null; const r = el.getBoundingClientRect(); return { y: Math.round(r.top), text: el.textContent.trim().slice(0, 40), inView: r.top >= 0 && r.bottom <= innerHeight }; };
      return { h: innerHeight, task: find(/정보가 없어요/), ask: find(/방금 올린/), tileLabel: find(/^작품 정보 입력$/), progress: find(/완료 ·|남은 것/) };
    });
    console.log(name, JSON.stringify(where));
    // 2026-10-11 부터 다 올리면 정보 창이 바로 열린다 — 떠 있으면 [나중에 하기] 로 닫고 이어 간다
    const dlg = page.getByRole('dialog', { name: '작품 정보' });
    console.log(name, '정보 창 자동으로 열림:', await dlg.isVisible());
    if (await dlg.isVisible()) await dlg.getByRole('button', { name: '나중에 하기' }).click();
    await page.getByRole('tablist', { name: '홈페이지 편집' }).getByRole('tab', { name: /^소개/ }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${name}-2-intro.png` });
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
