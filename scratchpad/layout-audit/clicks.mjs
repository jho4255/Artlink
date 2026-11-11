/**
 * 눌러야 열리는 것 점검 — 알림 목록 · 휴대폰 메뉴 · '이웃에게 메시지' · PDF 저장 창 · 작품 고르기 (2026-11-11, walk.mjs 의 짝)
 * 데모 묶음(5174 → 4001)만 쓴다. ⚠️ 로컬 전용.  node scratchpad/layout-audit/clicks.mjs [--out=DIR]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit } from '../../e2e/node_modules/playwright/index.mjs';
import { DETECT } from './detect.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const OUT = args.out || path.join(process.env.TMPDIR || '/tmp', 'layout-audit-clicks');
fs.mkdirSync(OUT, { recursive: true });
const WEB = 'http://localhost:5174';
const API = 'http://localhost:4001/api';
const WEBKIT_RUN = path.join(process.env.HOME, '.cache/wk-deps/run.sh');

const login = async (email) => (await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) })).json();
const CASES = [
  { who: 'artist1@artlink.com', path: '/', click: ['button', '알림'], label: 'bell-dropdown' },
  { who: 'artist1@artlink.com', path: '/', click: ['button', '메뉴 열기'], label: 'mobile-menu', mobileOnly: true },
  { who: 'artist1@artlink.com', path: '/messages', click: ['button', '이웃에게 메시지'], label: 'neighbor-picker' },
  { who: 'artist1@artlink.com', path: '/mypage?tab=portfolio', click: ['button', 'PDF 저장'], label: 'pdf-save-dialog' },
  { who: 'artist1@artlink.com', path: '/mypage?tab=portfolio', click: ['button', '작품 고르기'], label: 'work-picker' },
  { who: 'gallery@artlink.com', path: '/', click: ['button', '알림'], label: 'gallery-bell' },
  { who: 'admin@artlink.com', path: '/', click: ['button', '메뉴 열기'], label: 'admin-mobile-menu', mobileOnly: true },
];
const rows = [];
for (const [eng, ws] of [['chromium', [360, 412, 1280]], ['webkit', [390]]]) {
  if (eng === 'webkit' && !fs.existsSync(WEBKIT_RUN)) continue;
  const browser = await (eng === 'webkit' ? webkit : chromium).launch(eng === 'webkit' ? { executablePath: WEBKIT_RUN } : {});
  for (const w of ws) for (const c of CASES) {
    if (c.mobileOnly && w >= 1024) continue;
    const a = await login(c.who);
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 700 ? 820 : 900 }, ...(eng === 'chromium' && w < 700 ? { isMobile: true, hasTouch: true } : {}) });
    await ctx.addInitScript((a) => {
      localStorage.setItem('artlink-member-device', '1');
      localStorage.setItem('artlink-auth', JSON.stringify({ state: { user: a.user, token: a.token, isAuthenticated: true }, version: 0 }));
      localStorage.setItem('artlink-homepage-nudge-snooze', JSON.stringify({ [String(a.user.id)]: 8.64e15 }));
      localStorage.setItem('artlink-intro-hidden', JSON.stringify({ [String(a.user.id)]: Date.now() }));
    }, a);
    const page = await ctx.newPage();
    const rec = { engine: eng, width: w, label: c.label };
    try {
      await page.goto(WEB + c.path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2200);
      const btn = page.getByRole(c.click[0], { name: c.click[1], exact: true }).first();
      if (!(await btn.isVisible().catch(() => false))) { rec.skipped = '버튼이 안 보임'; }
      else {
        await btn.click();
        await page.waitForTimeout(1200);
        Object.assign(rec, await page.evaluate(DETECT));
        const bad = rec.page > 1 || rec.clip.length || rec.spill.length || rec.offscreen.length;
        await page.screenshot({ path: path.join(OUT, `${eng}-${w}-${c.label}.png`) });
        rec.bad = !!bad;
      }
    } catch (e) { rec.error = String(e).slice(0, 160); }
    console.log(`${rec.error ? '!' : rec.skipped ? '-' : rec.bad ? '✗' : '✓'} ${eng} ${w} ${c.label}${rec.skipped ? ' (' + rec.skipped + ')' : ''}${rec.bad ? ` clip${rec.clip.length} spill${rec.spill.length} off${rec.offscreen.length} page+${rec.page}` : ''}`);
    rows.push(rec);
    await ctx.close();
  }
  await browser.close();
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rows, null, 1));
