// 실서버 복제본 데이터로 **진짜 PDF 생성 경로**를 끝까지 돌린다.
// ⚠️ 로그인하지 않는다(공개 라우트만). ⚠️ 작품·개인정보를 디스크에 저장하지 않는다 — 집계 수치만.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 120)); });
await p.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);

const ids = process.argv.slice(2).map(Number);
const out = await p.evaluate(async (ids) => {
  const m = await import('/src/lib/portfolioFormats.ts');
  const { prefetchImages } = await import('/src/lib/imageFetch.ts');
  const rows = [];
  for (const uid of ids) {
    const r = await fetch(`/api/portfolio/${uid}`);
    if (!r.ok) { rows.push({ uid, err: `HTTP ${r.status}` }); continue; }
    const pf = await r.json();
    const data = {
      user: pf.user ?? { name: pf.name ?? '작가' },
      tagline: pf.tagline, statement: pf.statement, biography: pf.biography,
      career: pf.career, seriesInfo: pf.seriesInfo, images: pf.images ?? [],
    };
    const design = m.normalizePdfDesign(pf.designConfig ?? null);
    // 화면 미리보기 경로
    const preview = m.buildPortfolioPages(data, m.themeById('archive'), { design });
    const previewHtml = preview.map((x) => x.html).join('');
    // 저장(PDF) 경로 — 실제와 동일하게 프리페치 후 forPdf
    const urls = m.bookImageUrls(data);
    let missing = [];
    try { missing = urls.length ? await prefetchImages(urls) : []; } catch (e) { missing = ['prefetch 실패']; }
    const pdfPages = m.buildPortfolioPages(data, m.themeById('archive'), { forPdf: true, design });
    let pdfOk = false, mb = 0, err = null;
    try {
      const theme = m.applyDesign(m.themeById('archive'), design);
      const blob = await m.renderPagesToPdf(pdfPages, theme);
      pdfOk = true; mb = +(blob.size / 1048576).toFixed(2);
    } catch (e) { err = String(e && e.message || e).slice(0, 90); }
    rows.push({ uid, works: data.images.length, pages: preview.length,
      saved: !!pf.designConfig, cover: design.coverLayout, works_layout: design.worksLayout,
      page: design.page, colorMix: /color-mix|[^-]\bcolor\(/.test(previewHtml),
      missing: missing.length, pdfOk, mb, err });
  }
  return rows;
}, ids);

console.log('사용자  작품  쪽수  저장설정  표지          작품배치  판형            color-mix  못받은사진  PDF   용량');
for (const r of out) {
  if (r.err && !r.pdfOk && r.works === undefined) { console.log(`${r.uid}  ${r.err}`); continue; }
  console.log(`${String(r.uid).padEnd(7)} ${String(r.works).padStart(4)} ${String(r.pages).padStart(5)}  ` +
    `${(r.saved ? '있음' : '기본값').padEnd(8)} ${String(r.cover).padEnd(13)} ${String(r.works_layout).padEnd(9)} ` +
    `${String(r.page).padEnd(15)} ${(r.colorMix ? '있음 ✗' : '없음').padEnd(10)} ${String(r.missing).padStart(9)}   ` +
    `${r.pdfOk ? 'OK ' : '실패'}  ${r.pdfOk ? r.mb + 'MB' : (r.err || '')}`);
}
console.log('\n에러:', errs.length ? errs.slice(0, 4) : '없음');
await b.close();
