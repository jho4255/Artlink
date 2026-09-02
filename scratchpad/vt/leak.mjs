// 벽 무늬가 작품에 비치는가 — **단색 작품**을 걸어 본다.
// 작품이 완전 균일하면 작품 영역에 남는 고주파는 전부 '벽에서 새어 들어온 것'이다.
// (그레인 ±1.5레벨은 정상. 그 이상이면 벽돌·돌 줄눈이 찍힌 것)
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const { chromium } = pw;
const OUT = '/home/jho4255/ArtLink/scratchpad/vt/leak';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:5173/artlook/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(3800);

const SCENES_UNDER_TEST = ['white-brick', 'stone', 'grey-brick', 'travertine',
  'concrete', 'cream-stone', 'taupe-plaster', 'gallery-salon',
  // 2026-09-03 추가 6종. **walnut-panel 이 이 검사의 핵심**이다 — 세로 슬랫이
  // 폭 200px 짜리 주기 무늬라 벽 명암 밉맵(≈11텍셀)을 그냥 통과한다. 규칙 40 의
  // '그림이 투명해져서 벽문양이 비친다'가 재현될 수 있는 유일한 새 자산이다.
  'charcoal', 'olive', 'walnut-panel', 'terracotta', 'blue-grey', 'white-plaster'];

const shots = await p.evaluate(async (ids) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // 완전 균일한 회색 작품 — 여기 무늬가 생기면 100% 벽에서 온 것이다
  const flat = document.createElement('canvas');
  flat.width = 900; flat.height = 1200;
  const fx = flat.getContext('2d');
  fx.fillStyle = 'rgb(128,128,128)';
  fx.fillRect(0, 0, 900, 1200);
  state.img = flat;
  state.frameIdx = FRAMES.findIndex((f) => f.name === '캔버스 랩');  // 액자 없이 작품만
  state.matWidth = 0; selectedWork = null;
  const out = [];
  for (const id of ids) {
    const i = SCENES.findIndex((s) => s.id === id);
    if (i < 0) continue;
    state.sceneIdx = i;
    render(); await wait(600);
    out.push({ id, png: document.getElementById('preview').toDataURL('image/png'),
      probe: window.__artlook, wallAmt: SCENES[i].wallAmt, wallLod: SCENES[i].wallLod,
      srcWH: [SCENES[i].img.naturalWidth, SCENES[i].img.naturalHeight] });
  }
  return out;
}, SCENES_UNDER_TEST);

const meta = {};
for (const s of shots) {
  writeFileSync(`${OUT}/${s.id}.png`, Buffer.from(s.png.split(',')[1], 'base64'));
  meta[s.id] = { probe: s.probe, wallAmt: s.wallAmt, wallLod: s.wallLod, srcWH: s.srcWH };
}
writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 1));
console.log(`${shots.length}장.  에러:`, errs.length ? errs.slice(0, 3) : '없음');
await b.close();
