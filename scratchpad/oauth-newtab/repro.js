/**
 * 재현(2026-10-04, CLAUDE.md 64): 카카오 인증을 마치고 돌아오는 콜백이 **로그인을 누른 탭이 아닌 곳**에서 열릴 때.
 * 실서버 비회원 통계의 `카카오 로그인 3초 → 로그인 1초 → 카카오 로그인 1초 → 가입 정보 입력 → 가입 완료` 가 고치기 전 코드에서 그대로 나온다.
 *  - MODE=newtab   : 탭1 [로그인하고 지원하기] → 로그인 → 카카오 → 콜백은 탭2(같은 브라우저 새 탭 — localStorage 는 같고 sessionStorage 는 비어 있다)
 *  - MODE=otherctx : 콜백이 아예 다른 브라우저(새 컨텍스트 — localStorage 도 비어 있다)에서 열린다
 *  - MODE=sametab  : 보통의 경우(같은 탭으로 돌아온다) — 회귀 확인
 *  - ENGINE=webkit : 사파리 엔진(~/.cache/wk-deps/run.sh, PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1)
 * 쓰는 법: 데모 서버(BASE 기본 http://localhost:5183 → API 4001)를 띄운 채 `node scratchpad/oauth-newtab/repro.js`.
 * ⚠️ 데모 DB 전용 — 가입 완료 응답에 4001 의 개발자 로그인(artist1) 토큰을 쓴다. 실서버·복제본(4000)에 돌리지 말 것.
 * 실제 카카오 대신 kauth.kakao.com 을 가로채고, /api/auth/kakao · complete-registration 은 가짜 응답(가입 완료는 데모 DB 개발자 로그인 토큰).
 * 비회원 기록은 sendBeacon 을 바꿔 끼워 **보내지 않고** 모은다(데모 DB 에 안 쌓는다).
 */
const { chromium, webkit } = require('/home/jho4255/ArtLink/e2e/node_modules/playwright');
const BASE = process.env.BASE || 'http://localhost:5183';
const MODE = process.env.MODE || 'newtab';
const EX = process.env.EX || '7';
const beacons = [];
const log = (...a) => console.log(...a);

const TRAP = `(() => {
  const OB = window.Blob;
  function B(parts, opts) { const b = new OB(parts, opts); try { b.__parts = parts; } catch {} return b; }
  B.prototype = OB.prototype; window.Blob = B;
  const orig = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
  navigator.sendBeacon = (url, data) => {
    if (String(url).includes('guest-activity')) {
      const body = (data && data.__parts || []).join('');
      // 떠나는 순간(pagehide)에도 남도록 localStorage 에 먼저 적는다(바인딩 호출은 문서가 내려가며 사라질 수 있다)
      try { const k = '__beacons'; const a = JSON.parse(localStorage.getItem(k) || '[]'); a.push({ id: Math.random().toString(36).slice(2), path: location.pathname, body }); localStorage.setItem(k, JSON.stringify(a)); } catch {}
      return true;
    }
    return orig ? orig(url, data) : true;
  };
})();`;

async function setup(ctx, tag) {
  await ctx.addInitScript(TRAP);
  // 카카오 인증 서버 — 첫 번째는 '카카오톡 앱으로 인증하는 중'처럼 그 탭을 붙잡아 두고(콜백은 다른 곳에서 열린다), 그 다음부터는 곧바로 되돌려 보낸다
  await ctx.route('https://kauth.kakao.com/**', async (route) => {
    const u = new URL(route.request().url());
    const state = u.searchParams.get('state');
    lastAuthorize = { state, at: Date.now(), tag };
    authorizeCount++;
    if (holdFirst && authorizeCount === 1) return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>카카오톡에서 확인해 주세요</p>' });
    const to = `${BASE}/auth/kakao/callback?code=c${authorizeCount}&state=${encodeURIComponent(state)}`;
    // WebKit 의 route.fulfill 은 3xx 를 못 준다 — 스크립트로 되돌려 보낸다(같은 탭)
    if (process.env.ENGINE === 'webkit') return route.fulfill({ status: 200, contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(to)})</script>` });
    return route.fulfill({ status: 302, headers: { Location: to } });
  });
  await ctx.route('**/api/auth/kakao', (route) => (kakaoPosts.push(JSON.parse(route.request().postData() || '{}').code), route.fulfill({ json: { needsRegistration: true, tempToken: 'fake-temp', profile: { name: '재현', email: null, avatar: null } } })));
  await ctx.route('**/api/auth/complete-registration', async (route) => {
    const r = await fetch('http://localhost:4001/api/auth/dev-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'artist1@artlink.com' }) });
    route.fulfill({ json: await r.json() });
  });
}
const kakaoPosts = []; let lastAuthorize = null; let authorizeCount = 0; let holdFirst = MODE !== 'sametab';

(async () => {
  const browser = process.env.ENGINE === 'webkit' ? await webkit.launch({ executablePath: process.env.HOME + '/.cache/wk-deps/run.sh' }) : await chromium.launch();
  const ctx1 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await setup(ctx1, 'ctx1');
  const tab1 = await ctx1.newPage();
  await tab1.goto(`${BASE}/exhibitions/${EX}`);
  await tab1.waitForTimeout(2500);
  await tab1.getByRole('button', { name: /로그인하고 지원하기/ }).first().click();
  await tab1.waitForURL(/\/login/);
  await tab1.waitForTimeout(1500);
  await tab1.getByRole('button', { name: '카카오로 시작하기' }).click();
  await tab1.waitForTimeout(1500);
  log('탭1 주소:', tab1.url(), '| 첫 authorize state:', lastAuthorize?.state?.slice(0, 40));
  const state1 = lastAuthorize.state;

  // 콜백이 다른 곳에서 열린다
  let ctx2 = ctx1;
  if (MODE === 'otherctx') { ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await setup(ctx2, 'ctx2'); }
  const tab2 = MODE === 'sametab' ? tab1 : await ctx2.newPage();
  const urls2 = [];
  tab2.on('framenavigated', (f) => { if (f === tab2.mainFrame()) urls2.push(new URL(f.url()).pathname); });
  // SPA 안의 이동(pushState/replaceState)도 본다
  if (MODE !== 'sametab') await tab2.exposeFunction('__nav', (p) => urls2.push(p + ' (spa)'));
  if (MODE !== 'sametab') await tab2.addInitScript(() => { for (const k of ['pushState', 'replaceState']) { const o = history[k].bind(history); history[k] = (...a) => { const r = o(...a); try { window.__nav(location.pathname); } catch {} return r; }; } });
  const t0 = Date.now();
  if (MODE !== 'sametab') await tab2.goto(`${BASE}/auth/kakao/callback?code=c1&state=${encodeURIComponent(state1)}`);
  // 무엇이 보이는가 — 실패 문구 / 가입 정보 입력 / 로그인 화면
  const seen = [];
  for (let i = 0; i < 40; i++) {
    const txt = await tab2.locator('body').innerText().catch(() => '');
    const s = txt.includes('보안 검증에 실패') ? '보안 검증 실패 문구' : txt.includes('로그인을 마무리해 주세요') ? '한 번 더 누르기 안내' : txt.includes('회원 정보 입력') ? '가입 정보 입력' : /ArtLink 로그인/.test(txt) ? '로그인 화면' : txt.includes('로그인 처리 중') ? '로그인 처리 중' : '?';
    const key = `${s} @ ${new URL(tab2.url()).pathname}`;
    if (seen[seen.length - 1]?.key !== key) seen.push({ key, t: ((Date.now() - t0) / 1000).toFixed(1) });
    if (s === '가입 정보 입력') break;
    if (s === '한 번 더 누르기 안내') { await tab2.waitForTimeout(1500); await tab2.getByRole('button', { name: '카카오로 계속하기' }).click(); }
    if (s === '로그인 화면') {
      await tab2.waitForTimeout(1000);
      await tab2.getByRole('button', { name: '카카오로 시작하기' }).click();   // 사용자가 다시 누른다
    }
    await tab2.waitForTimeout(250);
  }
  log('탭2 화면 순서:', seen.map((x) => `${x.t}s ${x.key}`).join(' → '));
  // 가입 정보 입력
  await tab2.getByText('회원 정보 입력').waitFor({ timeout: 15000 });
  await tab2.waitForTimeout(2000);
  await tab2.locator('input[type=email]').fill('repro@example.com');
  await tab2.locator('input[type=tel]').fill('010-1234-5678');
  await tab2.getByText('전체 동의').click();
  await tab2.getByRole('button', { name: '가입 완료' }).click();
  await tab2.waitForURL((u) => !u.pathname.startsWith('/auth/'), { timeout: 15000 });
  await tab2.waitForTimeout(2500);
  log('탭2 지나간 주소:', [...new Set(urls2)].join(' → '));
  log('가입 뒤 탭2 주소:', new URL(tab2.url()).pathname + new URL(tab2.url()).search, '(지원하려던 곳: /exhibitions/' + EX + '/apply)');
  // 모은 기록 읽기 — 컨텍스트마다 우리 출처 문서에서
  for (const [ctx, tag] of MODE === 'otherctx' ? [[ctx1, 'ctx1'], [ctx2, 'ctx2']] : [[ctx1, 'ctx1']]) {
    const p = await ctx.newPage();
    await p.goto(`${BASE}/__read`, { waitUntil: 'commit' });
    const arr = await p.evaluate(() => JSON.parse(localStorage.getItem('__beacons') || '[]'));
    log(`[${tag}] 남은 저장값:`, JSON.stringify(await p.evaluate(() => ({ pending: localStorage.getItem('artlink-oauth-pending'), handoff: localStorage.getItem('artlink-guest-handoff'), member: localStorage.getItem('artlink-member-device') }))));
    for (const b of arr) { try { beacons.push({ tag, path: b.path, ...JSON.parse(b.body) }); } catch {} }
  }

  // 방문별로 모은다 — 서버와 같은 규칙(같은 seq 는 더 큰 시간, 경로는 처음 받은 것)
  const visits = new Map();
  for (const b of beacons) {
    const v = visits.get(b.visitId) ?? { views: new Map(), outcome: null, left: false, tags: new Set() };
    v.tags.add(b.tag);
    for (const pv of b.views) { const old = v.views.get(pv.seq); v.views.set(pv.seq, old ? { ...old, ms: Math.max(old.ms, pv.ms) } : pv); }
    if (b.outcome) v.outcome = b.outcome;
    if (b.left) v.left = true;
    visits.set(b.visitId, v);
  }
  log('POST /api/auth/kakao 에 보낸 인증 코드:', kakaoPosts.join(', '));
  log(`비회원 방문 ${visits.size}개:`);
  for (const [id, v] of visits) {
    const steps = [...v.views.values()].sort((a, b) => a.seq - b.seq).map((pv) => `${pv.path} ${(pv.ms / 1000).toFixed(1)}s(#${pv.seq})`);
    log(`  ${id.slice(0, 8)} [${[...v.tags]}] ${steps.join(' → ')}${v.outcome ? ' → ' + v.outcome : ''}${v.left ? ' (떠남 표시)' : ''}`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
