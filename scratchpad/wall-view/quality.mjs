// [벽에 걸어 보기] 화질 대조 — 작품 창이 실제로 쓰는 길(view.js render)로 초안·완성을 그리고, 같은 상태의 아트룩 탭 저장 합성(배율 2·capToCanvas, PNG)과 맞댄다.
//   OUT=<폴더> node scratchpad/wall-view/quality.mjs   (SRC=작품 원본 주소 · 실서버 복제본 5173 이 떠 있어야 한다)
//   그다음 PIL 로 평균 차이를 잰다(2026-10-23: 완성 1~2 단계 = JPEG 압축 정도 · 초안 3 단계). 낮은 배율로 되돌리면 이 차이가 커진다.
// ⚠️ 2026-10-23 '아트룩보다 퀄리티가 개쓰레기' — 완성 배율 1 · 초안 0.6 이던 때. 그 뒤로 완성 2 · 초안 1.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { writeFileSync } from 'node:fs';
const OUT = process.env.OUT;
const ORIG = process.env.SRC;   // 작품 원본 주소 — 실제 작품 주소를 이 파일에 적지 말 것(실행할 때 넘긴다)
if (!ORIG) { console.error('SRC=<작품 원본 주소> 를 넘겨 주세요'); process.exit(2); }
const T800 = ORIG.replace('/artlink/', '/artlink/t800/');
const browser = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto('http://localhost:5173/artlook/index.html?view=1');
await page.waitForFunction(() => window.__wallView && window.__wallView.state().ready, null, { timeout: 30000 });
const save = (name, b64) => writeFileSync(`${OUT}/${name}`, Buffer.from(b64, 'base64'));
const r = await page.evaluate(async ({ ORIG, T800 }) => {
  const get = async (u) => (await fetch(u, { cache: 'reload' })).blob();
  const b64 = (blob) => new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
  const out = {};
  for (const [name, src, ss] of [['draft', T800, 1], ['full', ORIG, 2]]) {
    const blob = await get(src);
    const t = performance.now();
    const res = await window.__wallView.render(blob, ss);
    out[name] = { ms: Math.round(performance.now() - t), size: res.size, b64: await b64(res.blob) };
  }
  // 아트룩 탭 저장과 같은 합성 — 같은 상태에서 배율 2 로 직접(PNG)
  const bmp = await createImageBitmap(await get(ORIG));
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0);
  state.img = capToCanvas(c); state.draft = false;
  const o = compose();
  out.artlook = { b64: o.toDataURL('image/png').split(',')[1] };
  return out;
}, { ORIG, T800 });
save('v-draft.jpg', r.draft.b64); save('v-full.jpg', r.full.b64); save('v-artlook.png', r.artlook.b64);
console.log('초안', r.draft.ms + 'ms', r.draft.size.join('×'), '· 완성', r.full.ms + 'ms', r.full.size.join('×'));
await browser.close();
