// 실제 크기 단일 모드에서 작품 치수별로 화면을 얼마나 차지하는지 실측.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
const { chromium } = pw;
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:5173/artlook/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(3800);
await p.evaluate(() => { window.__vtLoad = (f) => new Promise((r, j) => {
  const im = new Image(); im.onload = () => { state.img = capToCanvas(im); r(1); }; im.onerror = j;
  im.src = '/demo-art/' + f; }); });
const rows = await p.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await window.__vtLoad('water-memory.jpg');
  state.frameIdx = 0; state.matWidth = 0;
  const out = [];
  for (const sid of ['white-brick', 'gallery-salon']) {
    state.sceneIdx = SCENES.findIndex((s) => s.id === sid);
    for (const [w, h, label] of [[24, 33, '4호'], [45.5, 53, '10호'], [72.7, 90.9, '30호'],
                                 [130.3, 162.1, '100호'], [null, null, '치수 없음']]) {
      selectedWork = w ? { sizeText: `${w} × ${h} cm` } : null;
      render(); await wait(500);
      const a = window.__artlook, cv = document.getElementById('preview');
      out.push({ sid, label, pct: a ? +(a.piece.w * a.piece.h / (cv.width * cv.height) * 100).toFixed(1) : null,
                 hPct: a ? +(a.piece.h / cv.height * 100).toFixed(1) : null });
    }
  }
  return out;
});
console.log(`${'장면'.padEnd(16)} ${'작품'.padEnd(10)} ${'면적%'.padStart(7)} ${'높이%'.padStart(7)}`);
for (const r of rows) console.log(`${r.sid.padEnd(16)} ${r.label.padEnd(10)} ${String(r.pct).padStart(7)} ${String(r.hPct).padStart(7)}`);
console.log('에러:', errs.length ? [...new Set(errs)].slice(0, 4) : '없음');
await b.close();
