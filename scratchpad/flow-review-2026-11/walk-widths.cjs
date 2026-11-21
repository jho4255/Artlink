// 공모 흐름 개편(규칙 88) DEV-01 — 화면 폭 8종 × 단계 01~13 × 갤러리·작가. 데모 DB 전용(5183 → 4001).
// 사용: node walk-widths.cjs            (크롬)   ·  ENGINE=webkit node walk-widths.cjs  (사파리 엔진)
// 재는 것: ① 가로 밀림 0 ② 1024 미만 — 하단 고정 줄이 탭바 위에서 눌린다 ③ 1024 미만 — 본문 터치 대상 40px 미만(이름만 기록)
//          ④ 떠 있는 메뉴([내려받기]·[⋯]·[관리 ▾])가 화면 안 · 항목이 전부 눌린다 ⑤ 페이지 오류 0
// 실패만 스크린숏을 남긴다(out-widths/).
const path = require('path');
const pw = require(path.resolve(__dirname, '../../e2e/node_modules/@playwright/test'));
const ENGINE = process.env.ENGINE || 'chromium';
const launcher = ENGINE === 'webkit' ? pw.webkit : pw.chromium;
const BASE = 'http://localhost:5183', API = 'http://localhost:4001/api';
const OUT = path.join(__dirname, 'out-widths');
require('fs').mkdirSync(OUT, { recursive: true });
const WIDTHS = (process.env.WIDTHS || '360,390,412,768,1024,1180,1280,1440').split(',').map(Number);

async function login(email) {
  return (await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })).json();
}
function ctxFor(browser, who, w) {
  const mobile = w < 768;
  const opts = { viewport: { width: w, height: mobile ? 844 : 900 }, baseURL: BASE, locale: 'ko-KR', timezoneId: 'Asia/Seoul', hasTouch: w < 1024, deviceScaleFactor: 2 };
  if (ENGINE !== 'webkit') opts.isMobile = mobile;
  return browser.newContext({ ...opts, storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [
    { name: 'artlink-auth', value: JSON.stringify({ state: { token: who.token, user: who.user, isAuthenticated: true }, version: 0 }) },
    { name: 'artlink-intro-hidden', value: JSON.stringify({ [String(who.user.id)]: true }) },
    { name: 'artlink-homepage-nudge-snooze', value: JSON.stringify({ [String(who.user.id)]: 8.64e15 }) },
  ] }] } });
}
const fails = [];
let checks = 0;
async function measure(page, label, w) {
  const m = await page.evaluate((narrow) => {
    const de = document.scrollingElement;
    const over = de.scrollWidth - window.innerWidth;
    const bars = [];
    if (narrow) {
      for (const sel of ['[data-workspace-bar]', '[data-submission-bar]', '[data-settle-bar]', '[data-bulk-bar]']) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.height === 0) continue;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 20));
        const tab = document.querySelector('nav[aria-label="하단 내비게이션"]');
        const tabTop = tab ? tab.getBoundingClientRect().top : window.innerHeight;
        bars.push({ sel, inside: !!hit && el.contains(hit), bottom: Math.round(r.bottom), tabTop: Math.round(tabTop) });
      }
    }
    const small = narrow ? [...document.querySelectorAll('main button, main a, main [role=tab]')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 40 && getComputedStyle(e).visibility !== 'hidden'; })
      .map((e) => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 18)) : [];
    return { over, bars, small };
  }, w < 1024);
  checks++;
  const bad = [];
  if (m.over > 0) bad.push(`가로 밀림 ${m.over}px`);
  for (const b of m.bars) {
    if (!b.inside) bad.push(`${b.sel} 가 가려짐`);
    if (b.bottom > b.tabTop + 1) bad.push(`${b.sel} 가 탭바 밑(${b.bottom} > ${b.tabTop})`);
  }
  if (bad.length) {
    fails.push(`[${ENGINE} ${w}] ${label}: ${bad.join(' · ')}`);
    await page.screenshot({ path: path.join(OUT, `${ENGINE}-${w}-${label.replace(/[^\w가-힣-]+/g, '_')}.png`) });
  }
  return m;
}
async function openMenuCheck(page, label, w, opener) {
  const btn = await opener();
  if (!btn || !(await btn.count())) return;
  await btn.first().click();
  await page.waitForTimeout(350);
  const r = await page.evaluate(() => {
    const m = [...document.querySelectorAll('[role=menu]')].pop();
    if (!m) return null;
    const box = m.getBoundingClientRect();
    const items = [...m.querySelectorAll('[role=menuitem]')];
    const allHit = items.every((it) => {
      const b = it.getBoundingClientRect();
      const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return !!h && it.contains(h);
    });
    return { left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), bottom: Math.round(box.bottom), vw: innerWidth, vh: innerHeight, allHit };
  });
  checks++;
  if (!r) { fails.push(`[${ENGINE} ${w}] ${label}: 메뉴가 안 열렸다`); return; }
  const bad = [];
  if (r.left < 0 || r.right > r.vw) bad.push(`메뉴가 화면 밖(${r.left}~${r.right} / ${r.vw})`);
  if (r.top < 0 || r.bottom > r.vh) bad.push(`메뉴가 위아래로 잘림(${r.top}~${r.bottom} / ${r.vh})`);
  if (!r.allHit) bad.push('눌리지 않는 항목이 있다');
  if (bad.length) {
    fails.push(`[${ENGINE} ${w}] ${label} 메뉴: ${bad.join(' · ')}`);
    await page.screenshot({ path: path.join(OUT, `${ENGINE}-${w}-${label.replace(/[^\w가-힣-]+/g, '_')}-menu.png`) });
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
}
async function settle(page, ms = 900) { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(ms); }

(async () => {
  const browser = await launcher.launch(ENGINE === 'webkit' ? { executablePath: require('os').homedir() + '/.cache/wk-deps/run.sh' } : {});
  const gallery = await login('gallery@artlink.com');
  const artist1 = await login('artist1@artlink.com');
  const mine = await (await fetch(`${API}/exhibitions/my-exhibitions`, { headers: { Authorization: `Bearer ${gallery.token}` } })).json();
  const ST = {};
  for (const e of (mine.exhibitions ?? mine)) { const m = /^\[단계 (\d+)\]/.exec(e.title); if (m) ST[Number(m[1])] = e.id; }
  if (Object.keys(ST).length < 13) { console.error('단계별 데모 공모가 없다 — seed-flow-stages.ts 를 먼저'); process.exit(2); }
  const errors = [];

  for (const w of WIDTHS) {
    // ── 갤러리 ──
    let ctx = await ctxFor(browser, gallery, w);
    let page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`[${ENGINE} ${w}] 갤러리 ${e.message}`));
    await page.goto('/mypage?tab=my-exhibitions'); await settle(page);
    await measure(page, 'g 목록', w);
    for (let n = 1; n <= 13; n++) {
      await page.goto(`/mypage?tab=my-exhibitions&ex=${ST[n]}`); await settle(page, 1100);
      await measure(page, `g 단계${n}`, w);
      await openMenuCheck(page, `g 단계${n} 더 보기`, w, async () => page.locator('[data-exhibition-workspace]').getByRole('button', { name: '더 보기' }));
    }
    // 출품 자료 [내려받기] · 지원자 [관리 ▾] · 정산 [정산서 받기]
    await page.goto(`/mypage?tab=my-exhibitions&ex=${ST[4]}&view=submissions`); await settle(page, 1100);
    await openMenuCheck(page, 'g 단계4 내려받기', w, async () => page.getByRole('button', { name: '내려받기' }));
    await page.goto(`/mypage?tab=my-exhibitions&ex=${ST[3]}&view=applicants`); await settle(page, 1100);
    await openMenuCheck(page, 'g 단계3 관리', w, async () => page.locator('[data-applicant-manager]').getByRole('button', { name: '관리' }));
    await page.goto(`/mypage?tab=my-exhibitions&ex=${ST[9]}&view=settlement`); await settle(page, 1100);
    await openMenuCheck(page, 'g 단계9 정산서 받기', w, async () => page.getByRole('button', { name: '정산서 받기' }));
    await ctx.close();

    // ── 작가 ──
    ctx = await ctxFor(browser, artist1, w);
    page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`[${ENGINE} ${w}] 작가 ${e.message}`));
    await page.goto('/mypage?tab=applications'); await settle(page);
    await measure(page, 'a 목록', w);
    for (const n of [3, 4, 5, 6, 9, 10, 11, 13]) {
      await page.goto(`/mypage?tab=applications&ex=${ST[n]}`); await settle(page, 1100);
      await measure(page, `a 단계${n}`, w);
    }
    await ctx.close();
  }
  await browser.close();
  console.log(`[${ENGINE}] 확인 ${checks}개 · 실패 ${fails.length} · 페이지 오류 ${errors.length}`);
  for (const f of fails) console.log('  ✗', f);
  for (const e of errors.slice(0, 10)) console.log('  !!', e);
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
