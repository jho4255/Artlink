// 실치수 모드에서 **작은 작품이 얼마나 작아지는가**.
// 신고(2026-08-31): "마은영 작가 첫 작품 · 오크 · 갤러리 살롱 → 보이지도 않는다".
//
// 실치수는 정직하지만, 홍보 이미지에서 작품이 안 보이면 쓸모가 없다. 어디서부터
// 못 쓰게 되는지 **재고** 바닥값을 정한다.
//
//   node minsize.mjs
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';

const SIZES = [
  ['미니 (12×12)', '12 × 12 cm'],
  ['4호 (24×33)', '24 × 33 cm'],
  ['6호 (31×41)', '31 × 41 cm'],
  ['10호 (45×53)', '45 × 53 cm'],
  ['20호 (60×72)', '60 × 72 cm'],
  ['30호 (73×91)', '73 × 91 cm'],
  ['50호 (91×116)', '91 × 116 cm'],
  ['100호 (130×162)', '130 × 162 cm'],
  ['(치수 없음)', ''],
];
const SCENE_IDS = ['gallery-salon', 'collector-salon', 'hotel-lounge', 'white-brick', 'beige-plaster'];

const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:5173/artlook/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(3800);

const rows = await p.evaluate(async ({ SIZES, SCENE_IDS }) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => { state.img = capToCanvas(im); res(); };
    im.onerror = rej;
    im.src = '/demo-art/water-memory.jpg';
  });
  state.frameIdx = FRAMES.findIndex((f) => f.name === '오크');
  state.matWidth = 0;
  const out = [];
  for (const sid of SCENE_IDS) {
    const si = SCENES.findIndex((s) => s.id === sid);
    if (si < 0) continue;
    state.sceneIdx = si;
    for (const [label, sizeText] of SIZES) {
      selectedWork = sizeText ? { sizeText } : null;
      render(); await wait(260);
      const pr = window.__artlook;
      const cv = document.getElementById('preview');
      if (!pr) { out.push({ sid, label, err: 1 }); continue; }
      out.push({
        sid, label,
        areaPct: +(pr.piece.w * pr.piece.h / (cv.width * cv.height) * 100).toFixed(2),
        longPct: +(Math.max(pr.piece.w, pr.piece.h) / Math.max(cv.width, cv.height) * 100).toFixed(1),
        shortPx: Math.round(Math.min(pr.piece.w, pr.piece.h)),
        canvas: `${cv.width}×${cv.height}`,
        zoom: +(lastFitNote && lastFitNote.zoom ? lastFitNote.zoom : 1).toFixed(2),
      });
    }
  }
  return out;
}, { SIZES, SCENE_IDS });

let cur = null;
for (const r of rows) {
  if (r.sid !== cur) { cur = r.sid; console.log(`\n── ${cur} ──   (조각이 화면에서 차지하는 면적 %, 목표 44%)`); }
  if (r.err) { console.log(`   ${r.label.padEnd(16)} 렌더 실패`); continue; }
  const bar = '█'.repeat(Math.max(0, Math.round(r.areaPct / 2)));
  const flag = r.areaPct < 6 ? '  ← 사실상 안 보인다' : r.areaPct < 12 ? '  ← 작다' : '';
  console.log(`   ${r.label.padEnd(16)} ${String(r.areaPct).padStart(6)}%  긴변 ${String(r.longPct).padStart(5)}%  짧은변 ${String(r.shortPx).padStart(4)}px  `
    + `zoom ${r.zoom}  ${r.canvas}  ${bar}${flag}`);
}
console.log('\n에러:', errs.length ? [...new Set(errs)].slice(0, 4) : '없음');
await b.close();
