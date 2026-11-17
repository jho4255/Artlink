const sharp = require('/home/jho4255/ArtLink/backend/node_modules/sharp');
const path = require('path'); const Q = path.join(__dirname, 'q');
(async () => {
  // 실내 장면 100% 조각: [파일, left, top, w, h]
  const list = [
    ['special/unknown-salon', 0, 330, 420, 420], ['special/unknown-salon', 380, 300, 420, 420], ['special/unknown-salon', 660, 660, 420, 420],
    ['special/unknown-collector-home', 0, 600, 420, 420], ['special/unknown-collector-home', 360, 380, 420, 420], ['special/unknown-collector-home', 620, 620, 420, 420],
    ['special/unknown-whitecube', 330, 380, 420, 420], ['scenes/gallery-living', 60, 620, 420, 420],
  ];
  const tiles = [];
  for (const [f, l, t, w, h] of list) tiles.push(await sharp(path.join(Q, f + '.png')).extract({ left: l, top: t, width: w, height: h }).png().toBuffer());
  const cols = 4, T = 420, G = 6, rows = Math.ceil(tiles.length / cols);
  await sharp({ create: { width: cols * T + (cols + 1) * G, height: rows * T + (rows + 1) * G, channels: 3, background: '#404040' } })
    .composite(tiles.map((b, i) => ({ input: b, left: G + (i % cols) * (T + G), top: G + Math.floor(i / cols) * (T + G) }))).png().toFile(path.join(Q, 'crops-interior.png'));
  console.log('ok');
})();
