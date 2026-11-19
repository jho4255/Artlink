// G1 — 그림자 시안: 같은 엔진으로 옵션만 바꿔 전/후를 뽑는다(엔진 파일은 그대로, composeScene 을 감싸 덮어쓴다).
//   node g1.mjs            → q/g1/<케이스>-<시안>.png + q/geo-g1.json
// 시안: now(예전 값: 모서리 그늘 벽까지 · 그림자 1배) · A(모서리 그늘 액자 안만) · B(모서리 그늘 없음) · A15(A + 그림자 1.5배) · B15 · A13
// ⚠️ 엔진의 기본값이 바뀐 뒤에도 'now' 를 재현하려고 cornerAOClip:false · castGain:1 · contactGain:1 을 명시한다.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
const OUT = '/home/jho4255/ArtLink/scratchpad/artlook-review/q/g1'; mkdirSync(OUT, { recursive: true });
const VARIANTS = {
  now: { cornerAOClip: false, castGain: 1, contactGain: 1 },
  A: { cornerAOClip: true, castGain: 1, contactGain: 1 },
  B: { cornerAO: 0, castGain: 1, contactGain: 1 },
  A13: { cornerAOClip: true, castGain: 1.3, contactGain: 1.3 },
  A15: { cornerAOClip: true, castGain: 1.5, contactGain: 1.5 },
  B15: { cornerAO: 0, castGain: 1.5, contactGain: 1.5 },
  A15c: { cornerAOClip: true, castGain: 1.5, contactGain: 1.2 },
  Ac15: { cornerAOClip: true, castGain: 1.5, contactGain: 1 },     // 투영만 1.5배(접지 그대로) — 2026-11-17 채택
  Bc15: { cornerAO: 0, castGain: 1.5, contactGain: 1 },
  Ac18: { cornerAOClip: true, castGain: 1.8, contactGain: 1 },
};
const CASES = [
  ['plaster-black', { work: 'dawn-window.jpg', frame: 'black', scene: 'white-plaster' }],
  ['plaster-oak', { work: 'dawn-window.jpg', frame: 'oak', scene: 'white-plaster' }],
  ['concrete-white', { work: 'square-garden.jpg', frame: 'white', scene: 'concrete' }],
  ['brick-oak', { work: 'water-memory.jpg', frame: 'oak', scene: 'white-brick' }],
  ['terracotta-oak', { work: 'quiet-afternoon.jpg', frame: 'oak', scene: 'terracotta' }],
  ['charcoal-floater', { work: 'dawn-window.jpg', frame: 'floater-oak', scene: 'charcoal' }],
  ['salon-oak', { work: 'dawn-window.jpg', frame: 'oak', scene: 'gallery-salon' }],
  ['cube-black', { work: 'dawn-window.jpg', frame: 'black', scene: 'white-cube' }],
  ['canvas-concrete', { work: 'red-hill.jpg', frame: 'canvas-wrap', scene: 'concrete', mat: 0 }],
];
const only = process.env.ONLY ? process.env.ONLY.split(',') : Object.keys(VARIANTS);
const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:5173/artlook/index.html?preload=all', { waitUntil: 'networkidle' });
await p.waitForTimeout(5000);
await p.evaluate(() => {
  const orig = ArtLookScene.composeScene; window.__ov = null;
  ArtLookScene.composeScene = (ctx, W, H, sc, art, ui) => orig(ctx, W, H, sc, art, window.__ov ? { ...ui, ...window.__ov } : ui);
  window.__load = (file) => new Promise((res, rej) => { const im = new Image(); im.onload = () => { state.img = capToCanvas(im); res(); }; im.onerror = rej; im.src = '/demo-art/' + file; });
});
const GEO = '/home/jho4255/ArtLink/scratchpad/artlook-review/q/geo-g1.json';
const geo = existsSync(GEO) ? JSON.parse(readFileSync(GEO, 'utf8')) : {};   // ONLY 로 일부만 다시 뽑아도 나머지 기하는 남긴다
for (const [cname, c] of CASES) {
  for (const v of only) {
    const r = await p.evaluate(async ({ c, ov }) => {
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      await window.__load(c.work);
      state.frameIdx = FRAMES.findIndex((f) => f.id === c.frame);
      state.sceneIdx = SCENES.findIndex((s) => s.id === c.scene);
      state.matWidth = c.mat == null ? 0.05 : c.mat; state.ratio = '1:1'; state.light = 0; state.caption = false; state.group = null; state.circle = null;
      selectedWork = null; SCENES[state.sceneIdx].adj = { dx: 0, dy: 0, s: 1 };
      window.__ov = ov; render(); await wait(1100); window.__ov = null;
      const cv = document.getElementById('preview'); const pr = window.__artlook || {};
      return { png: cv.toDataURL('image/png'), W: cv.width, H: cv.height, piece: pr.piece ? [pr.piece.x, pr.piece.y, pr.piece.w, pr.piece.h].map(Math.round) : null };
    }, { c, ov: VARIANTS[v] });
    writeFileSync(`${OUT}/${cname}-${v}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
    geo[`g1/${cname}-${v}`] = { W: r.W, H: r.H, piece: r.piece };
  }
  console.log(cname, 'done');
}
writeFileSync(GEO, JSON.stringify(geo, null, 1));
console.log('errors:', errs.length ? [...new Set(errs)].slice(0, 5) : '없음');
await b.close();
