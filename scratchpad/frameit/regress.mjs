// HEAD(커밋된 ArtLook) ↔ 작업 트리 — 같은 입력으로 모든 액자를 그려 픽셀 비교 (2026-10-26)
//   node scratchpad/frameit/regress.mjs && python3 scratchpad/frameit/regress.py
// HEAD 사본은 scratchpad/frameit/base/ (git archive) — 실행할 때마다 다시 푼다. 정적 서버 5291 = HEAD · 5292 = 작업 트리
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { execSync } from 'node:child_process';
const R = '/home/jho4255/ArtLink/'; const D = R + 'scratchpad/frameit/';
fs.rmSync(D + 'base', { recursive: true, force: true }); fs.mkdirSync(D + 'base', { recursive: true });
execSync(`git -C ${R} archive HEAD frontend/public/artlook frontend/public/demo-art | tar -x -C ${D}base`);
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const serve = (root, port) => new Promise((r) => http.createServer((q, s) => { const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); }).listen(port, '127.0.0.1', r));
await serve(D + 'base/frontend/public', 5291); await serve(R + 'frontend/public', 5292);
const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const pages = {};
for (const [k, port] of [['base', 5291], ['now', 5292]]) {
  const p = await b.newPage({ viewport: { width: 1000, height: 800 } });
  await p.goto(`http://127.0.0.1:${port}/artlook/index.html?preload=all`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(4000); pages[k] = p;
}
const ids = await pages.base.evaluate(() => FRAMES.map((f) => f.id));
fs.rmSync(D + 'png', { recursive: true, force: true }); fs.mkdirSync(D + 'png', { recursive: true });
let k = 0, lost = 0;
for (const scene of ['charcoal', 'gallery-salon', 'terracotta']) for (const mat of [0, 0.05]) for (const id of ids) {
  for (const side of ['base', 'now']) {
    const r = await pages[side].evaluate(async ({ id, scene, mat }) => {
      if (!window.__vtArt) window.__vtArt = await new Promise((res) => { const im = new Image(); im.onload = () => res(capToCanvas(im)); im.src = '/demo-art/quiet-afternoon.jpg'; });
      Object.assign(state, { img: window.__vtArt, mode: 'scene', sceneIdx: SCENES.findIndex((s) => s.id === scene), frameIdx: FRAMES.findIndex((f) => f.id === id),
        matWidth: mat, matteColor: '#f5f2ea', light: 0, glass: false, weave: false, ratio: '4:5', draft: false, watermark: false });
      selectedWork = null; const sc = SCENES[state.sceneIdx]; sc.adj = { dx: 0, dy: 0, s: 1 };
      const c = compose();
      return { png: c.toDataURL('image/png').split(',')[1], lost: !!(ArtLookScene.glLost && ArtLookScene.glLost()) };
    }, { id, scene, mat });
    if (r.lost) lost++;
    fs.writeFileSync(`${D}png/${scene}_${mat}_${id}_${side}.png`, Buffer.from(r.png, 'base64'));
  }
  if (++k % 20 === 0) console.log(k);
}
await b.close(); console.log('WebGL 잃음', lost); process.exit(0);
