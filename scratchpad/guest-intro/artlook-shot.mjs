// 비회원 소개 팝업의 ArtLook 칸 그림 — 데모 그림(절차적 생성, frontend/public/demo-art)을 실제 ArtLook 엔진으로 걸어 뽑는다.
//   node scratchpad/guest-intro/artlook-shot.mjs   (로컬 vite 5173 이 떠 있어야 한다)
// 후보 여러 장을 out/ 에 뽑고, 고른 것을 make-assets.py 가 frontend/public/intro/ 로 줄여 넣는다.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { writeFileSync } from 'node:fs';
const OUT = '/home/jho4255/ArtLink/scratchpad/guest-intro/out';
const CASES = [
  { id: 'a', work: 'quiet-afternoon.jpg', frame: '오크', scene: 'white-plaster', mat: 0.1 },
  { id: 'b', work: 'dawn-window.jpg', frame: '블랙 슬림', scene: 'beige-plaster', mat: 0.1 },
  { id: 'c', work: 'square-garden.jpg', frame: '화이트', scene: 'gallery-living', mat: 0.05 },
  { id: 'd', work: 'long-summer.jpg', frame: '오크', scene: 'collector-home', mat: 0.05 },
  { id: 'e', work: 'red-hill.jpg', frame: '월넛', scene: 'taupe-plaster', mat: 0.1 },
  // 갤러리 탭 — 전시 공간 장면
  { id: 'g1', work: 'blue-wall.jpg', frame: '블랙 슬림', scene: 'white-cube', mat: 0.1 },
  { id: 'g2', work: 'red-hill.jpg', frame: '화이트', scene: 'gallery-salon', mat: 0.1 },
  { id: 'g3', work: 'long-summer.jpg', frame: '오크', scene: 'boutique', mat: 0.05 },
];
const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
await p.goto('http://localhost:5173/artlook/index.html?preload=all', { waitUntil: 'networkidle' });
await p.waitForTimeout(3800);
await p.evaluate(() => {
  window.__load = (file) => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => { state.img = capToCanvas(im); res(); };
    im.onerror = rej;
    im.src = '/demo-art/' + file;
  });
});
for (const c of CASES.filter((x) => !process.env.ONLY || process.env.ONLY.split(',').includes(x.id))) {
  const png = await p.evaluate(async (cc) => {
    await window.__load(cc.work);
    state.frameIdx = FRAMES.findIndex((f) => f.name === cc.frame);
    state.sceneIdx = SCENES.findIndex((s) => s.id === cc.scene);
    state.matWidth = cc.mat;
    state.ratio = cc.ratio || '1:1';
    selectedWork = null;
    render(); await new Promise((r) => setTimeout(r, 1200));
    return document.getElementById('preview').toDataURL('image/png');
  }, c);
  writeFileSync(`${OUT}/artlook-${c.id}.png`, Buffer.from(png.split(',')[1], 'base64'));
  console.log('✓', c.id, c.frame, c.scene);
}
await b.close();
