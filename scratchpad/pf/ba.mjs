/**
 * **전/후 비교 이미지** — 같은 작가·같은 설정을 옛 엔진과 새 엔진으로 나란히 렌더한다 (2026-09-13)
 *
 *   git show HEAD:frontend/src/lib/portfolioFormats.ts > frontend/src/lib/portfolioFormats.before.ts
 *   node ba.mjs
 *   rm frontend/src/lib/portfolioFormats.before.ts      # ⚠️ 끝나면 반드시 지울 것
 *
 * ⚠️ 옛 엔진을 **복사본 모듈**로 띄워 같은 페이지에서 둘 다 import 한다 — 브랜치를 오가며
 *    두 번 렌더하면 글꼴 로드·이미지 캐시가 달라져 비교가 흐려진다(같은 조건이어야 한다).
 * ⚠️ 쪽수가 버전마다 다를 수 있으므로(이어지는 장 재분배) **라벨·종류로 각자 찾는다**.
 */
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fillPortfolio } from './fill.mjs';

const CACHE = new URL('./cache/', import.meta.url).pathname;
const OUT = new URL('./ba/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

/** pick: {kind?, nth?, label?} — 버전마다 따로 찾는다. mode: 'page'(전체) | 'strip'(아래 띠 원본 크기) */
const CASES = [
  { file: '1-표지-회색판', uid: 537, title: '표지 — 그림 뒤 회색 판', note: '4점 격자 표지. 판의 30%만 그림이 덮었다',
    design: { coverLayout: 'grid2x2', worksLayout: 'grid', page: 'a4-portrait' }, pick: { kind: 'cover' } },
  { file: '2-전면배치-회색판', uid: 526, title: '전면 배치 작품 — 그림 뒤 회색 판', note: '27쪽 내내 좌우로 회색 띠. 판의 65%만 덮었다',
    design: { coverLayout: 'fullTint', worksLayout: 'full', page: 'a4-landscape', worksCaption: 'minimal', desc: 'none' }, pick: { kind: 'works', nth: 2 } },
  { file: '3-뮤지엄라벨-세로판형', uid: 503, title: '뮤지엄 라벨 — 세로 판형', note: '작품 지면점유 15.5% → 42.4% (라벨을 옆에서 아래로)',
    design: { coverLayout: 'bandBottom', worksLayout: 'label', page: 'a4-portrait', desc: 'full' }, pick: { kind: 'works', nth: 1 } },
  { file: '4-격자-열폭', uid: 537, title: '격자 — 칸 폭을 균등 분할하지 않는다', note: '제일 넓은 작품이 행 전체를 납작하게 만들던 것',
    design: { coverLayout: 'serifCenter', worksLayout: 'grid', page: 'a4-landscape' }, pick: { kind: 'works', nth: 1 } },
  { file: '5-이어지는장', uid: 503, title: 'CV (계속) — 몇 줄만 남던 장', note: '내용 높이 30% → 53%',
    design: { coverLayout: 'serifCenter', worksLayout: 'hero', page: 'a4-portrait' }, pick: { label: /^CV \(2\)/ } },
  { file: '6-줄바꿈과-줄길이', uid: 521, title: '약력 — 줄바꿈 정리 · 줄 길이 상한 · 양쪽맞춤', note: '문장마다 끊기던 산문을 잇고, 한 줄을 46자로 묶고, 오른쪽 끝을 맞춘다',
    design: { coverLayout: 'serifCenter', worksLayout: 'hero', page: 'a4-landscape' }, pick: { kind: 'cv', nth: 1 } },
  { file: '7-연락처-배지와-쪽번호', uid: 503, title: '연락처 — ARTLINK 배지 삭제 · 쪽번호 추가', note: '작가가 갤러리에 내는 문서다',
    design: { coverLayout: 'serifCenter', worksLayout: 'hero', page: 'a4-portrait' }, pick: { kind: 'contact' } },
  { file: '8-캡션-설명-정렬', uid: 521, title: '캡션 — 설명만 왼쪽으로 밀리던 것', note: '제목·재료·크기는 가운데인데 설명만 본문 정렬(왼쪽)을 따랐다',
    design: { coverLayout: 'split', worksLayout: 'hero', page: 'a4-landscape', desc: 'short' }, pick: { kind: 'works', nth: 1 } },
  { file: '9-가로판형-hero-캡션', uid: 574, title: '가로 판형 + 세로 작품 — 캡션을 옆으로', note: '아래 두면 그림이 높이에서 먼저 걸린다',
    design: { coverLayout: 'ruleFrame', worksLayout: 'hero', page: 'a4-landscape', desc: 'short' }, pick: { kind: 'works', nth: 3 } },
];

const browser = await pw.chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1900, height: 1100 }, deviceScaleFactor: 2 })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => {
  const m = await import('/src/lib/portfolioFormats.ts');
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = m.PORTFOLIO_FONT_HREF;
  document.head.appendChild(l);
  await new Promise((r) => { l.onload = r; l.onerror = r; setTimeout(r, 4000); });
  await document.fonts.ready;
});

const loaded = new Set();
const filter = process.argv[2];
for (const c of CASES.filter((x) => !filter || x.file.startsWith(filter))) {
  if (!loaded.has(c.uid)) {
    const pf = JSON.parse(readFileSync(`${CACHE}pf-${c.uid}.json`, 'utf8'));
    const dims = existsSync(`${CACHE}dims-${c.uid}.json`) ? JSON.parse(readFileSync(`${CACHE}dims-${c.uid}.json`, 'utf8')) : {};
    const { data } = fillPortfolio(pf, c.uid, dims);
    await page.evaluate(async ({ uid, data }) => {
      const { measureAspects, aspectMap } = await import('/src/lib/artworkAnalysis.ts');
      await measureAspects(data.images.map((i) => i.url));
      window.__PF = window.__PF || {};
      window.__PF[uid] = { ...data, aspects: aspectMap(data.images) };
    }, { uid: c.uid, data });
    loaded.add(c.uid);
  }

  const info = await page.evaluate(async ({ c }) => {
    const NEW = await import('/src/lib/portfolioFormats.ts');
    const OLD = await import('/src/lib/portfolioFormats.before.ts');
    const data = window.__PF[c.uid];
    const build = (m) => m.buildPortfolioPages(data, m.themeById('archive'), { design: c.design });
    const find = (pages) => {
      if (c.pick.label) return pages.find((p) => new RegExp(c.pick.label.source ?? c.pick.label).test(p.label));
      const hits = pages.filter((p) => p.kind === c.pick.kind);
      return hits[Math.min(hits.length - 1, (c.pick.nth ?? 1) - 1)];
    };
    const dims = NEW.PAGE_DIMS[NEW.normalizePdfDesign(c.design).page];
    const strip = c.mode === 'strip';
    const s = strip ? 1 : Math.min(1, 620 / dims.h);
    const boxH = strip ? 260 : Math.round(dims.h * s);
    const boxW = Math.round(dims.w * s);
    const pane = (label, html) => `
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="font:600 15px/1 system-ui;color:#fff;letter-spacing:.04em">${label}</div>
        <div style="width:${boxW}px;height:${boxH}px;overflow:hidden;box-shadow:0 2px 14px rgba(0,0,0,.45);background:#fff">
          <div style="transform:scale(${s});transform-origin:0 0;${strip ? `margin-top:-${dims.h - boxH}px` : ''}">${html}</div>
        </div>
      </div>`;
    const oldPage = find(build(OLD)), newPage = find(build(NEW));
    document.getElementById('root').innerHTML = `
      <div id="ba" style="position:fixed;left:0;top:0;z-index:99999;background:#1a1a1a;padding:18px 20px 20px;display:flex;flex-direction:column;gap:12px">
        <div style="font:700 18px/1.4 system-ui;color:#fff">${c.title}
          <span style="font-weight:400;font-size:14px;color:#9a9a9a"> — ${c.note}</span></div>
        <div style="display:flex;gap:20px;align-items:flex-start">
          ${pane('BEFORE', oldPage?.html ?? '')}${pane('AFTER', newPage?.html ?? '')}
        </div>
      </div>`;
    await Promise.all([...document.querySelectorAll('#ba img')].map((im) =>
      im.complete && im.naturalWidth ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
    await new Promise((r) => setTimeout(r, 400));
    const el = document.getElementById('ba');
    return { w: el.offsetWidth, h: el.offsetHeight, old: oldPage?.label, neu: newPage?.label };
  }, { c: { ...c, pick: { ...c.pick, label: c.pick.label ? { source: c.pick.label.source } : undefined } } });

  await page.setViewportSize({ width: Math.min(2400, info.w + 4), height: Math.min(1400, info.h + 4) });
  writeFileSync(`${OUT}${c.file}.png`, await page.locator('#ba').screenshot());
  console.log(`${c.file}.png   BEFORE[${info.old}] / AFTER[${info.neu}]`);
}
console.log('\n에러:', errs.length ? errs.slice(0, 3) : '없음');
await browser.close();
