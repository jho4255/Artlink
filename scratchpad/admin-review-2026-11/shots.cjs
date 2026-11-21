// 관리자 화면 리뷰(2026-11-21) — 지금 화면을 PC·휴대폰으로 찍고 높이·누를 것 수를 잰다.
// ⚠️ 데모 DB 전용(5183 → 4001). 복제본의 관리자는 실제 계정이라 쓰지 않는다.
//   node scratchpad/admin-review-2026-11/shots.cjs [pc|mobile]
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../e2e/node_modules/@playwright/test'));
const BASE = 'http://localhost:5183';
const API = 'http://localhost:4001/api';
const OUT = path.join(__dirname, 'out');
const screen = process.argv[2] || 'pc';
const VP = screen === 'pc' ? { viewport: { width: 1440, height: 900 } } : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
async function login(email) {
  const r = await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!r.ok) throw new Error('dev-login ' + r.status);
  return r.json();
}
(async () => {
  const browser = await chromium.launch();
  const { token, user } = await login('admin@artlink.com');
  const ctx = await browser.newContext({ ...VP, baseURL: BASE, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [
    { name: 'artlink-auth', value: JSON.stringify({ state: { token, user, isAuthenticated: true }, version: 0 }) },
    { name: 'artlink-intro-hidden', value: JSON.stringify({ [String(user.id)]: true }) },
  ] }] } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  ⚠ pageerror', String(e).slice(0, 200)));
  const measure = async (name) => {
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(900);
    const m = await page.evaluate(() => {
      const main = document.querySelector('main') || document.body;
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const clickable = [...main.querySelectorAll('button, a[href], select, input, textarea')].filter(vis);
      const small = clickable.filter((el) => { const r = el.getBoundingClientRect(); return r.height < 36; }).length;
      const fonts = {};
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      let n; while ((n = walker.nextNode())) { const t = n.textContent.trim(); if (!t) continue; const el = n.parentElement; if (!el || !vis(el)) continue; const fs = Math.round(parseFloat(getComputedStyle(el).fontSize)); fonts[fs] = (fonts[fs] || 0) + t.length; }
      return { h: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, vw: innerWidth, clickable: clickable.length, small, fonts };
    });
    console.log(`■ ${screen}-${name}  높이 ${m.h}px · 폭 ${m.sw}/${m.vw} · 누를 것 ${m.clickable}(36px 미만 ${m.small}) · 글자 ${JSON.stringify(m.fonts)}`);
    const clipH = Math.min(m.h, 2600);
    await page.screenshot({ path: path.join(OUT, `${screen}-${name}.png`), fullPage: true, clip: { x: 0, y: 0, width: m.vw, height: clipH } });
  };
  const go = async (tab, name, after) => { await page.goto(`/mypage?tab=${tab}`); if (after) await after(); await measure(name || tab); };
  await go('stats');
  await go('approvals', 'approvals-pending');
  await go('approvals', 'approvals-manage', async () => { await page.waitForTimeout(600); await page.getByRole('button', { name: '등록 관리' }).click(); });
  await go('hosted-exhibitions');
  await go('hosted-exhibitions', 'hosted-applicants', async () => { await page.waitForTimeout(800); const b = page.getByRole('button', { name: '지원자 관리' }).first(); if (await b.count()) await b.click(); });
  await go('user-manage', 'users-gallery');
  await go('user-manage', 'users-artist', async () => { await page.waitForTimeout(500); await page.getByRole('button', { name: '아티스트' }).first().click().catch(() => {}); });
  await go('oversight', 'ov-exhibitions');
  await go('oversight', 'ov-exhibition-detail', async () => { await page.waitForTimeout(800); const rows = page.locator('main button.w-full.text-left'); if (await rows.count()) await rows.first().click(); });
  await go('oversight', 'ov-artists', async () => { await page.waitForTimeout(500); await page.getByRole('button', { name: '작가 지원이력' }).click(); });
  await go('oversight', 'ov-galleries', async () => { await page.waitForTimeout(500); await page.getByRole('button', { name: '갤러리 게시물' }).click(); await page.waitForTimeout(600); const rows = page.locator('main button.w-full.text-left'); if (await rows.count()) await rows.first().click(); });
  await go('benefit-manage');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
