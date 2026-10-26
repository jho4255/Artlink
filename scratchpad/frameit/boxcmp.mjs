// 박스·몰딩·플로터 액자를 같은 작품·같은 벽에 걸어 비교한다 (2026-10-26). 5173(개발 서버)이 떠 있어야 한다.
//   node scratchpad/frameit/boxcmp.mjs [scene=white-plaster] [mat=0.05] [ids=oak,floater-oak,box-oak,…]
// 결과: scratchpad/frameit/out/<scene>_<mat>_<id>.png
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import fs from 'node:fs';
const OUT = '/home/jho4255/ArtLink/scratchpad/frameit/out/';
const scene = process.argv[2] || 'white-plaster';
const mat = Number(process.argv[3] ?? 0.05);
const ids = (process.argv[4] || 'oak,floater-oak,box-oak,walnut,box-walnut,floater-black,box-black,box-white,box-ivory').split(',');
const ART = process.env.ART || '/demo-art/quiet-afternoon.jpg';
const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1000, height: 800 } });
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto('http://localhost:5173/artlook/index.html?preload=all', { waitUntil: 'networkidle' });
await p.waitForTimeout(4000);
for (const fid of ids) {
  const png = await p.evaluate(async ({ scene, fid, mat, ART }) => {
    if (!window.__vtArt) window.__vtArt = await new Promise((res) => { const im = new Image(); im.onload = () => res(capToCanvas(im)); im.src = ART; });
    Object.assign(state, { img: window.__vtArt, mode: 'scene', sceneIdx: SCENES.findIndex((s) => s.id === scene), frameIdx: FRAMES.findIndex((f) => f.id === fid),
      matWidth: mat, matteColor: '#f5f2ea', light: 0, glass: false, weave: false, ratio: '4:5', draft: false, watermark: false });
    selectedWork = null; const sc = SCENES[state.sceneIdx]; sc.adj = { dx: 0, dy: 0, s: 1 };
    const c = compose(); window.__glLost = ArtLookScene.glLost && ArtLookScene.glLost();
    return c.toDataURL('image/png').split(',')[1];
  }, { scene, fid, mat, ART });
  fs.writeFileSync(`${OUT}${scene}_${mat}_${fid}.png`, Buffer.from(png, 'base64'));
  if (await p.evaluate(() => window.__glLost)) console.log('⚠️ WebGL 을 잃었다 —', fid);
}
await b.close();
console.log('done', ids.length);
