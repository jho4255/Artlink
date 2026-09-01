// 폴백 사다리(브리핑 AUTOMATIC FALLBACKS) 확인 — `?level=0..3` 이 실제로 단계별로
// 합성을 덜어내는가. 같은 입력으로 네 장을 뽑아 한 시트로 만든다.
//
//   0 원본 자산만 · 1 최소 장면 통합 · 2 기하 기반 · 3 방향광까지(기본)
//
//   node levels.mjs [frame] [scene]
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { writeFileSync } from 'node:fs';

const FRAME = process.argv[2] || '오크';
const SCENE = process.argv[3] || 'white-brick';

const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
for (const L of [0, 1, 2, 3]) {
  const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://localhost:5173/artlook/index.html?level=${L}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(3600);
  const r = await p.evaluate(async ({ FRAME, SCENE }) => {
    await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => { state.img = capToCanvas(im); res(); };
      im.onerror = rej;
      im.src = '/demo-art/water-memory.jpg';
    });
    state.frameIdx = FRAMES.findIndex((f) => f.name === FRAME);
    state.sceneIdx = SCENES.findIndex((s) => s.id === SCENE);
    state.matWidth = 0.05;
    selectedWork = null;
    render();
    await new Promise((res) => setTimeout(res, 800));
    return { png: document.getElementById('preview').toDataURL('image/png'),
      lvl: LEVEL, syn: SYN_EDGE, dir: SYN_DIR };
  }, { FRAME, SCENE });
  writeFileSync(`level${L}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
  console.log(`level=${L}  LEVEL=${r.lvl} syn=${r.syn} syndir=${r.dir}`
    + `   에러 ${errs.length ? errs[0].slice(0, 60) : '없음'}`);
  await p.close();
}
await b.close();
console.log(`\nlevel0..3.png  (${FRAME} @ ${SCENE})`);
