// 표 시트 — 행 × 열로 그림을 놓고 머리글을 단다.  node grid.cjs <out.png> <tile> <열이름,…> <행:파일1|파일2|…> …
//   파일 앞에 'crop:x,y,w,h@' 를 붙이면 그 영역만 잘라 놓는다(100% 확대 조각).
const sharp = require('/home/jho4255/ArtLink/backend/node_modules/sharp');
const path = require('path');
const [out, tileArg, colsArg, ...rows] = process.argv.slice(2);
const T = +tileArg, cols = colsArg.split(','), LW = 150, HH = 34, G = 6;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
(async () => {
  const comp = [];
  const W = LW + cols.length * (T + G) + G, H = HH + rows.length * (T + G) + G;
  cols.forEach((c, j) => comp.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${T}" height="${HH}"><text x="4" y="23" font-family="sans-serif" font-size="17" font-weight="700" fill="#111">${esc(c)}</text></svg>`), left: LW + G + j * (T + G), top: 0 }));
  for (let i = 0; i < rows.length; i++) {
    const [label, files] = rows[i].split(':');
    comp.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${LW}" height="${T}"><text x="6" y="${T / 2}" font-family="sans-serif" font-size="15" fill="#111">${esc(label)}</text></svg>`), left: 0, top: HH + G + i * (T + G) });
    const list = files.split('|');
    for (let j = 0; j < list.length; j++) {
      let f = list[j], img;
      const m = f.match(/^crop:(\d+),(\d+),(\d+),(\d+)@(.+)$/);
      if (m) img = sharp(m[5]).extract({ left: +m[1], top: +m[2], width: +m[3], height: +m[4] }).resize(T, T, { kernel: 'nearest' });
      else img = sharp(f).resize(T, T, { fit: 'contain', background: '#ffffff' });
      comp.push({ input: await img.png().toBuffer(), left: LW + G + j * (T + G), top: HH + G + i * (T + G) });
    }
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).composite(comp).png().toFile(out);
  console.log(out, W + 'x' + H);
})();
