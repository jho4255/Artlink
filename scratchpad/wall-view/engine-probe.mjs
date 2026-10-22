// [벽에 걸어 보기] 엔진 측정 — view.js 를 주소로 직접 열어 window.__wallView.render 로 그린다(바깥 창 없이 같은 길).
//   cd frontend && npx vite --port 5191 --strictPort   (다른 창)
//   node scratchpad/wall-view/engine-probe.mjs          → scratchpad/wall-view/out/probe-*.jpg + 표
// GPU 가 없는 헤드리스(SwiftShader)라 시간은 비관적이다 — 실기기는 따로 잴 것.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { mkdirSync, writeFileSync } from 'node:fs';

const APP = process.env.APP || 'http://localhost:5191';
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const WORKS = [
  ['portrait', 'dawn-window.jpg'],      // 세로
  ['landscape', 'long-summer.jpg'],     // 가로
  ['square', 'square-garden.jpg'],      // 정사각
  ['panorama', 'horizon.jpg'],          // 아주 넓은 가로
];

const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
const t0 = Date.now();
await p.goto(`${APP}/artlook/index.html?view=1`, { waitUntil: 'load' });
await p.waitForFunction(() => window.__wallView && window.__wallView.state().ready, null, { timeout: 60000 });
console.log('준비까지', Date.now() - t0, 'ms ·', await p.evaluate(() => JSON.stringify(window.__wallView.state())));

for (const depth of [null, 0]) {
  for (const [name, file] of WORKS) {
    for (const [label, src, ss] of [['draft800', 800, 1], ['full', 0, 1], ['full-ss2', 0, 2]]) {
      if (depth === 0 && label !== 'full') continue;
      const r = await p.evaluate(async ({ file, src, ss, depth }) => {
        if (window.__origDepth === undefined) window.__origDepth = SCENES[0].depth;
        SCENES[0].depth = depth === null ? window.__origDepth : depth;
        const raw = await (await fetch('/demo-art/' + file)).blob();
        let blob = raw;
        if (src) {       // t800 흉내 — 긴 변 800px 로 줄인다
          const bm = await createImageBitmap(raw);
          const s = src / Math.max(bm.width, bm.height);
          const c = document.createElement('canvas'); c.width = Math.round(bm.width * s); c.height = Math.round(bm.height * s);
          c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
          blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
        }
        // 메인 스레드가 얼마나 오래 막히는지 — 16ms 타이머가 얼마나 늦게 오는지로 잰다
        let worst = 0, last = performance.now();
        const iv = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last); last = n; }, 16);
        const t = performance.now();
        const out = await window.__wallView.render(blob, ss);
        const ms = performance.now() - t;
        clearInterval(iv);
        const fr = new FileReader();
        const data = await new Promise((res) => { fr.onload = () => res(fr.result); fr.readAsDataURL(out.blob); });
        return { ms: Math.round(ms), worst: Math.round(worst), ratio: out.ratio, size: out.size, kb: Math.round(out.blob.size / 1024), data, art: window.__artlook && window.__artlook.piece };
      }, { file, src, ss, depth });
      const tag = `${name}-${label}${depth === 0 ? '-flat' : ''}`;
      writeFileSync(`${OUT}probe-${tag}.jpg`, Buffer.from(r.data.split(',')[1], 'base64'));
      console.log(tag.padEnd(28), String(r.ms).padStart(5), 'ms · 가장 길게 멈춤', String(r.worst).padStart(5), 'ms ·', r.ratio, r.size.join('×'), `${r.kb}KB`, r.art ? `조각 ${JSON.stringify(r.art)}` : '');
    }
  }
}
await b.close();
