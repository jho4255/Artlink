// [벽에 걸어 보기] 화면 하니스 (2026-10-22, CLAUDE.md 규칙 74) — 비회원이 작가 홈페이지에서 작품을 눌러
// [사진 | 벽에 걸어 보기] 를 바꾸고 넘겨 보고 닫았다 다시 연다. 화면마다 시간·멈춘 시간·받은 것·기하를 잰다.
//
//   로컬 서버(데모 DB)가 떠 있어야 한다: backend :4000 · frontend :5173
//   node scratchpad/wall-view/walk.mjs                         크롬(SwiftShader WebGL)
//   ENGINE=webkit PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 node scratchpad/wall-view/walk.mjs   사파리 엔진(~/.cache/wk-deps)
//   ARTIST=/@seojin.yoon  SCREEN=pc1280,iphone13  SHOTS=1(out/ 에 스크린샷)  NOGL=1(크롬을 WebGL 없이 — 토글이 숨는지)
//
// ⚠️ 헤드리스는 GPU 가 없어 엔진이 느리다(SwiftShader) — 시간은 비관적 값이다. 실기기는 따로 볼 것.
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
import { mkdirSync } from 'node:fs';

const APP = process.env.APP || 'http://localhost:5173';
const ARTIST = process.env.ARTIST || '/@seojin.yoon';
const ENGINE = process.env.ENGINE || 'chromium';
const SHOTS = !!process.env.SHOTS;
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const SCREENS = {
  pc1280: { viewport: { width: 1280, height: 800 } },
  pc1440r: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  ipad: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  pixel7: { viewport: { width: 412, height: 839 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
  iphone13: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  iphonese: { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const pick = (process.env.SCREEN || Object.keys(SCREENS).join(',')).split(',');
if (ENGINE === 'webkit') for (const k of Object.keys(SCREENS)) delete SCREENS[k].isMobile;   // WebKit 은 isMobile 을 모른다

// 실서버 하니스와 같은 덫 — 로컬 데모 DB 의 비회원 통계를 더럽히지 않게(sendBeacon 은 page.route 를 안 탄다, 규칙 64)
const BEACON_TRAP = `(() => { const o = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = (u, d) => (/\\/api\\/(guest-activity|visits)/.test(String(u)) ? true : (o ? o(u, d) : true)); })();`;

const browser = ENGINE === 'webkit'
  ? await pw.webkit.launch({ executablePath: process.env.HOME + '/.cache/wk-deps/run.sh' })
  : await pw.chromium.launch({ args: process.env.NOGL ? ['--disable-gpu', '--disable-webgl', '--disable-webgl2'] : ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

let bad = 0;
const check = (ok, label, detail = '') => { if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); };

for (const name of pick) {
  const opt = SCREENS[name];
  if (!opt) continue;
  console.log(`\n■ ${ENGINE} · ${name} ${opt.viewport.width}×${opt.viewport.height}`);
  const ctx = await browser.newContext({ ...opt, locale: 'ko-KR' });
  await ctx.addInitScript(BEACON_TRAP);
  await ctx.route(/\/api\/(guest-activity|visits)/, (r) => r.fulfill({ status: 204, body: '' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const reqs = [];
  page.on('request', (r) => reqs.push(r.url()));
  await page.addInitScript(() => {
    // 벽 그림이 **실제로 화면에 오른** 시각 — Playwright 의 확인은 엔진이 스레드를 붙잡는 동안 늦어진다(초안이 원본과 함께 뜬 것처럼 재졌다)
    window.__wallT = {};
    const mark = () => {
      const el = document.querySelector('[data-view="wall"]');
      const q = el && el.getAttribute('data-quality');
      if (q && window.__wallT.t0 && !window.__wallT[q] && el.complete && el.naturalWidth) window.__wallT[q] = performance.now();
    };
    new MutationObserver(mark).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-quality', 'src'] });
    document.addEventListener('load', mark, true);
    window.__long = [];
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true }); } catch { /* WebKit */ }
  });

  await page.goto(APP + ARTIST, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 20000 });
  const first = page.locator('figure button.cursor-zoom-in').first();
  await first.scrollIntoViewIfNeeded();
  await first.click();
  const viewer = page.getByTestId('artwork-viewer');
  await viewer.waitFor({ timeout: 10000 });
  await page.locator('[data-view="photo"]').waitFor({ timeout: 10000 });
  check(/[?&]work=\d+/.test(page.url()), '열면 주소에 ?work=', new URL(page.url()).search);

  const toggle = viewer.getByRole('group', { name: '보기 방식' });
  const hasToggle = await toggle.isVisible().catch(() => false);
  console.log(`  · 토글 ${hasToggle ? '있음' : '없음(이 브라우저에선 엔진이 안 된다)'}`);

  const geom = async (label) => {
    const g = await page.evaluate(() => {
      const r = (el) => (el ? (({ x, y, width, height }) => ({ x, y, w: width, h: height }))(el.getBoundingClientRect()) : null);
      const v = document.querySelector('[data-testid="artwork-viewer"]');
      const img = v?.querySelector('[data-view]');
      return {
        vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth,
        img: r(img), view: img?.getAttribute('data-view'), q: img?.getAttribute('data-quality'),
        cap: r(v?.querySelector('[data-testid="artwork-caption"]')),
        close: r(v?.querySelector('button[aria-label="닫기"]')),
        toggle: r(v?.querySelector('[role="group"][aria-label="보기 방식"]')),
        strip: r(v?.querySelector('[role="group"][aria-label="작품 목록"]')),
        natural: img && img.naturalWidth ? [img.naturalWidth, img.naturalHeight] : null,
        frames: document.querySelectorAll('iframe[data-wall-view]').length,
      };
    });
    const inside = (b) => b && b.x >= -1 && b.y >= -1 && b.x + b.w <= g.vw + 1 && b.y + b.h <= g.vh + 1;
    check(inside(g.img), `${label}: 작품이 화면 안`, g.img && `${Math.round(g.img.w)}×${Math.round(g.img.h)} @${Math.round(g.img.x)},${Math.round(g.img.y)} (${g.view}${g.q ? '/' + g.q : ''})`);
    check(inside(g.close) && g.close.w >= 40, `${label}: [닫기] 화면 안 · 40px 이상`);
    if (g.toggle) check(inside(g.toggle) && g.toggle.h >= 44, `${label}: 토글 화면 안 · 누르는 곳 충분`, `${Math.round(g.toggle.w)}×${Math.round(g.toggle.h)}`);
    if (g.cap && g.img) check(g.cap.y >= g.img.y + g.img.h - 1, `${label}: 캡션이 작품을 가리지 않는다`, `작품 끝 ${Math.round(g.img.y + g.img.h)} · 캡션 ${Math.round(g.cap.y)}`);
    check(g.sw <= g.vw, `${label}: 가로로 밀리지 않는다`, `${g.sw}/${g.vw}`);
    if (g.vw >= 768) check(!!g.strip && g.strip.h > 0, `${label}: PC — 썸네일 줄`);
    else check(!g.strip || g.strip.h === 0, `${label}: 휴대폰 — 썸네일 줄 없음`);
    return g;
  };
  await geom('사진');
  if (SHOTS) await page.screenshot({ path: `${OUT}${ENGINE}-${name}-photo.png` });

  if (hasToggle && process.env.NOGL) {
    // WebGL 이 없는 브라우저 — 누르면 엔진이 '안 된다'고 답하고(webgl) 토글이 사라지며 사진으로 돌아간다
    await toggle.getByRole('button', { name: '벽에 걸어 보기' }).click();
    const note = viewer.getByText('이 브라우저에서는 벽에 걸어 볼 수 없어요');
    await note.waitFor({ timeout: 30000 });
    check(true, '안 되는 브라우저 — 안내 한 줄');
    check(!(await toggle.isVisible().catch(() => false)), '토글이 사라진다');
    check(await page.locator('[data-view="photo"]').isVisible(), '사진은 그대로 보인다');
    await page.waitForTimeout(300);
    check(await page.locator('iframe[data-wall-view]').count() === 0, 'iframe 을 걷는다');
    await viewer.getByRole('button', { name: '다음 작품' }).click();
    await page.waitForTimeout(500);
    check(await page.locator('iframe[data-wall-view]').count() === 0, '넘겨도 엔진을 다시 띄우지 않는다');
  } else if (hasToggle) {
    const t0 = Date.now();
    await page.evaluate(() => { window.__long = []; window.__wallT = { t0: performance.now() }; });
    await toggle.getByRole('button', { name: '벽에 걸어 보기' }).click();
    const pending = await page.locator('[data-view="wall-pending"]').isVisible().catch(() => false);
    await page.locator('[data-view="wall"]').waitFor({ timeout: 60000 });
    const tDraft = Date.now() - t0;
    await page.locator('[data-view="wall"][data-quality="full"]').waitFor({ timeout: 60000 }).catch(() => {});
    const tFull = Date.now() - t0;
    const long1 = await page.evaluate(() => window.__long.slice());
    const wt = await page.evaluate(() => window.__wallT);
    const at = (q) => (wt[q] ? `${Math.round(wt[q] - wt.t0)}ms` : '—');
    console.log(`  · 벽 — 기다리는 표시 ${pending ? '보임' : '안 보임'} · 화면에 오른 시각: 초안 ${at('draft')} · 원본 ${at('full')} (Playwright 확인 ${tDraft}/${tFull}ms) · 긴 작업 ${long1.length}개 최대 ${Math.max(0, ...long1)}ms`);
    await page.waitForTimeout(400);
    const gw = await geom('벽');
    if (gw.natural) {
      const [w, h] = gw.natural;
      console.log(`  · 벽 그림 ${w}×${h} (${(w / h).toFixed(2)})`);
    }
    check(gw.frames === 1, '숨은 iframe 하나', String(gw.frames));
    if (SHOTS) await page.screenshot({ path: `${OUT}${ENGINE}-${name}-wall.png` });

    // 다음 작품 — 이웃은 미리 그려 둬서 바로 떠야 한다
    await page.waitForTimeout(2500);   // 이웃 미리 그리기
    await page.evaluate(() => { window.__long = []; });
    const t1 = Date.now();
    await viewer.getByRole('button', { name: '다음 작품' }).click();
    await page.locator('[data-view="wall"]').waitFor({ timeout: 60000 });
    const tNext = Date.now() - t1;
    console.log(`  · 다음 작품 벽까지 ${tNext}ms`);
    check(tNext < 1500, '다음 작품은 미리 그려 둔 것으로 바로', `${tNext}ms`);
    await page.waitForTimeout(300);
    await geom('벽(다음)');
    check(/[?&]work=\d+/.test(page.url()), '넘기면 주소도 따라간다');

    // 닫으면 iframe 을 걷는다 · 다시 열면 벽으로 바로(그려 둔 것)
    await viewer.getByRole('button', { name: '닫기' }).click();
    await viewer.waitFor({ state: 'detached', timeout: 5000 });
    check(await page.locator('iframe[data-wall-view]').count() === 0, '닫으면 iframe 을 걷는다');
    check(!/[?&]work=/.test(page.url()), '닫으면 주소에서 work 를 뗀다');
    const t2 = Date.now();
    await first.click();
    await page.locator('[data-view="wall"]').waitFor({ timeout: 30000 });
    console.log(`  · 다시 열기 → 벽까지 ${Date.now() - t2}ms (벽을 골랐던 것을 기억)`);
    check(Date.now() - t2 < 1500, '다시 열면 벽으로 바로');
    const ls = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('artlook:')));
    check(ls.length === 0, '방문자 브라우저에 artlook:* 를 남기지 않는다', ls.join(','));

    // 사진으로 돌리면 사진 · 이 탭에서 기억
    await viewer.getByRole('group', { name: '보기 방식' }).getByRole('button', { name: '사진' }).click();
    await page.locator('[data-view="photo"]').waitFor({ timeout: 5000 });
    check(await page.evaluate(() => sessionStorage.getItem('artlink-artwork-view')) === null, '사진으로 돌리면 기억을 지운다');
  }

  const art = reqs.filter((u) => u.includes('/artlook/'));
  const walls = art.filter((u) => /\/walls\//.test(u));
  console.log(`  · 받은 ArtLook 파일 ${art.length}개 — 벽 사진 ${walls.map((u) => u.split('/').pop()).join(', ') || '없음'}`);
  check(walls.length <= 1, '벽 사진은 한 장만');
  const framePngs = art.filter((u) => /frames\/photo\/[^/]+\.png/.test(u));
  check(framePngs.length === 0, '액자 사진(PNG)은 받지 않는다 — 오크 플로터는 엔진이 그린다', framePngs.join(', '));
  const textures = art.filter((u) => /frames\/frame-[a-z]+-texture\.jpg/.test(u)).map((u) => u.split('/').pop().split('?')[0]);
  check(textures.length === 1 && textures[0] === 'frame-oak-texture.jpg', '액자 결 텍스처는 오크 한 장', textures.join(', ') || '없음');
  check(errors.length === 0, '페이지 오류 0', errors.join(' | '));
  await ctx.close();
}
await browser.close();
console.log(bad ? `\n✗ ${bad}개 실패` : '\n✓ 전부 통과');
process.exit(bad ? 1 : 0);
