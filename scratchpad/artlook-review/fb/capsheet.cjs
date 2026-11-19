// 벽 캡션 — 작품 셋(세로·가로·아주 가로) × 장면 넷(벽 둘·공간 둘), 캡션 켬/끔 — 작품 자리가 같은지, 카드가 읽히는지
const pw = require('/home/jho4255/ArtLink/e2e/node_modules/playwright');
const fs = require('fs');
const BASE = 'http://localhost:5173';
const OUT = process.env.OUT || 'cap';
const works = [
  { url: '/demo-art/dawn-window.jpg', title: '새벽 창', artist: '윤서진', year: '2024', medium: '캔버스에 유채', kind: 'portfolio', id: 9001 },
  { url: '/demo-art/long-summer.jpg', title: '긴 여름', artist: '윤서진', year: '2023', medium: '캔버스에 아크릴', sizeText: '72.7 × 90.9 cm', kind: 'portfolio', id: 9002 },
  { url: '/demo-art/horizon.jpg', title: '수평선 너머의 오후', artist: '윤서진', year: '2022', medium: '장지에 먹, 채색', kind: 'portfolio', id: 9003 },
];
const scenes = ['charcoal', 'white-plaster', 'gallery-living', 'white-cube'];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block',
    storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [
      { name: 'artlook:works', value: JSON.stringify(works) },
      { name: 'artlook:prefs', value: JSON.stringify({ frame: 'oak' }) },
    ] }] } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(BASE + '/artlook/index.html?preload=all', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => (window.__artlookRenders || 0) >= 1 && document.getElementById('busy').hidden, null, { timeout: 120000 });
  const render = async (fn, arg) => {
    const r0 = await p.evaluate(() => window.__artlookRenders);
    await p.evaluate(fn, arg);
    await p.waitForFunction((r0) => window.__artlookRenders > r0 && document.getElementById('busy').hidden, r0, { timeout: 60000 });
    await p.waitForTimeout(150);
  };
  for (let wi = 0; wi < works.length; wi++) {
    await p.click(`#tab-works`); await p.click(`#works .chip.work[data-i="${wi}"]`); await p.waitForTimeout(400);
    for (const sid of scenes) {
      for (const cap of [false, true]) {
        await render(([sid, cap]) => { state.sceneIdx = SCENES.findIndex((s) => s.id === sid); state.caption = cap; window.requestRender(); }, [sid, cap]);
        const info = await p.evaluate(() => ({ front: window.__artlook && window.__artlook.front, label: window.__artlook && window.__artlook.label, placed: lastLabelPlaced, zoom: lastFitNote && lastFitNote.zoom }));
        const data = await p.evaluate(() => document.getElementById('preview').toDataURL('image/jpeg', 0.88));
        fs.writeFileSync(`${OUT}/w${wi}-${sid}-${cap ? 'on' : 'off'}.jpg`, Buffer.from(data.split(',')[1], 'base64'));
        const f = info.front; const cx = f && Math.round(f.x + f.w / 2);
        console.log(wi, sid, cap ? 'on ' : 'off', 'centerX', cx, 'front', f && [f.x, f.y, f.w, f.h].map(Math.round).join(','), 'label', info.label ? info.label.map((q) => q.map(Math.round).join(':')).join(' ') : info.placed, 'zoom', info.zoom && info.zoom.toFixed(2));
      }
    }
  }
  console.log('errors', errs);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
