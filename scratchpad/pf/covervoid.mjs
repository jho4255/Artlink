// 표지 21종의 **하단 빈 공간** — 실데이터 조건(한 줄 소개 0명)에서.
// bandTop 하나만 보고 고치면 또 같은 실수다. 전부 재고 고칠 것을 고른다.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1700, height: 1500 } });
await p.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);
const rows = await p.evaluate(async () => {
  const m = await import('/src/lib/portfolioFormats.ts');
  const pf = await (await fetch('/api/portfolio/542')).json();
  const data = { user: pf.user ?? { name: '박명선' }, tagline: null, statement: pf.statement,
    biography: pf.biography, career: pf.career, seriesInfo: pf.seriesInfo, images: pf.images ?? [] };
  const host = document.getElementById('root');
  const out = [];
  for (const c of m.COVER_LAYOUTS)
    for (const page of ['a4-portrait', 'wide']) {
      const d = m.normalizePdfDesign({ coverLayout: c.key, page });
      const html = m.buildPortfolioPages(data, m.themeById('archive'), { design: d })[0].html;
      host.innerHTML = `<div id="h" style="position:fixed;left:0;top:0;z-index:9999">${html}</div>`;
      const el = document.querySelector('#h > *');
      await Promise.all(Array.from(el.querySelectorAll('img')).map((im) =>
        (im.complete && im.naturalWidth) ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
      const R = el.getBoundingClientRect();
      let lowest = R.top, highest = R.bottom;
      for (const e of el.querySelectorAll('*')) {
        const cs = getComputedStyle(e);
        const paints = e.tagName === 'IMG'
          || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && e !== el)
          || Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.nodeValue.trim());
        if (!paints) continue;
        const r = e.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        if (r.height > R.height * 0.98 && r.width > R.width * 0.98) continue; // 전면 배경은 제외
        lowest = Math.max(lowest, r.bottom); highest = Math.min(highest, r.top);
      }
      out.push({ cover: c.key, page, void: +((R.bottom - lowest) / R.height * 100).toFixed(1),
        topVoid: +((highest - R.top) / R.height * 100).toFixed(1) });
      host.innerHTML = '';
    }
  return out;
});
const byCover = {};
for (const r of rows) (byCover[r.cover] ??= {})[r.page] = r;
console.log('표지            A4세로: 위/아래      와이드: 위/아래     대칭?  판정');
for (const [k, v] of Object.entries(byCover)) {
  const a = v['a4-portrait'], w = v['wide'];
  // 가운데 정렬 표지는 아래가 비어도 **위도 같이** 빈다(의도된 구성). 비대칭일 때만 결함이다.
  const skew = Math.max(a.void - a.topVoid, w.void - w.topVoid);
  const worst = Math.max(a.void, w.void);
  console.log(`${k.padEnd(15)} ${(a.topVoid + '/' + a.void).padStart(13)} ${(w.topVoid + '/' + w.void).padStart(16)}  ` +
    `${(skew < 6 ? '대칭' : '아래로 ' + skew.toFixed(0) + 'p').padStart(9)}  ` +
    (worst >= 20 && skew >= 12 ? '← 고칠 것' : ''));
}
await b.close();
