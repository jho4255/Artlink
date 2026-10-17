// 팝업이 뜨기까지 — 페이지 이동 시작부터 창이 붙은 시각·그림이 다 찬 시각(ms). APP=… 로 개발 서버/배포용 빌드를 바꿔 잰다
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
const APP = process.env.APP || 'http://localhost:5173';
const b = await pw.chromium.launch();
for (const [name, vp] of [['pc', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }]]) {
  for (const start of ['/', '/exhibitions']) {
    const { width, height, ...rest } = vp;
    const ctx = await b.newContext({ viewport: { width, height }, ...rest });
    await ctx.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
      navigator.sendBeacon = () => true;
      new MutationObserver((_m, o) => {
        const d = document.querySelector('[data-testid=guest-intro]');
        if (d && !window.__introAt) { window.__introAt = performance.now(); o.disconnect(); }
      }).observe(document, { childList: true, subtree: true });
    });
    await ctx.route(/\/api\/(guest-activity|visits)/, (r) => r.fulfill({ status: 204, body: '' }));
    const p = await ctx.newPage();
    await p.goto(APP + start);
    await p.getByTestId('guest-intro').waitFor({ timeout: 10000 });
    await p.waitForFunction(() => [...document.querySelectorAll('[data-testid=guest-intro] img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 10000 });
    const t = await p.evaluate(() => ({ intro: Math.round(window.__introAt), dcl: Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd) }));
    console.log(`${name} ${start}  화면 준비 ${t.dcl}ms → 팝업 ${t.intro}ms`);
    await ctx.close();
  }
}
await b.close();
