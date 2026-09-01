// ⚠️ 브리핑 "SOURCE-ASSET LIGHTING PROTECTION" 을 재는 하니스 (8차, 2026-09-01)
//
//   "First estimate: 이 자산에 **이미** 얼마나 많은 조명 정보가 구워져 있는가?
//    이미 자연스럽게 조명돼 있으면 synthetic lighting = minimal."
//
// 우리는 그걸 한 번도 재지 않고 `SYN_DIR` 전역 상수 하나로 **전 액자에 같은 세기**를
// 걸어 왔다. 실제로 재 보면 자산마다 완전히 다르다 — 원본 PNG 실측(2026-09-01):
//     black T−B +27.8 · gold +15.8 · walnut +20.6   (위에서 온 빛 — 장면과 일치)
//     oak   T−B −17.3 · white  −41.2                (**아래에서 온 빛** — 장면과 반대)
// 즉 CLAUDE.md 37 의 전제("사진 액자는 네 변이 똑같이 밝다")가 5종 전부에서 틀렸다.
//
// 이 스크립트는 **판(plate)** 에서 같은 것을 잰다 — 합성 끄고/켜고 두 번 그려서
//   baked : 자산이 원래 갖고 있던 방향 신호
//   total : 우리 음영까지 얹은 뒤
//   add   : 우리가 더한 양 (= total − baked)
//   fight : 우리가 더한 방향이 baked 와 **싸우는가** (부호가 반대면 1)
//
//   node assetlight.mjs
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { writeFileSync } from 'node:fs';

// 장면 광원 3종 — 좌상단(옛 기본) · 우상단(실제 다수) · 좌상단 강한 수평
const LDS = [['좌상', [-1, -1]], ['우상', [0.94, -0.33]], ['좌상수평', [-0.9, -0.44]]];

async function measure(syn, syndir) {
  const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
  await p.goto(`http://localhost:5173/artlook/index.html?syn=${syn}&syndir=${syndir}`,
    { waitUntil: 'networkidle' });
  await p.waitForTimeout(3800);
  const rows = await p.evaluate(async ({ LDS }) => {
    await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => { state.img = capToCanvas(im); res(); };
      im.onerror = rej;
      im.src = '/demo-art/water-memory.jpg';
    });
    const lum = (d, i) => d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
    const boxMean = (ctx, x, y, w, h) => {
      x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
      w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
      const d = ctx.getImageData(x, y, w, h).data;
      let s = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { s += lum(d, i); n++; }
      return n ? s / n : 0;
    };
    const out = [];
    for (let fi = 0; fi < FRAMES.length; fi++) {
      state.frameIdx = fi;
      state.matWidth = 0.05;
      const rec = { name: FRAMES[fi].name, kind: FRAMES[fi].kind, ld: {} };
      for (const [tag, ld] of LDS) {
        state.lightDir = ld;
        const c = buildFramedCore(state.img, FRAMES[fi], state);
        const g = lastFrameLayout;
        const ctx = c.getContext('2d');
        const rail = Math.max(3, g.rail);
        const bx = g.x, by = g.y, bw = g.w, bh = g.h;
        // 살 안쪽 60% (코너 마이터 제외)
        const top = boxMean(ctx, bx + bw * 0.2, 0, bw * 0.6, rail);
        const bot = boxMean(ctx, bx + bw * 0.2, c.height - rail, bw * 0.6, rail);
        const left = boxMean(ctx, 0, by + bh * 0.2, rail, bh * 0.6);
        const right = boxMean(ctx, c.width - rail, by + bh * 0.2, rail, bh * 0.6);
        rec.ld[tag] = { tb: top - bot, lr: left - right, top, bot };
      }
      out.push(rec);
    }
    return out;
  }, { LDS });
  await b.close();
  return rows;
}

const off = await measure(0, 0);
const on = await measure('', '');   // 빈 값 → 기본값(현재 설정)

console.log('자산에 구워진 방향광 vs 우리가 더하는 양  (T−B = 위살 − 아래살 밝기)\n');
console.log(`${'액자'.padEnd(14)} ${'종류'.padEnd(8)} ${'장면광'.padEnd(9)} ${'baked'.padStart(8)} ${'total'.padStart(8)} ${'add'.padStart(8)}   판정`);
console.log('-'.repeat(84));
const rec = [];
for (let i = 0; i < off.length; i++) {
  for (const [tag] of LDS) {
    const bk = off[i].ld[tag].tb, tt = on[i].ld[tag].tb;
    const add = tt - bk;
    // 장면 광원은 언제나 위에서 온다(sceneLightModel 이 세로를 위로 고정한다) → 기대 부호 +
    //  · dup    : 자산이 이미 충분한데 **또 더했다** (브리핑 "duplicate what exists")
    //  · mush   : 자산이 반대 방향인데 **끝까지 못 옮겨** 모순된 중간이 남았다
    //             (브리핑 "incorrect adaptive lighting can be worse than doing nothing")
    //  · untouched : 자산이 이미 맞아서 아무것도 안 했다 = 가장 좋은 상태
    const dup = bk > 12 && add > 8;
    const mush = bk < -3 && tt < -6 && add > 3;
    const untouched = Math.abs(add) < 1;
    rec.push({ name: off[i].name, kind: off[i].kind, ld: tag, baked: +bk.toFixed(1), total: +tt.toFixed(1), add: +add.toFixed(1), dup, mush, untouched });
    const flag = dup ? '⚠ 이미 있는 걸 또 더한다'
      : mush ? '⚠ 못 옮겨 모순된 중간이 남았다'
      : untouched ? '· 자산이 이미 맞다 — 손대지 않음' : '';
    console.log(`${off[i].name.padEnd(14)} ${off[i].kind.padEnd(8)} ${tag.padEnd(9)} ${bk.toFixed(1).padStart(8)} ${tt.toFixed(1).padStart(8)} ${add.toFixed(1).padStart(8)}   ${flag}`);
  }
}
const ph = rec.filter((r) => r.kind === 'photo');
const pr = rec.filter((r) => r.kind !== 'photo');
const avg = (a, k) => a.length ? a.reduce((s, r) => s + Math.abs(r[k]), 0) / a.length : 0;
console.log('-'.repeat(84));
console.log(`사진 액자 : baked |T−B| 평균 ${avg(ph, 'baked').toFixed(1)}   우리가 더하는 양 ${avg(ph, 'add').toFixed(1)}`);
console.log(`절차적    : baked |T−B| 평균 ${avg(pr, 'baked').toFixed(1)}   우리가 더하는 양 ${avg(pr, 'add').toFixed(1)}`);
const ph2 = rec.filter((r) => r.kind === 'photo');
console.log(`\n사진 액자 ${ph2.length} 조합 —  중복 ${ph2.filter((r) => r.dup).length}`
  + ` · 모순된 중간 ${ph2.filter((r) => r.mush).length}`
  + ` · 손대지 않음 ${ph2.filter((r) => r.untouched).length}`
  + `  (중복·모순이 0 이면 통과)`);
writeFileSync('reports/assetlight.json', JSON.stringify(rec, null, 1));
