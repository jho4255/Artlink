// 포트폴리오 생성기 실측 하니스 — "보기에 괜찮다"로 두 번 속지 않으려고 만든다(ArtLook 37번과 같은 이유).
//
// 재는 것:
//   overflow  페이지(고정 높이 + overflow:hidden)를 넘겨 **조용히 잘린** 내용
//   desc      작품설명(shortDescHtml)이 예약한 2줄(DESC_LINE_H*2)을 넘겼는가
//   art       작품이 지면에서 차지하는 면적비 / 회색 패널을 채우는 비율
//   contrast  실제 렌더된 글자색 vs **히트테스트로 구한 진짜 배경**의 WCAG 대비
//
//   node audit.mjs [sweep]      sweep = main | covers | fonts | all(기본)
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { ARTISTS } from './data.mjs';

const HERE = '/home/jho4255/ArtLink/scratchpad/pf';
const MIME = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript' };
const srv = createServer((req, res) => {
  const p = join(HERE, decodeURIComponent(req.url.split('?')[0]));
  try {
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const PORT = srv.address().port;

const sweep = process.argv[2] || 'all';
const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1700, height: 1500 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`http://localhost:${PORT}/harness.html`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__pfReady === true);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(600);

// ── 작품 사진: 캔버스로 만든 색면(개인정보 없음). 비율만 실제 회화 분포를 따른다 ──
await p.evaluate((artists) => {
  const mk = (aspect, i) => {                       // aspect = w/h
    const H = 900, W = Math.round(H * aspect);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = `hsl(${(i * 47) % 360} 34% 62%)`; x.fillRect(0, 0, W, H);
    x.fillStyle = `hsl(${(i * 47 + 180) % 360} 40% 38%)`; x.fillRect(W * 0.2, H * 0.2, W * 0.6, H * 0.6);
    return c.toDataURL('image/png');
  };
  window.__A = artists;
  for (const a of Object.values(artists)) a.images.forEach((im, i) => { im.url = mk(im.aspect, i); });
}, ARTISTS);

// ── 페이지 하나를 재는 함수 (브라우저 안) ──
await p.evaluate(() => {
  const L = (rgb) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
  const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const v = m[1].split(',').map(Number); return (v.length > 3 && v[3] === 0) ? null : v; };
  const ratio = (a, b) => { const la = L(a), lb = L(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };

  window.__measure = (html, W, H) => {
    const host = document.getElementById('host');
    host.innerHTML = html;
    const root = host.firstElementChild;
    const R = root.getBoundingClientRect();
    const out = { overflow: 0, clipped: [], desc: [], art: [], contrast: [], textPx: 0 };

    // ① 넘침 — 루트 스크롤 + 요소별 사각형 포함 검사(절대배치는 스크롤에 안 잡힌다)
    out.overflow = Math.max(0, root.scrollHeight - root.clientHeight, root.scrollWidth - root.clientWidth);
    const all = root.querySelectorAll('*');
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const has = el.tagName === 'IMG' || Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.nodeValue.trim());
      if (!has) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 0.5 || r.height < 0.5) continue;
      const over = Math.max(R.top - r.top, r.bottom - R.bottom, R.left - r.left, r.right - R.right);
      if (over > 0.75) out.clipped.push({ tag: el.tagName, over: +over.toFixed(1), txt: (el.textContent || '').trim().slice(0, 26) });
    }

    // ② 작품설명 — 12.5px 글상자(shortDescHtml 유일 식별자)가 예약 2줄(42px)을 넘겼는가
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (Math.abs(parseFloat(cs.fontSize) - 12.5) > 0.01) continue;
      const h = el.getBoundingClientRect().height;
      const lines = Math.round(h / (parseFloat(cs.lineHeight) || 20));
      out.desc.push({ h: +h.toFixed(1), lines });
    }

    // ③ 작품 면적 — object-fit:contain 이라 **그려진 픽셀**을 따로 계산해야 한다(요소 상자가 아니라)
    for (const im of root.querySelectorAll('img')) {
      const r = im.getBoundingClientRect();
      const nw = im.naturalWidth, nh = im.naturalHeight;
      if (!nw || !nh || r.width < 1) continue;
      const s = Math.min(r.width / nw, r.height / nh);
      const pw = nw * s, ph = nh * s;
      // 뒤에 깔린 패널(직계 조상 중 배경이 있는 첫 요소)
      let panel = null;
      for (let e = im.parentElement; e && e !== root; e = e.parentElement) {
        const bg = parse(getComputedStyle(e).backgroundColor);
        if (bg) { const pr = e.getBoundingClientRect(); panel = pr.width * pr.height; break; }
      }
      out.art.push({ area: +(pw * ph).toFixed(0), page: +((pw * ph) / (W * H)).toFixed(4), panelFill: panel ? +((pw * ph) / panel).toFixed(3) : null });
    }

    // ④ 대비 — 배경은 **히트테스트**로 구한다(형제 absolute 배경 때문에 조상 탐색은 틀린다)
    for (const el of all) {
      const t = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('').trim();
      if (!t) continue;
      const cs = getComputedStyle(el);
      const fg = parse(cs.color); if (!fg) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const stack = document.elementsFromPoint(Math.min(innerWidth - 1, r.left + r.width / 2), Math.min(innerHeight - 1, r.top + r.height / 2));
      let bg = null;
      for (const e of stack) { if (e === el || el.contains(e)) continue; const c = parse(getComputedStyle(e).backgroundColor); if (c) { bg = c; break; } }
      if (!bg) bg = [255, 255, 255];
      const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
      const large = px >= 24 || (bold && px >= 18.66);
      const need = large ? 3.0 : 4.5;
      const cr = ratio(fg, bg);
      out.textPx++;
      if (cr < need) out.contrast.push({ cr: +cr.toFixed(2), need, px: +px.toFixed(1), bold, txt: t.slice(0, 22) });
    }
    return out;
  };
});

const DESIGN = (o) => ({ bg: 'white', ink: 'black', accent: 'red', font: 'myeongjo', page: 'a4-portrait', worksLayout: 'hero', desc: 'none', worksCaption: 'below', coverLayout: 'bandTop', proseAlign: 'left', ...o });

async function run(configs, tag) {
  const rows = [];
  for (const c of configs) {
    const r = await p.evaluate(async ({ artist, design, W, H }) => {
      const data = window.__A[artist];
      const pages = window.PF.buildPortfolioPages(data, window.PF.themeById('archive'), { design });
      const acc = { pages: pages.length, overflow: 0, worstOver: 0, clipped: [], desc3: 0, descMax: 0, artPage: [], panelFill: [], contrast: [], text: 0 };
      for (const pg of pages) {
        const m = window.__measure(pg.html, W, H);
        if (m.overflow > 1 || m.clipped.length) {
          acc.overflow++;
          const worst = Math.max(m.overflow, ...m.clipped.map((c) => c.over));
          if (worst > acc.worstOver) { acc.worstOver = worst; acc.clipped = [pg.label, ...m.clipped.slice(0, 2).map((c) => `${c.tag}+${c.over}"${c.txt}"`)]; }
        }
        for (const d of m.desc) { if (d.lines > 2) acc.desc3++; if (d.h > acc.descMax) acc.descMax = d.h; }
        if (pg.label !== '표지' && !/소개$|이야기$|^CV|^연락처|^작가노트/.test(pg.label))
          for (const a of m.art) { acc.artPage.push(a.page); if (a.panelFill != null) acc.panelFill.push(a.panelFill); }
        acc.text += m.textPx;
        for (const c of m.contrast) acc.contrast.push(c);
      }
      const med = (a) => a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : null;
      return { pages: acc.pages, overflow: acc.overflow, worstOver: +acc.worstOver.toFixed(1), clipped: acc.clipped,
        desc3: acc.desc3, descMax: acc.descMax, artPage: med(acc.artPage), panelFill: med(acc.panelFill),
        badContrast: acc.contrast.length, worstCr: acc.contrast.length ? Math.min(...acc.contrast.map((c) => c.cr)) : null,
        crSample: acc.contrast.slice(0, 3) };
    }, { artist: c.artist, design: c.design, W: c.W, H: c.H });
    rows.push({ ...c, ...r });
  }
  writeFileSync(`${HERE}/out-${tag}.json`, JSON.stringify(rows, null, 1));
  return rows;
}

const PAGES = ['a4-portrait', 'a4-landscape', 'wide'];
const LAYOUTS = ['hero', 'label', 'full', 'duo', 'grid', 'index'];
const results = {};

if (sweep === 'all' || sweep === 'main') {
  const cfg = [];
  for (const artist of Object.keys(ARTISTS))
    for (const worksLayout of LAYOUTS)
      for (const desc of ['none', 'short', 'full'])
        for (const page of PAGES) {
          const d = await p.evaluate((k) => window.PF.PAGE_DIMS[k], page);
          cfg.push({ artist, worksLayout, desc, page, W: d.w, H: d.h, design: DESIGN({ worksLayout, desc, page }) });
        }
  results.main = await run(cfg, 'main');
  const bad = results.main.filter((r) => r.overflow);
  console.log(`\n[main] ${cfg.length}조합 / 총 ${results.main.reduce((n, r) => n + r.pages, 0)}장`);
  console.log(`  넘침 조합 ${bad.length}  · 설명 3줄+ ${results.main.reduce((n, r) => n + r.desc3, 0)}건 (최대 ${Math.max(...results.main.map((r) => r.descMax))}px, 예약 42px)`);
  for (const r of bad.slice(0, 12)) console.log(`   ✗ ${r.artist}/${r.worksLayout}/${r.desc}/${r.page}  ${r.overflow}장 넘침 최대 ${r.worstOver}px  ${JSON.stringify(r.clipped)}`);
  console.log('  작품 지면점유(중앙값) — 레이아웃별');
  for (const l of LAYOUTS) {
    const v = results.main.filter((r) => r.worksLayout === l && r.artPage != null);
    const m = v.map((r) => r.artPage).sort((a, b) => a - b);
    const f = v.map((r) => r.panelFill).filter((x) => x != null).sort((a, b) => a - b);
    console.log(`   ${l.padEnd(6)} 지면 ${(100 * m[m.length >> 1]).toFixed(1)}%   패널채움 ${f.length ? (100 * f[f.length >> 1]).toFixed(0) + '%' : '—'}`);
  }
  const cr = results.main.filter((r) => r.badContrast);
  console.log(`  대비 미달 조합 ${cr.length}/${cfg.length}  최저 ${Math.min(...cr.map((r) => r.worstCr)).toFixed(2)}:1`);
  console.log('   예:', JSON.stringify(cr[0]?.crSample));
}

if (sweep === 'all' || sweep === 'covers') {
  const layouts = await p.evaluate(() => window.PF.COVER_LAYOUTS.map((c) => c.key));
  const cfg = [];
  for (const artist of ['rich', 'stress', 'typical'])
    for (const coverLayout of layouts)
      for (const page of PAGES) {
        const d = await p.evaluate((k) => window.PF.PAGE_DIMS[k], page);
        cfg.push({ artist, coverLayout, page, W: d.w, H: d.h, design: DESIGN({ coverLayout, page }) });
      }
  results.covers = await run(cfg, 'covers');
  const bad = results.covers.filter((r) => r.overflow);
  console.log(`\n[covers] ${cfg.length}조합  넘침 ${bad.length}`);
  for (const r of bad.slice(0, 10)) console.log(`   ✗ ${r.artist}/${r.coverLayout}/${r.page} 최대 ${r.worstOver}px ${JSON.stringify(r.clipped)}`);
}

if (sweep === 'all' || sweep === 'fonts') {
  const cfg = [];
  for (const font of ['myeongjo', 'gothic', 'noto', 'gowun', 'plex', 'nanum'])
    for (const artist of ['rich', 'stress'])
      for (const worksLayout of ['hero', 'grid']) {
        const d = await p.evaluate(() => window.PF.PAGE_DIMS['a4-portrait']);
        cfg.push({ artist, font, worksLayout, page: 'a4-portrait', W: d.w, H: d.h, design: DESIGN({ font, worksLayout, desc: 'short' }) });
      }
  results.fonts = await run(cfg, 'fonts');
  const bad = results.fonts.filter((r) => r.overflow);
  console.log(`\n[fonts] ${cfg.length}조합  넘침 ${bad.length}`);
  for (const r of bad.slice(0, 12)) console.log(`   ✗ ${r.font}/${r.artist}/${r.worksLayout} ${r.overflow}장 최대 ${r.worstOver}px ${JSON.stringify(r.clipped)}`);
}

if (errs.length) console.log('\n페이지 에러:', errs.slice(0, 5));
await b.close(); srv.close();
