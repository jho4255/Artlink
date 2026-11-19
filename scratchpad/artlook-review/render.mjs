// ArtLook 결과물(저장되는 그림) 모아 보기 — 화면이 쓰는 것과 같은 compose 경로. 데모 그림만 쓴다.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const OUT = '/home/jho4255/ArtLink/scratchpad/artlook-review/' + (process.env.OUTQ || 'q');
for (const d of ['frames', 'scenes', 'special']) mkdirSync(`${OUT}/${d}`, { recursive: true });
const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
// Q=cast=1&contact=1&aoclip=0 처럼 엔진의 비교 손잡이를 붙일 수 있다 · OUTQ=폴더 이름(기본 q)
await p.goto('http://localhost:5173/artlook/index.html?preload=all' + (process.env.Q ? '&' + process.env.Q : ''), { waitUntil: 'networkidle' });
await p.waitForTimeout(4500);
await p.evaluate(() => {
  window.__load = (file) => new Promise((res, rej) => { const im = new Image(); im.onload = () => { state.img = capToCanvas(im); res(); }; im.onerror = rej; im.src = '/demo-art/' + file; });
  window.__shot = async (o) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await window.__load(o.work);
    state.frameIdx = FRAMES.findIndex((f) => f.id === o.frame);
    state.sceneIdx = SCENES.findIndex((s) => s.id === o.scene);
    state.matWidth = o.mat == null ? 0.05 : o.mat;
    state.ratio = o.ratio || '1:1'; state.light = o.light || 0; state.caption = !!o.caption;
    state.group = null; state.circle = null;
    if (o.matColor) state.matteColor = o.matColor;
    selectedWork = o.size ? { sizeText: o.size, title: o.title || '긴 여름', artist: '윤서진', year: '2022', medium: '캔버스에 유채' } : (o.caption ? { title: '새벽 창', artist: '윤서진', year: '2024', medium: '캔버스에 유채' } : null);
    for (const k of ['adj', 'sceneAdj']) if (state[k]) { state[k].dx = 0; state[k].dy = 0; state[k].s = 1; }
    render(); await wait(o.wait || 1100);
    const cv = document.getElementById('preview');
    return { png: cv.toDataURL('image/png'), W: cv.width, H: cv.height, probe: window.__artlook || null };
  };
});
const geo = {};
const run = async (dir, name, o) => {
  const r = await p.evaluate((oo) => window.__shot(oo), o);
  writeFileSync(`${OUT}/${dir}/${name}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
  const pc = r.probe && r.probe.piece;
  geo[`${dir}/${name}`] = { W: r.W, H: r.H, piece: pc ? [pc.x, pc.y, pc.w, pc.h].map(Math.round) : null, rail: r.probe ? Math.round(r.probe.railPx) : null };
  console.log(dir, name, r.W + 'x' + r.H, pc ? `piece ${Math.round(pc.w)}x${Math.round(pc.h)} (${(100 * Math.max(pc.w / r.W, pc.h / r.H)).toFixed(0)}%)` : '');
};
const lists = await p.evaluate(() => ({ frames: FRAMES.filter((f) => !f.hidden).map((f) => f.id), scenes: SCENES.map((s) => s.id) }));
const which = process.argv[2] || 'all';
if (which === 'all' || which === 'frames') for (const f of lists.frames) await run('frames', f, { work: 'dawn-window.jpg', frame: f, scene: 'white-plaster', mat: f === 'canvas-wrap' ? 0 : 0.05 });
if (which === 'all' || which === 'scenes') for (const s of lists.scenes) await run('scenes', s, { work: 'quiet-afternoon.jpg', frame: 'oak', scene: s });
if (which === 'all' || which === 'special') {
  await run('special', 'default-first', { work: 'long-summer.jpg', frame: 'oak', scene: 'gallery-salon', size: '130.3×162.2cm' });
  await run('special', 'small-10ho-salon', { work: 'small-room.jpg', frame: 'oak', scene: 'gallery-salon', size: '53.0×45.5cm' });
  await run('special', 'small-10ho-wall', { work: 'small-room.jpg', frame: 'oak', scene: 'white-plaster', size: '53.0×45.5cm' });
  await run('special', 'unknown-salon', { work: 'dawn-window.jpg', frame: 'oak', scene: 'gallery-salon' });
  await run('special', 'unknown-collector-home', { work: 'dawn-window.jpg', frame: 'walnut', scene: 'collector-home' });
  await run('special', 'unknown-whitecube', { work: 'dawn-window.jpg', frame: 'black', scene: 'white-cube' });
  await run('special', 'nomat-black-charcoal', { work: 'city-walk.jpg', frame: 'black', scene: 'charcoal', mat: 0 });
  await run('special', 'widemat-white-concrete', { work: 'square-garden.jpg', frame: 'white', scene: 'concrete', mat: 0.10 });
  await run('special', 'canvas-redbrick', { work: 'red-hill.jpg', frame: 'canvas-wrap', scene: 'red-brick', mat: 0 });
  await run('special', 'floater-oak-nomat-olive', { work: 'water-memory.jpg', frame: 'floater-oak', scene: 'olive', mat: 0 });
  await run('special', 'gold-burgundy', { work: 'forgotten-alley.jpg', frame: 'gold', scene: 'burgundy' });
  await run('special', 'light60-charcoal', { work: 'dawn-window.jpg', frame: 'oak', scene: 'charcoal', light: 0.6 });
  await run('special', 'ratio-4x5-salon', { work: 'dawn-window.jpg', frame: 'oak', scene: 'gallery-salon', ratio: '4:5' });
  await run('special', 'ratio-9x16-living', { work: 'dawn-window.jpg', frame: 'oak', scene: 'gallery-living', ratio: '9:16' });
  await run('special', 'ratio-16x9-hotel', { work: 'horizon.jpg', frame: 'black', scene: 'hotel-lounge', ratio: '16:9' });
  await run('special', 'caption-plaster', { work: 'dawn-window.jpg', frame: 'oak', scene: 'white-plaster', caption: true });
  await run('special', 'pano-wall', { work: 'horizon.jpg', frame: 'oak-thin', scene: 'sand' });
}
writeFileSync(`${OUT}/geo-${which}.json`, JSON.stringify(geo, null, 1));
console.log('errors:', errs.length ? [...new Set(errs)].slice(0, 5) : '없음');
await b.close();
