/**
 * **작품이 지면을 얼마나 쓰는가** — 고정 배치 × 판형 전수 (2026-09-13)
 *
 *   node coverage.mjs            # 작가 3명 × 배치 7 × 판형 3
 *   node coverage.mjs --artist 503
 *
 * ## 왜 만들었나
 * 이 폴더엔 이미 지면점유 지표가 있었다(`probe3.mjs`, 골든 5종 실측). 그런데 **자동 편집만**
 * 태웠고, 사용자가 직접 고르는 **고정 배치(worksLayout)는 한 번도 안 태웠다.**
 * 그래서 "4점 격자"를 고른 작가의 책이 지면의 **17~26%** 만 쓰고 있는 걸 아무도 못 잡았다
 * (2026-09-13 외부 리뷰가 눈으로 먼저 찾았다). 넘침(`audit.mjs`)만 보면 이런 건 구조적으로 안 보인다 —
 * 텅 빈 페이지는 절대 넘치지 않기 때문이다.
 *
 * ## 기준을 골든 절대값으로 두지 않는 이유 (2026-09-13 실측)
 * 골든(실제 작가 포트폴리오 5종·작품 319점, `golden2.py`)의 쪽당 작품 수별 지면점유는
 * 1점 42.2% · 2점 48.7% · 3점 49.9% · 4점 56.1% 인데, **그건 전부 세로 판형 도록**이다.
 * 판형과 작품 비율이 어긋나면 그 값은 **기하학적으로 도달할 수 없다** — 예를 들어 가로 지면
 * (1414×1000, 본문 1182×776)에 정사각 작품 4점을 캡션과 함께 놓으면 최선이 **25%** 다:
 *   · 2열×2행 → 높이에 걸려 h=275, 행 폭은 550/1182 (가로 절반이 빈다)
 *   · 1열×4점 → 폭에 걸려 h=253, 쓰는 높이는 344/776 (세로 절반이 빈다)
 * 그래서 여기서는 골든을 **참고 열**로 두고, 판정은 **회귀 방지**로 한다 —
 * `coverage-baseline.json` 보다 나빠지면 실패. 기준선은 `--save` 로 갱신한다.
 * ⚠️ 나빠졌는데 기준선을 갱신해서 통과시키지 말 것. 갱신은 **의도한 개선을 기록할 때만**이다.
 * 6점 목록(index)은 '도판 색인'이라 작게 싣는 게 의도다 — 골든에 대응 구성이 없어 참고만 한다.
 */
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fillPortfolio } from './fill.mjs';

const CACHE = new URL('./cache/', import.meta.url).pathname;
const GOLDEN = { 1: 0.422, 2: 0.487, 3: 0.499, 4: 0.561, 6: null };
const LAYOUTS = ['hero', 'label', 'full', 'feature', 'duo', 'grid', 'index'];
const PER = { hero: 1, label: 1, full: 1, feature: 3, duo: 2, grid: 4, index: 6 };
const PAGES = ['a4-portrait', 'a4-landscape', 'wide'];

const only = process.argv.includes('--artist') ? Number(process.argv[process.argv.indexOf('--artist') + 1]) : null;
const ARTISTS = (only ? [only] : [503, 526, 521]);

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

const rows = [];
for (const uid of ARTISTS) {
  const pf = JSON.parse(readFileSync(`${CACHE}pf-${uid}.json`, 'utf8'));
  const dims = existsSync(`${CACHE}dims-${uid}.json`) ? JSON.parse(readFileSync(`${CACHE}dims-${uid}.json`, 'utf8')) : {};
  const { data } = fillPortfolio(pf, uid, dims);
  await page.evaluate(async ({ uid, data }) => {
    const { measureAspects, aspectMap } = await import('/src/lib/artworkAnalysis.ts');
    await measureAspects(data.images.map((i) => i.url));
    window.__PF = window.__PF || {};
    window.__PF[uid] = { ...data, aspects: aspectMap(data.images) };
  }, { uid, data });

  for (const layout of LAYOUTS) {
    for (const pg of PAGES) {
      const r = await page.evaluate(async ({ uid, layout, pg }) => {
        const m = await import('/src/lib/portfolioFormats.ts');
        const design = { worksLayout: layout, page: pg, coverLayout: 'serifCenter', desc: 'short' };
        const d = m.normalizePdfDesign(design);
        const pages = m.buildPortfolioPages(window.__PF[uid], m.themeById('archive'), { design });
        const dims = m.PAGE_DIMS[d.page];
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;left:0;top:0;z-index:99999';
        document.getElementById('root').innerHTML = ''; document.body.appendChild(host);
        const vals = [];
        for (const p of pages.filter((x) => x.kind === 'works')) {
          host.innerHTML = p.html;
          const root = host.firstElementChild;
          const imgs = [...root.querySelectorAll('img')];
          await Promise.all(imgs.map((im) => (im.complete && im.naturalWidth ? 0 : new Promise((r2) => { im.onload = im.onerror = r2; }))));
          const a = imgs.reduce((s, im) => { const b = im.getBoundingClientRect(); return s + b.width * b.height; }, 0);
          vals.push(a / (dims.w * dims.h));
        }
        host.remove();
        vals.sort((x, y) => x - y);
        return { n: vals.length, med: vals.length ? vals[Math.floor(vals.length / 2)] : 0, min: vals[0] ?? 0, max: vals.at(-1) ?? 0 };
      }, { uid, layout, pg });
      rows.push({ uid, layout, pg, ...r });
    }
  }
}
await browser.close();

const BASE = new URL('./coverage-baseline.json', import.meta.url).pathname;
const key = (r) => `${r.uid}/${r.layout}/${r.pg}`;
const save = process.argv.includes('--save');
const base = existsSync(BASE) ? JSON.parse(readFileSync(BASE, 'utf8')) : null;
const TOL = 0.02;   // 2%p 까지는 측정 편차로 본다

let fail = 0;
console.log('작가   배치      판형            쪽수  최소    중앙    최대   골든(참고)  기준선  판정');
for (const r of rows) {
  const g = GOLDEN[PER[r.layout]];
  const b = base?.[key(r)];
  const bad = b != null && r.med < b - TOL;
  if (bad) fail += 1;
  console.log(
    `${r.uid}  ${r.layout.padEnd(8)} ${r.pg.padEnd(15)} ${String(r.n).padStart(3)}  ` +
    `${(r.min * 100).toFixed(1).padStart(5)}%  ${(r.med * 100).toFixed(1).padStart(5)}%  ${(r.max * 100).toFixed(1).padStart(5)}%  ` +
    `${(g ? (g * 100).toFixed(1) + '%' : '   -').padStart(8)}  ` +
    `${(b == null ? '   -' : (b * 100).toFixed(1) + '%').padStart(6)}  ${b == null ? '(새 항목)' : bad ? '✗ 나빠짐' : '○'}`);
}
if (save) {
  writeFileSync(BASE, JSON.stringify(Object.fromEntries(rows.map((r) => [key(r), +r.med.toFixed(4)])), null, 1));
  console.log(`\n기준선 저장 — ${BASE}`);
} else {
  console.log(`\n나빠진 항목 ${fail} / ${rows.length}${base ? '' : '  (기준선 없음 — --save 로 만들 것)'}`);
}
process.exit(fail ? 1 : 0);
