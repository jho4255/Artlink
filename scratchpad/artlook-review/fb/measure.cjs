// 사용자 지적 셋을 잰다(2026-11-18): ①배경마다 작품 화면 크기 ②공간 장면이 얼마나 확대됐나 ③벽 캡션 글자 크기
// 데모 그림 주소만 쓴다(서버 데이터 없음). 출력: 장면마다 [그룹 · 이름 · 작품 긴변% · 작품 면적% · 확대(zoom) · 원본에서 보이는 비율 · 캡션 글자 px]
const pw = require('/home/jho4255/ArtLink/e2e/node_modules/playwright');
const BASE = 'http://localhost:5173';
const W0 = { url: '/demo-art/dawn-window.jpg', title: '새벽 창', artist: '샘플 작가', year: '2024', medium: '캔버스에 유채', kind: 'portfolio', id: 9999 };
const cases = [
  ['크기 모름(30호 가정)', W0],
  ['10호', { ...W0, id: 9998, sizeText: '53.0 × 45.5 cm' }],
  ['100호', { ...W0, id: 9997, sizeText: '162.2 × 130.3 cm' }],
];
(async () => {
  const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [label, work] of cases) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block',
      storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [
        { name: 'artlook:works', value: JSON.stringify([work]) },
        { name: 'artlook:prefs', value: JSON.stringify({ frame: 'oak', caption: true }) },
      ] }] } });
    const p = await ctx.newPage();
    await p.goto(BASE + '/artlook/index.html?preload=all', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => (window.__artlookRenders || 0) >= 1 && document.getElementById('busy').hidden, null, { timeout: 120000 });
    const n = await p.evaluate(() => SCENES.length);
    console.log('\n## ' + label);
    for (let i = 0; i < n; i++) {
      const r0 = await p.evaluate(() => window.__artlookRenders);
      await p.evaluate((i) => { state.sceneIdx = i; window.requestRender(); }, i);
      await p.waitForFunction((r0) => window.__artlookRenders > r0 && document.getElementById('busy').hidden, r0, { timeout: 60000 });
      await p.waitForTimeout(150);
      const r = await p.evaluate(() => {
        const sc = SCENES[state.sceneIdx], a = window.__artlook, cv = document.getElementById('preview');
        const W = cv.width, H = cv.height;
        const f = lastFitNote || {};
        const lab = a && a.label; let labH = null, labW = null;
        if (lab) { const ys = lab.map(q => q[1]), xs = lab.map(q => q[0]); labH = Math.max(...ys) - Math.min(...ys); labW = Math.max(...xs) - Math.min(...xs); }
        return { id: sc.id, name: sc.name, group: sc.group, W, H,
          longPct: a ? +(100 * Math.max(a.front.w, a.front.h) / Math.max(W, H)).toFixed(1) : null,
          areaPct: a ? +(100 * a.front.w * a.front.h / (W * H)).toFixed(1) : null,
          zoom: f.zoom != null ? +f.zoom.toFixed(2) : null, enlarged: f.enlarged,
          labW: labW && +labW.toFixed(0), labH: labH && +labH.toFixed(0), labelPlaced: lastLabelPlaced,
          regionCm: sc.regionCm, maxLong: sc.maxLong };
      });
      console.log(JSON.stringify(r));
    }
    await ctx.close();
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
