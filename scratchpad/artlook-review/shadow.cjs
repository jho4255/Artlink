// 그림자 재기 — 조각 바깥 벽의 밝기가 변/모서리 근처에서 얼마나 떨어지는가(먼 벽 대비 %)
const sharp = require('/home/jho4255/ArtLink/backend/node_modules/sharp');
const fs = require('fs'); const path = require('path'); const Q = path.join(__dirname, 'q');
const geo = Object.assign({}, ...fs.readdirSync(Q).filter((f) => f.startsWith('geo-')).map((f) => JSON.parse(fs.readFileSync(path.join(Q, f), 'utf8'))));
(async () => {
  for (const key of process.argv.slice(2)) {
    const g = geo[key]; const { data, info } = await sharp(path.join(Q, key + '.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const L = (x, y) => { const i = (Math.round(y) * info.width + Math.round(x)) * 3; return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; };
    const box = (x0, y0, x1, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { if (x < 0 || y < 0 || x >= info.width || y >= info.height) continue; s += L(x, y); n++; } return n ? s / n : NaN; };
    const [x, y, w, h] = g.piece; const u = Math.max(w, h) / 100; // 조각 긴 변의 1%
    const far = (side) => side === 'b' ? box(x + w * 0.3, y + h + 14 * u, x + w * 0.7, y + h + 18 * u) : side === 't' ? box(x + w * 0.3, y - 18 * u, x + w * 0.7, y - 14 * u) : side === 'r' ? box(x + w + 14 * u, y + h * 0.3, x + w + 18 * u, y + h * 0.7) : box(x - 18 * u, y + h * 0.3, x - 14 * u, y + h * 0.7);
    const near = (side, d0, d1) => side === 'b' ? box(x + w * 0.3, y + h + d0 * u, x + w * 0.7, y + h + d1 * u) : side === 't' ? box(x + w * 0.3, y - d1 * u, x + w * 0.7, y - d0 * u) : side === 'r' ? box(x + w + d0 * u, y + h * 0.3, x + w + d1 * u, y + h * 0.7) : box(x - d1 * u, y + h * 0.3, x - d0 * u, y + h * 0.7);
    const out = {};
    for (const s of ['t', 'b', 'l', 'r']) { const f = far(s); out[s] = [[0.3, 1], [1, 2.5], [2.5, 5], [5, 9]].map(([a, b]) => Math.round(100 * (near(s, a, b) / f - 1))); }
    // 모서리 바깥 대각선(1~4%)
    const cz = (cx, cy, sx, sy) => box(Math.min(cx + sx * 1 * u, cx + sx * 4 * u), Math.min(cy + sy * 1 * u, cy + sy * 4 * u), Math.max(cx + sx * 1 * u, cx + sx * 4 * u), Math.max(cy + sy * 1 * u, cy + sy * 4 * u));
    const wall = (far('t') + far('b') + far('l') + far('r')) / 4;
    const cor = { tl: cz(x, y, -1, -1), tr: cz(x + w, y, 1, -1), bl: cz(x, y + h, -1, 1), br: cz(x + w, y + h, 1, 1) };
    console.log(key.padEnd(34), 'wall', Math.round(wall), '| 변 중앙 %(0.3–1,1–2.5,2.5–5,5–9%) 위', out.t.join(','), '아래', out.b.join(','), '왼', out.l.join(','), '오른', out.r.join(','), '| 모서리 %', Object.entries(cor).map(([k, v]) => k + ' ' + Math.round(100 * (v / wall - 1))).join(' '));
  }
})();
