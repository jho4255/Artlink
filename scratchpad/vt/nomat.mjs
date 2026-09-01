// 브리핑 "NO-MAT SAFETY SYSTEM" — 매트 없음이 **매트 흉내를 내지 않는가**.
//
//   "no white band · no cream band · no artificial border · no fake mat shadow ·
//    no graphic inner ring. 비어 보인다고 매트 같은 테두리를 곧바로 넣지 말 것 —
//    rabbet depth · frame thickness · artwork inset · inner occlusion 을 먼저 보라."
//
// 왜 위험한가: 매트가 있으면 액자 사진의 **밝은 안쪽 립**(원본 실측: 검정·월넛이 살 대비
// 2.4배, 골드·오크 1.06~1.07배)이 **밝은 매트 옆**이라 보이지 않는다. 매트를 빼면 그게
// **작품에 직접** 닿아 [액자 → 흰 테두리 → 작품] 이 된다 — 사용자가 실패라고 한 그것이다.
//
// 액자 18종 × 매트(없음/좁게)를 PNG 로 뽑는다. JPEG 는 1~2px 임펄스를 뭉갠다.
//
//   node nomat.mjs
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = '/home/jho4255/ArtLink/scratchpad/vt/' + (process.env.NOMAT_OUT || 'nomat');
mkdirSync(OUT, { recursive: true });
const MATS = [0, 0.05];
const SCENE = process.argv[2] || 'white-brick';   // 밝은 벽 = 밝은 링이 가장 잘 보인다
const WORK = process.argv[3] || 'water-memory.jpg';

const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
// 합성 음영을 끈 기준 렌더도 뽑을 수 있어야 한다 — 임펄스가 **우리 것인지 사진 것인지**
// 가르는 유일한 방법이다(7차 syncheck 와 같은 논리).
const qs = [process.env.SYN != null ? `syn=${process.env.SYN}` : '',
  process.env.SYNDIR != null ? `syndir=${process.env.SYNDIR}` : ''].filter(Boolean).join('&');
await p.goto('http://localhost:5173/artlook/index.html' + (qs ? '?' + qs : ''), { waitUntil: 'networkidle' });
await p.waitForTimeout(3800);
await p.evaluate(() => {
  window.__vtLoad = (f) => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => { state.img = capToCanvas(im); res(); };
    im.onerror = rej;
    im.src = '/demo-art/' + f;
  });
});

const meta = {};
const n = await p.evaluate(() => FRAMES.length);
for (let fi = 0; fi < n; fi++) {
  for (const m of MATS) {
    const r = await p.evaluate(async ({ fi, m, SCENE, WORK }) => {
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      await window.__vtLoad(WORK);
      state.frameIdx = fi;
      state.sceneIdx = SCENES.findIndex((s) => s.id === SCENE);
      state.matWidth = m;
      selectedWork = null;
      render();
      await wait(820);
      const cv = document.getElementById('preview');
      return { png: cv.toDataURL('image/png'), probe: window.__artlook || null,
        name: FRAMES[fi].name, kind: FRAMES[fi].kind };
    }, { fi, m, SCENE, WORK });
    if (!r.probe) { console.log(`✗ ${r.name} m${m}`); continue; }
    const id = `${fi}_m${m}`;
    writeFileSync(`${OUT}/${id}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
    const box = (x) => [Math.round(x.x), Math.round(x.y),
      Math.round(x.x + x.w) - 1, Math.round(x.y + x.h) - 1];
    meta[id] = { name: r.name, kind: r.kind, mat: m,
      rect: box(r.probe.piece), art: box(r.probe.art),
      railPx: Math.round(r.probe.railPx), matPx: Math.round(r.probe.matPx) };
  }
}
writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 1));
console.log(`${Object.keys(meta).length}장 (${SCENE}).  에러:`, errs.length ? [...new Set(errs)].slice(0, 3) : '없음');
await b.close();
