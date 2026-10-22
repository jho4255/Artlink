import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { writeFileSync } from 'node:fs';
const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
const reqs = [];
p.on('request', r => reqs.push(r.url()));
const t0 = Date.now();
await p.goto('http://localhost:5191/artlook/index.html?embed=1', { waitUntil: 'networkidle' });
await p.waitForFunction(() => (window.__artlookRenders || 0) >= 1, null, { timeout: 60000 });
console.log('first paint(default prefs, demo work) ms', Date.now() - t0);
console.log('artlook requests', reqs.filter(u => u.includes('/artlook/')).map(u => u.replace('http://localhost:5191', '')).join(' '));
await p.evaluate(() => {
  window.__load = (file) => new Promise((res, rej) => { const im = new Image(); im.onload = () => { state.img = capToCanvas(im); res(); }; im.onerror = rej; im.src = '/demo-art/' + file; });
});
const cases = [
  { scene: 'white-cube', frame: 'canvas-wrap', ratio: '4:5' },
  { scene: 'white-plaster', frame: 'canvas-wrap', ratio: '4:5' },
  { scene: 'white-plaster', frame: 'oak-thin', ratio: '4:5' },
  { scene: 'sand', frame: 'canvas-wrap', ratio: '16:9' },
];
for (const c of cases) {
  const r = await p.evaluate(async (cc) => {
    await window.__load('dawn-window.jpg');
    state.mode = 'scene';
    state.frameIdx = FRAMES.findIndex(f => f.id === cc.frame);
    state.sceneIdx = SCENES.findIndex(s => s.id === cc.scene);
    state.ratio = cc.ratio; selectedWork = null;
    const sc = SCENES[state.sceneIdx];
    const tl = performance.now();
    await new Promise(res => { if (ArtLookScene.ensureScene(sc, () => { if (ArtLookScene.sceneReady(sc)) res(); })) res(); });
    if (cc.frame !== 'canvas-wrap') { await new Promise(res => { const tick = () => frameAssetsReady(FRAMES[state.frameIdx]) ? res() : setTimeout(tick, 50); ensureFrameAssets(FRAMES[state.frameIdx]); tick(); }); }
    const loadMs = performance.now() - tl;
    const out = {};
    for (const draft of [true, false]) {
      state.draft = draft;
      const t = performance.now(); compose(); out[draft ? 'ss1' : 'ss2'] = Math.round(performance.now() - t);
    }
    const pv = document.getElementById('preview');
    return { loadMs: Math.round(loadMs), out: [pv.width, pv.height], ...out, scenePx: [sc.img.naturalWidth, sc.img.naturalHeight], png: pv.toDataURL('image/jpeg', 0.9) };
  }, c);
  writeFileSync(`view-${c.scene}-${c.frame}.jpg`, Buffer.from(r.png.split(',')[1], 'base64'));
  console.log(c.scene, c.frame, c.ratio, 'scene', r.scenePx, 'load', r.loadMs, 'ms · out', r.out, '· compose SS1', r.ss1, 'ms · SS2', r.ss2, 'ms');
}
await b.close();
