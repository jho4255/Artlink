// 액자 재질 옮기기 시험 — 가진 사진 액자(검정·흰색 도장)에서 **결·명암은 그대로 두고 색만** 옮겨 새 재질을 만든다(OKLab).
// 저장소 자산은 건드리지 않는다: 브라우저가 그 액자 사진을 받을 때 색 옮긴 사본으로 바꿔 내보내고 엔진으로 그려 본다.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const sharp = require('/home/jho4255/ArtLink/backend/node_modules/sharp');
const OUT = '/home/jho4255/ArtLink/scratchpad/artlook-review/q/recolor'; mkdirSync(OUT, { recursive: true });
const PHOTO = '/home/jho4255/ArtLink/frontend/public/artlook/frames/photo/';
const s2l = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const l2s = (c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)));
const toLab = (r, g, b) => { r = s2l(r); g = s2l(g); b = s2l(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]; };
const toRgb = (L, a, b) => { const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [l2s(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), l2s(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), l2s(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)]; };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** src 사진의 '앞면 평균'을 target 색으로 옮긴다. 밝기 편차(결·명암)는 kL 배로, 색 편차는 그대로 더한다 */
async function recolor(file, target, kL = 1) {
  const { data, info } = await sharp(PHOTO + file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let sL = 0, sa = 0, sb = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 250) { const [L, a, b] = toLab(data[i], data[i + 1], data[i + 2]); sL += L; sa += a; sb += b; n++; }
  const mL = sL / n, ma = sa / n, mb = sb / n; const [tL, ta, tb] = toLab(...hex(target));
  const out = Buffer.from(data);
  for (let i = 0; i < data.length; i += 4) { if (!data[i + 3]) continue; const [L, a, b] = toLab(data[i], data[i + 1], data[i + 2]);
    const [r, g, bb] = toRgb(Math.max(0, tL + (L - mL) * kL), ta + (a - ma), tb + (b - mb)); out[i] = r; out[i + 1] = g; out[i + 2] = bb; }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}
// [결과 이름, 바탕 액자 id, 바탕 사진 파일, 목표 색, 밝기 편차 배율]
const VARIANTS = (process.env.SET === 'wood') ? [
  ['cherry', 'oak', 'oak.png', '#9c5a3a', 1.0], ['honey', 'oak', 'oak.png', '#b98a4e', 1.0], ['greywash', 'oak', 'oak.png', '#9a958c', 1.0], ['espresso', 'walnut', 'walnut.png', '#2e221c', 1.0],
  ['box-cherry', 'box-oak', 'oak-deep.png', '#9c5a3a', 1.0], ['slim-honey', 'oak-thin', 'oak-thin.png', '#b98a4e', 1.0],
] : [
  ['navy', 'black', 'black.png', '#1f2c47', 1.0], ['forest', 'black', 'black.png', '#22382c', 1.0], ['burgundy', 'black', 'black.png', '#4a1f26', 1.0], ['charcoal', 'black', 'black.png', '#3d3f43', 1.0],
  ['sage', 'white', 'white.png', '#b9c2ae', 1.0], ['dustblue', 'white', 'white.png', '#a9b9c9', 1.0], ['cream', 'white', 'white.png', '#ece3cf', 1.0], ['blush', 'white', 'white.png', '#e0bfb6', 1.0],
  ['slim-navy', 'slim-black', 'black-thin.png', '#1f2c47', 1.0], ['floater-sage', 'floater-white', 'white-floater.png', '#b9c2ae', 1.0],
];
const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const geo = {};
for (const [name, frameId, file, target, kL] of VARIANTS) {
  const buf = await recolor(file, target, kL);
  const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
  await p.route('**/artlook/frames/photo/' + file, (route) => route.fulfill({ body: buf, contentType: 'image/png' }));
  await p.goto('http://localhost:5173/artlook/index.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const r = await p.evaluate(async ({ frameId }) => {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    await new Promise((res, rej) => { const im = new Image(); im.onload = () => { state.img = capToCanvas(im); res(); }; im.onerror = rej; im.src = '/demo-art/dawn-window.jpg'; });
    state.frameIdx = FRAMES.findIndex((f) => f.id === frameId); state.sceneIdx = SCENES.findIndex((s) => s.id === 'white-plaster'); state.matWidth = 0.05; state.ratio = '1:1'; state.light = 0;
    selectedWork = null; ensureFrameAssets(FRAMES[state.frameIdx]); await ArtLookScene.ensureScene(SCENES[state.sceneIdx]);
    for (let i = 0; i < 40; i++) { render(); await wait(400); const cv = document.getElementById('preview'); if (window.__artlook && window.__artlook.piece && !cv.hidden && cv.width > 1200) break; }
    await wait(900); render(); await wait(900);
    const cv = document.getElementById('preview'); const pr = window.__artlook || {};
    return { png: cv.toDataURL('image/png'), W: cv.width, H: cv.height, piece: pr.piece ? [pr.piece.x, pr.piece.y, pr.piece.w, pr.piece.h].map(Math.round) : null };
  }, { frameId });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
  geo[`recolor/${name}`] = { W: r.W, H: r.H, piece: r.piece };
  console.log(name, r.W + 'x' + r.H, r.piece);
  await p.close();
}
writeFileSync('/home/jho4255/ArtLink/scratchpad/artlook-review/q/geo-recolor' + (process.env.SET || '') + '.json', JSON.stringify(geo, null, 1));
await b.close();
