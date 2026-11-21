// 공모 흐름 개편(규칙 88) 화면 점검 — 데모 DB 전용(5183 → 4001). 크롬 기본, ENGINE=webkit 이면 사파리 엔진.
// 화면마다: 스크린샷 · 가로 밀림 · (휴대폰) 하단 고정 줄을 눌렀을 때 그 줄이 잡히는가 · 누르는 곳 44px 미만 개수
// 사용: node scratchpad/flow-review-2026-11/walk.cjs [only-substring]
const path = require('path');
const pw = require(path.resolve(__dirname, '../../e2e/node_modules/@playwright/test'));
const ENGINE = process.env.ENGINE || 'chromium';
const launcher = ENGINE === 'webkit' ? pw.webkit : pw.chromium;
const BASE = 'http://localhost:5183', API = 'http://localhost:4001/api';
const OUT = path.join(__dirname, 'out-impl');
require('fs').mkdirSync(OUT, { recursive: true });
const ONLY = process.argv[2] || '';

async function login(email) {
  const r = await (await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })).json();
  return r;
}
async function ctxFor(browser, who, screen) {
  const VP = screen === 'pc' ? { viewport: { width: 1280, height: 800 } } : { viewport: { width: 390, height: 844 }, isMobile: ENGINE !== 'webkit' || true, hasTouch: true, deviceScaleFactor: 2 };
  if (ENGINE === 'webkit' && screen !== 'pc') VP.isMobile = false; // WebKit 은 isMobile 미지원
  return browser.newContext({ ...VP, baseURL: BASE, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [
    { name: 'artlink-auth', value: JSON.stringify({ state: { token: who.token, user: who.user, isAuthenticated: true }, version: 0 }) },
    { name: 'artlink-intro-hidden', value: JSON.stringify({ [String(who.user.id)]: true }) },
    { name: 'artlink-homepage-nudge-snooze', value: JSON.stringify({ [String(who.user.id)]: 8.64e15 }) },
  ] }] } });
}
async function measure(page, label, screen, barSel) {
  const m = await page.evaluate((barSel) => {
    const de = document.scrollingElement;
    const over = de.scrollWidth - window.innerWidth;
    let bar = null;
    if (barSel) {
      const el = document.querySelector(barSel);
      if (el) {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        bar = { top: Math.round(r.top), bottom: Math.round(r.bottom), innerH: window.innerHeight, hitInside: !!hit && el.contains(hit) };
      } else bar = 'missing';
    }
    const small = [...document.querySelectorAll('main button, main a, main [role=tab], main input[type=checkbox]')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 40 && getComputedStyle(e).visibility !== 'hidden'; })
      .map((e) => (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 18)).slice(0, 8);
    return { over, bar, small };
  }, barSel);
  console.log(`[${ENGINE}] ${screen} ${label}: 가로밀림 ${m.over}px` + (m.bar ? ` · 하단줄 ${JSON.stringify(m.bar)}` : '') + (m.small.length ? ` · 40px 미만 ${JSON.stringify(m.small)}` : ''));
}
async function shot(page, name, full = false) {
  await page.screenshot({ path: path.join(OUT, `${ENGINE}-${name}.png`), fullPage: full });
}
async function settle(page, ms = 900) { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(ms); }

(async () => {
  const browser = await launcher.launch(ENGINE === 'webkit' ? { executablePath: require('os').homedir() + '/.cache/wk-deps/run.sh' } : {});
  const gallery = await login('gallery@artlink.com');
  const artist1 = await login('artist1@artlink.com');
  const artist2 = await login('artist2@artlink.com');
  const run = (key) => !ONLY || key.includes(ONLY);
  // 단계 n → 공모 id — 제목('[단계 0n]')으로 찾는다. 데모 DB 를 다시 깔면 번호가 밀린다(2026-11-20 실제로 한 칸 밀렸다)
  const mine = await (await fetch(`${API}/exhibitions/my-exhibitions`, { headers: { Authorization: `Bearer ${gallery.token}` } })).json();
  const ST = {};
  for (const e of (mine.exhibitions ?? mine)) { const m = /^\[단계 (\d+)\]/.exec(e.title); if (m) ST[Number(m[1])] = e.id; }
  console.log('단계 → id', JSON.stringify(ST));

  for (const screen of ['pc', 'mobile']) {
    // ── 갤러리 ──
    let ctx = await ctxFor(browser, gallery, screen);
    let page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('  !! pageerror', e.message));
    if (run('g-list')) {
      await page.goto('/mypage?tab=my-exhibitions'); await settle(page);
      await shot(page, `${screen}-g1-list`, true); await measure(page, 'g1 목록', screen);
    }
    const ws = async (id, key, after) => {
      if (!run(key)) return;
      await page.goto(`/mypage?tab=my-exhibitions&ex=${id}`); await settle(page, 1300);
      if (after) await after();
      await shot(page, `${screen}-${key}`); await measure(page, key, screen, screen === 'mobile' ? '[data-workspace-bar]' : null);
      await shot(page, `${screen}-${key}-full`, true);
    };
    await ws(ST[3], 'g2-ex03-applicants');
    if (run('g3-sheet') && screen === 'mobile') {
      await page.goto(`/mypage?tab=my-exhibitions&ex=${ST[3]}`); await settle(page, 1300);
      await page.locator('[data-applicant-manager] li button').first().click(); await page.waitForTimeout(700);
      await shot(page, `${screen}-g3-applicant-sheet`); await measure(page, 'g3 지원서 창', screen);
      // 고르기 → 일괄 줄
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      await page.locator('[data-applicant-manager] li input[type=checkbox]').first().check(); await page.waitForTimeout(300);
      await shot(page, `${screen}-g3b-bulk`); await measure(page, 'g3b 일괄 줄', screen, '[data-bulk-bar]');
    }
    await ws(ST[4], 'g4-ex04-submissions');
    if (run('g4b-menu') && screen === 'mobile') {   // PC 는 [내려받기]가 메뉴가 아니라 글자 버튼 줄이다
      // [내려받기] 메뉴 — 버튼을 화면 아래쪽(하단 줄 바로 위)에 두고 연다. 항목이 전부 눌리는가(2026-11-20 E2E 가 잡은 결함의 화면 확인)
      await page.goto(`/mypage?tab=my-exhibitions&ex=${ST[4]}&view=submissions`); await settle(page, 1300);
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('내려받기'));
        if (b) window.scrollBy(0, b.getBoundingClientRect().bottom - (window.innerHeight - 170));
      });
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: '내려받기' }).first().click(); await page.waitForTimeout(400);
      const r = await page.evaluate(() => {
        const m = document.querySelector('[role=menu]');
        if (!m) return { menu: false };
        const items = [...m.querySelectorAll('[role=menuitem]')];
        return { menu: true, up: m.hasAttribute('data-up'), n: items.length, all: items.every((it) => { const b = it.getBoundingClientRect(); const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!h && it.contains(h); }) };
      });
      console.log(`[${ENGINE}] ${screen} g4b 내려받기 메뉴: ${JSON.stringify(r)}`);
      await shot(page, `${screen}-g4b-download-menu`);
    }
    await ws(ST[5], 'g5-ex05-confirm');
    await ws(ST[8], 'g6-ex08-settle');
    await ws(ST[9], 'g7-ex09-issue');
    await ws(ST[10], 'g8-ex10-complete');
    await ws(ST[11], 'g9-ex11-summary');
    await ws(ST[12], 'g10-ex12-recruitonly');
    if (run('g11-close') ) {
      await page.goto(`/mypage?tab=my-exhibitions&ex=${ST[5]}`); await settle(page, 1300);
      const btn = screen === 'pc' ? page.locator('[data-task-bar] button', { hasText: '전시 확정' }) : page.locator('[data-workspace-bar] button', { hasText: '전시 확정' });
      await btn.first().click(); await page.waitForTimeout(500);
      await shot(page, `${screen}-g11-confirm-dialog`);
      await page.keyboard.press('Escape');
      await page.goto(`/mypage?tab=my-exhibitions&ex=${ST[3]}`); await settle(page, 1300);
      const close = screen === 'pc' ? page.locator('[data-task-bar] button', { hasText: '모집 마감' }) : page.locator('[data-workspace-bar] button', { hasText: '모집 마감' });
      await close.first().click(); await page.waitForTimeout(500);
      await shot(page, `${screen}-g11b-close-dialog`);
    }
    await ctx.close();

    // ── 작가 ──
    ctx = await ctxFor(browser, artist1, screen);
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('  !! pageerror', e.message));
    if (run('a-list')) {
      await page.goto('/mypage?tab=applications'); await settle(page);
      await shot(page, `${screen}-a1-list`, true); await measure(page, 'a1 목록', screen);
    }
    const aw = async (id, key, after) => {
      if (!run(key)) return;
      await page.goto(`/mypage?tab=applications&ex=${id}`); await settle(page, 1300);
      if (after) await after();
      await shot(page, `${screen}-${key}`); await measure(page, key, screen, '[data-submission-bar], [data-settle-bar]');
      await shot(page, `${screen}-${key}-full`, true);
    };
    await aw(ST[4], 'a2-ex04-submit');
    await aw(ST[9], 'a3-ex09-settle');
    if (run('a4-issue')) {
      await page.goto(`/mypage?tab=applications&ex=${ST[9]}`); await settle(page, 1300);
      await page.locator('[data-settle-bar] button', { hasText: '이의 제기' }).click(); await page.waitForTimeout(500);
      await page.locator('#settle-issue-text').fill("'수평선' 판매가가 다릅니다. 150만 원에 팔렸어요.");
      await shot(page, `${screen}-a4-issue-dialog`);
    }
    await aw(ST[11], 'a5-ex11-settled');
    await aw(ST[3], 'a6-ex03-reviewing');
    if (run('b3-apply-sheet')) {
      // 홈페이지 내용으로 채워진 지원서 → [지원하기] → 확인 창(약관은 창 안)
      await page.goto(`/exhibitions/${ST[12]}/apply`); await settle(page, 1800);
      // 데모 DB 를 새로 깔면 Artist 1 홈페이지에 작품 사진이 없다 — 한 장 올려 둔다(빈 칸 안내는 정상 동작)
      if (await page.locator('#apply-images img').count() === 0) {
        const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        await page.locator('#apply-images input[type="file"]').first().setInputFiles({ name: 'art.png', mimeType: 'image/png', buffer: PNG });
        await page.locator('#apply-images img[src*="/uploads/"]').first().waitFor({ timeout: 12000 });
        await page.waitForTimeout(900);   // 올린 직후 상태가 자리 잡을 때까지(바로 누르면 하니스만 헛돈다 — 사람 손으로는 안 생긴다)
      }
      const bio = page.getByPlaceholder('작가 소개·약력을 입력하세요.');
      if (!(await bio.inputValue())) await bio.fill('데모 약력');
      await page.getByRole('button', { name: '지원하기', exact: true }).click(); await page.waitForTimeout(700);
      await shot(page, `${screen}-b3-apply-sheet`);
      await page.getByRole('dialog').getByRole('button', { name: '지원하기' }).click(); await page.waitForTimeout(400);
      await shot(page, `${screen}-b3b-apply-nag`);
      await page.getByRole('dialog').getByRole('button', { name: '약관 보기' }).click(); await page.waitForTimeout(700);
      await shot(page, `${screen}-b3c-apply-terms`);
    }
    await ctx.close();

    // ── 작가2: 빈 목록 · 지원서 ──
    ctx = await ctxFor(browser, artist2, screen);
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('  !! pageerror', e.message));
    if (run('b-empty')) {
      await page.goto('/mypage?tab=applications'); await settle(page);
      await shot(page, `${screen}-b1-empty`); await measure(page, 'b1 빈 목록', screen);
    }
    if (run('b-apply')) {
      await page.goto(`/exhibitions/${ST[3]}/apply`); await settle(page, 1500);
      await shot(page, `${screen}-b2-apply`); await measure(page, 'b2 지원서', screen);
    }
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
