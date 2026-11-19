// WP9 — 엔진이 실제로 그리는 액자 사진(보정·색 옮김 뒤 PHOTO_FRAMES)을 PNG 로 떠 둔다. 판정(wp9gate.py)이 원본과 견준다.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const OUT = '/home/jho4255/ArtLink/scratchpad/artlook-review/wp9/assets'; mkdirSync(OUT, { recursive: true });
const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 900, height: 700 } });
await p.goto('http://localhost:5173/artlook/index.html?preload=all', { waitUntil: 'networkidle' });
await p.waitForFunction(() => PHOTO_META_READY && Object.keys(PHOTO_META).every((k) => PHOTO_STATE[k] === 'ready' || PHOTO_STATE[k] === 'failed'), null, { timeout: 180000, polling: 300 });
const dump = await p.evaluate(() => Object.keys(PHOTO_META).map((k) => {
  const im = PHOTO_FRAMES[k]; if (!im) return null;
  const c = document.createElement('canvas'); c.width = im.naturalWidth || im.width; c.height = im.naturalHeight || im.height;
  c.getContext('2d').drawImage(im, 0, 0);
  return { k, png: c.toDataURL('image/png'), meta: PHOTO_META[k], light: PHOTO_LIGHT[k] };
}).filter(Boolean));
const meta = {};
for (const d of dump) { writeFileSync(`${OUT}/${d.k}.png`, Buffer.from(d.png.split(',')[1], 'base64')); meta[d.k] = { meta: d.meta, light: d.light }; }
writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 1));
console.log(dump.length, '장');
await b.close();
