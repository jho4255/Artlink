// 디버그 마스크 시각화 + BEFORE/AFTER — 브리핑의 "debug output" 요구.
//
// ⚠️ 마스크는 **엔진이 본 렌더와 같은 quad·같은 워프로** 만들어 준다(`?debug=1` 훅).
//    여기서 다시 계산하면 그림과 어긋나 디버그가 거짓말이 된다.
//
//   node masks.mjs [caseId]
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const { chromium } = pw;
const HERE = '/home/jho4255/ArtLink/scratchpad/vt';
const OUT = `${HERE}/debug`;
mkdirSync(OUT, { recursive: true });
const suite = JSON.parse(readFileSync(`${HERE}/suite.json`, 'utf8'));
const id = process.argv[2] || 't01';
const c = suite.cases.find((x) => x.id === id) || suite.cases[0];

const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:5173/artlook/index.html?debug=1', { waitUntil: 'networkidle' });
await p.waitForTimeout(3800);
await p.evaluate(() => {
  window.__vtLoad = (f) => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => { state.img = capToCanvas(im); res(1); };
    im.onerror = rej; im.src = '/demo-art/' + f;
  });
});
const shots = await p.evaluate(async (cc) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await window.__vtLoad(cc.work);
  state.frameIdx = FRAMES.findIndex((f) => f.name === cc.frame);
  state.sceneIdx = SCENES.findIndex((s) => s.id === cc.scene);
  state.matWidth = cc.mat; selectedWork = null;
  render(); await wait(700);
  const after = window.__artlookDebug({});
  await wait(400);
  // BEFORE = 이번 라운드 이전 설정(벽 진정 없음 + 예전 높이 기준 크기)
  const before = window.__artlookDebug({ wallCalm: 0, frameArea: 0.215 });
  return { after, before };
}, c);
if (!shots.after) { console.log('✗ 디버그 훅 없음'); await b.close(); process.exit(1); }
const w = (n, d) => d && writeFileSync(`${OUT}/${n}.png`, Buffer.from(d.split(',')[1], 'base64'));
w(`${id}_after`, shots.after.final);
w(`${id}_before`, shots.before.final);
w(`${id}_masks`, shots.after.masks);
for (const [k, v] of Object.entries(shots.after.shadow || {})) w(`${id}_shadow_${k}`, v);
writeFileSync(`${OUT}/${id}_meta.json`, JSON.stringify({
  maskColors: shots.after.maskColors, geom: shots.after.geom,
  ss: shots.after.ss, canvas: shots.after.canvas,
}, null, 1));
console.log(`✓ ${id}  →  ${OUT}/  (마스크 색: ${JSON.stringify(shots.after.maskColors)})`);
console.log('에러:', errs.length ? [...new Set(errs)].slice(0, 4) : '없음');
await b.close();
