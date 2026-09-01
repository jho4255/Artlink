// H) PDF 붕괴 범위 — color-mix 를 한 개라도 쓰는 페이지가 있으면 그 포트폴리오는 PDF 저장이 **통째로** 실패한다
//    (html2canvas 가 던지고 renderPagesToPdf 가 reject → "PDF 생성에 실패했습니다" 토스트).
// I) '선이 곧 디자인'인 표지 3종이 정말 구별되는가 — 픽셀로 센다.
//
//   node blast.mjs
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { ARTISTS } from './data.mjs';

const HERE = '/home/jho4255/ArtLink/scratchpad/pf';
const MIME = { '.html': 'text/html', '.mjs': 'text/javascript' };
const srv = createServer((req, res) => {
  const p = join(HERE, decodeURIComponent(req.url.split('?')[0]));
  try { res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const PORT = srv.address().port;

const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1700, height: 1500 } });
await p.goto(`http://localhost:${PORT}/harness.html`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__pfReady === true);
await p.evaluate(() => document.fonts.ready);
await p.evaluate((artists) => {
  const mk = (a, i) => { const H = 900, W = Math.round(H * a);
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    x.fillStyle = `hsl(${(i * 47) % 360} 34% 62%)`; x.fillRect(0, 0, W, H); return c.toDataURL('image/png'); };
  window.__A = artists;
  for (const a of Object.values(artists)) a.images.forEach((im, i) => { im.url = mk(im.aspect, i); });
}, ARTISTS);

const D = (o) => ({ bg: 'white', ink: 'black', accent: 'red', font: 'myeongjo', page: 'a4-portrait',
  worksLayout: 'hero', desc: 'none', worksCaption: 'below', coverLayout: 'bandTop',
  coverEyebrow: true, coverTagline: true, coverYear: true, coverNameAccent: false,
  coverEyebrowText: null, coverTaglineText: null, coverImageIds: [], coverImageScale: 1, coverTextScale: 1,
  proseAlign: 'left', ...o });

const H = await p.evaluate((DS) => {
  const D2 = (o) => ({ ...JSON.parse(DS), ...o });
  const host = document.getElementById('host');
  const covers = window.PF.COVER_LAYOUTS.map((c) => c.key);
  const works = ['hero', 'label', 'full', 'duo', 'grid', 'index'];
  const hasMix = (html) => { host.innerHTML = html;
    return Array.from(host.firstElementChild.querySelectorAll('*'))
      .some((e) => /(^|\s)color\(/.test(getComputedStyle(e).backgroundColor)); };
  // 표지별 / 작품레이아웃별로 따로 본다(둘 중 하나만 걸려도 전체 실패)
  const coverBad = {}, workBad = {};
  for (const c of covers) {
    const pgs = window.PF.buildPortfolioPages(window.__A.rich, window.PF.themeById('archive'), { design: D2({ coverLayout: c }) });
    coverBad[c] = hasMix(pgs[0].html);
  }
  for (const w of works) {
    const pgs = window.PF.buildPortfolioPages(window.__A.rich, window.PF.themeById('archive'), { design: D2({ worksLayout: w, coverLayout: 'serifCenter' }) });
    workBad[w] = pgs.slice(1).some((x) => hasMix(x.html));
  }
  return { coverBad, workBad, covers, works };
}, JSON.stringify(D({})));

const cb = Object.entries(H.coverBad), wb = Object.entries(H.workBad);
console.log('── H) PDF 저장이 깨지는 범위 (color-mix 를 쓰는가) ──');
console.log(`표지 ${H.covers.length}종 중 깨짐 ${cb.filter(([, v]) => v).length}종:`, cb.filter(([, v]) => v).map(([k]) => k).join(', '));
console.log(`  안전한 표지:`, cb.filter(([, v]) => !v).map(([k]) => k).join(', '));
console.log(`작품 레이아웃 ${H.works.length}종 중 깨짐 ${wb.filter(([, v]) => v).length}종:`, wb.filter(([, v]) => v).map(([k]) => k).join(', '));
console.log(`  안전한 작품 레이아웃:`, wb.filter(([, v]) => !v).map(([k]) => k).join(', '));
const safe = cb.filter(([, v]) => !v).length * wb.filter(([, v]) => !v).length;
console.log(`\n표지×작품 조합 ${H.covers.length * H.works.length}가지 중 PDF 가 나오는 조합: ${safe}가지 (${(100 * safe / (H.covers.length * H.works.length)).toFixed(0)}%)`);
console.log(`기본값(표지 bandTop · 작품 hero)은 ${H.coverBad.bandTop ? '깨짐 ✗' : '정상'}`);

// ── I) '선이 곧 디자인'인 표지가 구별되는가 ──
console.log('\n── I) 표지 픽셀 차이 (serifCenter 대비, |Δ|>8 픽셀 비율) ──');
for (const c of ['ruleFrame', 'nameplate', 'matted', 'stacked', 'accentField']) {
  const shots = {};
  for (const key of ['serifCenter', c]) {
    await p.evaluate(({ DS, key }) => {
      const d = { ...JSON.parse(DS), coverLayout: key };
      const pgs = window.PF.buildPortfolioPages(window.__A.minimal, window.PF.themeById('archive'), { design: d });
      document.getElementById('host').innerHTML = pgs[0].html;
    }, { DS: JSON.stringify(D({})), key });
    shots[key] = await p.locator('#host > *').first().screenshot();
  }
  const r = await p.evaluate(async ([a, bb]) => {
    const load = (d) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = 'data:image/png;base64,' + d; });
    const [A, B] = await Promise.all([load(a), load(bb)]);
    const c1 = document.createElement('canvas'); c1.width = A.width; c1.height = A.height;
    const c2 = document.createElement('canvas'); c2.width = B.width; c2.height = B.height;
    c1.getContext('2d').drawImage(A, 0, 0); c2.getContext('2d').drawImage(B, 0, 0);
    const p1 = c1.getContext('2d').getImageData(0, 0, A.width, A.height).data;
    const p2 = c2.getContext('2d').getImageData(0, 0, B.width, B.height).data;
    let n = 0; const tot = A.width * A.height;
    for (let i = 0; i < p1.length; i += 4)
      if (Math.abs(p1[i] - p2[i]) + Math.abs(p1[i + 1] - p2[i + 1]) + Math.abs(p1[i + 2] - p2[i + 2]) > 8) n++;
    return { pct: +(100 * n / tot).toFixed(2), w: A.width, h: A.height };
  }, [shots.serifCenter.toString('base64'), shots[c].toString('base64')]);
  writeFileSync(`${HERE}/cover-${c}.png`, shots[c]);
  console.log(`   ${c.padEnd(12)} ${String(r.pct).padStart(6)}% 픽셀만 다름${r.pct < 1.5 ? '   ← 사실상 같은 표지' : ''}`);
}
writeFileSync(`${HERE}/cover-serifCenter.png`, (await p.locator('#host > *').first().screenshot()));
await b.close(); srv.close();
