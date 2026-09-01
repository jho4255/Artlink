// 캡션 예약(capH) vs 실제 렌더 높이 — 격자에서 작품이 작아지는 원인을 정확히 짚는다.
// + 우리 엔진의 **작품 합계 지면점유**(골든과 같은 지표)
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { ARTISTS } from './data.mjs';
const HERE = '/home/jho4255/ArtLink/scratchpad/pf';
const MIME = { '.html': 'text/html', '.mjs': 'text/javascript' };
const srv = createServer((q, s) => { const f = join(HERE, decodeURIComponent(q.url.split('?')[0]));
  try { s.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' }); s.end(readFileSync(f)); }
  catch { s.writeHead(404); s.end(); } }).listen(0);
const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1700, height: 1500 } });
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto(`http://localhost:${srv.address().port}/harness.html`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__pfReady === true);
await p.evaluate(() => document.fonts.ready);
await p.evaluate((A) => { const mk = (a, i) => { const H = 900, W = Math.round(H * a);
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    x.fillStyle = `hsl(${(i*47)%360} 34% 62%)`; x.fillRect(0,0,W,H); return c.toDataURL('image/png'); };
  window.__A = A; for (const a of Object.values(A)) a.images.forEach((im,i)=>{ im.url = mk(im.aspect,i); }); }, ARTISTS);

const D = (o) => ({ bg:'white', ink:'black', accent:'red', font:'myeongjo', page:'a4-portrait',
  worksLayout:'hero', desc:'none', worksCaption:'below', coverLayout:'serifCenter', proseAlign:'left', ...o });

const r = await p.evaluate(async (DS) => {
  const D2 = (o) => ({ ...JSON.parse(DS), ...o });
  const host = document.getElementById('host');
  const load = (root) => Promise.all(Array.from(root.querySelectorAll('img'))
    .map((im) => (im.complete && im.naturalWidth) ? 0 : new Promise((r2) => { im.onload = im.onerror = r2; })));
  const isWork = (x) => !/표지|CV|연락처|작가노트|소개$|이야기$/.test(x.label);
  const out = [];
  for (const layout of ['hero','label','full','duo','grid','index'])
    for (const page of ['a4-portrait','a4-landscape','wide'])
      for (const desc of ['none','short']) {
        const dim = window.PF.PAGE_DIMS[page];
        const pgs = window.PF.buildPortfolioPages(window.__A.rich, window.PF.themeById('archive'),
          { design: D2({ worksLayout: layout, page, desc }) }).filter(isWork).slice(0, 4);
        const sums = [], caps = [], imgs = [];
        for (const pg of pgs) {
          host.innerHTML = pg.html; const root = host.firstElementChild; await load(root);
          let s = 0;
          for (const im of root.querySelectorAll('img')) {
            if (!im.naturalWidth) continue;
            const rc = im.getBoundingClientRect();
            const k = Math.min(rc.width/im.naturalWidth, rc.height/im.naturalHeight);
            s += (im.naturalWidth*k)*(im.naturalHeight*k);
            imgs.push(Math.round(rc.height));
          }
          sums.push(s/(dim.w*dim.h));
          // 캡션 실제 높이 — 이미지 컨테이너의 형제(캡션 블록들)
          for (const im of root.querySelectorAll('img')) {
            const cell = im.parentElement?.parentElement; if (!cell) continue;
            const kids = Array.from(cell.children);
            const iBox = im.parentElement;
            const capH = kids.filter((k2) => k2 !== iBox).reduce((n,k2)=>n+k2.getBoundingClientRect().height,0);
            if (capH > 0) caps.push(Math.round(capH));
            break;
          }
        }
        const med = (a) => a.length ? a.slice().sort((x,y)=>x-y)[a.length>>1] : null;
        out.push({ layout, page, desc, n: window.PF.WORKS_PER_PAGE[layout],
          sum: med(sums), capReal: med(caps), imgH: med(imgs) });
      }
  return out;
}, JSON.stringify(D({})));

const GOLD = { 1: 42.2, 2: 48.7, 3: 49.9, 4: 56.1, 6: 55.4 };
console.log('레이아웃 판형          설명   점수  작품합계   골든   달성률  캡션실측  이미지높이');
for (const x of r) {
  const g = GOLD[x.n] ?? 50;
  const pct = 100 * x.sum;
  console.log(`${x.layout.padEnd(6)} ${x.page.padEnd(14)} ${x.desc.padEnd(6)} ${String(x.n).padStart(3)} ` +
    `${pct.toFixed(1).padStart(7)}% ${String(g).padStart(6)}% ${(100*pct/g).toFixed(0).padStart(6)}% ` +
    `${String(x.capReal ?? '—').padStart(7)}px ${String(x.imgH).padStart(8)}px`);
}
await b.close(); srv.close();
