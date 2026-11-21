// 관리자 화면 개편 뒤(2026-11-21) — PC·휴대폰으로 찍고 가로 넘침·작은 누를 것·페이지 오류를 센다.
// ⚠️ 데모 DB 전용(5183 → 4001).  node scratchpad/admin-review-2026-11/shots-after.cjs [pc|mobile] [webkit]
const path = require('path');
const pw = require(path.resolve(__dirname, '../../e2e/node_modules/@playwright/test'));
const BASE = 'http://localhost:5183';
const API = 'http://localhost:4001/api';
const OUT = path.join(__dirname, 'out');
const screen = process.argv[2] || 'pc';
const engine = process.argv[3] === 'webkit' ? pw.webkit : pw.chromium;
const tag = `${screen}${process.argv[3] === 'webkit' ? '-wk' : ''}`;
const VP = screen === 'pc' ? { viewport: { width: 1440, height: 900 } } : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
(async () => {
  const r = await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@artlink.com' }) });
  const { token, user } = await r.json();
  const browser = await engine.launch(process.argv[3] === 'webkit' ? { executablePath: process.env.HOME + '/.cache/wk-deps/run.sh' } : {});
  const ctx = await browser.newContext({ ...VP, baseURL: BASE, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [
    { name: 'artlink-auth', value: JSON.stringify({ state: { token, user, isAuthenticated: true }, version: 0 }) },
    { name: 'artlink-intro-hidden', value: JSON.stringify({ [String(user.id)]: true }) },
  ] }] } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  const measure = async (name) => {
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(800);
    const m = await page.evaluate(() => {
      const main = document.querySelector('main') || document.body;
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const clickable = [...main.querySelectorAll('button, a[href], select, input')].filter(vis);
      const small = clickable.filter((el) => el.getBoundingClientRect().height < 32).map((el) => (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20));
      let tiny = 0; const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT); let n;
      while ((n = walker.nextNode())) { if (!n.textContent.trim()) continue; const el = n.parentElement; if (el && vis(el) && parseFloat(getComputedStyle(el).fontSize) < 12) tiny += n.textContent.trim().length; }
      return { h: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, vw: innerWidth, clickable: clickable.length, small, tiny };
    });
    console.log(`■ ${tag}-${name}  높이 ${m.h} · 넓이 ${m.sw}/${m.vw}${m.sw > m.vw ? ' ⚠ 가로 넘침' : ''} · 누를 것 ${m.clickable} · 32px 미만 ${m.small.length}${m.small.length ? ' ' + JSON.stringify(m.small.slice(0, 6)) : ''} · 12px 미만 글자 ${m.tiny}`);
    await page.screenshot({ path: path.join(OUT, `after-${tag}-${name}.png`), fullPage: true, clip: { x: 0, y: 0, width: m.vw, height: Math.min(m.h, 3200) } });
  };
  const go = async (url, name, after) => { await page.goto(url); await page.waitForTimeout(500); if (after) await after(); await measure(name); };
  await go('/mypage', 'stats-summary');
  for (const [tab, name] of [['방문', 'stats-visits'], ['회원', 'stats-members'], ['공모·지원', 'stats-calls'], ['갤러리·전시', 'stats-galleries'], ['기능 사용', 'stats-usage']]) {
    await go('/mypage', name, async () => { await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click(); });
  }
  await go('/mypage?tab=approvals', 'approvals');
  if (screen !== 'pc') await go('/mypage?tab=approvals', 'approvals-sheet', async () => { const b = page.locator('ul[aria-label="기다리는 요청"] button').first(); if (await b.count()) await b.click(); });
  await go('/mypage?tab=approvals', 'approvals-history', async () => { await page.getByRole('tab', { name: /처리한 요청/ }).click(); });
  await go('/mypage?tab=hosted-exhibitions', 'hosted');
  await go('/mypage?tab=hosted-exhibitions', 'hosted-workspace', async () => { const b = page.locator('[data-hosted-row] button').first(); if (await b.count()) { await b.click(); await page.waitForTimeout(1200); } });
  await go('/mypage?tab=hosted-exhibitions&new=1', 'hosted-new');
  await go('/mypage?tab=user-manage', 'users');
  await go('/mypage?tab=user-manage', 'users-detail', async () => { const b = page.locator('[role="row"] button, ul[aria-label="회원"] button').first(); if (await b.count()) { await b.click(); await page.waitForTimeout(800); } });
  await go('/mypage?tab=oversight', 'oversight');
  await go('/mypage?tab=oversight', 'oversight-detail', async () => { const b = page.locator('[data-ov-row] button').first(); if (await b.count()) { await b.click(); await page.waitForTimeout(900); } });
  await go('/mypage?tab=oversight', 'oversight-galleries', async () => { await page.getByRole('tab', { name: /^갤러리/ }).click(); });
  console.log(errors.length ? `⚠ 페이지 오류 ${errors.length}: ${errors.join(' | ')}` : '페이지 오류 0');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
