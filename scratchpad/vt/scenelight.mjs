// 브리핑 "SCENE-LIGHTING SAFETY / CONFIDENCE-AWARE RENDERING" 을 재는 하니스 (8차)
//
//   "If scene-light estimation is uncertain: apply LESS synthetic lighting, not more."
//   "UNCERTAINTY ↑ → SYNTHETIC EFFECT STRENGTH ↓"
//
// scenes.json 의 `lightDir` 은 **손으로 적혔거나 한 번 측정된 값**이고 신뢰도가 없다.
// 실제로 6개 장면은 아직 `[-1,-1]`(측정 안 함, 좌상단 가정)이다.
// 여기서는 각 장면의 **작품이 걸릴 영역 주변 벽**을 격자로 재서
//   · 밝기(wallLum)   — 그림자 알파를 정하는 데 필요하다. 어두운 벽에 같은 알파를 걸면
//                       보이는 낙차가 절반이 된다(=적응형 강도).
//   · 기울기(grad)    — 이게 곧 '방향광이 실제로 있는가'의 증거다.
//   · 기울기 방향     — scenes.json 의 lightDir 과 **맞는가**.
// 를 뽑는다.
//
//   node scenelight.mjs
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { writeFileSync } from 'node:fs';

const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
await p.goto('http://localhost:5173/artlook/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(3800);

const rows = await p.evaluate(async () => {
  const out = [];
  for (const sc of SCENES) {
    if (!sc.loaded) continue;
    const q = sc.region || sc.opening;
    if (!q) continue;
    const iw = sc.img.naturalWidth, ih = sc.img.naturalHeight;
    // 영역을 조금 넓혀 그 주변 벽까지 — 작품이 덮을 자리 밖의 빛을 봐야 한다
    const xs = q.map((pt) => pt[0]), ys = q.map((pt) => pt[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const ex = (x1 - x0) * 0.35, ey = (y1 - y0) * 0.35;
    const rx0 = Math.max(0, x0 - ex), rx1 = Math.min(1, x1 + ex);
    const ry0 = Math.max(0, y0 - ey), ry1 = Math.min(1, y1 + ey);
    // 7×7 격자로 평균 밝기 — 벽 무늬가 아니라 **넓은 조명 낙차**를 본다
    const N = 7;
    const c = document.createElement('canvas'); c.width = N; c.height = N;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(sc.img, rx0 * iw, ry0 * ih, (rx1 - rx0) * iw, (ry1 - ry0) * ih, 0, 0, N, N);
    const d = cx.getImageData(0, 0, N, N).data;
    const L = [];
    for (let i = 0; i < N * N; i++) L.push((d[i * 4] * 0.2126 + d[i * 4 + 1] * 0.7152 + d[i * 4 + 2] * 0.0722) / 255);
    const at = (x, y) => L[y * N + x];
    let gx = 0, gy = 0, mean = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) mean += at(x, y);
    mean /= N * N;
    // 최소제곱 평면 기울기 (중심화 좌표)
    let sxx = 0, syy = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = (x - (N - 1) / 2), v = (y - (N - 1) / 2);
      gx += u * at(x, y); gy += v * at(x, y); sxx += u * u; syy += v * v;
    }
    gx /= sxx; gy /= syy;                       // 격자 한 칸당 밝기 변화
    const gmag = Math.hypot(gx, gy) * (N - 1);  // 영역 전체에 걸친 낙차(0~1 밝기 단위)
    // 측정된 광원 방향 — 밝은 쪽이 광원 쪽이다(빛이 '오는' 방향 = 기울기 반대)
    const measured = gmag > 1e-6 ? [-gx / Math.hypot(gx, gy), -gy / Math.hypot(gx, gy)] : null;
    const ld = sc.lightDir || [-1, -1];
    const n = Math.hypot(ld[0], ld[1]) || 1;
    const ldn = [ld[0] / n, ld[1] / n];
    const cos = measured ? measured[0] * ldn[0] + measured[1] * ldn[1] : null;
    out.push({
      id: sc.id, wallLum: +(mean * 255).toFixed(1), grad: +(gmag * 255).toFixed(1),
      gx: +(gx * 255 * (N - 1)).toFixed(1), gy: +(gy * 255 * (N - 1)).toFixed(1),
      ld: ldn.map((v) => +v.toFixed(2)),
      measured: measured ? measured.map((v) => +v.toFixed(2)) : null,
      cos: cos == null ? null : +cos.toFixed(2),
      hand: Math.abs(Math.abs(ld[0]) - 1) < 1e-9 && Math.abs(Math.abs(ld[1]) - 1) < 1e-9,
    });
  }
  return out;
});
await b.close();

console.log('장면별 벽 밝기 · 조명 낙차 · 기록된 광원과의 일치도\n');
console.log(`${'장면'.padEnd(17)} ${'벽밝기'.padStart(7)} ${'낙차'.padStart(6)} ${'가로'.padStart(7)} ${'세로'.padStart(7)}  ${'기록ld'.padEnd(15)} ${'측정ld'.padEnd(15)} ${'cos'.padStart(6)}  판정`);
console.log('-'.repeat(104));
for (const r of rows) {
  const weak = r.grad < 6;
  const bad = r.cos != null && r.cos < 0.2 && !weak;
  const flag = weak ? '낙차 약함 → 방향 신뢰 못함'
    : bad ? '⚠ 기록된 방향이 사진과 어긋난다' : '';
  console.log(`${r.id.padEnd(17)} ${String(r.wallLum).padStart(7)} ${String(r.grad).padStart(6)} `
    + `${String(r.gx).padStart(7)} ${String(r.gy).padStart(7)}  ${JSON.stringify(r.ld).padEnd(15)} `
    + `${JSON.stringify(r.measured).padEnd(15)} ${String(r.cos).padStart(6)}  ${flag}${r.hand ? '  (손으로 적은 값)' : ''}`);
}
const lums = rows.map((r) => r.wallLum);
console.log('-'.repeat(104));
console.log(`벽 밝기 범위 ${Math.min(...lums)} ~ ${Math.max(...lums)}  (배율 ${(Math.max(...lums) / Math.min(...lums)).toFixed(2)}배)`);
console.log(`  → 같은 그림자 알파를 걸면 보이는 낙차가 그만큼 달라진다(적응형 강도가 필요한 이유)`);
console.log(`낙차 6 미만(방향 신뢰 불가) : ${rows.filter((r) => r.grad < 6).length} / ${rows.length}`);
writeFileSync('reports/scenelight.json', JSON.stringify(rows, null, 1));
