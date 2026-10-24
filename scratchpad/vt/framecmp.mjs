// 액자 전부를 같은 작품·같은 벽·같은 매트·저장 화질(합성 배율 2)로 그려 나란히 비교한다(2026-10-24 — 사진 액자 '오크'가 오크 플로터보다 납작하다는 지적).
//   node scratchpad/vt/framecmp.mjs [out폴더이름] [장면id=charcoal] [매트=0.10]
//   결과: scratchpad/vt/framecmp/<이름>/<i>_<id>.png + meta.json(조각·작품 사각형). 시트는 framecmp.py.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const HERE = '/home/jho4255/ArtLink/scratchpad/vt';
const NAME = process.argv[2] || 'now';
const SCENE = process.argv[3] || 'charcoal';
const MAT = Number(process.argv[4] ?? 0.10);
const ART = process.env.ART || 'water-memory.jpg';
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const Q = process.env.Q ? '&' + process.env.Q : '';   // 엔진 쿼리(예: Q=recess=0)
const OUT = `${HERE}/framecmp/${NAME}`;
mkdirSync(OUT, { recursive: true });
const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:5173/artlook/index.html?preload=all' + Q, { waitUntil: 'networkidle' });
await p.waitForTimeout(3500);
const meta = {};
const ids = await p.evaluate(() => FRAMES.map((f) => f.id));
for (const [i, id] of ids.entries()) {
  if (ONLY.length && !ONLY.includes(id)) continue;
  const r = await p.evaluate(async ({ i, SCENE, MAT, ART }) => {
    if (!window.__vtArt) {
      window.__vtArt = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(capToCanvas(im)); im.onerror = rej; im.src = '/demo-art/' + ART; });
    }
    Object.assign(state, { img: window.__vtArt, mode: 'scene', sceneIdx: SCENES.findIndex((s) => s.id === SCENE), frameIdx: i,
      matWidth: MAT, matteColor: '#f5f2ea', light: 0, glass: false, weave: false, ratio: '4:5', draft: false, watermark: false });
    selectedWork = null;
    const sc = SCENES[state.sceneIdx]; if (sc) sc.adj = { dx: 0, dy: 0, s: 1 };
    const out = compose();
    return { png: out.toDataURL('image/png').split(',')[1], probe: window.__artlook, name: FRAMES[i].name, kind: FRAMES[i].kind };
  }, { i, SCENE, MAT, ART });
  const file = `${String(i).padStart(2, '0')}_${id}.png`;
  writeFileSync(`${OUT}/${file}`, Buffer.from(r.png, 'base64'));
  meta[id] = { file, name: r.name, kind: r.kind, probe: r.probe };
}
writeFileSync(`${OUT}/meta.json`, JSON.stringify({ scene: SCENE, mat: MAT, art: ART, q: Q, frames: meta }, null, 1));
console.log(`${Object.keys(meta).length}장 → ${OUT}  에러:`, errs.length ? errs.slice(0, 3) : '없음');
await b.close();
