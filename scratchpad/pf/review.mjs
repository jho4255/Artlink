/**
 * 리뷰 지적을 **재서** 확인한다 (2026-09-13). 눈으로 본 지적이 맞는지 / 원인이 무엇인지.
 *
 *   node review.mjs 1 2 4 5 6      # 조합 번호
 *
 * 재는 것
 *  - panel   : 그 장에 깔린 '연회색 판'(softPanel) 개수와, 판 안에서 그림이 차지하는 면적 비율
 *  - fill    : 그 장의 내용이 지면(여백 안쪽)에서 차지하는 세로 비율 — 이어지는 장이 텅 비었는지
 *  - art     : 작품 그림들이 지면에서 차지하는 면적 비율(골든 42~56%)
 *  - line    : 가장 긴 본문 줄의 폭(px)과 대략 글자 수
 *  - grid    : 격자 배열(열×행)과 격자 덩어리의 세로 위치
 */
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { readFileSync, existsSync } from 'node:fs';
import { fillPortfolio } from './fill.mjs';

const CACHE = new URL('./cache/', import.meta.url).pathname;
const COMBOS = (await import('./combos-def.mjs')).COMBOS;

const browser = await pw.chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1000 } })).newPage();
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => {
  const m = await import('/src/lib/portfolioFormats.ts');
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = m.PORTFOLIO_FONT_HREF;
  document.head.appendChild(l);
  await new Promise((r) => { l.onload = r; l.onerror = r; setTimeout(r, 4000); });
  await document.fonts.ready;
});

const nums = process.argv.slice(2).map(Number);
const loaded = new Set();

for (const job of COMBOS.filter((c) => nums.includes(c.n))) {
  if (!loaded.has(job.uid)) {
    const pf = JSON.parse(readFileSync(`${CACHE}pf-${job.uid}.json`, 'utf8'));
    const dims = existsSync(`${CACHE}dims-${job.uid}.json`) ? JSON.parse(readFileSync(`${CACHE}dims-${job.uid}.json`, 'utf8')) : {};
    const { data } = fillPortfolio(pf, job.uid, dims);
    await page.evaluate(async ({ uid, data }) => {
      const { measureAspects, aspectMap } = await import('/src/lib/artworkAnalysis.ts');
      await measureAspects(data.images.map((i) => i.url));
      window.__PF = window.__PF || {};
      window.__PF[uid] = { ...data, aspects: aspectMap(data.images) };
    }, { uid: job.uid, data });
    loaded.add(job.uid);
  }

  const out = await page.evaluate(async ({ uid, design }) => {
    const m = await import('/src/lib/portfolioFormats.ts');
    const data = window.__PF[uid];
    const d = m.normalizePdfDesign(design);
    const theme = m.applyDesign(m.themeById('archive'), d);
    const pages = m.buildPortfolioPages(data, m.themeById('archive'), { design });
    const dims = m.PAGE_DIMS[d.page];
    const panelHex = (() => { // softPanel 과 같은 색을 rgb 로
      const el = document.createElement('div'); el.style.background = theme.ink; document.body.appendChild(el);
      const ink = getComputedStyle(el).backgroundColor; el.style.background = theme.bg;
      const bg = getComputedStyle(el).backgroundColor; el.remove();
      const p = (s) => s.match(/\d+/g).map(Number);
      const [i, b] = [p(ink), p(bg)];
      return `rgb(${i.map((v, k) => Math.round(v * 0.05 + b[k] * 0.95)).join(', ')})`;
    })();

    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;z-index:99999';
    document.getElementById('root').innerHTML = ''; document.body.appendChild(host);
    const rows = [];
    for (const pg of pages) {
      host.innerHTML = pg.html;
      const root = host.firstElementChild;
      await Promise.all([...root.querySelectorAll('img')].map((im) =>
        im.complete && im.naturalWidth ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
      const R = root.getBoundingClientRect();
      const area = dims.w * dims.h;

      // ① 연회색 판 — 판 면적 대비 그림이 실제로 덮는 면적
      const panels = [...root.querySelectorAll('*')]
        .filter((el) => getComputedStyle(el).backgroundColor === panelHex)
        .map((el) => el.getBoundingClientRect()).filter((r) => r.width > 40 && r.height > 40);
      const imgs = [...root.querySelectorAll('img')].map((im) => im.getBoundingClientRect()).filter((r) => r.width > 8);
      const covered = panels.map((p) => {
        const inside = imgs.filter((i) => i.left >= p.left - 2 && i.right <= p.right + 2 && i.top >= p.top - 2 && i.bottom <= p.bottom + 2);
        const a = inside.reduce((s, i) => s + i.width * i.height, 0);
        return p.width * p.height ? a / (p.width * p.height) : 1;
      });

      // ② 내용이 지면에서 차지하는 세로 비율 (이어지는 장이 텅 비었는가)
      const boxes = [...root.querySelectorAll('*')]
        .filter((el) => (el.textContent || '').trim() || el.tagName === 'IMG')
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.height > 2 && r.width > 2 && r.height < dims.h * 0.9);   // 전면 배경 판은 '내용'이 아니다
      // ⚠️ 러닝 머리말(위)·연락처 푸터(아래)를 빼야 한다 — 안 빼면 3줄짜리 장도 '90% 참'으로 나온다
      const body = boxes.filter((b) => b.top - R.top > 120 && b.bottom - R.top < dims.h - 80);
      const top = body.length ? Math.min(...body.map((b) => b.top)) : R.bottom;
      const bot = body.length ? Math.max(...body.map((b) => b.bottom)) : R.top;

      // ③ 작품 그림의 지면 점유
      const art = imgs.reduce((s, i) => s + i.width * i.height, 0) / area;

      // ④ 가장 긴 본문 줄 (Range 로 줄 단위 실측)
      let maxLine = 0, maxText = '';
      for (const el of root.querySelectorAll('p,div,li,span')) {
        if (el.children.length || !(el.textContent || '').trim()) continue;
        const t = el.firstChild; if (!t || t.nodeType !== 3) continue;
        const rg = document.createRange(); rg.selectNodeContents(el);
        for (const r of rg.getClientRects()) if (r.width > maxLine) { maxLine = r.width; maxText = el.textContent.trim().slice(0, 30); }
      }

      // ⑤ 격자 배열
      // 행 수는 top 으로, 열 수는 '한 행에 든 장수'로 센다(칸 안에서 가운데 정렬돼 left 가 제각각이다)
      const ys = [...new Set(imgs.map((i) => Math.round(i.top / 20)))];
      const perRow = Math.max(1, ...ys.map((y) => imgs.filter((i) => Math.round(i.top / 20) === y).length));

      rows.push({
        label: pg.label, kind: pg.kind || '', comp: pg.composition || '',
        panels: panels.length, panelFill: covered.length ? Math.round(Math.min(...covered) * 100) : null,
        fill: Math.round(((bot - top) / dims.h) * 100),
        top: Math.round(top - R.top),
        art: Math.round(art * 100), imgs: imgs.length,
        cols: imgs.length ? perRow : 0, rows: imgs.length ? ys.length : 0,
        line: Math.round(maxLine), chars: maxText.length ? Math.round(maxLine / 13) : 0,
      });
    }
    host.remove();
    return { rows, page: d.page, dims };
  }, { uid: job.uid, design: job.d });

  console.log(`\n━━ ${job.n}. ${job.why} — ${job.uid} (${out.page} ${out.dims.w}×${out.dims.h})`);
  console.log('  쪽  종류      배치      판  판채움  내용높이 시작y  그림점유 장수 열×행  최장줄');
  out.rows.forEach((r, i) => console.log(
    `  ${String(i + 1).padStart(2)}  ${r.label.slice(0, 9).padEnd(10)}${r.comp.padEnd(9)} ` +
    `${String(r.panels).padStart(2)}  ${(r.panelFill == null ? '-' : r.panelFill + '%').padStart(5)}  ` +
    `${(r.fill + '%').padStart(6)}  ${String(r.top).padStart(5)}  ${(r.art + '%').padStart(6)}  ` +
    `${String(r.imgs).padStart(3)}  ${r.cols}×${r.rows}   ${r.line}px(≈${r.chars}자)`));
}
await browser.close();
