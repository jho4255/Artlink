// 골든 회귀 — 스위트 전 케이스를 렌더하고 **정확한 기하**를 함께 받아 적는다.
//
// 왜 기하를 페이지에서 받나: 목업 이미지에서 조각을 다시 검출하면 그림자·벽무늬 때문에
// 경계가 십수 px 씩 어긋난다(레퍼런스 측정에서 실제로 겪었다). 우리 렌더는 좌표를
// 알고 있으므로 추측할 이유가 없다 — 측정 오차 0.
//
//   node render.mjs [outdir]
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const { chromium } = pw;

const HERE = '/home/jho4255/ArtLink/scratchpad/vt';
const OUT = process.argv[2] || `${HERE}/renders`;
mkdirSync(OUT, { recursive: true });
const suite = JSON.parse(readFileSync(`${HERE}/suite.json`, 'utf8'));

const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
// 하니스에서 합성 음영 세기를 바꿔 렌더할 수 있게 (브리핑 9번 전/후 비교)
//   SYN=0 SYNDIR=0 node render.mjs renders_off   → 사진 액자 원본만
const qs = [process.env.SYN != null ? `syn=${process.env.SYN}` : '',
  process.env.SYNDIR != null ? `syndir=${process.env.SYNDIR}` : ''].filter(Boolean).join('&');
await p.goto('http://localhost:5173/artlook/index.html' + (qs ? '?' + qs : ''), { waitUntil: 'networkidle' });
await p.waitForTimeout(3800);

// 데모 작품을 직접 심는다 — 로그인/포트폴리오에 기대면 장비마다 결과가 달라진다
await p.evaluate(() => {
  window.__vtLoad = (file) => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => { state.img = capToCanvas(im); res([im.naturalWidth, im.naturalHeight]); };
    im.onerror = rej;
    im.src = '/demo-art/' + file;
  });
});

const out = {};
for (const c of suite.cases) {
  const r = await p.evaluate(async (cc) => {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const wh = await window.__vtLoad(cc.work);
    const fi = FRAMES.findIndex((f) => f.name === cc.frame);
    const si = SCENES.findIndex((s) => s.id === cc.scene);
    if (fi < 0 || si < 0) return { err: `frame/scene 없음 ${cc.frame}/${cc.scene}` };
    state.frameIdx = fi; state.sceneIdx = si; state.matWidth = cc.mat;
    selectedWork = null;                       // 실치수 미지정 → 장면 기본 채움
    render(); await wait(900);
    const cv = document.getElementById('preview');
    const framed = buildFramed(state.img);
    return {
      png: cv.toDataURL('image/png'),
      W: cv.width, H: cv.height,
      probe: window.__artlook || null,             // 정확한 조각·작품 사각형 (계측 훅)
      srcWH: wh, framedWH: [framed.width, framed.height],
      frameKind: FRAMES[fi].kind,
    };
  }, c);
  if (r.err || !r.probe) { console.log(`✗ ${c.id} ${r.err || '계측 훅 없음'}`); continue; }
  writeFileSync(`${OUT}/${c.id}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
  const box = (b) => [Math.round(b.x), Math.round(b.y),
    Math.round(b.x + b.w) - 1, Math.round(b.y + b.h) - 1];
  const rect = box(r.probe.piece), art = box(r.probe.art);
  out[c.id] = {
    ...c, rect, art, front: r.probe.front ? box(r.probe.front) : rect,
    railPx: Math.round(r.probe.railPx), matPx: Math.round(r.probe.matPx),
    canvas: [r.W, r.H], srcWH: r.srcWH, framedWH: r.framedWH, frameKind: r.frameKind,
    srcAspect: r.srcWH[0] / r.srcWH[1], framedAspect: r.framedWH[0] / r.framedWH[1],
  };
  console.log(`✓ ${c.id} ${c.frame} @${c.scene}  piece=[${rect}] art=[${art}] rail=${Math.round(r.probe.railPx)}px`);
}
writeFileSync(`${OUT}/geometry.json`, JSON.stringify(out, null, 1));
console.log('\n에러:', errs.length ? [...new Set(errs)].slice(0, 5) : '없음');
await b.close();
