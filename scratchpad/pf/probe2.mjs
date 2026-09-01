// 마무리 실측 셋.
//   E) 어두운 배경에서 **선이 사라지는가** — line = mix(ink,bg,0.88) 은 대비 1.03:1 이다.
//      '얇은 테두리'(ruleFrame)·'명패'(nameplate)·'가운데 액자'(matted) 는 그 선이 곧 디자인이다.
//   F) 표지 글요소 토글 — coverBaseline 은 metaLine(v) || EYEBROW 라 **다 꺼도 기본 문구가 남는다**
//   G) 실제 PDF 용량 — 기본값(hero·작품30점)이 몇 MB 인가 (메일·업로드 한도)
//
//   node probe2.mjs
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
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

const D = (o) => ({ bg: 'white', ink: 'black', accent: 'red', font: 'myeongjo', page: 'a4-portrait',
  worksLayout: 'hero', desc: 'none', worksCaption: 'below', coverLayout: 'bandTop',
  coverEyebrow: true, coverTagline: true, coverYear: true, coverNameAccent: false,
  coverEyebrowText: null, coverTaglineText: null, coverImageIds: [], coverImageScale: 1, coverTextScale: 1,
  proseAlign: 'left', ...o });

// ── E) 선이 보이는가 ──
const E = await p.evaluate((DS) => {
  const D2 = (o) => ({ ...JSON.parse(DS), ...o });
  const host = document.getElementById('host');
  const rgbOf = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); return m ? m[1].split(',').map(Number) : null; };
  const L = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const cr = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const out = [];
  for (const bg of ['white', 'ivory', 'graphite', 'ink', 'navy'])
    for (const cover of ['ruleFrame', 'nameplate', 'matted']) {
      const ink = ['white', 'ivory'].includes(bg) ? 'black' : 'white';
      const pages = window.PF.buildPortfolioPages(window.__A.rich, window.PF.themeById('archive'),
        { design: D2({ bg, ink, coverLayout: cover }) });
      host.innerHTML = pages[0].html;
      const root = host.firstElementChild;
      const pageBg = rgbOf(getComputedStyle(root).backgroundColor);
      let worst = 99, n = 0;
      for (const el of root.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        const bw = parseFloat(cs.borderTopWidth) || 0;
        if (bw <= 0 || cs.borderTopStyle === 'none') continue;
        const c = rgbOf(cs.borderTopColor); if (!c) continue;
        n++; const v = cr(c, pageBg); if (v < worst) worst = v;
      }
      out.push({ bg, cover, borders: n, contrast: n ? +worst.toFixed(2) : null });
    }
  // CV 섹션 밑줄 · 본문 룰도 같은 색이다
  for (const bg of ['white', 'ink']) {
    const ink = bg === 'white' ? 'black' : 'white';
    const pages = window.PF.buildPortfolioPages(window.__A.rich, window.PF.themeById('archive'), { design: D2({ bg, ink }) });
    const cv = pages.find((x) => /^CV/.test(x.label));
    host.innerHTML = cv.html;
    const root = host.firstElementChild;
    const pageBg = rgbOf(getComputedStyle(root).backgroundColor);
    let worst = 99, n = 0;
    for (const el of root.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const bw = parseFloat(cs.borderBottomWidth) || 0;
      if (bw <= 0 || cs.borderBottomStyle === 'none') continue;
      const c = rgbOf(cs.borderBottomColor); if (!c) continue;
      n++; const v = cr(c, pageBg); if (v < worst) worst = v;
    }
    out.push({ bg, cover: 'CV 섹션 밑줄', borders: n, contrast: n ? +worst.toFixed(2) : null });
  }
  return out;
}, JSON.stringify(D({})));
console.log('── E) 선의 대비 (배경 대비. 1.0 = 완전히 안 보임, UI 경계 권장 3.0) ──');
console.log('배경        표지/요소            선개수  최저대비');
for (const r of E) console.log(`${r.bg.padEnd(11)} ${r.cover.padEnd(20)} ${String(r.borders).padStart(5)}   ${r.contrast ?? '—'}:1${r.contrast && r.contrast < 1.35 ? '   ← 사실상 안 보임' : ''}`);

// ── F) 표지 글요소 토글 ──
const F = await p.evaluate((DS) => {
  const D2 = (o) => ({ ...JSON.parse(DS), ...o });
  const host = document.getElementById('host');
  const out = [];
  for (const cover of window.PF.COVER_LAYOUTS.map((c) => c.key)) {
    const on = window.PF.buildPortfolioPages(window.__A.rich, window.PF.themeById('archive'),
      { design: D2({ coverLayout: cover }) })[0].html;
    const off = window.PF.buildPortfolioPages(window.__A.rich, window.PF.themeById('archive'),
      { design: D2({ coverLayout: cover, coverEyebrow: false, coverYear: false, coverTagline: false }) })[0].html;
    host.innerHTML = off;
    const txt = host.firstElementChild.textContent;
    out.push({ cover, leaks: /ARTWORK PORTFOLIO/.test(txt), also: /2026/.test(txt) });
    void on;
  }
  return out;
}, JSON.stringify(D({})));
const leaked = F.filter((r) => r.leaks || r.also);
console.log('\n── F) 머리말·연도·소개를 **전부 끈** 표지에 남는 문구 ──');
console.log(leaked.length ? leaked.map((r) => `   ✗ ${r.cover}: ${[r.leaks && "'ARTWORK PORTFOLIO'", r.also && "'2026'"].filter(Boolean).join(' + ')} 가 그대로 나온다`).join('\n') : '   (전 표지 정상)');

// ── G) PDF 용량 ──
await p.addScriptTag({ path: '/home/jho4255/ArtLink/frontend/node_modules/html2canvas/dist/html2canvas.min.js' });
await p.addScriptTag({ path: '/home/jho4255/ArtLink/frontend/node_modules/jspdf/dist/jspdf.umd.min.js' });
const G = await p.evaluate(async (DS) => {
  const D2 = (o) => ({ ...JSON.parse(DS), ...o });
  const host = document.getElementById('host');
  const out = [];
  for (const cfg of [{ worksLayout: 'hero', coverLayout: 'bandTop' }, { worksLayout: 'grid', coverLayout: 'grid2x2' }]) {
    const pages = window.PF.buildPortfolioPages(window.__A.rich, window.PF.themeById('archive'), { design: D2(cfg) });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: [210, 297] });
    const scale = Math.max(1, Math.min(2.4, (210 / 25.4) * 240 / 1000));
    let n = 0, err = null;
    try {
      for (let i = 0; i < pages.length; i++) {
        host.innerHTML = pages[i].html;
        const root = host.firstElementChild;
        await Promise.all(Array.from(root.querySelectorAll('img')).map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
        const cv = await html2canvas(root, { scale, backgroundColor: '#FFFFFF', width: 1000, height: 1414, useCORS: true });
        if (i > 0) pdf.addPage();
        pdf.addImage(cv.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, 297);
        cv.width = 0; cv.height = 0; n++;
      }
    } catch (e) { err = String(e && e.message || e).slice(0, 80); }
    const blob = pdf.output('blob');
    out.push({ ...cfg, pages: pages.length, rendered: n, mb: +(blob.size / 1048576).toFixed(1), scale: +scale.toFixed(2), err });
  }
  return out;
}, JSON.stringify(D({})));
console.log('\n── G) 실제 PDF (작품 30점, 표지는 패널 없는 것으로 골라 color-mix 회피) ──');
for (const r of G) console.log(`   ${r.worksLayout.padEnd(5)} ${r.pages}쪽 → ${r.rendered}쪽 렌더 · ${r.mb}MB (배율 ${r.scale})${r.err ? '  에러: ' + r.err : ''}`);

await b.close(); srv.close();
