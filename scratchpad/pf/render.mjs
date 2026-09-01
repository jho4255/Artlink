// 실데이터 페이지를 **눈으로 보기 위해** 렌더한다. 지금까지 수치로만 판정했다.
// ⚠️ 로컬 전용·gitignore. 커밋 금지(실제 가입자 작품).
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { writeFileSync } from 'node:fs';
const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 1200 } });
await p.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);
const jobs = JSON.parse(process.argv[2]);
for (const j of jobs) {
  const info = await p.evaluate(async ({ uid, pick, design }) => {
    const m = await import('/src/lib/portfolioFormats.ts');
    const r = await fetch(`/api/portfolio/${uid}`); const pf = await r.json();
    const data = { user: pf.user ?? { name: pf.name ?? '작가' }, tagline: pf.tagline,
      statement: pf.statement, biography: pf.biography, career: pf.career,
      seriesInfo: pf.seriesInfo, images: pf.images ?? [] };
    const d = m.normalizePdfDesign(design ?? pf.designConfig ?? null);
    const pages = m.buildPortfolioPages(data, m.themeById('archive'), { design: d });
    const isWork = (x) => !/표지|CV|연락처|작가노트|소개$|이야기$/.test(x.label);
    const idx = pick === 'cover' ? 0 : pick === 'cv' ? pages.findIndex((x) => /^CV/.test(x.label))
      : Math.max(0, pages.findIndex(isWork));
    const host = document.getElementById('root');
    host.innerHTML = `<div id="pfhost" style="position:fixed;left:0;top:0;z-index:99999">${pages[idx].html}</div>`;
    const el = document.querySelector('#pfhost > *');
    await Promise.all(Array.from(el.querySelectorAll('img')).map((im) =>
      (im.complete && im.naturalWidth) ? 0 : new Promise((res) => { im.onload = im.onerror = res; })));
    await new Promise((r2) => setTimeout(r2, 400));
    return { label: pages[idx].label, w: el.offsetWidth, h: el.offsetHeight, layout: d.worksLayout, cover: d.coverLayout, page: d.page };
  }, j);
  await p.setViewportSize({ width: Math.min(1500, info.w), height: Math.min(1400, info.h) });
  const shot = await p.locator('#pfhost > *').first().screenshot();
  const f = `${j.name}.png`;
  writeFileSync(f, shot);
  console.log(`${f}  ${info.label} (${info.w}x${info.h}) ${info.cover}/${info.layout}/${info.page}`);
}
await b.close();
