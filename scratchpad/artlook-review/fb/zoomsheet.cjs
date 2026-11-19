// 공간 장면 7개를 카메라 당김(zoom) 세 단계로 그려 나란히 — 1.0(방 전체) · 1.15 · 지금(1.34)
const pw = require('/home/jho4255/ArtLink/e2e/node_modules/playwright');
const BASE = 'http://localhost:5173';
const W0 = { url: '/demo-art/dawn-window.jpg', title: '새벽 창', artist: '샘플 작가', year: '2024', medium: '캔버스에 유채', kind: 'portfolio', id: 9999 };
(async () => {
  const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block',
    storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [
      { name: 'artlook:works', value: JSON.stringify([W0]) },
      { name: 'artlook:prefs', value: JSON.stringify({ frame: 'oak' }) },
    ] }] } });
  const p = await ctx.newPage();
  await p.goto(BASE + '/artlook/index.html?preload=all', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => (window.__artlookRenders || 0) >= 1 && document.getElementById('busy').hidden, null, { timeout: 120000 });
  // 카메라 당김 상한만 바꿔 끼운다(엔진 수정 없이) — ui.maxZoomCap 를 흉내 내려고 maxSrcScale 를 그 비율로 줄인다
  await p.evaluate(() => {
    const orig = ArtLookScene.composeScene;
    ArtLookScene.composeScene = function (ctx, W, H, sc, art, ui) {
      if (window.__zoomMul != null && sc.group === 'space') ui = Object.assign({}, ui, { maxSrcScale: ui.maxSrcScale * window.__zoomMul });
      return orig.call(this, ctx, W, H, sc, art, ui);
    };
  });
  const idx = await p.evaluate(() => SCENES.map((s, i) => [i, s.id, s.group]).filter((x) => x[2] === 'space'));
  for (const [i, id] of idx) {
    for (const [tag, mul] of [['z100', 1 / 1.34], ['z115', 1.15 / 1.34], ['z134', null]]) {
      const r0 = await p.evaluate(() => window.__artlookRenders);
      await p.evaluate(([i, mul]) => { window.__zoomMul = mul; state.sceneIdx = i; window.requestRender(); }, [i, mul]);
      await p.waitForFunction((r0) => window.__artlookRenders > r0 && document.getElementById('busy').hidden, r0, { timeout: 60000 });
      await p.waitForTimeout(200);
      const info = await p.evaluate(() => ({ zoom: lastFitNote && lastFitNote.zoom, long: window.__artlook && Math.max(__artlook.front.w, __artlook.front.h) / document.getElementById('preview').width }));
      const data = await p.evaluate(() => document.getElementById('preview').toDataURL('image/jpeg', 0.85));
      require('fs').writeFileSync(`zoom/${id}-${tag}.jpg`, Buffer.from(data.split(',')[1], 'base64'));
      console.log(id, tag, JSON.stringify(info));
    }
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
