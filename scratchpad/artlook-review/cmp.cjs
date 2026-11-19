// 기준선(q-base) ↔ 지금(q) 비교 — 크기가 다르면 지금 것을 기준선 크기로 줄여서 잰다(구도 유지 확인용).
//   node cmp.cjs <폴더> [이름,…|-] [뒤 폴더=q] [앞 폴더=q-base]     → 이름 · 크기(전→후) · 조각 사각형 비율 차(%) · 평균 픽셀 차(/255) · 최대
const sharp = require('/home/jho4255/ArtLink/backend/node_modules/sharp');
const fs = require('fs'); const path = require('path');
const R = __dirname;
const load = (d) => Object.assign({}, ...fs.readdirSync(d).filter((f) => f.startsWith('geo-') && f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))));
const [dir, only, AFTER = 'q', BEFORE = 'q-base'] = process.argv.slice(2);
const gb = load(path.join(R, BEFORE)), gn = load(path.join(R, AFTER));
(async () => {
  const names = only && only !== '-' ? only.split(',') : fs.readdirSync(path.join(R, BEFORE, dir)).filter((f) => f.endsWith('.png')).map((f) => f.replace('.png', ''));
  for (const n of names) {
    const k = `${dir}/${n}`, b = gb[k], a = gn[k];
    if (!b || !a) { console.log(n, '기하 없음'); continue; }
    const rel = (g) => g.piece ? [g.piece[0] / g.W, g.piece[1] / g.H, g.piece[2] / g.W, g.piece[3] / g.H] : null;
    const rb = rel(b), ra = rel(a);
    const dRect = rb && ra ? Math.max(...rb.map((v, i) => Math.abs(v - ra[i]))) * 100 : NaN;
    const bi = await sharp(path.join(R, BEFORE, dir, n + '.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const ai = await sharp(path.join(R, AFTER, dir, n + '.png')).removeAlpha().resize(bi.info.width, bi.info.height, { kernel: 'lanczos3' }).raw().toBuffer();
    let s = 0, mx = 0; for (let i = 0; i < ai.length; i++) { const d = Math.abs(ai[i] - bi.data[i]); s += d; if (d > mx) mx = d; }
    console.log(`${n.padEnd(28)} ${b.W}x${b.H} → ${a.W}x${a.H}  조각차 ${dRect.toFixed(2)}%  평균 ${(s / ai.length).toFixed(2)}  최대 ${mx}`);
  }
})();
