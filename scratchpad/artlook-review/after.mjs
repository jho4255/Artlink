// 개선안 '전/후' — 엔진 파일은 그대로 두고, 페이지 안에서 옵션만 덮어쓰거나(모서리 그늘·그림자 세기)
// 실내 사진을 늘린 사본으로 바꿔 받아(출력 해상도) 실제 합성 결과를 뽑는다. 데모 그림만 쓴다.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const sharp = require('/home/jho4255/ArtLink/backend/node_modules/sharp');
const OUT = '/home/jho4255/ArtLink/scratchpad/artlook-review/q/after'; mkdirSync(OUT, { recursive: true });
const WALLS = '/home/jho4255/ArtLink/frontend/public/artlook/walls/';
const UP = +(process.env.UP || 0);            // 실내 사진을 UP 배로 늘려 내보낸다(0 = 그대로)
const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
if (UP) await p.route(/\/artlook\/walls\/wall1[1-7]-[a-z-]+\.jpg/, async (route) => {
  const name = route.request().url().split('/').pop().split('?')[0];
  const src = sharp(readFileSync(WALLS + name)); const m = await src.metadata();
  const buf = await src.resize({ width: Math.round(m.width * UP), kernel: 'lanczos3' }).jpeg({ quality: 92 }).toBuffer();
  await route.fulfill({ body: buf, contentType: 'image/jpeg' });
});
await p.goto('http://localhost:5173/artlook/index.html?preload=all', { waitUntil: 'networkidle' });
await p.waitForTimeout(5000);
await p.evaluate(() => {
  const orig = ArtLookScene.composeScene; window.__ov = null;
  try { ArtLookScene.composeScene = (ctx, W, H, sc, art, ui) => orig(ctx, W, H, sc, art, window.__ov ? { ...ui, ...window.__ov } : ui); window.__patched = true; } catch (e) { window.__patched = String(e); }
  window.__load = (file) => new Promise((res, rej) => { const im = new Image(); im.onload = () => { state.img = capToCanvas(im); res(); }; im.onerror = rej; im.src = '/demo-art/' + file; });
  window.__shot = async (o) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await window.__load(o.work);
    state.frameIdx = FRAMES.findIndex((f) => f.id === o.frame);
    state.sceneIdx = SCENES.findIndex((s) => s.id === o.scene);
    state.matWidth = o.mat == null ? 0.05 : o.mat; state.ratio = o.ratio || '1:1'; state.light = o.light || 0; state.caption = false; state.group = null; state.circle = null;
    state.matteColor = o.matColor || '#f5f2ea'; state.matTexture = 'paper';
    selectedWork = o.size ? { sizeText: o.size } : null;
    const sc = SCENES[state.sceneIdx]; sc.adj = { dx: 0, dy: 0, s: o.zoom || 1 };
    window.__ov = o.ov || null;
    render(); await wait(o.wait || 1300);
    window.__ov = null;
    const cv = document.getElementById('preview'); const pr = window.__artlook || {};
    return { png: cv.toDataURL('image/png'), W: cv.width, H: cv.height, piece: pr.piece ? [pr.piece.x, pr.piece.y, pr.piece.w, pr.piece.h].map(Math.round) : null };
  };
});
console.log('patched:', await p.evaluate(() => window.__patched));
const geo = {};
const run = async (name, o) => {
  const r = await p.evaluate((oo) => window.__shot(oo), o);
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
  geo[`after/${name}`] = { W: r.W, H: r.H, piece: r.piece };
  console.log(name, r.W + 'x' + r.H, r.piece ? `piece ${r.piece[2]}x${r.piece[3]}` : '');
};
const set = process.argv[2] || 'ao';
if (set === 'ao') {
  for (const [scene, work, frame] of [['terracotta', 'quiet-afternoon.jpg', 'oak'], ['white-plaster', 'dawn-window.jpg', 'black'], ['charcoal', 'dawn-window.jpg', 'oak']]) {
    await run(`ao-${scene}-A-now`, { work, frame, scene });
    await run(`ao-${scene}-B-off`, { work, frame, scene, ov: { cornerAO: 0 } });
    await run(`ao-${scene}-C-off-sh15`, { work, frame, scene, ov: { cornerAO: 0, shadow: 1.5 } });
    await run(`ao-${scene}-D-half`, { work, frame, scene, ov: { cornerAO: 0.07, shadow: 1.3 } });
  }
}
if (set === 'zoom') {
  for (const z of [1, 1.35, 1.8]) await run(`zoom-salon-${String(z).replace('.', '_')}`, { work: 'dawn-window.jpg', frame: 'oak', scene: 'gallery-living', zoom: z });
}
if (set === 'res') {
  await run(`res-9x16-up${UP}`, { work: 'dawn-window.jpg', frame: 'oak', scene: 'gallery-living', ratio: '9:16' });
  await run(`res-1x1-up${UP}`, { work: 'dawn-window.jpg', frame: 'oak', scene: 'gallery-living' });
  await run(`res-4x5-up${UP}`, { work: 'dawn-window.jpg', frame: 'oak', scene: 'gallery-living', ratio: '4:5' });
}
if (set === 'presets') {
  const W = process.env.WORK || 'dawn-window.jpg';
  await run('preset-whitecube', { work: W, frame: 'black', scene: 'white-cube', mat: 0.05, matColor: '#ffffff' });
  await run('preset-living', { work: W, frame: 'oak', scene: 'gallery-living', mat: 0.05 });
  await run('preset-charcoal', { work: W, frame: 'floater-oak', scene: 'charcoal', mat: 0.10, light: 0.35 });
  await run('preset-plaster', { work: W, frame: 'white', scene: 'white-plaster', mat: 0.10 });
  await run('preset-burgundy', { work: W, frame: 'gold', scene: 'burgundy', mat: 0.05 });
  await run('preset-brick', { work: W, frame: 'slim-black', scene: 'white-brick', mat: 0 });
  await run('preset-home', { work: W, frame: 'walnut', scene: 'collector-home', mat: 0.05 });
  await run('preset-canvas', { work: W, frame: 'canvas-wrap', scene: 'concrete', mat: 0 });
}
if (set === 'mock') {
  const ov = { cornerAO: 0, shadow: 1.5 }; const W = 'dawn-window.jpg';
  await run('mock-charcoal', { work: W, frame: 'floater-oak', scene: 'charcoal', mat: 0.10, light: 0.35, ov });
  await run('mock-plaster-oak', { work: W, frame: 'oak', scene: 'white-plaster', mat: 0.05, ov });
  await run('mock-living', { work: W, frame: 'oak', scene: 'gallery-living', mat: 0.05, ov });
  await run('mock-whitecube', { work: W, frame: 'black', scene: 'white-cube', mat: 0.05, matColor: '#ffffff', ov });
  await run('mock-p-plaster', { work: W, frame: 'white', scene: 'white-plaster', mat: 0.10, ov });
  await run('mock-p-burgundy', { work: W, frame: 'gold', scene: 'burgundy', mat: 0.05, ov });
  await run('mock-p-brick', { work: W, frame: 'slim-black', scene: 'white-brick', mat: 0, ov });
  await run('mock-p-home', { work: W, frame: 'walnut', scene: 'collector-home', mat: 0.05, ov });
  await run('mock-p-canvas', { work: W, frame: 'canvas-wrap', scene: 'concrete', mat: 0, ov });
  for (const f of ['oak', 'walnut', 'maple', 'black', 'white', 'silver', 'gold']) await run('mock-f-' + f, { work: W, frame: f, scene: 'white-plaster', mat: 0.05, ov });
}
writeFileSync(`/home/jho4255/ArtLink/scratchpad/artlook-review/q/geo-after-${set}${UP || ''}.json`, JSON.stringify(geo, null, 1));
console.log('errors:', errs.length ? [...new Set(errs)].slice(0, 5) : '없음');
await b.close();
