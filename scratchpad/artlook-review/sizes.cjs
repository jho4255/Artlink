// 크기 칩 확인 — 크기를 적지 않은 작품(데모 그림 주소)으로 ArtLook 단독 페이지를 연다. 서버 데이터를 쓰지 않는다.
const pw = require('/home/jho4255/ArtLink/e2e/node_modules/playwright');
const BASE = 'http://localhost:5173';
(async () => {
  const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 664 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block',
    storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [
      { name: 'artlook:works', value: JSON.stringify([{ url: '/demo-art/dawn-window.jpg', title: '새벽 창', artist: '샘플', kind: 'portfolio', id: 9999 },
                                                      { url: '/demo-art/red-hill.jpg', title: '붉은 언덕', artist: '샘플', kind: 'portfolio', id: 9998, sizeText: '53.0 × 45.5 cm' }]) },
      { name: 'artlook:prefs', value: JSON.stringify({ scene: 'white-plaster', frame: 'oak' }) },
    ] }] } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(BASE + '/artlook/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => (window.__artlookRenders || 0) >= 1 && document.getElementById('busy').hidden, null, { timeout: 90000 });
  const snap = async (tag) => { await p.waitForTimeout(900); const r = await p.evaluate(() => ({
    renders: window.__artlookRenders, piece: window.__artlook && window.__artlook.piece && [window.__artlook.piece.w, window.__artlook.piece.h].map(Math.round),
    line: document.getElementById('worksLine').textContent, sizesHidden: document.getElementById('sizes').hidden,
    pressed: [...document.querySelectorAll('#sizes [aria-pressed=true]')].map((x) => x.textContent), saved: localStorage.getItem('artlook:sizes') })); console.log(tag, JSON.stringify(r)); return r; };
  await p.click('#tab-works');
  await snap('처음(크기 없음)');
  for (const k of ['10호', '30호', '100호']) { await p.click(`#sizes button:has-text("${k}")`); await snap(k); }
  await p.screenshot({ path: 'shots2/sizes-100.png' });
  await p.click('#sizes button:has-text("100호")'); await snap('100호 다시 → 빼기');
  await p.click('#sizes [data-kind=custom]'); await p.waitForTimeout(300);
  await p.fill('#sizeH', '2000'); await p.fill('#sizeW', '50'); await p.click('#sizeOk'); await p.waitForTimeout(300);
  console.log('잘못된 값', await p.evaluate(() => ({ err: document.getElementById('sizeErr').textContent, open: !document.getElementById('sizeSheet').hidden })));
  await p.screenshot({ path: 'shots2/sizes-sheet.png' });
  await p.fill('#sizeH', '72,7'); await p.fill('#sizeW', '60.6'); await p.click('#sizeOk'); await snap('직접 72.7×60.6');
  // 크기가 있는 작품으로 바꾸면 칩 줄이 없다
  await p.click('#works [data-i="1"]'); await snap('크기 있는 작품');
  // 다시 첫 작품 — 고른 크기가 남아 있다
  await p.click('#works [data-i="0"]'); await snap('첫 작품으로 돌아옴');
  await p.reload(); await p.waitForFunction(() => (window.__artlookRenders || 0) >= 1 && document.getElementById('busy').hidden, null, { timeout: 90000 });
  await p.click('#tab-works'); await snap('새로고침 뒤');
  console.log('errors', errs);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
