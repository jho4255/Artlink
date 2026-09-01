// 실데이터(캡션 97% 없음)에서 작품이 지면을 얼마나 쓰는가 — 골든 42.2%(1점/쪽) 기준.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 1500 } });
await p.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);
const out = await p.evaluate(async (ids) => {
  const m = await import('/src/lib/portfolioFormats.ts');
  const rows = [];
  for (const uid of ids) {
    const pf = await (await fetch(`/api/portfolio/${uid}`)).json();
    const data = { user: pf.user ?? { name: '작가' }, tagline: pf.tagline, statement: pf.statement,
      biography: pf.biography, career: pf.career, seriesInfo: pf.seriesInfo, images: pf.images ?? [] };
    for (const worksLayout of ['hero', 'grid']) {
      const d = m.normalizePdfDesign({ ...(pf.designConfig ?? {}), worksLayout, page: 'a4-portrait' });
      const dim = m.PAGE_DIMS['a4-portrait'];
      const pages = m.buildPortfolioPages(data, m.themeById('archive'), { design: d })
        .filter((x) => !/표지|CV|연락처|작가노트|소개$|이야기$/.test(x.label)).slice(0, 5);
      const host = document.getElementById('root');
      const shares = [];
      for (const pg of pages) {
        host.innerHTML = `<div id="h" style="position:fixed;left:0;top:0;z-index:9999">${pg.html}</div>`;
        const el = document.querySelector('#h > *');
        await Promise.all(Array.from(el.querySelectorAll('img')).map((im) =>
          (im.complete && im.naturalWidth) ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
        let s = 0;
        for (const im of el.querySelectorAll('img')) {
          if (!im.naturalWidth) continue;
          const r = im.getBoundingClientRect();
          const k = Math.min(r.width / im.naturalWidth, r.height / im.naturalHeight);
          s += (im.naturalWidth * k) * (im.naturalHeight * k);
        }
        shares.push(s / (dim.w * dim.h));
      }
      host.innerHTML = '';
      const med = shares.sort((x, y) => x - y)[shares.length >> 1];
      rows.push({ uid, worksLayout, n: data.images.length, share: +(100 * med).toFixed(1) });
    }
  }
  return rows;
}, [542, 537, 564, 526]);
const GOLD = { hero: 42.2, grid: 56.1 };
console.log('사용자  작품  배치    작품 지면점유   골든    달성률');
for (const r of out)
  console.log(`${String(r.uid).padEnd(7)} ${String(r.n).padStart(4)}  ${r.worksLayout.padEnd(6)} ` +
    `${String(r.share).padStart(10)}%  ${String(GOLD[r.worksLayout]).padStart(5)}%  ${(100 * r.share / GOLD[r.worksLayout]).toFixed(0).padStart(5)}%`);
await b.close();
