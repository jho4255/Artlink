// 판매 입력 펼친 상태(정산) — shots2 의 x10 을 바로잡은 것
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../e2e/node_modules/@playwright/test'));
const BASE = 'http://localhost:5183', API = 'http://localhost:4001/api';
const OUT = path.join(__dirname, 'out');
(async () => {
  const browser = await chromium.launch();
  const r = await (await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'gallery@artlink.com' }) })).json();
  const ov = await (await fetch(API + '/exhibitions/my-operation-overview', { headers: { Authorization: 'Bearer ' + r.token } })).json();
  const ex = ov.find((e) => e.title.startsWith('[단계 08]'));
  for (const screen of ['pc', 'mobile']) {
    const VP = screen === 'pc' ? { viewport: { width: 1280, height: 800 } } : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
    const ctx = await browser.newContext({ ...VP, baseURL: BASE, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [
      { name: 'artlink-auth', value: JSON.stringify({ state: { token: r.token, user: r.user, isAuthenticated: true }, version: 0 }) },
      { name: 'artlink-intro-hidden', value: JSON.stringify({ [String(r.user.id)]: true }) } ] }] } });
    const page = await ctx.newPage();
    await page.goto(`/mypage?tab=my-exhibitions&ex=${ex.id}&panel=operation`); await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
    const card = page.locator(`#ex-card-${ex.id}`);
    await card.getByRole('button', { name: '판매 입력', exact: true }).first().click(); await page.waitForTimeout(800);
    // 첫 작품 체크
    const cb = card.locator('input[type=checkbox]').first(); if (await cb.count()) { await cb.check().catch(() => {}); await page.waitForTimeout(500); }
    await page.screenshot({ path: path.join(OUT, `${screen}-x10-sales-viewport.png`) });
    // 정산 구역만
    const box = await card.boundingBox();
    console.log(screen, '카드 높이', Math.round(box.height));
    await card.screenshot({ path: path.join(OUT, `${screen}-x10-sales-card.png`) });
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
