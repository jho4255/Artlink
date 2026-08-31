// 브리핑 5번 — **공통 장면 조명**: 액자만 바뀌었을 뿐 같은 방·같은 카메라여야 한다.
//
// 장면 합성까지 가지 않고 **액자 판(buildFramedCore)만** 두 광원으로 만들어 비교한다.
// 그래야 벽·워프·비네트가 섞이지 않아 "액자 자신이 광원에 반응하는가"만 남는다.
//
//   좌상단 광 [-1,-1] 과 우상단 광 [+1,-1] 은 서로 **좌우 거울**이다.
//   즉 왼살↔오른살 밝기차는 부호가 정확히 뒤집혀야 한다.
//     sym = |d_left + d_right| / (|d_left| + |d_right|)
//       0.0 = 완전한 반대칭(=광원을 제대로 따른다)   1.0 = 광원을 무시한다
//
// 작품 영역도 함께 잰다 — 액자 종류에 따라 **작품 밝기가 달라지면** 같은 방이 아니다.
//
//   node framelight.mjs
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { writeFileSync } from 'node:fs';

const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:5173/artlook/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(3800);

const rows = await p.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => { state.img = capToCanvas(im); res(); };
    im.onerror = rej;
    im.src = '/demo-art/water-memory.jpg';
  });
  await wait(600);
  const lum = (d, i) => d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
  // 캔버스의 한 사각형 평균 휘도
  const boxMean = (ctx, x, y, w, h) => {
    x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const d = ctx.getImageData(x, y, w, h).data;
    let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 8) { s += lum(d, i); n++; } }
    return n ? s / n : 0;
  };
  const out = [];
  for (let fi = 0; fi < FRAMES.length; fi++) {
    state.frameIdx = fi;
    state.matWidth = 0;
    const m = {};
    for (const [tag, ld] of [['L', [-1, -1]], ['R', [1, -1]]]) {
      state.lightDir = ld;
      const c = buildFramedCore(state.img, FRAMES[fi], state);
      const g = lastFrameLayout;
      const ctx = c.getContext('2d');
      const rail = Math.max(3, g.rail);
      // 살 안쪽 60% 구간만 — 코너 마이터가 섞이면 좌우 비교가 흐려진다
      const bx = g.x, by = g.y, bw = g.w, bh = g.h;
      m[tag] = {
        left: boxMean(ctx, 0, by + bh * 0.2, rail, bh * 0.6),
        right: boxMean(ctx, c.width - rail, by + bh * 0.2, rail, bh * 0.6),
        top: boxMean(ctx, bx + bw * 0.2, 0, bw * 0.6, rail),
        bottom: boxMean(ctx, bx + bw * 0.2, c.height - rail, bw * 0.6, rail),
        // 작품 영역 — 액자를 바꿔도 여기는 그대로여야 한다(같은 방·같은 노출)
        art: boxMean(ctx, bx + bw * 0.15, by + bh * 0.15, bw * 0.7, bh * 0.7),
        // 틈(작품 바로 바깥 3px 링)의 최솟값 — 검은 stroke 탐지
        wh: [c.width, c.height],
      };
      // 작품 경계 바깥 링의 최저 휘도
      const ring = ctx.getImageData(Math.round(bx - 4), Math.round(by + bh * 0.35),
        4, Math.max(1, Math.round(bh * 0.3))).data;
      let mn = 255;
      for (let i = 0; i < ring.length; i += 4) mn = Math.min(mn, lum(ring, i));
      m[tag].gapMin = mn;
    }
    // ⚠️ 좌−우 차이는 두 성분의 합이다:
    //     d@좌광 = C + Δ,  d@우광 = C − Δ
    //   C = 액자 **자체의** 좌우 비대칭(9-slice 사진 원본이 완전한 정면이 아니다 —
    //       CLAUDE.md 41 의 symmetrize 참고). 광원과 무관한 상수다.
    //   Δ = **광원에 대한 반응**. 우리가 재려는 건 이것뿐이다.
    //   예전엔 |dL+dR|/(|dL|+|dR|) 하나로 봤는데, 그건 C 가 크면 Δ 가 멀쩡해도 1 에
    //   가까워진다 — 실제로 화이트(C=−12.5, Δ=13.9)가 sym 0.90 으로 '광원 무시'로
    //   잘못 표시됐다. 반응은 정상이었고 액자가 원래 비대칭이었을 뿐이다.
    const dL = m.L.left - m.L.right, dR = m.R.left - m.R.right;
    const C = (dL + dR) / 2, D = (dL - dR) / 2;
    out.push({
      name: FRAMES[fi].name, kind: FRAMES[fi].kind,
      dL: +dL.toFixed(1), dR: +dR.toFixed(1),
      C: +C.toFixed(1), D: +D.toFixed(1),
      sym: Math.abs(D) > 0.5 ? +(Math.abs(C) / Math.abs(D)).toFixed(2) : 99,
      resp: +(Math.abs(dL) + Math.abs(dR)).toFixed(1),
      art: +m.L.art.toFixed(1),
      artDelta: +(m.L.art - m.R.art).toFixed(2),
      gapMin: +Math.min(m.L.gapMin, m.R.gapMin).toFixed(1),
    });
  }
  return out;
});

console.log('액자              종류      Δ 광원반응   C 자체비대칭   |C/Δ|   작품밝기  틈바닥');
console.log('-'.repeat(84));
for (const r of rows) {
  const bad = Math.abs(r.D) < 3 ? '  ← 광원에 거의 반응 안 함' : '';
  console.log(`${r.name.padEnd(16)} ${r.kind.padEnd(8)} ${String(r.D).padStart(9)} `
    + `${String(r.C).padStart(13)} ${String(r.sym).padStart(8)} `
    + `${String(r.art).padStart(9)} ${String(r.gapMin).padStart(7)}${bad}`);
}
const arts = rows.map((r) => r.art);
console.log('-'.repeat(84));
console.log(`  Δ(광원반응) 최소 ${Math.min(...rows.map((r) => Math.abs(r.D))).toFixed(1)}`
  + `  중앙 ${median(rows.map((r) => Math.abs(r.D))).toFixed(1)}   — 0 이면 광원을 무시한다는 뜻`);
console.log(`  작품 밝기 편차: ${(Math.max(...arts) - Math.min(...arts)).toFixed(1)} 레벨`
  + `  (${Math.min(...arts).toFixed(1)} ~ ${Math.max(...arts).toFixed(1)})  — 같은 방이면 0 이어야 한다`);
console.log(`  틈 바닥 최저: ${Math.min(...rows.map((r) => r.gapMin)).toFixed(1)}`);
function median(a) { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; }
writeFileSync('reports/framelight.json', JSON.stringify(rows, null, 1));
console.log('\n에러:', errs.length ? [...new Set(errs)].slice(0, 4) : '없음');
await b.close();
