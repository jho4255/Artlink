// 히어로 [자세히 보기]·사이드바 광고 링크를 어디서 여는가 (2026-10-17, CLAUDE.md 규칙 48 · lib/siteLink.ts)
//
//   node scratchpad/hero/samelink.mjs [BASE]            BASE 기본 http://localhost:5173 (실서버면 https://artlink.cc)
//   ENGINE=webkit node scratchpad/hero/samelink.mjs …   사파리 엔진(~/.cache/wk-deps/run.sh, sudo 없이)
//
// 배너 응답만 이 브라우저 안에서 갈아끼워(서버·DB 는 안 건드린다) 세 가지를 PC·휴대폰에서 본다:
//   A 우리 사이트의 전체 주소(실서버 배너 그대로) → 같은 탭 · 뒤로가기로 홈
//   B 바깥 사이트 → 새 탭, 원래 탭은 홈 그대로 · 새 탭이 이 탭의 비회원 방문 번호를 복사해 가지 않는다(noopener)
//   C '/galleries' 같은 경로 → 같은 탭
// 로컬이면 로그인한 작가의 사이드바 광고도 본다(D). ⚠️ 실서버에서는 로그인하지 않는다.
// ⚠️ 실서버에서는 기록 요청을 막는다 — 페이지를 떠날 때 나가는 sendBeacon 은 page.route 를 거치지 않으므로 페이지 안에서 바꿔 끼운다(규칙 64).
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';

const BASE = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');
const PROD = !/localhost|127\.0\.0\.1/.test(BASE);
const wk = process.env.ENGINE === 'webkit';
const EXT = 'https://example.org/artlink-samelink-check';
const out = [];
const check = (name, ok, info = '') => { out.push(`${ok ? '✓' : '✗'} ${name}${info ? ` — ${info}` : ''}`); if (!ok) process.exitCode = 1; };

const browser = await (wk ? pw.webkit : pw.chromium).launch(wk ? { executablePath: `${process.env.HOME}/.cache/wk-deps/run.sh` } : {});

async function newCtx(mobile) {
  const ctx = await browser.newContext(mobile
    ? { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 3, ...(wk ? {} : { isMobile: true }) }
    : { viewport: { width: 1440, height: 900 } });
  if (PROD) {
    await ctx.addInitScript(() => {
      const orig = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
      navigator.sendBeacon = (url, data) => (/\/api\/(guest-activity|visits)/.test(String(url)) ? true : orig ? orig(url, data) : false);
    });
    await ctx.route(/\/api\/(guest-activity|visits)/, (r) => r.fulfill({ status: 204, body: '' }));
  }
  await ctx.route(EXT, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>바깥</title><p>바깥 사이트</p>' }));
  return ctx;
}

async function withBanner(ctx, linkUrl) {
  await ctx.unroute('**/api/hero-slides');
  await ctx.route('**/api/hero-slides', async (r) => {
    const res = await r.fetch();
    const list = await res.json();
    const one = (Array.isArray(list) && list[0]) || { id: 1, imageUrl: '/images/hero1.jpg', title: ' ' };
    await r.fulfill({ response: res, json: [{ ...one, linkUrl }] });
  });
}

const visitKey = (p) => p.evaluate(() => sessionStorage.getItem('artlink-guest-visit')).catch(() => 'ERR');

for (const mobile of [false, true]) {
  const tag = `${wk ? 'WebKit' : 'Chrome'} ${mobile ? '휴대폰 390' : 'PC 1440'}`;
  const ctx = await newCtx(mobile);

  // A — 우리 사이트의 전체 주소
  for (const own of [...new Set([`${BASE}/exhibitions`, 'https://artlink.cc/exhibitions'])]) {
    await withBanner(ctx, own);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: /자세히 보기/ }).first().waitFor({ timeout: 20000 });
    await p.waitForTimeout(800);
    await p.getByRole('button', { name: /자세히 보기/ }).first().click();
    const went = await p.waitForURL('**/exhibitions', { timeout: 10000 }).then(() => true, () => false);
    await p.waitForTimeout(800);
    check(`${tag} · A ${own.replace(/^https?:\/\//, '')} → 같은 탭`, went && ctx.pages().length === 1, `탭 ${ctx.pages().length} · ${new URL(p.url()).pathname}`);
    await p.goBack();
    const back = await p.waitForURL(`${BASE}/`, { timeout: 10000 }).then(() => true, () => false);
    check(`${tag} · A 뒤로가기 → 홈`, back, new URL(p.url()).pathname);
    await p.close();
  }

  // B — 바깥 사이트
  await withBanner(ctx, EXT);
  {
    const p = await ctx.newPage();
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: /자세히 보기/ }).first().waitFor({ timeout: 20000 });
    await p.waitForTimeout(3500);   // 비회원 방문 번호가 생길 때까지
    const mine = await visitKey(p);
    const popP = ctx.waitForEvent('page', { timeout: 10000 }).catch(() => null);
    await p.getByRole('button', { name: /자세히 보기/ }).first().click();
    const pop = await popP;
    if (pop) await pop.waitForLoadState('domcontentloaded');
    const popUrl = pop ? pop.url() : '';
    const opener = pop ? await pop.evaluate(() => window.opener === null).catch(() => 'ERR') : 'ERR';
    check(`${tag} · B 바깥 사이트 → 새 탭`, !!pop && popUrl.startsWith(EXT) && new URL(p.url()).pathname === '/', `새 탭 ${popUrl || '없음'} · 원래 탭 ${new URL(p.url()).pathname}`);
    check(`${tag} · B 새 탭은 원래 탭과 이어지지 않는다(noopener)`, opener === true, `opener 끊김 ${opener} · 원래 탭 방문 번호 ${mine ? '있음' : '없음'}`);
    if (pop) await pop.close();
    await p.close();
  }

  // C — 경로
  await withBanner(ctx, '/galleries');
  {
    const p = await ctx.newPage();
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: /자세히 보기/ }).first().waitFor({ timeout: 20000 });
    await p.waitForTimeout(800);
    await p.getByRole('button', { name: /자세히 보기/ }).first().click();
    const went = await p.waitForURL('**/galleries', { timeout: 10000 }).then(() => true, () => false);
    check(`${tag} · C /galleries → 같은 탭`, went && ctx.pages().length === 1, `탭 ${ctx.pages().length}`);
    await p.close();
  }

  // 실서버: 갈아끼우지 않은 진짜 배너
  if (PROD) {
    await ctx.unroute('**/api/hero-slides');
    const p = await ctx.newPage();
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const btn = p.getByRole('button', { name: /자세히 보기/ }).first();
    const has = await btn.waitFor({ timeout: 20000 }).then(() => true, () => false);
    if (has) {
      await p.waitForTimeout(800);
      await btn.click();
      await p.waitForTimeout(2500);
      check(`${tag} · 실제 배너 → 같은 탭`, ctx.pages().length === 1 && new URL(p.url()).pathname !== '/', `탭 ${ctx.pages().length} · ${new URL(p.url()).pathname}`);
    } else check(`${tag} · 실제 배너`, false, '[자세히 보기] 없음');
    await p.close();
  }
  await ctx.close();
}

// D — 로그인한 작가의 사이드바 광고(PC, 로컬 전용)
if (!PROD) {
  const API = BASE.replace(':5173', ':4000') + '/api';
  const login = await (await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'artist1@artlink.com' }) })).json();
  const ctx = await newCtx(false);
  await ctx.addInitScript(([token, user]) => {
    localStorage.setItem('artlink-auth', JSON.stringify({ state: { token, user, isAuthenticated: true }, version: 0 }));
    localStorage.setItem('artlink-homepage-nudge-snooze', JSON.stringify({ [user.id]: 8.64e15 }));
  }, [login.token, login.user]);
  for (const [name, linkUrl, same] of [['우리 사이트 전체 주소', 'https://artlink.cc/artists', true], ['바깥 사이트', EXT, false]]) {
    await ctx.unroute('**/api/ads');
    await ctx.route('**/api/ads', (r) => r.fulfill({ json: [{ id: 1, imageUrl: '/images/hero1.jpg', title: '광고', linkUrl }] }));
    const p = await ctx.newPage();
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const ad = p.getByRole('button', { name: /광고/ }).first();
    const has = await ad.waitFor({ timeout: 15000 }).then(() => true, () => false);
    if (!has) { check(`${wk ? 'WebKit' : 'Chrome'} PC · D 광고 ${name}`, false, '광고 칸 없음'); await p.close(); continue; }
    const popP = ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null);
    await ad.click();
    const pop = await popP;
    if (same) check(`${wk ? 'WebKit' : 'Chrome'} PC · D 광고 ${name} → 같은 탭`, !pop && new URL(p.url()).pathname === '/artists', `${new URL(p.url()).pathname}`);
    else check(`${wk ? 'WebKit' : 'Chrome'} PC · D 광고 ${name} → 새 탭`, !!pop && new URL(p.url()).pathname === '/', pop ? pop.url() : '없음');
    if (pop) await pop.close();
    await p.close();
  }
  await ctx.close();
}

await browser.close();
console.log(`${BASE} (${wk ? 'WebKit' : 'Chrome'})\n${out.join('\n')}\n${out.filter((l) => l.startsWith('✗')).length ? '실패 있음' : '전부 통과'}`);
