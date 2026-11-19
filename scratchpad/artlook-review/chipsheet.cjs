// 구운 칩 한눈에 — node chipsheet.cjs <폴더> <출력.png> [칸 크기] [열 수]
const sharp = require('/home/jho4255/ArtLink/backend/node_modules/sharp');
const fs = require('fs'); const path = require('path');
const [dir, out, cellArg, colsArg] = process.argv.slice(2);
const cell = +cellArg || 96, cols = +colsArg || 7, pad = 8, lab = 18;
(async () => {
  const files = fs.readdirSync(dir).filter((f) => /\.(webp|jpg|png)$/.test(f)).sort();
  const rows = Math.ceil(files.length / cols);
  const W = cols * (cell + pad) + pad, H = rows * (cell + lab + pad) + pad;
  const comps = [];
  for (let i = 0; i < files.length; i++) {
    const x = pad + (i % cols) * (cell + pad), y = pad + Math.floor(i / cols) * (cell + lab + pad);
    comps.push({ input: await sharp(path.join(dir, files[i])).resize(cell, cell, { fit: 'contain', background: '#fff' }).png().toBuffer(), left: x, top: y });
    const name = files[i].replace(/\.\w+$/, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="${lab}"><text x="0" y="13" font-size="11" font-family="sans-serif" fill="#333">${name}</text></svg>`;
    comps.push({ input: Buffer.from(svg), left: x, top: y + cell + 2 });
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: '#f4f4f4' } }).composite(comps).png().toFile(out);
  console.log(out, files.length);
})();
