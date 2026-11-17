// 커뮤니티 데모 글에 쓸 사진 — 데모 그림(절차적 생성, frontend/public/demo-art)을 우리 ArtLook 엔진으로 벽에 걸어 뽑는다(워터마크 없음).
//   node scratchpad/community-editor/demo-media.mjs   (로컬 vite 5173 이 떠 있어야 한다)
// 결과는 scratchpad/community-editor/media/ (git 제외) — seed-community-demo.ts 가 이 폴더와 demo-art 를 올린다.
// ⚠️ 실제 가입자 작품(backend/uploads, R2)은 쓰지 않는다.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const OUT = '/home/jho4255/ArtLink/scratchpad/community-editor/media';
mkdirSync(OUT, { recursive: true });
const CASES = [
  // 전시 전경 — 공간 장면
  { id: 'show-salon', work: 'red-hill.jpg', frame: '화이트', scene: 'gallery-salon', mat: 0.1, ratio: '16:9' },
  { id: 'show-cube', work: 'blue-wall.jpg', frame: '블랙 슬림', scene: 'white-cube', mat: 0.1, ratio: '4:5' },
  { id: 'show-boutique', work: 'long-summer.jpg', frame: '오크', scene: 'boutique', mat: 0.05, ratio: '16:9' },
  { id: 'show-living', work: 'square-garden.jpg', frame: '화이트', scene: 'gallery-living', mat: 0.05, ratio: '1:1' },
  { id: 'show-collector', work: 'winter-garden.jpg', frame: '월넛', scene: 'collector-home', mat: 0.1, ratio: '4:5' },
  // 벽에 건 모습 — 벽 장면
  { id: 'wall-plaster', work: 'quiet-afternoon.jpg', frame: '오크', scene: 'white-plaster', mat: 0.1, ratio: '4:5' },
  { id: 'wall-charcoal', work: 'dawn-window.jpg', frame: '블랙 슬림', scene: 'charcoal', mat: 0.1, ratio: '3:4' },
  { id: 'wall-brick', work: 'city-walk.jpg', frame: '월넛', scene: 'red-brick', mat: 0.05, ratio: '1:1' },
  { id: 'wall-leaf', work: 'water-memory.jpg', frame: '화이트', scene: 'leaf-shadow', mat: 0.1, ratio: '4:5' },
  { id: 'wall-olive', work: 'small-room.jpg', frame: '오크', scene: 'olive', mat: 0.1, ratio: '3:4' },
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
for (const c of CASES) {
  const png = await p.evaluate(async (cc) => {
    await window.__load(cc.work);
    state.frameIdx = FRAMES.findIndex((f) => f.name === cc.frame);
    state.sceneIdx = SCENES.findIndex((s) => s.id === cc.scene);
    state.matWidth = cc.mat;
    state.ratio = cc.ratio;
    state.watermark = false;
    selectedWork = null;
    render(); await new Promise((r) => setTimeout(r, 1500));
    return document.getElementById('preview').toDataURL('image/png');
  }, c);
  const pngPath = `${OUT}/${c.id}.png`;
  writeFileSync(pngPath, Buffer.from(png.split(',')[1], 'base64'));
  execFileSync('python3', ['-c', `from PIL import Image; im=Image.open('${pngPath}').convert('RGB'); im.save('${OUT}/${c.id}.jpg', quality=88); print(im.size)`], { stdio: 'inherit' });
  execFileSync('rm', [pngPath]);
  console.log('✓', c.id, c.frame, c.scene, c.ratio);
}
await b.close();
// 부분 확대 — 작업 일지의 '붓 자국' 사진. 원본 그림의 한 부분을 잘라 키운다(3:2)
execFileSync('python3', ['-c', `
from PIL import Image
for name, box in [('quiet-afternoon.jpg', (380, 260, 860, 580)), ('water-memory.jpg', (200, 420, 680, 740)), ('red-hill.jpg', (520, 300, 1000, 620))]:
    im = Image.open('/home/jho4255/ArtLink/frontend/public/demo-art/' + name).convert('RGB').crop(box).resize((1200, 800), Image.LANCZOS)
    im.save('${OUT}/detail-' + name, quality=88)
print('detail ok')
`], { stdio: 'inherit' });
console.log('→', OUT);
