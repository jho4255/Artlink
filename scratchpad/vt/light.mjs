// 조명 슬라이더 전수 — 강도 0/25/50/75/100 × 장면 몇 개, 그리고 액자 전 스타일 × 매트.
// 목적 두 가지:
//   ① 조명이 **작품을 망가뜨리지 않는가** (artpreserve 와 같은 기준)
//   ② 조명이 **마스크 테를 만들지 않는가** (조각 경계 keyline)
// 사용: node light.mjs [strengths|frames]
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const { chromium } = pw;
const HERE = '/home/jho4255/ArtLink/scratchpad/vt';
const MODE = process.argv[2] || 'strengths';
mkdirSync(`${HERE}/light`, { recursive: true });

const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await p.goto('http://localhost:5173/artlook/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(4000);
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
  if (mode === 'strengths') {
    // 밝은 벽 / 어두운 실내 / 창빛 — 조명 반응이 제일 다른 셋
    for (const id of ['white-brick', 'collector-salon', 'gallery-living', 'concrete']) {
      const si = SCENES.findIndex((s) => s.id === id);
      if (si < 0) continue;
      state.sceneIdx = si; state.frameIdx = 0; state.matWidth = 0;
      for (const L of [0, 0.25, 0.5, 0.75, 1.0]) {
        state.light = L; render(); await wait(420);
        out.push({ name: `${id}_L${Math.round(L * 100)}`,
          png: document.getElementById('preview').toDataURL('image/png'),
          probe: window.__artlook, scene: id, light: L,
          ld: SCENES[si].lightDir || [-1, -1] });
      }
    }
  } else {
    state.sceneIdx = SCENES.findIndex((s) => s.id === 'white-brick');
    state.light = 0.6;
    for (let i = 0; i < FRAMES.length; i++) {
      for (const mat of [0, 0.08]) {
        state.frameIdx = i; state.matWidth = mat;
        render(); await wait(420);
        out.push({ name: `${i}_${FRAMES[i].name}_m${mat}`,
          png: document.getElementById('preview').toDataURL('image/jpeg', .92),
          probe: window.__artlook });
      }
    }
  }
  state.light = 0;
  return out;
}, MODE);

const meta = {};
for (const s of shots) {
  const ext = s.png.startsWith('data:image/png') ? 'png' : 'jpg';
  writeFileSync(`${HERE}/light/${MODE}_${s.name.replace(/[^\w.\-가-힣]/g, '_')}.${ext}`,
    Buffer.from(s.png.split(',')[1], 'base64'));
  meta[s.name] = { probe: s.probe, scene: s.scene, light: s.light, ld: s.ld };
}
writeFileSync(`${HERE}/light/${MODE}_meta.json`, JSON.stringify(meta, null, 1));
console.log(`${shots.length}장 저장 (${MODE}).  에러:`, errs.length ? [...new Set(errs)].slice(0, 5) : '없음');
await b.close();
