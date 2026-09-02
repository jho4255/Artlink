// 브리핑 TEST MATRIX — 한 번의 실험이 **한 케이스만 좋게 만드는 것**을 막는다.
//
//   밝은 나무 / 어두운 나무 / 흰 액자 / 실버 플로터  ×  매트 있음·없음
//   정면 평면 벽 / 실내(원근) / 밝은 방 / 따뜻한 방
//
// 실버 플로터 무매트는 **레퍼런스**다(브리핑: "currently a useful successful reference").
// 그 케이스가 나빠지면 어떤 지표가 좋아져도 실패다.
//
//   node matrix.mjs [outdir]
//   SYN=0 SYNDIR=0 node matrix.mjs matrix_off      # 합성만 끈 기준 렌더 (차등 측정용)
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const HERE = '/home/jho4255/ArtLink/scratchpad/vt';
const OUT = process.argv[2] || `${HERE}/matrix`;
mkdirSync(OUT, { recursive: true });

// 작품은 두 종류만 — 밝은 것 하나, 어두운 것 하나. 매트 없음의 위험(밝은 립이 작품에
// 직접 닿는다)은 **어두운 작품**에서 가장 크게 드러난다.
const M = [
  // id                  frame          mat    scene            work
  ['m01_oak_mat',        '오크',        0.05, 'white-brick',   'water-memory.jpg'],
  ['m02_oak_nomat',      '오크',        0,    'white-brick',   'water-memory.jpg'],
  ['m03_walnut_mat',     '월넛',        0.05, 'white-brick',   'water-memory.jpg'],
  ['m04_walnut_nomat',   '월넛',        0,    'white-brick',   'water-memory.jpg'],
  ['m05_white_mat',      '화이트',      0.05, 'white-brick',   'water-memory.jpg'],
  ['m06_white_nomat',    '화이트',      0,    'white-brick',   'water-memory.jpg'],
  ['m07_silverfl_nomat', '실버 플로터', 0,    'white-brick',   'water-memory.jpg'],  // ★ 레퍼런스
  ['m08_black_nomat',    '블랙',        0,    'white-brick',   'dawn-window.jpg'],   // 어두운 작품
  ['m09_gold_nomat',     '골드',        0,    'white-brick',   'water-memory.jpg'],
  ['m10_slim_nomat',     '오크 슬림',   0,    'white-brick',   'water-memory.jpg'],  // 갭 없는 평면
  ['m11_oak_interior',   '오크',        0,    'gallery-salon', 'water-memory.jpg'],  // 실내
  ['m12_walnut_bright',  '월넛',        0,    'white-cube',    'water-memory.jpg'],  // 밝은 방
  ['m13_oak_warm',       '오크',        0,    'collector-salon', 'water-memory.jpg'],// 따뜻한 방
  ['m14_canvas',         '캔버스 랩',   0,    'white-brick',   'water-memory.jpg'],
  ['m15_silverfl_mat',   '실버 플로터', 0.05, 'white-brick',   'water-memory.jpg'],
  ['m16_black_mat',      '블랙',        0.05, 'white-brick',   'dawn-window.jpg'],
  // 2026-09-01 추가 자산 — 얇은 사진 액자 3종 + 실내 장면 1
  ['m17_oakthin_nomat',  '얇은 오크',   0,    'white-brick',   'water-memory.jpg'],
  ['m18_walthin_nomat',  '얇은 월넛',   0,    'white-brick',   'water-memory.jpg'],
  ['m19_silthin_nomat',  '얇은 실버',   0,    'white-brick',   'water-memory.jpg'],
  ['m20_oakthin_mat',    '얇은 오크',   0.05, 'white-brick',   'water-memory.jpg'],
  // 2026-09-03 추가 벽 6종. 여기 오기 전에는 벽이 전부 밝고(157~231) 중성색이라
  // **어두운 벽·색 있는 벽에서 액자가 어떻게 보이는지 한 번도 재 본 적이 없었다.**
  ['m21_charcoal',       '오크',        0,    'charcoal',      'water-memory.jpg'],
  ['m22_walnutpanel',    '얇은 실버',   0,    'walnut-panel',  'water-memory.jpg'],
  ['m23_terracotta',     '블랙',        0.05, 'terracotta',    'dawn-window.jpg'],
  ['m24_whiteplaster',   '얇은 오크',   0,    'white-plaster', 'water-memory.jpg'],
];

const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
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
for (const [id, frame, mat, scene, work] of M) {
  const r = await p.evaluate(async (c) => {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    await window.__vtLoad(c.work);
    const fi = FRAMES.findIndex((f) => f.name === c.frame);
    const si = SCENES.findIndex((s) => s.id === c.scene);
    if (fi < 0 || si < 0) return { err: `없음 ${c.frame}/${c.scene}` };
    state.frameIdx = fi; state.sceneIdx = si; state.matWidth = c.mat;
    selectedWork = null;
    render(); await wait(900);
    const cv = document.getElementById('preview');
    return { png: cv.toDataURL('image/png'), W: cv.width, H: cv.height,
      probe: window.__artlook || null, kind: FRAMES[fi].kind };
  }, { frame, mat, scene, work });
  if (r.err || !r.probe) { console.log(`✗ ${id}: ${r.err || 'probe 없음'}`); continue; }
  writeFileSync(`${OUT}/${id}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
  const box = (x) => [Math.round(x.x), Math.round(x.y),
    Math.round(x.x + x.w) - 1, Math.round(x.y + x.h) - 1];
  meta[id] = { frame, mat, scene, work, kind: r.kind, W: r.W, H: r.H,
    rect: box(r.probe.piece), art: box(r.probe.art),
    railPx: Math.round(r.probe.railPx), matPx: Math.round(r.probe.matPx) };
  console.log(`✓ ${id}`);
}
writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 1));
console.log(`\n${Object.keys(meta).length}/${M.length}장 → ${OUT}`);
console.log('에러:', errs.length ? [...new Set(errs)].slice(0, 3) : '없음');
await b.close();
