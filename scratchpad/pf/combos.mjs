/**
 * **실제 작가 데이터로 포트폴리오 조합 20개를 뽑는다** (2026-09-13)
 *
 * 지금까지 이 폴더의 하니스는 전부 '숫자로 판정'했다(넘침 0, 채움률 99.9%…).
 * 그런데 "이 설정으로 만들면 어떤 책이 나오는가"는 눈으로 봐야 알 수 있고,
 * 합성 데이터(`data.mjs` 색면 4명)로는 그게 안 보인다.
 *
 * ## 데이터
 * - 실서버 **공개** 라우트에서 받는다(`https://artlink.cc/api/portfolio/:id`, 로그인 없음).
 * - 사진·이름·약력·작가노트는 **실제 것**, 빠진 **작품정보만** `fill.mjs` 가 채운다.
 * - ⚠️ 결과물은 실제 가입자의 작품이다. `scratchpad/pf/combos/` 는 gitignore —
 *   **커밋·배포·외부 공유 금지**(CLAUDE.md 「실제 가입자 작품을 public/ 으로 옮기지 말 것」과 같은 이유).
 *
 * ## 실행
 *   node combos.mjs            # 20개 전부
 *   node combos.mjs 1 5        # 1~5번만 (중간에 끊겼을 때)
 *   node combos.mjs --no-pdf   # 미리보기 PNG 만 (빠름)
 *
 * 로컬 dev 서버(5173)가 떠 있어야 한다 — 엔진을 번들이 아니라 **살아 있는 소스**에서 import 한다.
 */
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import sharp from '/home/jho4255/ArtLink/backend/node_modules/sharp/dist/index.cjs';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { fillPortfolio } from './fill.mjs';

const API = 'https://artlink.cc/api';
const OUT = new URL('./combos/', import.meta.url).pathname;
const CACHE = new URL('./cache/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
mkdirSync(CACHE, { recursive: true });

const { ARTISTS, COMBOS } = await import('./combos-def.mjs');

const slug = (s) => s.replace(/[^가-힣A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ── 실데이터 받기 (+ 사진 비율 실측) ────────────────────────────────────
async function loadArtist(uid) {
  const f = `${CACHE}pf-${uid}.json`;
  let pf;
  if (existsSync(f)) pf = JSON.parse(readFileSync(f, 'utf8'));
  else {
    const r = await fetch(`${API}/portfolio/${uid}`);
    if (!r.ok) throw new Error(`portfolio ${uid}: HTTP ${r.status}`);
    pf = await r.json();
    writeFileSync(f, JSON.stringify(pf));
  }
  // 치수를 사진 비율에서 만들어야 캡션과 그림이 어긋나지 않는다. 비율만 필요하니 t240 으로 잰다.
  const dimsFile = `${CACHE}dims-${uid}.json`;
  let dims = existsSync(dimsFile) ? JSON.parse(readFileSync(dimsFile, 'utf8')) : {};
  for (const im of pf.images ?? []) {
    if (dims[im.url]) continue;
    try {
      const t = im.url.replace(/\/([^/]+)$/, '/t240/$1');
      const res = await fetch(t).then((x) => (x.ok ? x : fetch(im.url)));
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      dims[im.url] = { w: meta.width, h: meta.height };
    } catch { dims[im.url] = { w: 1, h: 1 }; }
  }
  writeFileSync(dimsFile, JSON.stringify(dims));
  return fillPortfolio(pf, uid, dims);
}

// ── 실행 ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const noPdf = args.includes('--no-pdf');
const nums = args.filter((a) => /^\d+$/.test(a)).map(Number);
const [lo, hi] = nums.length === 2 ? nums : nums.length === 1 ? [nums[0], nums[0]] : [1, 99];
const jobs = COMBOS.filter((c) => c.n >= lo && c.n <= hi);

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });

// 글꼴을 먼저 붙인다 — 없으면 폴백 글꼴로 렌더된 책이 나온다(표지 큰 글씨에서 바로 티가 난다)
await page.evaluate(async () => {
  const m = await import('/src/lib/portfolioFormats.ts');
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = m.PORTFOLIO_FONT_HREF;
  document.head.appendChild(l);
  await new Promise((r) => { l.onload = r; l.onerror = r; setTimeout(r, 4000); });
  await document.fonts.ready;
});

const loaded = new Set();
const rows = [];

for (const job of jobs) {
  const t0 = Date.now();
  if (!loaded.has(job.uid)) {
    const { filled, data } = await loadArtist(job.uid);
    await page.evaluate(async ({ uid, data }) => {
      const { measureAspects, aspectMap } = await import('/src/lib/artworkAnalysis.ts');
      await measureAspects(data.images.map((i) => i.url));      // 배치가 비율을 알아야 지면을 채운다
      window.__PF = window.__PF || {};
      window.__PF[uid] = { ...data, aspects: aspectMap(data.images) };
    }, { uid: job.uid, data });
    loaded.add(job.uid);
    console.log(`  · ${job.uid} ${ARTISTS[job.uid].name} 로드 (작품 ${data.images.length}점, 채운 칸 ${filled})`);
  }

  const name = `${String(job.n).padStart(2, '0')}-${ARTISTS[job.uid].name}-${slug(job.why)}`;

  // ① 미리보기 — 표지 + 작품 2장 + CV 를 한 줄로 붙여 한 장에 담는다
  const info = await page.evaluate(async ({ uid, design }) => {
    const m = await import('/src/lib/portfolioFormats.ts');
    const data = window.__PF[uid];
    const pages = m.buildPortfolioPages(data, m.themeById('archive'), { design });
    const w = pages.filter((p) => p.kind === 'works');
    const pick = [pages[0], w[0], w[Math.min(w.length - 1, Math.floor(w.length / 2))], pages.find((p) => p.kind === 'cv')]
      .filter(Boolean).filter((p, i, a) => a.indexOf(p) === i);
    const dims = m.PAGE_DIMS[m.normalizePdfDesign(design).page];
    const s = 480 / dims.h;
    document.getElementById('root').innerHTML =
      `<div id="sheet" style="position:fixed;left:0;top:0;z-index:99999;display:flex;gap:14px;padding:14px;background:#8a8a8a">` +
      pick.map((p) => `<div style="width:${dims.w * s}px;height:${dims.h * s}px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.35)">
         <div style="transform:scale(${s});transform-origin:0 0">${p.html}</div></div>`).join('') +
      `</div>`;
    await Promise.all([...document.querySelectorAll('#sheet img')].map((im) =>
      im.complete && im.naturalWidth ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
    await new Promise((r) => setTimeout(r, 350));
    return { pages: pages.length, labels: pick.map((p) => p.label), comps: [...new Set(w.map((p) => p.composition))].filter(Boolean),
      works: data.images.length, sheetW: document.getElementById('sheet').offsetWidth };
  }, { uid: job.uid, design: job.d });

  await page.setViewportSize({ width: Math.min(2400, Math.ceil(info.sheetW) + 4), height: 520 });
  writeFileSync(`${OUT}${name}.png`, await page.locator('#sheet').screenshot());

  // ② 진짜 PDF — 사용자가 [저장]을 눌렀을 때와 같은 경로(forPdf + renderPagesToPdf)
  let pdf = null;
  if (!noPdf) {
    const dl = page.waitForEvent('download', { timeout: 600000 });
    await page.evaluate(async ({ uid, design, name }) => {
      const m = await import('/src/lib/portfolioFormats.ts');
      const data = window.__PF[uid];
      const d = m.normalizePdfDesign(design);
      const pages = m.buildPortfolioPages(data, m.themeById('archive'), { forPdf: true, design });
      const blob = await m.renderPagesToPdf(pages, m.applyDesign(m.themeById('archive'), d));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${name}.pdf`;
      document.body.appendChild(a); a.click();
    }, { uid: job.uid, design: job.d, name });
    const d = await dl;
    await d.saveAs(`${OUT}${name}.pdf`);
    pdf = `${name}.pdf`;
  }

  rows.push({ ...job, name, ...info, pdf, sec: ((Date.now() - t0) / 1000).toFixed(0) });
  console.log(`${String(job.n).padStart(2)}. ${name}  ${info.pages}쪽  배치[${info.comps.join(',')}]  ${rows.at(-1).sec}s`);
}

// ── 한눈에 보는 목록 ────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
writeFileSync(`${OUT}index.html`, `<!doctype html><meta charset="utf-8"><title>포트폴리오 조합 ${rows.length}종</title>
<style>body{font:14px/1.6 system-ui;margin:0;padding:28px;background:#111;color:#eee}
h1{font-size:20px;margin:0 0 4px}p{color:#9a9a9a;margin:0 0 24px;max-width:70ch}
section{margin:0 0 34px}h2{font-size:15px;margin:0 0 8px;font-weight:600}
.m{color:#8a8a8a;font-weight:400;font-size:13px}img{max-width:100%;display:block;border-radius:4px}
a{color:#7ab8ff}</style>
<h1>포트폴리오 조합 ${rows.length}종 — 실제 작가 데이터</h1>
<p>사진·이름·약력·작가노트는 실서버의 실제 데이터입니다. 작품정보(제목·재료·크기·연도·설명)가
비어 있던 작가는 대역으로 채웠습니다 — <b>그 작가가 쓴 글이 아닙니다.</b> 로컬 검토용이며 공유·커밋 금지.</p>
${rows.map((r) => `<section><h2>${r.n}. ${esc(r.why)}
 <span class="m">— ${esc(ARTISTS[r.uid].name)}(작품 ${r.works}점) · ${r.pages}쪽 ·
 ${esc(r.d.coverLayout)} / ${esc(r.d.auto ? '자동편집(' + r.comps.join(',') + ')' : r.d.worksLayout)} /
 ${esc(r.d.page)} / ${esc(r.d.font)} / ${esc(r.d.bg)}·${esc(r.d.ink)}·${esc(r.d.accent)}
 ${r.pdf ? `· <a href="${encodeURI(r.pdf)}">PDF</a>` : ''}</span></h2>
<img src="${encodeURI(r.name)}.png" alt=""></section>`).join('\n')}`);

console.log(`\n완료 — ${OUT}index.html`);
console.log('에러:', errs.length ? errs.slice(0, 5) : '없음');
await browser.close();
