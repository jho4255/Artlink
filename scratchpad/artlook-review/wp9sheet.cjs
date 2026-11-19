// WP9 시트 — 같은 작품·같은 벽 렌더를 SNS 크기(전체 300px)와 왼쪽 위 모서리 100%(240px)로 줄지어 놓는다
//   node wp9sheet.cjs <출력.png> <줄:id,id,…> [<줄:…> …]
const sharp = require('/home/jho4255/ArtLink/backend/node_modules/sharp');
const fs = require('fs'); const path = require('path');
const DIR = process.env.DIR || path.join(__dirname, 'wp9/after');
const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'meta.json'), 'utf8'));
const [out, ...rows] = process.argv.slice(2);
const S = 300, C = 240, gap = 10, lab = 20;
(async () => {
  const comps = []; let y = gap, W = 0;
  for (const row of rows) {
    const ids = row.split(','); let x = gap;
    for (const id of ids) {
      const key = `${id}_m0.05`, m = meta[key]; if (!m) { x += S + C + gap * 2; continue; }
      const f = path.join(DIR, key + '.png');
      comps.push({ input: await sharp(f).resize(S, S).png().toBuffer(), left: x, top: y + lab });
      const p = m.piece; const cx = Math.max(0, Math.round(p.x - 30)), cy = Math.max(0, Math.round(p.y - 30));
      comps.push({ input: await sharp(f).extract({ left: cx, top: cy, width: C, height: C }).png().toBuffer(), left: x + S + 4, top: y + lab });
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S + C}" height="${lab}"><text x="0" y="15" font-size="14" font-family="sans-serif" fill="#222">${id}</text></svg>`;
      comps.push({ input: Buffer.from(svg), left: x, top: y });
      x += S + C + 4 + gap * 2;
    }
    W = Math.max(W, x); y += S + lab + gap;
  }
  await sharp({ create: { width: W, height: y, channels: 3, background: '#e9e9e9' } }).composite(comps).png().toFile(out);
  console.log(out, W, y);
})();
