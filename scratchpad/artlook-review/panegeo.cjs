// 칩 칸(pane) 안 줄 높이 재기 — 단독 페이지 · 크기 없는 작품
const pw = require('/home/jho4255/ArtLink/e2e/node_modules/playwright');
const BASE = 'http://localhost:5173';
(async () => {
  const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const W = +(process.env.W || 390), H = +(process.env.H || 664);
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block',
    storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [
      { name: 'artlook:works', value: JSON.stringify([{ url: '/demo-art/dawn-window.jpg', title: '새벽 창', artist: '샘플', kind: 'portfolio', id: 9999 },
        ...(process.env.TWO ? [{ url: '/demo-art/red-hill.jpg', title: '붉은 언덕', artist: '샘플', kind: 'portfolio', id: 9998, sizeText: '53.0 × 45.5 cm' }] : [])]) },
      ...(process.env.PREFS ? [{ name: 'artlook:prefs', value: process.env.PREFS }] : []),
      { name: 'artlook:sizes', value: process.env.SIZED ? JSON.stringify({ '/demo-art/dawn-window.jpg': { text: '162.2 × 129.8 cm', kind: '100호' } }) : '{}' },
    ] }] } });
  const p = await ctx.newPage();
  await p.goto(BASE + '/artlook/index.html' + (process.env.Q === undefined ? '?embed=1' : process.env.Q), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => (window.__artlookRenders || 0) >= 1 && document.getElementById('busy').hidden, null, { timeout: 90000 });
  for (const tab of (process.env.TABS || 'works').split(',')) {
    await p.click('#tab-' + tab); await p.waitForTimeout(800);
    const r = await p.evaluate((tab) => {
      const pane = document.getElementById('pane-' + tab); const pr = pane.getBoundingClientRect(); const cs = getComputedStyle(pane);
      const kids = [...pane.children].filter((e) => !e.hidden && getComputedStyle(e).display !== 'none').map((e) => { const r = e.getBoundingClientRect(); return [e.id || e.className, Math.round(r.top - pr.top), Math.round(r.height), Math.round(r.bottom - pr.top)]; });
      return { pane: [Math.round(pr.top), Math.round(pr.height)], pad: cs.padding, gap: cs.rowGap, scrollH: pane.scrollHeight, clientH: pane.clientHeight, overflowY: cs.overflowY, kids };
    }, tab);
    console.log(tab, JSON.stringify(r));
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
