// WP9 관문용 렌더 — 액자마다 같은 작품·같은 벽에 걸어 PNG 로(매트 5% · 없음). 기존 액자의 픽셀 대조와 새 액자 판정이 같이 쓴다.
//   OUT=wp9/before node wp9.mjs            # 보이는 액자 전부(숨긴 것 제외)
//   OUT=wp9/after IDS=a,b node wp9.mjs     # 고른 것만
//   SCENE=white-plaster(기본) | charcoal | gallery-salon …
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
const OUT = '/home/jho4255/ArtLink/scratchpad/artlook-review/' + (process.env.OUT || 'wp9/now'); mkdirSync(OUT, { recursive: true });
const SCENE = process.env.SCENE || 'white-plaster', WORK = process.env.WORK || 'dawn-window.jpg';
const MATS = (process.env.MATS || '0.05,0').split(',').map(Number);
const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:5173/artlook/index.html?preload=all', { waitUntil: 'networkidle' });
await p.waitForFunction(() => {
  if (typeof PHOTO_META_READY === 'undefined' || !PHOTO_META_READY) return false;
  const photos = Object.keys(PHOTO_META || {}).every((k) => PHOTO_STATE[k] === 'ready' || PHOTO_STATE[k] === 'failed');
  return photos && SCENES.length > 0 && SCENES.every((s) => s.loaded || s.failed) && Object.values(MATS).every((m) => !m.texture || m.ready);
}, null, { timeout: 180000, polling: 300 });
const ids = process.env.IDS ? process.env.IDS.split(',') : await p.evaluate(() => FRAMES.filter((f) => !f.hidden).map((f) => f.id));
const metaFile = `${OUT}/meta.json`; const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {};
for (const id of ids) for (const mat of MATS) {
  const r = await p.evaluate(async ({ id, mat, SCENE, WORK }) => {
    await new Promise((res, rej) => { const im = new Image(); im.onload = () => { state.img = capToCanvas(im); res(); }; im.onerror = rej; im.src = '/demo-art/' + WORK; });
    const f = FRAMES.find((x) => x.id === id); if (!f) return null;
    state.mode = 'scene'; state.frameIdx = FRAMES.indexOf(f); state.sceneIdx = SCENES.findIndex((s) => s.id === SCENE);
    state.matWidth = f.kind === 'canvas' ? 0 : mat; state.matteColor = '#f5f2ea'; state.matTexture = 'paper';
    state.light = 0; state.ratio = '1:1'; state.caption = false; state.group = null; state.circle = null; state.draft = false;
    selectedWork = null; SCENES[state.sceneIdx].adj = { dx: 0, dy: 0, s: 1 };
    const out = compose(); const pr = window.__artlook;
    return { png: out.toDataURL('image/png'), W: out.width, H: out.height, piece: pr && pr.piece, art: pr && pr.art, railPx: pr && pr.railPx, matPx: pr && pr.matPx, name: f.name };
  }, { id, mat, SCENE, WORK });
  if (!r) { console.log('없음', id); continue; }
  const key = `${id}_m${mat}`;
  writeFileSync(`${OUT}/${key}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
  meta[key] = { id, mat, name: r.name, W: r.W, H: r.H, piece: r.piece, art: r.art, railPx: r.railPx, matPx: r.matPx };
}
writeFileSync(metaFile, JSON.stringify(meta, null, 1));
console.log(Object.keys(meta).length, '장 ·', SCENE, '· 오류', errs.length ? [...new Set(errs)].slice(0, 3) : '없음');
await b.close();
