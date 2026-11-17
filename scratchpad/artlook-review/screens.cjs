// ArtLook 화면 캡처 — 복제본(4000/5173) · 가상 작가(676, intro-sample@artlink.test) · 아무것도 쓰지 않는다
const fs = require('fs'); const path = require('path');
const pw = require('/home/jho4255/ArtLink/e2e/node_modules/playwright');
const BASE = 'http://localhost:5173', API = 'http://localhost:4000/api';
const OUT = path.join(__dirname, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const SCREENS = {
  pc1440: { viewport: { width: 1440, height: 900 } },
  pc1280: { viewport: { width: 1280, height: 720 } },
  iphone13: { viewport: { width: 390, height: 664 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  pixel7: { viewport: { width: 412, height: 839 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const only = (process.env.SCREEN || Object.keys(SCREENS).join(',')).split(',');
(async () => {
  const r = await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'intro-sample@artlink.test' }) });
  const acc = await r.json();
  if (!r.ok || acc.user.id !== 676) throw new Error('가상 계정 로그인 실패 ' + r.status + ' ' + JSON.stringify(acc).slice(0, 200));
  const browser = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const name of only) {
    const ctx = await browser.newContext({ ...SCREENS[name], serviceWorkers: 'block', acceptDownloads: true, storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [
      { name: 'artlink-auth', value: JSON.stringify({ state: { token: acc.token, user: acc.user, isAuthenticated: true }, version: 0 }) },
      { name: 'artlink-homepage-nudge-snooze', value: JSON.stringify({ [String(acc.user.id)]: 8.64e15 }) },
      { name: 'artlink-member-device', value: '1' },
    ] }] } });
    await ctx.addInitScript(() => { try { navigator.sendBeacon = () => true; } catch {} });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
    await page.goto(`${BASE}/mypage?tab=artlook`, { waitUntil: 'domcontentloaded' });
    const h = await page.waitForSelector('iframe[title="ArtLook"]', { state: 'attached', timeout: 60000 });
    const frame = await h.contentFrame();
    await frame.waitForFunction(() => (window.__artlookRenders || 0) >= 1 && document.getElementById('busy').hidden, null, { timeout: 90000 });
    await page.waitForTimeout(2500);
    const shot = async (tag) => { await page.screenshot({ path: path.join(OUT, `${name}-${tag}.png`) }); };
    const settle = async () => { await frame.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 60000 }).catch(() => {}); await page.waitForTimeout(1200); };
    await shot('1-works');
    for (const [id, tag] of [['tab-frames', '2-frames'], ['tab-mat', '3-mat'], ['tab-scenes', '4-scenes'], ['tab-light', '5-light'], ['tab-ratio', '6-ratio']]) {
      await frame.locator('#' + id).click(); await settle(); await shot(tag);
    }
    // 배경 → 벽 하나, 캡션 켜기
    await frame.locator('#tab-scenes').click();
    const info = await frame.evaluate(() => ({
      works: document.querySelectorAll('#works button').length,
      worksLine: document.getElementById('worksLine').innerText,
      framesLine: document.getElementById('framesLine').innerText,
      sceneNote: document.getElementById('sceneNote').innerText,
      matHint: document.getElementById('matHint').innerText,
      frameCount: document.querySelectorAll('#frames button').length,
      sceneCount: document.querySelectorAll('#scenes button').length,
      cv: [document.getElementById('preview').width, document.getElementById('preview').height],
      cvCss: (() => { const r = document.getElementById('preview').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
      scene: SCENES[state.sceneIdx].id, frame: FRAMES[state.frameIdx].id, ratio: state.ratio,
    }));
    console.log(name, JSON.stringify(info));
    // 저장
    await frame.locator('#tab-works').click(); await settle();
    const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
    await frame.locator('#dl').click();
    const d = await dl; if (d) { const p = path.join(OUT, `${name}-saved.png`); await d.saveAs(p); console.log(name, 'saved', d.suggestedFilename(), fs.statSync(p).size); }
    await page.waitForTimeout(1500); await shot('7-after-save');
    // 여러 점
    const multi = frame.locator('#works button', { hasText: '여러 점' });
    if (await multi.count()) {
      await multi.first().click(); await settle();
      const chips = frame.locator('#works button[data-i]');
      const n = await chips.count();
      for (const i of [0, 1, 2].filter((k) => k < n)) { await chips.nth(i).click().catch(() => {}); await page.waitForTimeout(300); }
      await settle(); await shot('8-multi');
      console.log(name, 'multi line:', await frame.locator('#worksLine').innerText());
      await multi.first().click(); await settle();
    }
    if (errs.length) console.log(name, 'errors', [...new Set(errs)]);
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
