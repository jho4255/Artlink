// 모아 보기 시트 — node sheet.cjs <dir> <mode: full|piece|corner|bottom> <cols> [tile]
const sharp = require('/home/jho4255/ArtLink/backend/node_modules/sharp');
const fs = require('fs'); const path = require('path');
const Q = path.join(__dirname, 'q');
const [dir, mode = 'full', colsArg = '6', tileArg = '300', filterArg = ''] = process.argv.slice(2);
const geo = Object.assign({}, ...fs.readdirSync(Q).filter((f) => f.startsWith('geo-')).map((f) => JSON.parse(fs.readFileSync(path.join(Q, f), 'utf8'))));
(async () => {
  const cols = +colsArg, T = +tileArg, LAB = 22;
  let names = fs.readdirSync(path.join(Q, dir)).filter((f) => f.endsWith('.png')).map((f) => f.replace('.png', ''));
  if (filterArg) names = filterArg.split(',');
  const tiles = [];
  for (const n of names) {
    const g = geo[`${dir}/${n}`]; const src = path.join(Q, dir, n + '.png');
    let img = sharp(src);
    if (mode === 'piece' && g.piece) {
      const [x, y, w, h] = g.piece; const m = Math.round(Math.max(w, h) * 0.12);
      const L = Math.max(0, x - m), Tp = Math.max(0, y - m), R = Math.min(g.W, x + w + m), B = Math.min(g.H, y + h + m);
      img = img.extract({ left: L, top: Tp, width: R - L, height: B - Tp }).resize({ width: T, height: T, fit: 'contain', background: '#808080' });
    } else if (mode === 'corner' && g.piece) {
      const [x, y] = g.piece; const s = T; // 왼쪽 위 모서리 100%
      img = img.extract({ left: Math.max(0, x - Math.round(s * 0.22)), top: Math.max(0, y - Math.round(s * 0.22)), width: s, height: s });
    } else if (mode === 'bottom' && g.piece) {
      const [x, y, w, h] = g.piece; const s = T; // 오른쪽 아래 모서리 100% (그림자)
      img = img.extract({ left: Math.min(g.W - s, x + w - Math.round(s * 0.62)), top: Math.min(g.H - s, y + h - Math.round(s * 0.62)), width: s, height: s });
    } else img = img.resize({ width: T, height: T, fit: 'contain', background: '#808080' });
    const buf = await img.png().toBuffer();
    const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${T}" height="${LAB}"><rect width="100%" height="100%" fill="#111"/><text x="6" y="16" font-family="sans-serif" font-size="13" fill="#fff">${n}${g ? ' · ' + g.W : ''}</text></svg>`);
    tiles.push({ buf, label });
  }
  const rows = Math.ceil(tiles.length / cols), G = 6;
  const W = cols * T + (cols + 1) * G, H = rows * (T + LAB) + (rows + 1) * G;
  const comp = [];
  tiles.forEach((t, i) => { const cx = G + (i % cols) * (T + G), cy = G + Math.floor(i / cols) * (T + LAB + G); comp.push({ input: t.buf, left: cx, top: cy + LAB }, { input: t.label, left: cx, top: cy }); });
  const out = path.join(Q, `sheet-${dir}-${mode}${filterArg ? '-' + names[0] : ''}.png`);
  await sharp({ create: { width: W, height: H, channels: 3, background: '#404040' } }).composite(comp).png().toFile(out);
  console.log(out, W + 'x' + H);
})();
