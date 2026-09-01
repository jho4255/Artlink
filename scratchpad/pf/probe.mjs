// 세부 실측 — main 스윕에서 튀어나온 숫자 셋을 각각 원인까지 좁힌다.
//   A) 작품 크기: 레이아웃 × 판형별 지면 점유(그려진 픽셀 기준) + 회색 패널을 채우는 비율
//   B) 대비 미달: 어떤 **역할**의 글자가 몇 :1 인가 (역할별로 묶어야 고칠 데가 보인다)
//   C) 작품설명: shortDescHtml 이 예약(2줄=42px)보다 몇 줄을 더 넣는가
//   D) PPTX: color-mix 배경이 hexOf 를 통과하는가 (통과 못 하면 **에러 없이** 패널이 사라진다)
//
//   node probe.mjs
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
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
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

const DESIGN = (o) => ({ bg: 'white', ink: 'black', accent: 'red', font: 'myeongjo', page: 'a4-portrait',
  worksLayout: 'hero', desc: 'none', worksCaption: 'below', coverLayout: 'bandTop', proseAlign: 'left', ...o });

const res = await p.evaluate(async ({ DESIGN_JSON }) => {
  const loaded = (root) => Promise.all(Array.from(root.querySelectorAll('img'))
    .map((im) => (im.complete && im.naturalWidth) ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
  const D = (o) => ({ ...JSON.parse(DESIGN_JSON), ...o });
  const host = document.getElementById('host');
  const L = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const v = m[1].split(',').map(Number); return (v.length > 3 && v[3] === 0) ? null : v; };
  const cr = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const isWork = (x) => !/표지|CV|연락처|작가노트|소개$|이야기$/.test(x.label);
  const out = { art: [], text: {}, desc: [], pptx: null, pages: {} };

  // A) 작품 크기 — 레이아웃 × 판형
  for (const layout of ['hero', 'label', 'full', 'duo', 'grid', 'index'])
    for (const page of ['a4-portrait', 'a4-landscape', 'wide']) {
      const dim = window.PF.PAGE_DIMS[page];
      const pages = window.PF.buildPortfolioPages(window.__A.rich, window.PF.themeById('archive'),
        { design: D({ worksLayout: layout, page, desc: 'short' }) });
      const rec = { layout, page, share: [], fill: [], px: [] };
      for (const pg of pages.filter(isWork).slice(0, 6)) {
        host.innerHTML = pg.html;
        const root = host.firstElementChild;
        await loaded(root);
        for (const im of root.querySelectorAll('img')) {
          if (!im.naturalWidth || !im.naturalHeight) continue;
          const r = im.getBoundingClientRect();
          const s = Math.min(r.width / im.naturalWidth, r.height / im.naturalHeight);
          const pw = im.naturalWidth * s, ph = im.naturalHeight * s;
          rec.share.push((pw * ph) / (dim.w * dim.h));
          rec.px.push(Math.round(Math.max(pw, ph)));
          const pe = im.parentElement;
          const pr = pe.getBoundingClientRect();
          const hasBg = /color\(|rgb\(/.test(getComputedStyle(pe).backgroundColor) && getComputedStyle(pe).backgroundColor !== 'rgba(0, 0, 0, 0)';
          if (hasBg && pr.width > 1) rec.fill.push((pw * ph) / (pr.width * pr.height));
        }
      }
      const med = (a) => a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : null;
      out.art.push({ layout, page, share: med(rec.share), fill: med(rec.fill), longPx: med(rec.px), perPage: pages.filter(isWork).length });
    }

  // B) 대비 — 역할별로 묶는다
  for (const artist of ['rich', 'typical'])
    for (const layout of ['hero', 'grid']) {
      const pages = window.PF.buildPortfolioPages(window.__A[artist], window.PF.themeById('archive'),
        { design: D({ worksLayout: layout, desc: 'short' }) });
      for (const pg of pages) {
        host.innerHTML = pg.html;
        const root = host.firstElementChild;
        for (const el of root.querySelectorAll('*')) {
          const t = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('').trim();
          if (!t) continue;
          const cs = getComputedStyle(el);
          const fg = parse(cs.color); if (!fg) continue;
          const r = el.getBoundingClientRect(); if (r.width < 1) continue;
          const stack = document.elementsFromPoint(Math.min(innerWidth - 1, r.left + r.width / 2), Math.min(innerHeight - 1, r.top + r.height / 2));
          let bg = null;
          for (const e of stack) { if (e === el || el.contains(e)) continue; const c = parse(getComputedStyle(e).backgroundColor); if (c) { bg = c; break; } }
          const v = cr(fg, bg || [255, 255, 255]);
          const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
          const need = (px >= 24 || (bold && px >= 18.66)) ? 3.0 : 4.5;
          // 역할 추정 — 페이지 종류 + 글자 크기 + 색
          const role = `${/표지/.test(pg.label) ? '표지' : /^CV/.test(pg.label) ? 'CV' : /연락처/.test(pg.label) ? '연락처' : /작가노트|소개$|이야기$/.test(pg.label) ? '글' : '작품'}·${px}px${bold ? 'B' : ''}`;
          const k = out.text[role] || (out.text[role] = { n: 0, bad: 0, min: 9, need, ex: '' });
          k.n++; if (v < need) { k.bad++; if (v < k.min) { k.min = +v.toFixed(2); k.ex = t.slice(0, 20); } }
        }
      }
    }

  // C) 작품설명 — 예약 2줄 대비 실제
  for (const layout of ['hero', 'duo', 'grid'])
    for (const page of ['a4-portrait', 'a4-landscape', 'wide']) {
      const pages = window.PF.buildPortfolioPages(window.__A.rich, window.PF.themeById('archive'),
        { design: D({ worksLayout: layout, page, desc: 'short' }) });
      const pg = pages.find(isWork); if (!pg) continue;
      host.innerHTML = pg.html;
      const root = host.firstElementChild;
      for (const el of root.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        if (Math.abs(parseFloat(cs.fontSize) - 12.5) > 0.01) continue;
        const h = el.getBoundingClientRect().height, lh = parseFloat(cs.lineHeight) || 20;
        out.desc.push({ layout, page, chars: (el.textContent || '').length, lines: +(h / lh).toFixed(2), h: Math.round(h), reserved: 42 });
        break;
      }
    }

  // D) PPTX — hexOf 는 rgba?() 만 파싱한다. color-mix 는?
  const d = document.createElement('div');
  d.style.background = 'color-mix(in srgb, #1A1A1A 5%, #FFFFFF)';
  document.body.appendChild(d);
  const computed = getComputedStyle(d).backgroundColor;
  d.remove();
  const hexOf = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/i); return m ? 'OK' : null; };
  out.pptx = { computed, hexOf: hexOf(computed) ?? 'null → addShape 생략(조용히 사라짐)' };

  // 쪽수 — 30점 작가가 레이아웃별로 몇 장이 되는가
  for (const layout of ['hero', 'label', 'full', 'duo', 'grid', 'index'])
    out.pages[layout] = window.PF.buildPortfolioPages(window.__A.rich, window.PF.themeById('archive'),
      { design: D({ worksLayout: layout, desc: 'short' }) }).length;
  return out;
}, { DESIGN_JSON: JSON.stringify(DESIGN({})) });

console.log('\n── A) 작품이 지면에서 차지하는 면적 (작품 30점, 설명 짧게) ──');
console.log('레이아웃  판형            점유율   패널채움   긴변px   작품쪽수');
for (const a of res.art)
  console.log(`${a.layout.padEnd(9)} ${a.page.padEnd(14)} ${(100 * a.share).toFixed(1).padStart(5)}%  ` +
    `${a.fill == null ? '   —  ' : (100 * a.fill).toFixed(0).padStart(5) + '%'}  ${String(a.longPx).padStart(6)}   ${a.perPage}`);

console.log('\n── B) 대비 (실제 렌더 색 vs 히트테스트 배경) ──');
console.log('역할·크기            개수  미달  최저     기준   예시');
for (const [k, v] of Object.entries(res.text).sort((a, b) => a[1].min - b[1].min))
  if (v.bad) console.log(`${k.padEnd(20)} ${String(v.n).padStart(4)} ${String(v.bad).padStart(5)}  ${String(v.min).padStart(5)}:1  ${v.need}:1  ${v.ex}`);

console.log('\n── C) 작품설명 2줄 예약(42px) vs 실제 ──');
for (const d of res.desc)
  console.log(`${d.layout.padEnd(6)} ${d.page.padEnd(14)} ${String(d.chars).padStart(4)}자 → ${String(d.lines).padStart(5)}줄 ${String(d.h).padStart(3)}px  (예약 ${d.reserved}px, ${(d.h / d.reserved).toFixed(2)}배)`);

console.log('\n── D) PPTX 색 파싱 ──');
console.log(`  크롬 계산값 ${res.pptx.computed}  →  hexOf: ${res.pptx.hexOf}`);

console.log('\n── 쪽수 (작품 30점) ──', JSON.stringify(res.pages));
writeFileSync(`${HERE}/probe.json`, JSON.stringify(res, null, 1));
await b.close(); srv.close();
