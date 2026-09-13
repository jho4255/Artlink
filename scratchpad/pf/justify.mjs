/**
 * 양쪽맞춤이 **PDF 경로에서도 유지되는가** (2026-09-13)
 *
 * 화면(크롬)은 CSS 로 양쪽맞춤을 하지만, PDF 는 html2canvas 가 글자를 **다시 그린다**.
 * 단어 위치를 스스로 계산하는 구현이면 양쪽맞춤이 조용히 풀린다 — 화면만 보면 절대 모른다.
 *
 *   node justify.mjs      → justify-dom.png / justify-h2c.png
 */
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fillPortfolio } from './fill.mjs';

const CACHE = new URL('./cache/', import.meta.url).pathname;
const OUT = new URL('./ba/', import.meta.url).pathname;
const UID = 521;   // 오무 — 약력 1246자, 문장마다 줄바꿈

const browser = await pw.chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 2 })).newPage();
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => {
  const m = await import('/src/lib/portfolioFormats.ts');
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = m.PORTFOLIO_FONT_HREF;
  document.head.appendChild(l);
  await new Promise((r) => { l.onload = r; l.onerror = r; setTimeout(r, 4000); });
  await document.fonts.ready;
});

const pf = JSON.parse(readFileSync(`${CACHE}pf-${UID}.json`, 'utf8'));
const dims = existsSync(`${CACHE}dims-${UID}.json`) ? JSON.parse(readFileSync(`${CACHE}dims-${UID}.json`, 'utf8')) : {};
const { data } = fillPortfolio(pf, UID, dims);

const res = await page.evaluate(async ({ data }) => {
  const m = await import('/src/lib/portfolioFormats.ts');
  const design = { coverLayout: 'serifCenter', worksLayout: 'hero', page: 'a4-landscape' };
  const dom = m.buildPortfolioPages(data, m.themeById('archive'), { design }).find((p) => p.kind === 'cv');
  const pdf = m.buildPortfolioPages(data, m.themeById('archive'), { forPdf: true, design }).find((p) => p.kind === 'cv');

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0';
  document.body.appendChild(host);
  host.innerHTML = pdf.html;
  const { default: html2canvas } = await import('/node_modules/html2canvas/dist/html2canvas.esm.js');
  const canvas = await html2canvas(host.firstElementChild, { scale: 1.4, backgroundColor: '#fff' });
  host.remove();

  // 줄 오른쪽 끝이 얼마나 들쭉날쭉한가 — 양쪽맞춤이면 거의 0
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:-99999px;top:0';
  document.body.appendChild(probe);
  probe.innerHTML = dom.html;
  let ragged = null;
  for (const el of probe.querySelectorAll('div')) {
    if (el.children.length || !(el.textContent || '').trim().startsWith('오무가 생각하는')) continue;
    const rg = document.createRange(); rg.selectNodeContents(el);
    const rects = [...rg.getClientRects()];
    if (rects.length < 3) continue;
    const rights = rects.slice(0, -1).map((r) => r.right);   // 마지막 줄은 원래 안 늘린다
    ragged = Math.round(Math.max(...rights) - Math.min(...rights));
    break;
  }
  probe.remove();

  document.getElementById('root').innerHTML = '';
  document.getElementById('root').appendChild(canvas);
  canvas.id = 'h2c';
  canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:99999';
  return { ragged, w: canvas.width, h: canvas.height, domHtml: dom.html };
}, { data: { ...data } });

await page.setViewportSize({ width: Math.min(2400, res.w), height: Math.min(1400, res.h) });
writeFileSync(`${OUT}justify-h2c.png`, await page.locator('#h2c').screenshot());
console.log(`양쪽맞춤 줄 끝 들쭉날쭉: ${res.ragged}px  (0 에 가까우면 맞춤 적용됨)`);
console.log(`PDF 경로 렌더 → ${OUT}justify-h2c.png (${res.w}×${res.h})`);
await browser.close();
