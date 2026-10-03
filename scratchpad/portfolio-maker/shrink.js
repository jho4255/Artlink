/**
 * 용량 맞추기 — 예산을 일부러 작게 주고 `exportPortfolioPdf` 를 직접 부른다(브라우저 안에서). cwd = e2e
 *   node ../scratchpad/portfolio-maker/shrink.js [budgetMB…]
 * 넘칠 때만 줄이는지 · 줄인 뒤 예산 안에 들어오는지 · 쪽 그림의 해상도가 얼마가 되는지를 본다.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../e2e/node_modules/playwright'));
const BASE = process.env.BASE || 'http://localhost:5183';
const API = process.env.API || 'http://localhost:4001/api';
const OUT = path.join(__dirname, 'out');
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const budgets = process.argv.slice(2).map(Number).filter((n) => n > 0);
  const acc = await (await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'jinwoo.seo@demo.artlink.local' }) })).json();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [{ name: 'artlink-auth', value: JSON.stringify({ state: { token: acc.token, user: acc.user, isAuthenticated: true }, version: 0 }) }] }] } });
  const page = await ctx.newPage();
  await page.route('**/api/visits', (q) => q.fulfill({ status: 200, body: '{}' }));
  await page.goto(`${BASE}/mypage?tab=portfolio`);
  await page.waitForSelector('[data-testid="portfolio-maker"]');
  await page.waitForLoadState('networkidle').catch(() => {});
  for (const mb of budgets.length ? budgets : [9.4, 2, 1.2, 0.5]) {
    const r = await page.evaluate(async ({ mb, token, user }) => {
      const m = await import('/src/lib/portfolioExport.ts');
      const p = await (await fetch('/api/portfolio', { headers: { Authorization: `Bearer ${token}` } })).json();
      const book = { user, homepageUrl: `${location.origin}/@${user.handle}`, statement: p.statement, biography: p.biography, career: p.career, seriesInfo: p.seriesInfo, images: p.images };
      const seen = new Set();
      const t0 = performance.now();
      const out = await m.exportPortfolioPdf(book, p.designConfig, { budget: mb * 1048576, onProgress: (ph) => seen.add(ph) });
      const buf = new Uint8Array(await out.blob.arrayBuffer());
      let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return { ms: Math.round(performance.now() - t0), pages: out.pages, works: out.works, bytes: out.bytes, step: out.step, overBudget: out.overBudget, phases: [...seen], b64: btoa(bin) };
    }, { mb, token: acc.token, user: acc.user });
    const file = path.join(OUT, `shrink-${mb}.pdf`);
    fs.writeFileSync(file, Buffer.from(r.b64, 'base64'));
    delete r.b64;
    console.log(`예산 ${mb}MB →`, JSON.stringify({ ...r, MB: +(r.bytes / 1048576).toFixed(2), inBudget: r.bytes <= mb * 1048576 }));
  }
  await browser.close();
})();
