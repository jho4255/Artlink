// 공모 흐름 리뷰(2026-11-20) — 단계별 화면을 갤러리·작가 × PC·휴대폰으로 찍고 글을 뽑는다.
// ⚠️ 데모 DB 전용(5183 → 4001). 먼저: seed-gallery-artists.ts → seed-flow-stages.ts (backend, DATABASE_URL=…/artlink)
//   node scratchpad/flow-review-2026-11/shots.cjs [pc|mobile]
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.resolve(__dirname, '../../e2e/node_modules/@playwright/test'));
const BASE = 'http://localhost:5183';
const API = 'http://localhost:4001/api';
const OUT = path.join(__dirname, 'out');
const screen = process.argv[2] || 'pc';
const VP = screen === 'pc' ? { viewport: { width: 1280, height: 800 } } : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
const cache = {};
async function login(email) {
  if (cache[email]) return cache[email];
  const r = await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!r.ok) throw new Error('dev-login ' + r.status);
  return (cache[email] = await r.json());
}
async function api(email, url) {
  const { token } = await login(email);
  const r = await fetch(API + url, { headers: { Authorization: 'Bearer ' + token } });
  return r.json();
}
async function open(browser, email) {
  const opts = { ...VP, baseURL: BASE, locale: 'ko-KR', timezoneId: 'Asia/Seoul' };
  if (email) {
    const { token, user } = await login(email);
    opts.storageState = { cookies: [], origins: [{ origin: BASE, localStorage: [
      { name: 'artlink-auth', value: JSON.stringify({ state: { token, user, isAuthenticated: true }, version: 0 }) },
      { name: 'artlink-homepage-nudge-snooze', value: JSON.stringify({ [String(user.id)]: 8.64e15 }) },
      { name: 'artlink-intro-hidden', value: JSON.stringify({ [String(user.id)]: true }) },
    ] }] };
  }
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  ⚠ pageerror', String(e).slice(0, 200)));
  return { ctx, page };
}
const one = (s, n = 1600) => s.replace(/\n+/g, ' / ').slice(0, n);
const texts = [];
async function snap(page, name, locator) {
  await page.waitForTimeout(600);
  const file = path.join(OUT, `${screen}-${name}.png`);
  if (locator && (await locator.count())) await locator.first().screenshot({ path: file }).catch((e) => console.log('  shot 실패', e.message));
  else await page.screenshot({ path: file, fullPage: false });
  const t = locator && (await locator.count()) ? await locator.first().innerText() : await page.locator('body').innerText();
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  const box = locator && (await locator.count()) ? await locator.first().boundingBox() : null;
  texts.push(`\n■ ${screen}-${name}  (페이지 ${h}px${box ? ` · 카드 ${Math.round(box.width)}×${Math.round(box.height)}` : ''})\n${one(t)}`);
  console.log(`■ ${name} ${box ? Math.round(box.height) + 'px' : ''}`);
}
(async () => {
  const browser = await chromium.launch();
  const G = 'gallery@artlink.com', A = 'artist1@artlink.com', A2 = 'artist2@artlink.com';
  const ov = await api(G, '/exhibitions/my-operation-overview');
  const stages = ov.filter((e) => /^\[단계/.test(e.title)).sort((a, b) => a.id - b.id);
  const byN = (n) => stages.find((e) => e.title.startsWith(`[단계 ${String(n).padStart(2, '0')}]`));

  // ── 갤러리 ──
  const g = await open(browser, G);
  await g.page.goto('/mypage?tab=my-exhibitions'); await g.page.waitForLoadState('networkidle');
  await snap(g.page, 'g00-list-top');
  await g.page.screenshot({ path: path.join(OUT, `${screen}-g00-list-full.png`), fullPage: true });
  for (const n of [3, 4, 5, 6, 7, 8, 9, 10, 11, 13]) {
    const ex = byN(n); if (!ex) continue;
    // 접힌 카드
    await g.page.goto(`/mypage?tab=my-exhibitions&ex=${ex.id}`); await g.page.waitForLoadState('networkidle'); await g.page.waitForTimeout(700);
    const card = g.page.locator(`#ex-card-${ex.id}`);
    if (!(await card.count())) { console.log('  카드 없음', n); continue; }
    await snap(g.page, `g${String(n).padStart(2, '0')}-card`, card);
    // 지원자 패널
    if ([3, 4, 8, 13].includes(n)) {
      await g.page.goto(`/mypage?tab=my-exhibitions&ex=${ex.id}&panel=applicants`); await g.page.waitForLoadState('networkidle'); await g.page.waitForTimeout(900);
      await snap(g.page, `g${String(n).padStart(2, '0')}-applicants`, g.page.locator(`#ex-card-${ex.id}`));
      await g.page.screenshot({ path: path.join(OUT, `${screen}-g${String(n).padStart(2, '0')}-applicants-viewport.png`) });
    }
    // 운영 패널
    if (n >= 4 && n !== 13) {
      await g.page.goto(`/mypage?tab=my-exhibitions&ex=${ex.id}&panel=operation`); await g.page.waitForLoadState('networkidle'); await g.page.waitForTimeout(1200);
      await snap(g.page, `g${String(n).padStart(2, '0')}-operation`, g.page.locator(`#ex-card-${ex.id}`));
      await g.page.screenshot({ path: path.join(OUT, `${screen}-g${String(n).padStart(2, '0')}-operation-viewport.png`) });
    }
  }
  await g.ctx.close();

  // ── 작가 ──
  const a = await open(browser, A);
  await a.page.goto('/mypage?tab=applications'); await a.page.waitForLoadState('networkidle');
  await snap(a.page, 'a00-list-top');
  await a.page.screenshot({ path: path.join(OUT, `${screen}-a00-list-full.png`), fullPage: true });
  const apps = await api(A, '/exhibitions/my-applications');
  for (const app of apps.filter((x) => /^\[단계/.test(x.exhibition.title)).sort((x, y) => x.exhibitionId - y.exhibitionId)) {
    const n = app.exhibition.title.slice(4, 6);
    await a.page.goto(`/mypage?tab=applications&ex=${app.exhibitionId}`); await a.page.waitForLoadState('networkidle'); await a.page.waitForTimeout(1100);
    const card = a.page.locator(`#app-card-${app.id}`);
    if (!(await card.count())) { console.log('  작가 카드 없음', n); continue; }
    await snap(a.page, `a${n}-card`, card);
    await a.page.screenshot({ path: path.join(OUT, `${screen}-a${n}-viewport.png`) });
  }
  await a.ctx.close();

  // ── 지원 전: 공모 상세 → 지원서 (작가 2) ──
  const b = await open(browser, A2);
  const ex3 = byN(3);
  await b.page.goto(`/exhibitions/${ex3.id}`); await b.page.waitForLoadState('networkidle');
  await snap(b.page, 'b03-detail');
  await b.page.goto(`/exhibitions/${ex3.id}/apply`); await b.page.waitForLoadState('networkidle'); await b.page.waitForTimeout(800);
  await snap(b.page, 'b03-apply-top');
  await b.page.screenshot({ path: path.join(OUT, `${screen}-b03-apply-full.png`), fullPage: true });
  texts.push('\n■ 지원서 전체 글\n' + one(await b.page.locator('main').last().innerText(), 4000));
  await b.ctx.close();
  await browser.close();
  fs.writeFileSync(path.join(OUT, `${screen}-texts.txt`), texts.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
