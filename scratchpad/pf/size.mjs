// PDF 용량 — 지금 설정(배율 1.98 · JPEG 0.9)이 메일로 보낼 만한가.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 1500 } });
await p.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);
await p.addScriptTag({ path: '/home/jho4255/ArtLink/frontend/node_modules/html2canvas/dist/html2canvas.min.js' });
await p.addScriptTag({ path: '/home/jho4255/ArtLink/frontend/node_modules/jspdf/dist/jspdf.umd.min.js' });
const out = await p.evaluate(async (uid) => {
  const m = await import('/src/lib/portfolioFormats.ts');
  const { prefetchImages } = await import('/src/lib/imageFetch.ts');
  const pf = await (await fetch(`/api/portfolio/${uid}`)).json();
  const data = { user: pf.user ?? { name: '작가' }, tagline: pf.tagline, statement: pf.statement,
    biography: pf.biography, career: pf.career, seriesInfo: pf.seriesInfo, images: pf.images ?? [] };
  await prefetchImages(m.bookImageUrls(data));
  const pages = m.buildPortfolioPages(data, m.themeById('archive'), { forPdf: true, design: m.normalizePdfDesign(null) });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;width:1000px;height:1414px;z-index:-1';
  document.body.appendChild(host);
  await document.fonts.ready;
  const rows = [];
  for (const [scale, q] of [[1.98, 0.9], [1.98, 0.8], [1.5, 0.85], [1.25, 0.85], [1.0, 0.85]]) {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: [210, 297] });
    for (let i = 0; i < pages.length; i++) {
      host.innerHTML = pages[i].html;
      await Promise.all(Array.from(host.querySelectorAll('img')).map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
      const cv = await html2canvas(host, { scale, backgroundColor: '#FFFFFF', width: 1000, height: 1414, useCORS: true });
      if (i > 0) pdf.addPage();
      pdf.addImage(cv.toDataURL('image/jpeg', q), 'JPEG', 0, 0, 210, 297);
      cv.width = 0; cv.height = 0;
    }
    const mb = pdf.output('blob').size / 1048576;
    rows.push({ scale, q, mb: +mb.toFixed(1), dpi: Math.round(scale * 1000 / (210 / 25.4)) });
  }
  host.remove();
  return { pages: pages.length, rows };
}, 542);
console.log(`작가 542 · ${out.pages}쪽 (작품 26점)\n`);
console.log('배율   JPEG품질   해상도      용량      Gmail 25MB');
for (const r of out.rows)
  console.log(`${String(r.scale).padEnd(6)} ${String(r.q).padEnd(10)} ${String(r.dpi).padStart(4)}dpi  ${String(r.mb).padStart(6)}MB   ${r.mb <= 25 ? 'OK' : '초과 ✗'}`);
await b.close();
