// [PDF 내려받기] 글자 밀림 · 제목 잘림 검사 (2026-10-15, 김현수 작가 신고 "작품 이름이 위아래가 잘린다")
//
// 실제 내려받기(lib/portfolioExport.ts rasterize)와 같은 html2canvas 옵션(≈240dpi)으로 쪽을 그리고,
// 같은 쪽을 크롬이 그린 것과 **작품 제목 글자의 윗선**을 비교한다. 2px 넘게 어긋나면 실패(두 그리기의 반올림 차이가 1~2px — 고치기 전 밀림은 8~11px).
//
// ⚠️ 반드시 **앱의 CSS 를 넣고** 그린다. 원인이 Tailwind 기본값(img{display:block})이었는데, 다른 하니스(harness.html)는
//    앱 CSS 없이 돌아서 몇 달 동안 이 밀림을 한 번도 못 봤다. 화면 미리보기·내려받기 둘 다 앱 문서 안에서 그려진다.
//
//   cd frontend && npm run build                     # 앱 CSS(dist/assets/index-*.css)가 필요하다
//   cd frontend && ./node_modules/.bin/esbuild src/lib/portfolioFormats.ts --bundle --format=esm --alias:@=./src --outfile=../scratchpad/pf/engine.mjs
//   node scratchpad/pf/textshift.mjs                # 고친 상태 — 전부 통과해야 한다
//   NOFIX=1 node scratchpad/pf/textshift.mjs        # 고치기 전 재현 — 작품 목록 제목이 8px 안팎 밀려 실패해야 한다
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ARTISTS } from './data.mjs';

const HERE = '/home/jho4255/ArtLink/scratchpad/pf';
const FRONT = '/home/jho4255/ArtLink/frontend';
const assets = join(FRONT, 'dist/assets');
const cssFile = readdirSync(assets).filter((f) => /^index-.*\.css$/.test(f))
  .map((f) => join(assets, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
if (!cssFile) { console.error('앱 CSS 가 없습니다 — frontend 에서 npm run build 를 먼저'); process.exit(2); }
let appCss = readFileSync(cssFile, 'utf8');
// NOFIX=1 — 고치기 전 상태를 재현한다(측정 GIF 를 되살리는 규칙만 뺀다)
if (process.env.NOFIX) appCss = appCss.replace(/img\[src="data:image\/gif;base64,R0lGODlhAQABAIAAAAAAAP\/\/\/yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"\]\{display:inline\}/, '');

const PAGE = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<link rel="stylesheet" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nanum+Myeongjo:wght@400;700;800&display=swap">
<link rel="stylesheet" href="/app.css"><style>#host{position:absolute;left:0;top:0}</style></head>
<body><div id="host"></div><script src="/html2canvas.js"></script>
<script type="module">import * as E from '/engine.mjs'; window.E = E; window.__ready = true;</script></body></html>`;

const srv = createServer((req, res) => {
  const u = req.url.split('?')[0];
  const send = (type, body) => { res.writeHead(200, { 'content-type': type }); res.end(body); };
  try {
    if (u === '/' || u === '/index.html') return send('text/html', PAGE);
    if (u === '/app.css') return send('text/css', appCss);
    if (u === '/html2canvas.js') return send('text/javascript', readFileSync(join(FRONT, 'node_modules/html2canvas/dist/html2canvas.min.js')));
    if (u === '/engine.mjs') return send('text/javascript', readFileSync(join(HERE, 'engine.mjs')));
  } catch { /* 아래 404 */ }
  res.writeHead(404); res.end();
}).listen(0);
const PORT = srv.address().port;

// 김현수 작가 설정과 같은 축(캡션 '제목만' · 작품 목록 켬 · 고딕) + 기본 캡션 + 명조
const CASES = [
  { artist: 'typical', design: { font: 'gothic', worksCaption: 'minimal', worksIndex: true, auto: true } },
  { artist: 'rich', design: { font: 'gothic', worksCaption: 'minimal', worksIndex: true, auto: true } },
  { artist: 'rich', design: { font: 'myeongjo', worksCaption: 'below', worksIndex: true, auto: false, worksLayout: 'grid' } },
];
// 크롬(2배)과 html2canvas(1.984배)의 반올림·안티에일리어싱 차이가 1~2px 난다 — 고치기 전 밀림은 8~11px 였다
const LIMIT = 2;

const b = await pw.chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 1600 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__ready === true);

let worst = 0, checked = 0, failed = 0;
for (const c of CASES) {
  const a = JSON.parse(JSON.stringify(ARTISTS[c.artist]));
  const info = await p.evaluate(async ({ a, design }) => {
    const mk = (aspect, i) => { const H = 600, W = Math.round(H * aspect); const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const x = cv.getContext('2d'); x.fillStyle = `hsl(${(i * 47) % 360} 34% 62%)`; x.fillRect(0, 0, W, H); return cv.toDataURL('image/png'); };
    const aspects = {};
    a.images.forEach((im, i) => { im.url = mk(im.aspect, i); aspects[im.url] = im.aspect; });
    a.aspects = aspects;
    const base = window.E.themeById('archive');
    const full = { bg: 'white', ink: 'black', accent: 'mono', page: 'a4-portrait', ...design };
    window.__theme = window.E.applyDesign(base, window.E.normalizePdfDesign(full));
    window.__pages = window.E.buildPortfolioPages(a, base, { forPdf: true, design: full });
    window.__titles = a.images.map((im) => im.title).filter(Boolean);
    await document.fonts.ready;
    return { n: window.__pages.length, w: window.__theme.page.w, mmW: window.__theme.page.mmW };
  }, { a, design: c.design });
  const scale = Math.max(1, Math.min(2.4, ((info.mmW / 25.4) * 240) / info.w));   // portfolioExport.ts baseScale 와 같은 식

  for (let i = 0; i < info.n; i++) {
    await p.evaluate(async (i) => {
      const host = document.getElementById('host'); const th = window.__theme;
      host.style.cssText = `position:absolute;left:0;top:0;width:${th.page.w}px;height:${th.page.h}px;background:${th.bg}`;
      host.innerHTML = window.__pages[i].html;
      await window.E.waitPageImages(host); await document.fonts.ready;
    }, i);
    const has = await p.evaluate(() => { const t = document.getElementById('host').textContent; return window.__titles.some((x) => t.includes(x)); });
    if (!has) continue;
    const shot = (await p.locator('#host').screenshot()).toString('base64');
    const rows = await p.evaluate(async ({ shot, scale }) => {
      const host = document.getElementById('host'); const hr = host.getBoundingClientRect(); const th = window.__theme;
      const h2c = await window.html2canvas(host, { scale, useCORS: true, backgroundColor: th.bg, width: th.page.w, height: th.page.h, logging: false });
      const im = new Image(); im.src = `data:image/png;base64,${shot}`; await im.decode();
      const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight; cv.getContext('2d').drawImage(im, 0, 0);
      const S_CH = im.naturalWidth / th.page.w;
      /** 상자 안에서 처음으로 진한 픽셀이 나오는 줄(css px) */
      const inkTop = (canvas, s, box) => {
        const x0 = Math.round(box.x * s), y0 = Math.round(box.y * s), w = Math.max(1, Math.round(box.w * s)), h = Math.max(1, Math.round(box.h * s));
        const d = canvas.getContext('2d').getImageData(x0, y0, w, h).data;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = (y * w + x) * 4; if (d[k] + d[k + 1] + d[k + 2] < 3 * 140) return y / s; }
        return null;
      };
      const out = [];
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.textContent.trim();
        if (!t || !window.__titles.some((x) => t.includes(x))) continue;
        const rg = document.createRange(); rg.selectNodeContents(n); const tr = rg.getBoundingClientRect();
        const el = n.parentElement.getBoundingClientRect();
        if (tr.width < 2) continue;
        const box = { x: tr.x - hr.x, y: el.y - hr.y - 10, w: Math.min(tr.width, 260), h: el.height + 20 };
        const a = inkTop(cv, S_CH, box), b2 = inkTop(h2c, scale, box);
        if (a == null) continue;
        out.push({ text: t.slice(0, 24), shift: b2 == null ? 99 : b2 - a });
      }
      return out;
    }, { shot, scale });
    for (const r of rows) {
      checked += 1;
      worst = Math.max(worst, Math.abs(r.shift));
      if (Math.abs(r.shift) > LIMIT) {
        failed += 1;
        if (failed <= 12) console.log(`✗ ${c.artist} ${JSON.stringify(c.design)} p${i + 1} '${r.text}' 밀림 ${r.shift.toFixed(1)}px`);
      }
    }
  }
}
await b.close(); srv.close();
console.log(`제목 ${checked}곳 · 가장 많이 어긋난 곳 ${worst.toFixed(1)}px · 실패 ${failed}`);
process.exit(failed > 0 || checked === 0 ? 1 : 0);
