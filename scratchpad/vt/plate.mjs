// 판(buildFramed 캔버스)만 뽑아 살→작품 단면을 본다 — 장면 합성 이전이라
// 이음매의 밝은 선이 **판에서 생기는지** 합성에서 생기는지 가른다.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 860 } });
await p.goto('http://localhost:5173/artlook/index.html' + (process.env.Q ? '?' + process.env.Q : ''), { waitUntil: 'networkidle' });
await p.waitForTimeout(3500);
const out = await p.evaluate(async (names) => {
  const load = (f) => new Promise((res, rej) => { const im = new Image();
    im.onload = () => { state.img = capToCanvas(im); res(); }; im.onerror = rej; im.src = '/demo-art/' + f; });
  await load('water-memory.jpg');
  const r = {};
  for (const n of names) {
    const fi = FRAMES.findIndex((f) => f.name === n);
    state.frameIdx = fi; state.matWidth = 0;
    const c = buildFramed(state.img);
    const x = c.getContext('2d');
    const y = Math.round(c.height / 2);
    const L = lastFrameLayout;
    const w = Math.round(L.x) + 8;
    const d = x.getImageData(0, y, w, 1).data;
    const v = [];
    for (let i = 0; i < w; i++) v.push(+(d[i*4]*.2126 + d[i*4+1]*.7152 + d[i*4+2]*.0722).toFixed(1));
    r[n] = { rail: Math.round(L.x), prof: v.slice(-24) };
  }
  return r;
}, ['오크 슬림', '월넛 슬림', '오크']);
for (const [k, v] of Object.entries(out))
  console.log(`${k}  살 ${v.rail}px   판 단면(작품 경계 8px 전후):\n   ${v.prof.join(' ')}`);
await b.close();
