// 전수 훑기 — 액자 18종 × 매트 3단계, 그리고 장면 17개. 10케이스 스위트가 못 보는
// 조합에서 깨지는 게 없는지 확인한다(회귀 방지).
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const { chromium } = pw;
const HERE = '/home/jho4255/ArtLink/scratchpad/vt';
const MODE = process.argv[2] || 'frames';
mkdirSync(`${HERE}/sweep`, { recursive: true });

const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
await p.goto('http://localhost:5173/artlook/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(3800);
await p.evaluate(() => {
  window.__vtLoad = (f) => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => { state.img = capToCanvas(im); res(); };
    im.onerror = rej; im.src = '/demo-art/' + f;
  });
});

const shots = await p.evaluate(async (mode) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await window.__vtLoad('water-memory.jpg');
  selectedWork = null;
  const out = [];
  if (mode === 'frames') {
    state.sceneIdx = SCENES.findIndex((s) => s.id === 'white-brick');
    for (let i = 0; i < FRAMES.length; i++) {
      for (const mat of [0, 0.08]) {
        state.frameIdx = i; state.matWidth = mat;
        render(); await wait(420);
        out.push({ name: `${i}_${FRAMES[i].name}_m${mat}`,
          png: document.getElementById('preview').toDataURL('image/jpeg', .9),
          probe: window.__artlook });
      }
    }
  } else {
    state.frameIdx = 0; state.matWidth = 0;
    for (let i = 0; i < SCENES.length; i++) {
      state.sceneIdx = i; render(); await wait(420);
      out.push({ name: `${i}_${SCENES[i].id}`,
        png: document.getElementById('preview').toDataURL('image/jpeg', .9),
        probe: window.__artlook });
    }
  }
  return out;
}, MODE);

const meta = {};
for (const s of shots) {
  writeFileSync(`${HERE}/sweep/${MODE}_${s.name.replace(/[^\w.\-가-힣]/g, '_')}.jpg`,
    Buffer.from(s.png.split(',')[1], 'base64'));
  meta[s.name] = s.probe;
}
writeFileSync(`${HERE}/sweep/${MODE}_meta.json`, JSON.stringify(meta, null, 1));
console.log(`${shots.length}장 저장 (${MODE}).  에러:`, errs.length ? [...new Set(errs)].slice(0, 5) : '없음');
await b.close();
