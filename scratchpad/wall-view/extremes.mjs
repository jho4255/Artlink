// 아주 길쭉한 실제 작품(세로 0.5배 · 가로 2배)을 벽 보기로 바로 연다 — 9:16 · 16:9 캔버스에서 잘리지 않는지(복제본 서버)
//   HANDLES=<가장 세로로 긴 작품이 있는 작가 핸들>,<가장 가로로 긴 작품이 있는 작가 핸들> APP=<복제본 프론트> node scratchpad/wall-view/extremes.mjs
//   ⚠️ 실제 작가 핸들을 이 파일에 적지 말 것(저장소에 남는다) — 실행할 때 넘긴다. 결과 캡처(out/)는 .gitignore.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
const APP = process.env.APP || 'http://localhost:5183';
const OUT = new URL('./out/', import.meta.url).pathname;
const pickWork = async (handle, cmp) => {
  const { id } = await (await fetch(`${APP}/api/handles/${handle}`)).json();
  const d = await (await fetch(`${APP}/api/portfolio/${id}`)).json();
  const ims = d.images.filter((i) => i.width && i.height).map((i) => ({ id: i.id, a: i.width / i.height }));
  return ims.sort((x, y) => cmp(x.a, y.a))[0];
};
const handles = (process.env.HANDLES || '').split(',').map((h) => h.trim().replace(/^@/, '')).filter(Boolean);
if (handles.length !== 2) { console.error('HANDLES=세로작가,가로작가 를 넘겨 주세요'); process.exit(2); }
const cases = [[handles[0], (a, b) => a - b], [handles[1], (a, b) => b - a]];
const b = await pw.chromium.launch();
for (const [handle, cmp] of cases) {
  const w = await pickWork(handle, cmp);
  for (const [name, vp] of [['pc', { viewport: { width: 1280, height: 800 } }], ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }]]) {
    const ctx = await b.newContext(vp);
    await ctx.addInitScript(() => { try { sessionStorage.setItem('artlink-artwork-view', 'wall'); } catch {} });
    await ctx.route(/\/api\/(guest-activity|visits)/, (r) => r.fulfill({ status: 204, body: '' }));
    const p = await ctx.newPage();
    await p.goto(`${APP}/@${handle}?work=${w.id}`);
    const img = p.locator('[data-view="wall"][data-quality="full"]');
    await img.waitFor({ timeout: 60000 });
    const nat = await img.evaluate((el) => [el.naturalWidth, el.naturalHeight]);
    const piece = await p.evaluate(() => {
      const f = document.querySelector('iframe[data-wall-view]');
      const g = f && f.contentWindow && f.contentWindow.__artlook;
      return g ? { piece: g.piece, canvas: [f.contentWindow.document.getElementById('preview').width, f.contentWindow.document.getElementById('preview').height] } : null;
    });
    console.log(`${handle} 작품 ${w.id} 비율 ${w.a.toFixed(2)} · ${name} → 벽 그림 ${nat.join('×')}`, piece ? `· 조각 ${Math.round(piece.piece.x)},${Math.round(piece.piece.y)} ${Math.round(piece.piece.w)}×${Math.round(piece.piece.h)} / 캔버스 ${piece.canvas.join('×')}` : '');
    await p.screenshot({ path: `${OUT}extreme-${handle}-${name}.png` });
    await ctx.close();
  }
}
await b.close();
