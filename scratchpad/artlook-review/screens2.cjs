// 개편 화면 캡처 — 복제본(4000/5173) · 가상 작가(676) · 아무것도 쓰지 않는다(저장은 내려받기만)
//   SCREEN=iphone13,pc1440 node screens2.cjs   → shots2/<화면>-<단계>.png + 기하 한 줄
const fs = require('fs'); const path = require('path');
const pw = require('/home/jho4255/ArtLink/e2e/node_modules/playwright');
const BASE = 'http://localhost:5173', API = 'http://localhost:4000/api';
const OUT = path.join(__dirname, process.env.OUT || 'shots2'); fs.mkdirSync(OUT, { recursive: true });
const SCREENS = {
  iphone13: { viewport: { width: 390, height: 664 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  se: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  pixel7: { viewport: { width: 412, height: 839 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ipad: { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  pc1024: { viewport: { width: 1024, height: 768 } },
  pc1280: { viewport: { width: 1280, height: 720 } },
  pc1440: { viewport: { width: 1440, height: 900 } },
};
const only = (process.env.SCREEN || 'iphone13,pc1440').split(',');
const STEPS = (process.env.STEPS || 'reco,works,frames,scenes,finish,save').split(',');
(async () => {
  const r = await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'intro-sample@artlink.test' }) });
  const acc = await r.json();
  if (!r.ok || acc.user.id !== 676) throw new Error('가상 계정 로그인 실패 ' + r.status);
  const browser = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const name of only) {
    const ctx = await browser.newContext({ ...SCREENS[name], serviceWorkers: 'block', acceptDownloads: true, storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [
      { name: 'artlink-auth', value: JSON.stringify({ state: { token: acc.token, user: acc.user, isAuthenticated: true }, version: 0 }) },
      { name: 'artlink-homepage-nudge-snooze', value: JSON.stringify({ [String(acc.user.id)]: 8.64e15 }) },
      { name: 'artlink-member-device', value: '1' },
    ] }] } });
    await ctx.addInitScript(() => { try { navigator.sendBeacon = () => true; } catch {} });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
    await page.goto(`${BASE}/mypage?tab=artlook`, { waitUntil: 'domcontentloaded' });
    const h = await page.waitForSelector('iframe[title="ArtLook"]', { state: 'attached', timeout: 60000 });
    const frame = await h.contentFrame();
    await frame.waitForFunction(() => (window.__artlookRenders || 0) >= 1 && document.getElementById('busy').hidden, null, { timeout: 90000 });
    await page.waitForTimeout(1500);
    const geo = await page.evaluate(() => {
      const nav = document.querySelector('header nav, nav[aria-label="주 메뉴"]');
      const bar = document.querySelector('nav[aria-label="하단 내비게이션"]');
      const ifr = document.querySelector('iframe[title="ArtLook"]').getBoundingClientRect();
      return { navbar: !!document.querySelector('header') && getComputedStyle(document.querySelector('header')).display !== 'none', bottomBar: !!bar && getComputedStyle(bar).display !== 'none', ifr: [Math.round(ifr.top), Math.round(ifr.height)], vh: innerHeight };
    });
    const inner = await frame.evaluate(() => {
      const r = (id) => { const e = document.getElementById(id); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
      return { bare: document.documentElement.classList.contains('bare'), preview: r('preview'), dl: r('dl'), saveOpen: r('saveOpen'), story: !document.getElementById('toStory').hidden, renders: window.__artlookRenders };
    });
    console.log(name, JSON.stringify(geo), JSON.stringify(inner));
    const shot = (tag) => page.screenshot({ path: path.join(OUT, `${name}-${tag}.png`) });
    for (const st of STEPS) {
      if (st === 'save') {
        if (inner.bare && inner.saveOpen && inner.saveOpen[2] > 0) { await frame.locator('#saveOpen').click(); await page.waitForTimeout(600); await shot('save'); await page.keyboard.press('Escape'); }
        continue;
      }
      const tab = frame.locator('#tab-' + st);
      if (!(await tab.isVisible())) { console.log(name, st, '탭 없음'); continue; }
      await tab.click(); await page.waitForTimeout(700); await shot(st);
    }
    if (errs.length) console.log(name, 'errors', [...new Set(errs)].slice(0, 6));
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
