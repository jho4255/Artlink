// 눌러서 나오는 상태들 — 지원자 펼침·일괄 선택·단계 확인창·출품 자료 펼침·정산 입력·지원서(휴대폰)·알림
//   node scratchpad/flow-review-2026-11/shots2.cjs [pc|mobile]   (데모 DB 5183 → 4001 전용)
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.resolve(__dirname, '../../e2e/node_modules/@playwright/test'));
const BASE = 'http://localhost:5183', API = 'http://localhost:4001/api';
const OUT = path.join(__dirname, 'out');
const screen = process.argv[2] || 'pc';
const VP = screen === 'pc' ? { viewport: { width: 1280, height: 800 } } : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
const cache = {};
async function login(email) { if (cache[email]) return cache[email]; const r = await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }); return (cache[email] = await r.json()); }
async function api(email, url) { const { token } = await login(email); return (await fetch(API + url, { headers: { Authorization: 'Bearer ' + token } })).json(); }
async function open(browser, email) {
  const { token, user } = await login(email);
  const ctx = await browser.newContext({ ...VP, baseURL: BASE, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [
    { name: 'artlink-auth', value: JSON.stringify({ state: { token, user, isAuthenticated: true }, version: 0 }) },
    { name: 'artlink-homepage-nudge-snooze', value: JSON.stringify({ [String(user.id)]: 8.64e15 }) },
    { name: 'artlink-intro-hidden', value: JSON.stringify({ [String(user.id)]: true }) } ] }] } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  ⚠ pageerror', String(e).slice(0, 200)));
  return { ctx, page };
}
const texts = [];
const one = (s, n = 1800) => s.replace(/\n+/g, ' / ').slice(0, n);
async function vp(page, name, note) { await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, `${screen}-${name}.png`) }); console.log('■', name, note || ''); }
async function el(page, name, loc) { await page.waitForTimeout(400); if (await loc.count()) { await loc.first().screenshot({ path: path.join(OUT, `${screen}-${name}.png`) }); texts.push(`\n■ ${screen}-${name}\n${one(await loc.first().innerText())}`); console.log('■', name); } else console.log('  없음', name); }
const safe = async (label, fn) => { try { await fn(); } catch (e) { console.log(`  ✗ ${label}: ${String(e.message || e).split('\n')[0].slice(0, 160)}`); } };
(async () => {
  const browser = await chromium.launch();
  const G = 'gallery@artlink.com', A = 'artist1@artlink.com', A2 = 'artist2@artlink.com';
  const ov = await api(G, '/exhibitions/my-operation-overview');
  const byN = (n) => ov.find((e) => e.title.startsWith(`[단계 ${String(n).padStart(2, '0')}]`));
  const g = await open(browser, G);
  const go = async (n, panel) => { const ex = byN(n); await g.page.goto(`/mypage?tab=my-exhibitions&ex=${ex.id}${panel ? `&panel=${panel}` : ''}`); await g.page.waitForLoadState('networkidle'); await g.page.waitForTimeout(900); return g.page.locator(`#ex-card-${ex.id}`); };

  await safe('지원자 펼침', async () => {
    const card = await go(3, 'applicants');
    await card.getByText('배소민', { exact: true }).first().click();
    await g.page.waitForTimeout(700);
    await el(g.page, 'x1-applicant-open', card);
    await card.getByLabel('Artist 1 선택').check(); await card.getByLabel('서진우 선택').check();
    await g.page.waitForTimeout(400);
    await vp(g.page, 'x2-applicant-bulk');
    await safe('수락 확인창', async () => { await card.getByRole('button', { name: '수락하기' }).first().click(); await g.page.waitForTimeout(500); await el(g.page, 'x3-accept-dialog', g.page.getByRole('dialog')); await g.page.keyboard.press('Escape'); });
  });
  await safe('모집 마감 확인창', async () => {
    const card = await go(3, 'operation');
    await el(g.page, 'x4-stage3-operation', card);
    await card.getByRole('button', { name: /모집 마감하기/ }).click(); await g.page.waitForTimeout(500);
    await el(g.page, 'x5-close-dialog', g.page.getByRole('dialog')); await g.page.keyboard.press('Escape');
  });
  await safe('전시 확정 확인창', async () => {
    const card = await go(5, 'operation');
    await card.getByRole('button', { name: /전시 확정하기/ }).click(); await g.page.waitForTimeout(500);
    await el(g.page, 'x6-confirm-dialog', g.page.getByRole('dialog')); await g.page.keyboard.press('Escape');
    await g.page.waitForTimeout(300);
    // 출품 자료 한 명 펼침
    await card.getByText('배소민', { exact: true }).first().click(); await g.page.waitForTimeout(800);
    await el(g.page, 'x7-submission-open', card);
    await safe('내려받기 메뉴', async () => { await card.getByRole('button', { name: /내려받기/ }).first().click(); await g.page.waitForTimeout(400); await vp(g.page, 'x8-download-menu'); await g.page.keyboard.press('Escape'); });
  });
  await safe('전시 종료 확인창', async () => {
    const card = await go(7, 'operation');
    await card.getByRole('button', { name: /전시 종료하기/ }).click(); await g.page.waitForTimeout(500);
    await el(g.page, 'x9-end-dialog', g.page.getByRole('dialog')); await g.page.keyboard.press('Escape');
  });
  await safe('판매 입력', async () => {
    const card = await go(8, 'operation');
    await card.getByRole('button', { name: '판매 입력' }).first().click(); await g.page.waitForTimeout(700);
    await vp(g.page, 'x10-sales-input-viewport');
    await el(g.page, 'x10-sales-input', card);
  });
  await safe('정산 완료 확인창', async () => {
    const card = await go(10, 'operation');
    await card.getByRole('button', { name: '정산 완료', exact: true }).click(); await g.page.waitForTimeout(500);
    await el(g.page, 'x11-settle-dialog', g.page.getByRole('dialog')); await g.page.keyboard.press('Escape');
  });
  await safe('종료 탭', async () => { await g.page.goto('/mypage?tab=my-exhibitions'); await g.page.waitForLoadState('networkidle'); await g.page.getByRole('tab', { name: /종료/ }).click().catch(async () => { await g.page.getByText(/^종료/).first().click(); }); await g.page.waitForTimeout(700); await g.page.screenshot({ path: path.join(OUT, `${screen}-x12-gallery-closed-tab.png`), fullPage: true }); console.log('■ x12'); });
  await safe('갤러리 알림', async () => { await g.page.getByRole('button', { name: '알림' }).first().click(); await g.page.waitForTimeout(700); await vp(g.page, 'x13-gallery-bell'); });
  await g.ctx.close();

  const a = await open(browser, A);
  const apps = await api(A, '/exhibitions/my-applications');
  const appOf = (n) => apps.find((x) => x.exhibition.title.startsWith(`[단계 ${String(n).padStart(2, '0')}]`));
  await safe('작가 제출 완료 펼침', async () => {
    const app = appOf(5); await a.page.goto(`/mypage?tab=applications&ex=${app.exhibitionId}`); await a.page.waitForLoadState('networkidle'); await a.page.waitForTimeout(900);
    const card = a.page.locator(`#app-card-${app.id}`);
    await card.getByText('출품 자료', { exact: true }).first().click(); await a.page.waitForTimeout(800);
    await el(a.page, 'y1-artist-submitted-open', card);
  });
  await safe('작가 문제 제기', async () => {
    const app = appOf(9); await a.page.goto(`/mypage?tab=applications&ex=${app.exhibitionId}`); await a.page.waitForLoadState('networkidle'); await a.page.waitForTimeout(900);
    const card = a.page.locator(`#app-card-${app.id}`);
    await card.getByRole('button', { name: '문제 제기' }).click(); await a.page.waitForTimeout(500);
    await el(a.page, 'y2-artist-issue', card);
    await vp(a.page, 'y2-artist-issue-viewport');
  });
  await safe('작가 탭들', async () => {
    await a.page.goto('/mypage?tab=applications'); await a.page.waitForLoadState('networkidle');
    await a.page.screenshot({ path: path.join(OUT, `${screen}-y3-artist-list-full.png`), fullPage: true });
    for (const t of ['심사 중', '종료']) { await a.page.getByRole('tab', { name: new RegExp(t) }).click().catch(() => {}); await a.page.waitForTimeout(600); await a.page.screenshot({ path: path.join(OUT, `${screen}-y4-artist-tab-${t.replace(' ', '')}.png`), fullPage: true }); }
    console.log('■ y3,y4');
  });
  await safe('작가 알림', async () => { await a.page.getByRole('button', { name: '알림' }).first().click(); await a.page.waitForTimeout(700); await vp(a.page, 'y5-artist-bell'); });
  await a.ctx.close();

  const b = await open(browser, A2);
  await safe('지원서', async () => {
    const ex = byN(3);
    await b.page.goto(`/exhibitions/${ex.id}`); await b.page.waitForLoadState('networkidle'); await vp(b.page, 'z1-detail-viewport');
    await b.page.goto(`/exhibitions/${ex.id}/apply`); await b.page.waitForLoadState('networkidle'); await b.page.waitForTimeout(700); await vp(b.page, 'z2-apply-viewport');
    await b.page.getByRole('button', { name: /지원하기/ }).last().click(); await b.page.waitForTimeout(700); await vp(b.page, 'z3-apply-error-viewport');
  });
  await b.ctx.close();
  await browser.close();
  fs.writeFileSync(path.join(OUT, `${screen}-texts2.txt`), texts.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
