// 미리보기 ↔ PDF 일치 검증.
//
// 엔진 첫 주석의 약속: "미리보기 화면도 같은 HTML을 그대로 축소해 보여주면 되므로
// **미리보기와 PDF가 절대 어긋나지 않는다**". 그런데 PDF 는 html2canvas 1.4.1 이 그린다 —
// 같은 HTML 이어도 **그리는 엔진이 다르다**. 크롬이 아는 CSS 를 html2canvas 가 모르면
// 화면은 멀쩡한데 PDF 만 틀어진다(그리고 에러가 없다).
//
//   node fidelity.mjs
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { ARTISTS } from './data.mjs';

const HERE = '/home/jho4255/ArtLink/scratchpad/pf';
const MIME = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript' };
const srv = createServer((req, res) => {
  const p = join(HERE, decodeURIComponent(req.url.split('?')[0]));
  try { res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const PORT = srv.address().port;

const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 1000 } });
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto(`http://localhost:${PORT}/harness.html`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__pfReady === true);
await p.evaluate(() => document.fonts.ready);

// ── ① 크롬이 color-mix / min() / line-clamp 를 뭐로 계산하는가 ──
const css = await p.evaluate(() => {
  const d = document.createElement('div');
  d.style.cssText = 'background:color-mix(in srgb, #1A1A1A 5%, #FFFFFF);max-width:min(100%,640px);' +
    'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;width:300px';
  d.textContent = '가'.repeat(400);
  document.body.appendChild(d);
  const cs = getComputedStyle(d);
  const r = { bg: cs.backgroundColor, maxW: cs.maxWidth, clampH: d.getBoundingClientRect().height,
              lineClamp: cs.webkitLineClamp, display: cs.display };
  d.remove(); return r;
});
console.log('크롬 계산값:', JSON.stringify(css));

// ── ② html2canvas 로 실제 PDF 경로를 그려 크롬 렌더와 픽셀 비교 ──
await p.addScriptTag({ path: '/home/jho4255/ArtLink/frontend/node_modules/html2canvas/dist/html2canvas.min.js' });
await p.evaluate((artists) => {
  const mk = (aspect, i) => { const H = 900, W = Math.round(H * aspect);
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    x.fillStyle = `hsl(${(i * 47) % 360} 34% 62%)`; x.fillRect(0, 0, W, H);
    x.fillStyle = `hsl(${(i * 47 + 180) % 360} 40% 38%)`; x.fillRect(W * .2, H * .2, W * .6, H * .6);
    return c.toDataURL('image/png'); };
  window.__A = artists;
  for (const a of Object.values(artists)) a.images.forEach((im, i) => { im.url = mk(im.aspect, i); });
}, ARTISTS);

const DESIGN = (o) => ({ bg: 'white', ink: 'black', accent: 'red', font: 'myeongjo', page: 'a4-portrait',
  worksLayout: 'hero', desc: 'none', worksCaption: 'below', coverLayout: 'bandTop', proseAlign: 'left', ...o });

const CASES = [
  { name: 'grid 작품(패널)', artist: 'rich', design: DESIGN({ worksLayout: 'grid', desc: 'short' }), pick: 'work' },
  { name: 'full 전면(패널)', artist: 'rich', design: DESIGN({ worksLayout: 'full' }), pick: 'work' },
  { name: '표지 bandTop(패널)', artist: 'rich', design: DESIGN({ coverLayout: 'bandTop' }), pick: 'cover' },
  { name: '표지 4점격자(패널)', artist: 'rich', design: DESIGN({ coverLayout: 'grid2x2' }), pick: 'cover' },
  { name: '표지 긴소개(line-clamp)', artist: 'stress', design: DESIGN({ coverLayout: 'serifCenter' }), pick: 'cover' },
  { name: 'hero 설명(min())', artist: 'rich', design: DESIGN({ worksLayout: 'hero', desc: 'short' }), pick: 'work' },
  { name: 'CV', artist: 'rich', design: DESIGN({}), pick: 'cv' },
];

const rows = [];
for (const c of CASES) {
  const r = await p.evaluate(async ({ artist, design, pick }) => {
    const data = window.__A[artist];
    const pages = window.PF.buildPortfolioPages(data, window.PF.themeById('archive'), { design });
    const isWork = (x) => !/표지|CV|연락처|작가노트|소개$|이야기$/.test(x.label);
    const idx = pick === 'cover' ? 0 : Math.max(0, pages.findIndex(pick === 'cv' ? (x) => /^CV/.test(x.label) : isWork));
    const host = document.getElementById('host');
    host.innerHTML = pages[idx].html;
    const root = host.firstElementChild;
    const W = root.offsetWidth, H = root.offsetHeight;
    // 이미지 로딩 대기
    await Promise.all(Array.from(root.querySelectorAll('img')).map((im) => im.complete ? 0 : new Promise((r2) => { im.onload = im.onerror = r2; })));
    // color-mix 를 쓴 요소가 몇 개인가 — 실패의 원인을 세어 둔다
    const mixCount = Array.from(root.querySelectorAll('*'))
      .filter((e) => /(^|\s)color\(/.test(getComputedStyle(e).backgroundColor)).length;
    const clamp = Array.from(root.querySelectorAll('*'))
      .filter((e) => getComputedStyle(e).webkitLineClamp !== 'none').length;
    try {
      const cv = await html2canvas(root, { scale: 1, backgroundColor: '#FFFFFF', width: W, height: H, useCORS: true });
      return { label: pages[idx].label, W, H, mixCount, clamp, ok: true, h2c: cv.toDataURL('image/png') };
    } catch (e) {
      return { label: pages[idx].label, W, H, mixCount, clamp, ok: false, err: String(e && e.message || e).slice(0, 90) };
    }
  }, { artist: c.artist, design: c.design, pick: c.pick });

  const f = c.name.replace(/[ ()]/g, '_');
  const shot = await p.locator('#host > *').first().screenshot();
  writeFileSync(`${HERE}/fid-${f}-chrome.png`, shot);
  if (r.ok) writeFileSync(`${HERE}/fid-${f}-h2c.png`, Buffer.from(r.h2c.split(',')[1], 'base64'));
  rows.push({ ...c, ...r, h2c: undefined });
  console.log(`${r.ok ? '  OK  ' : '  실패'} ${c.name.padEnd(24)} ${r.label.padEnd(10)} color-mix ${String(r.mixCount).padStart(2)}개 · line-clamp ${r.clamp}개 ${r.ok ? '' : ' → ' + r.err}`);
}
writeFileSync(`${HERE}/fid.json`, JSON.stringify(rows, null, 1));
await b.close(); srv.close();
