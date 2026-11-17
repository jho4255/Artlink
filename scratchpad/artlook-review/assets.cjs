// 목업에 올릴 그림 준비 — 전부 데모 그림·우리 엔진 결과물·우리 화면 캡처
const sharp = require('/home/jho4255/ArtLink/backend/node_modules/sharp');
const fs = require('fs'); const path = require('path');
const Q = path.join(__dirname, 'q'), UP = path.join(__dirname, 'up'), SH = path.join(__dirname, 'shots');
const geo = Object.assign({}, ...fs.readdirSync(Q).filter((f) => f.startsWith('geo-')).map((f) => JSON.parse(fs.readFileSync(path.join(Q, f), 'utf8'))));
const jpg = (img, out, q = 84) => img.jpeg({ quality: q, chromaSubsampling: '4:4:4' }).toFile(path.join(UP, out));
(async () => {
  // 큰 미리보기(휴대폰 390px · PC 660px 로 쓴다)
  for (const n of ['mock-charcoal', 'mock-plaster-oak', 'mock-living', 'mock-whitecube']) await jpg(sharp(path.join(Q, 'after', n + '.png')).resize(1000, 1000), `pv-${n.slice(5)}.jpg`, 86);
  // 추천 조합 칩
  for (const n of ['mock-whitecube', 'mock-living', 'mock-charcoal', 'mock-p-plaster', 'mock-p-burgundy', 'mock-p-brick', 'mock-p-home', 'mock-p-canvas']) await jpg(sharp(path.join(Q, 'after', n + '.png')).resize(240, 240), `ps-${n.replace('mock-p-', '').replace('mock-', '')}.jpg`);
  // 액자 모서리 칩(재질) — 왼쪽 위 모서리 100% 조각
  for (const f of ['oak', 'walnut', 'maple', 'black', 'white', 'silver', 'gold']) {
    const g = geo[`after/mock-f-${f}`]; const [x, y] = g.piece; const s = 190;
    await jpg(sharp(path.join(Q, 'after', `mock-f-${f}.png`)).extract({ left: x - 34, top: y - 34, width: s, height: s }).resize(160, 160), `fc-${f}.jpg`, 88);
  }
  // 모양(프로파일) 칩 — 같은 오크/블랙 계열의 모서리: 몰딩·넓은 몰딩·슬림·플로터·박스·캔버스
  for (const [id, name] of [['oak', 'molding'], ['black-wide', 'wide'], ['oak-thin', 'slim'], ['floater-oak', 'floater'], ['box-oak', 'box'], ['canvas-wrap', 'canvas']]) {
    const g = geo[`frames/${id}`]; const [x, y] = g.piece; const s = 190;
    await jpg(sharp(path.join(Q, 'frames', `${id}.png`)).extract({ left: x - 34, top: y - 34, width: s, height: s }).resize(160, 160), `sh-${name}.jpg`, 88);
  }
  // 배경 칩 · 작품 칩
  const TH = '/home/jho4255/ArtLink/frontend/public/artlook/walls/thumbs/';
  for (const [f, n] of [['wall15-gallery-salon', 'salon'], ['wall16-boutique-gallery', 'boutique'], ['wall17-collector-salon', 'csalon'], ['wall11-gallery-living', 'living'], ['wall12-white-cube', 'cube'], ['wall14-collector-home', 'home'], ['wall13-hotel-lounge', 'hotel'], ['wall26-white-plaster', 'plaster'], ['wall21-charcoal', 'charcoal'], ['wall30-red-brick', 'brick']]) await jpg(sharp(TH + f + '.jpg').resize(200, 200), `bg-${n}.jpg`);
  const DA = '/home/jho4255/ArtLink/frontend/public/demo-art/';
  for (const n of ['dawn-window', 'long-summer', 'red-hill', 'quiet-afternoon', 'water-memory', 'square-garden']) await jpg(sharp(DA + n + '.jpg').resize(200, 200, { fit: 'contain', background: '#f3f4f6' }), `wk-${n}.jpg`);
  // 지금 화면 캡처
  await jpg(sharp(path.join(SH, 'iphone13-1-works.png')), 'now-m-works.jpg', 82);
  await jpg(sharp(path.join(SH, 'iphone13-2-frames.png')), 'now-m-frames.jpg', 82);
  await jpg(sharp(path.join(SH, 'pc1440-2-frames.png')), 'now-pc-frames.jpg', 82);
  // 화질 근거 — 모서리 그늘 전/후
  for (const [a, b] of [['ao-white-plaster-A-now', 'ev-ao-plaster-now'], ['ao-white-plaster-C-off-sh15', 'ev-ao-plaster-after'], ['ao-terracotta-A-now', 'ev-ao-terra-now'], ['ao-terracotta-C-off-sh15', 'ev-ao-terra-after']]) await jpg(sharp(path.join(Q, 'after', a + '.png')).resize(640, 640), b + '.jpg', 86);
  await jpg(sharp(path.join(Q, 'res-now-crop.png')), 'ev-res-now.jpg', 88);
  await jpg(sharp(path.join(Q, 'res-after-crop.png')), 'ev-res-after.jpg', 88);
  // 비슷해 보이는 액자 — 검정 5종·흰색 계열 6종을 SNS 크기(조각 150px)로
  for (const [ids, out] of [[['black', 'black-wide', 'slim-black', 'floater-black', 'box-black'], 'ev-black5'], [['white', 'white-wide', 'slim-white', 'floater-white', 'box-white', 'box-ivory'], 'ev-white6']]) {
    const tiles = [];
    for (const id of ids) { const g = geo[`frames/${id}`]; const [x, y, w, h] = g.piece; const m = 60; tiles.push(await sharp(path.join(Q, 'frames', id + '.png')).extract({ left: x - m, top: y - m, width: w + 2 * m, height: h + 2 * m }).resize({ height: 220 }).png().toBuffer({ resolveWithObject: true })); }
    const W = tiles.reduce((s, t) => s + t.info.width, 0) + (tiles.length - 1) * 10; let cx = 0;
    await jpg(sharp({ create: { width: W, height: 220, channels: 3, background: '#ffffff' } }).composite(tiles.map((t) => { const o = { input: t.data, left: cx, top: 0 }; cx += t.info.width + 10; return o; })), out + '.jpg', 86);
    console.log(out, W);
  }
  console.log(fs.readdirSync(UP).length, 'files', Math.round(fs.readdirSync(UP).reduce((s, f) => s + fs.statSync(path.join(UP, f)).size, 0) / 1024) + 'KB');
})();
