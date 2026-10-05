/**
 * ArtLook 화면 하니스 (2026-10-04, CLAUDE.md 규칙 65) — 크롬 + 사파리 엔진(WebKit) × 8화면.
 *
 * E2E(`e2e/tests/69-artlook-ux.spec.ts`)는 크롬 한 엔진·두 화면으로 **로직**을 보고, 여기는 **기하·무게**를 본다.
 *   cd e2e && PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 node ../scratchpad/artlook-ux/walk.js
 *   ENGINE=chromium|webkit  SCREEN=iphone13,se  SHOTS=1(스크린샷 out/)  VERBOSE=1(통과한 줄도)
 *   BASE=http://localhost:5183 API=http://localhost:4001/api   (기본 — 데모 DB 로 띄운 서버)
 * 계정은 데모 DB 의 `maker.walk@demo.artlink.local`(작품 12점, 진짜 업로드 — 썸네일이 있다). **아무것도 쓰지 않는다**
 * (저장은 내려받기만, ArtStory 로 올리기는 누르지 않는다). 복제본(실서버 사본)으로 띄운 서버에는 그 계정이 없어 로그인에서 멈춘다.
 * 사파리 엔진은 `bash scratchpad/hero/setup-webkit.sh` 로 한 번 준비(~/.cache/wk-deps/run.sh).
 */
const fs = require('fs');
const path = require('path');
const pw = require(path.resolve(__dirname, '../../e2e/node_modules/playwright'));

const BASE = process.env.BASE || 'http://localhost:5183';
const API = process.env.API || 'http://localhost:4001/api';
const OUT = path.join(__dirname, 'out');
const WEBKIT_RUN = path.join(process.env.HOME, '.cache/wk-deps/run.sh');
const EMAIL = process.env.EMAIL || 'maker.walk@demo.artlink.local';
const VERBOSE = !!process.env.VERBOSE, SHOTS = !!process.env.SHOTS;

// 바깥 높이 = 그 기기의 브라우저 안쪽 높이(주소창 등을 뺀)
const SCREENS = {
  pc1280: { viewport: { width: 1280, height: 800 }, min: 420 },
  pc1440: { viewport: { width: 1440, height: 900 }, min: 520 },
  pc1024: { viewport: { width: 1024, height: 768 }, min: 260 },
  ipad: { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, min: 380 },
  pixel7: { viewport: { width: 412, height: 839 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, min: 300 },
  iphone13: { viewport: { width: 390, height: 664 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, min: 200 },
  galaxy360: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, min: 250 },
  se: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, min: 130 },
};

let fails = 0, passes = 0;
const rows = [];
function check(tag, name, ok, info = '') {
  if (ok) { passes++; if (VERBOSE) console.log(`  ✓ ${tag} ${name}${info ? ' — ' + info : ''}`); }
  else { fails++; console.log(`  ✗ ${tag} ${name}${info ? ' — ' + info : ''}`); }
}

async function devLogin() {
  const r = await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL }) });
  if (!r.ok) throw new Error(`로그인 실패 ${r.status} — 데모 DB 서버(${API})가 떠 있고 ${EMAIL} 계정이 있는지 볼 것`);
  return r.json();
}

async function run(engineName, screenName, acc) {
  const tag = `[${engineName === 'webkit' ? 'WK' : 'CR'} ${screenName}]`;
  const s = { ...SCREENS[screenName] }; const min = s.min; delete s.min;
  if (engineName === 'webkit') delete s.isMobile;
  const browser = await pw[engineName].launch(engineName === 'webkit' ? { executablePath: WEBKIT_RUN } : {});
  const ctx = await browser.newContext({ ...s, serviceWorkers: 'block', acceptDownloads: true, storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [{ name: 'artlink-auth', value: JSON.stringify({ state: { token: acc.token, user: acc.user, isAuthenticated: true }, version: 0 }) }] }] } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  const dialogs = []; page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss().catch(() => {}); });
  const reqs = []; page.on('requestfinished', async (r) => { try { reqs.push({ u: r.url(), b: (await r.sizes()).responseBodySize }); } catch { reqs.push({ u: r.url(), b: 0 }); } });
  const t0 = Date.now();
  await page.goto(`${BASE}/mypage?tab=artlook`, { waitUntil: 'domcontentloaded' });
  const h = await page.waitForSelector('iframe[title="ArtLook"]', { state: 'attached', timeout: 60000 });
  const frame = await h.contentFrame();
  await frame.waitForFunction(() => (window.__artlookRenders || 0) >= 1 && document.getElementById('busy').hidden, null, { timeout: 90000 });
  const firstMs = Date.now() - t0;
  await page.waitForTimeout(2500);

  // ① 첫 화면
  const floor = await page.evaluate(() => { const b = document.querySelector('nav[aria-label="하단 내비게이션"]'); return b && getComputedStyle(b).display !== 'none' ? b.getBoundingClientRect().top : innerHeight; });
  const ifr = await page.locator('iframe[title="ArtLook"]').boundingBox();
  const inner = (sel) => frame.locator(sel).evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const cv = await inner('#preview'); const dl = await inner('#dl');
  const o = (r) => ({ x: ifr.x + r.x, y: ifr.y + r.y, w: r.w, h: r.h });
  const ocv = o(cv), odl = o(dl);
  check(tag, 'iframe 이 하단 탭바 위에서 끝난다', ifr.y + ifr.height <= floor + 1, `bottom ${Math.round(ifr.y + ifr.height)} / 바닥 ${Math.round(floor)}`);
  check(tag, '미리보기가 첫 화면 안에 통째로', ocv.y >= 0 && ocv.y + ocv.h <= floor + 0.5, `y ${Math.round(ocv.y)}~${Math.round(ocv.y + ocv.h)}`);
  check(tag, `미리보기 짧은 변 ≥ ${min}px`, Math.min(ocv.w, ocv.h) >= min, `${Math.round(ocv.w)}×${Math.round(ocv.h)}`);
  check(tag, '[이미지 저장]이 첫 화면 안', odl.y >= 0 && odl.y + odl.h <= floor + 0.5, `y ${Math.round(odl.y)}`);
  const hit = await frame.evaluate(() => { const b = document.getElementById('dl').getBoundingClientRect(); const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return t && t.id; });
  const ohit = await page.evaluate(([x, y]) => { const t = document.elementFromPoint(x, y); return t && t.tagName; }, [odl.x + odl.w / 2, odl.y + odl.h / 2]);
  check(tag, '[이미지 저장] 자리를 누르면 저장 단추', hit === 'dl' && ohit === 'IFRAME', `${ohit}/${hit}`);
  const ox = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const ix = await frame.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(tag, '가로로 밀리지 않는다(바깥·안)', ox <= 0 && ix <= 0, `${ox}/${ix}`);

  // ② 무게·그리기
  const renders = await frame.evaluate(() => window.__artlookRenders);
  check(tag, '열 때 2번 이하로 그린다', renders <= 2, `${renders}번`);
  const art = reqs.filter((r) => r.u.includes('/artlook/'));
  const walls = art.filter((r) => /\/artlook\/walls\/(?!thumbs\/)/.test(r.u));
  const photos = art.filter((r) => /\/artlook\/frames\/photo\/[^/]+\.png/.test(r.u));
  const originals = reqs.filter((r) => /\/uploads\/(?!t240\/|t800\/)[^/?]+\.(jpe?g|png|webp)/i.test(r.u));
  check(tag, '벽 사진 원본은 고른 배경 하나', walls.length <= 1, `${walls.length}장`);
  check(tag, '액자 사진은 고른 액자 하나', photos.length <= 1, `${photos.length}장`);
  check(tag, '작품 원본은 미리보기 하나(목록은 썸네일)', originals.length <= 1, `${originals.length}장`);
  const artMB = art.reduce((t, r) => t + r.b, 0) / 1048576;
  const allMB = reqs.reduce((t, r) => t + r.b, 0) / 1048576;

  // ③ 탭마다 — 내용이 칸 안에 있고, 누르는 곳 40px·글자 12px
  const tabs = ['works', 'frames', 'mat', 'scenes', 'light', 'ratio'];
  let small = [], tiny = [], clipped = [];
  for (const t of tabs) {
    await frame.locator(`#tab-${t}`).click();
    await page.waitForTimeout(250);
    const g = await frame.evaluate((t) => {
      const pane = document.getElementById('pane-' + t), pr = pane.getBoundingClientRect(), panes = document.getElementById('panes').getBoundingClientRect();
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
      const clickable = [...pane.querySelectorAll('button, input, [role=tab]'), ...document.querySelectorAll('.tabs [role=tab], #dl, #toStory, #zoom button')].filter(vis);
      const small = clickable.filter((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height) < 39.5; }).map((e) => (e.id || e.className || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().width) + '×' + Math.round(e.getBoundingClientRect().height));
      const texts = [...pane.querySelectorAll('*')].filter(vis).filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
      const tiny = texts.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 11.99).map((e) => e.textContent.trim().slice(0, 10) + ' ' + getComputedStyle(e).fontSize);
      // 좁은 칸은 칩 칸 높이가 고정이다 — 내용이 아래로 잘리면 안 된다(가로 줄은 옆으로 넘쳐도 된다).
      // 넓은 칸은 패널이 위아래로 스크롤되므로 넘쳐도 잘린 게 아니다
      const scrolls = getComputedStyle(document.getElementById('panes')).overflowY !== 'hidden';
      const clipped = scrolls ? [] : [...pane.children].filter(vis).filter((e) => { const r = e.getBoundingClientRect(); return r.bottom > panes.bottom + 1; }).map((e) => (e.id || e.className) + ' ' + Math.round(e.getBoundingClientRect().bottom - panes.bottom) + 'px');
      return { small, tiny, clipped };
    }, t);
    small = small.concat(g.small.map((x) => t + ':' + x)); tiny = tiny.concat(g.tiny.map((x) => t + ':' + x)); clipped = clipped.concat(g.clipped.map((x) => t + ':' + x));
    if (SHOTS) { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, `${engineName}-${screenName}-${t}.png`) }); }
  }
  check(tag, '누르는 곳 40px 이상', small.length === 0, small.slice(0, 4).join(', '));
  check(tag, '글자 12px 이상', tiny.length === 0, tiny.slice(0, 4).join(', '));
  check(tag, '칩 칸 안에서 잘리는 것 없음', clipped.length === 0, clipped.slice(0, 4).join(', '));

  // ④ 휴대폰 — 끌어도 바깥이 안 밀린다(크롬만: 터치 이벤트를 CDP 로 넣는다)
  if (engineName === 'chromium' && s.hasTouch) {
    await frame.locator('#tab-works').click();
    const cdp = await ctx.newCDPSession(page);
    const a = await frame.evaluate(() => { const c = document.getElementById('preview'), r = c.getBoundingClientRect(), k = r.width / c.width; return { x: r.left + (lastArt.x + lastArt.fw / 2) * k, y: r.top + (lastArt.y + lastArt.fh / 2) * k }; });
    const x0 = ifr.x + a.x, y0 = ifr.y + a.y, sy0 = await page.evaluate(() => scrollY);
    const before = await frame.evaluate(() => ({ ...SCENES[state.sceneIdx].adj }));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + i * 2, y: y0 - i * 4 }] }); await page.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(700);
    const after = await frame.evaluate(() => ({ ...SCENES[state.sceneIdx].adj }));
    check(tag, '끌면 작품이 움직인다', after.dy < before.dy - 0.01, `dy ${before.dy.toFixed(3)}→${after.dy.toFixed(3)}`);
    check(tag, '끄는 동안 바깥이 안 밀린다', (await page.evaluate(() => scrollY)) === sy0);
    await frame.evaluate(() => { const s = SCENES[state.sceneIdx]; s.adj.dx = 0; s.adj.dy = 0; s.adj.s = 1; });
  }

  // ⑤ 저장 — 내려받기(공유 창을 못 쓰는 환경). 경고창 없이 "저장했어요"
  if (engineName === 'chromium') {
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }).catch(() => null), frame.locator('#dl').click()]);
    const toast = await frame.locator('#toast').innerText().catch(() => '');
    check(tag, '저장 — 파일 + "저장했어요"', !!d && /저장했어요/.test(toast), d ? d.suggestedFilename() : '내려받기 없음');
  }
  check(tag, '경고창 없음', dialogs.length === 0, dialogs.join(' | '));
  check(tag, '화면 오류 없음', errors.length === 0, errors.join(' | '));

  rows.push({ 화면: `${engineName === 'webkit' ? 'WK' : 'CR'} ${screenName}`, 첫그림: firstMs + 'ms', 그림: renders, 미리보기: `${Math.round(ocv.w)}×${Math.round(ocv.h)}@${Math.round(ocv.y)}`, 저장: `y${Math.round(odl.y)}`, ArtLook: artMB.toFixed(2) + 'MB', 전체: allMB.toFixed(1) + 'MB' });
  await browser.close();
}

(async () => {
  const acc = await devLogin();
  const engines = process.env.ENGINE ? process.env.ENGINE.split(',') : ['chromium', 'webkit'];
  const screens = process.env.SCREEN ? process.env.SCREEN.split(',') : Object.keys(SCREENS);
  for (const e of engines) {
    if (e === 'webkit' && !fs.existsSync(WEBKIT_RUN)) { console.log('WebKit 준비 안 됨 — bash scratchpad/hero/setup-webkit.sh'); process.exitCode = 1; continue; }
    for (const sc of screens) {
      try { await run(e, sc, acc); } catch (err) { fails++; console.log(`  ✗ [${e} ${sc}] 실행 실패 — ${String(err).slice(0, 200)}`); }
    }
  }
  console.table(rows);
  console.log(`\n${passes + fails}개 확인 — 통과 ${passes} · 실패 ${fails}`);
  if (fails) process.exitCode = 1;
})();
