// 배포 뒤 실서버 확인 — **DB 에 아무것도 쓰지 않는다** (2026-10-03)
//   cd e2e && node ../scratchpad/guest-activity/prod-smoke.mjs [https://artlink.cc]
// - 기록 라우트: 형식이 틀린 본문(400) · 화면 없는 본문(204 — 서버가 DB 에 닿기 전에 돌려보낸다)만 보낸다.
// - 브라우저: 비회원으로 몇 화면을 열되 기록은 **브라우저 밖으로 내보내지 않는다**(내 확인이 방문으로 세어지지 않게).
//   보내려 한 횟수로 새 화면 코드가 올라갔는지 본다.
//   ⚠️⚠️ `page.route` 로 막는 것만으로는 새어 나간다(2026-10-04 실서버에서 확인) — 창을 닫거나 다른 주소로 떠날 때(pagehide) 나가는
//   마지막 sendBeacon 은 가로채지지 않아, 이 점검을 돌릴 때마다 '커뮤니티 2초 → 나감' 같은 가짜 방문이 실서버 통계에 남았다.
//   그래서 페이지 안에서 `navigator.sendBeacon` 을 바꿔 끼워 기록 주소로는 아무것도 보내지 않는다(아래 BEACON_TRAP).
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(process.cwd(), 'node_modules/@playwright/test'));

const BASE = process.argv[2] || 'https://artlink.cc';
const out = [];
const check = (name, ok, info = '') => { out.push(`${ok ? '✓' : '✗'} ${name}${info ? ` — ${info}` : ''}`); if (!ok) process.exitCode = 1; };

async function http(method, url, body, type = 'text/plain;charset=UTF-8') {
  const r = await fetch(`${BASE}${url}`, { method, headers: body !== undefined ? { 'Content-Type': type } : {}, body });
  return { status: r.status, headers: r.headers };
}

const home = await http('GET', '/');
check('홈 200', home.status === 200, String(home.status));
check('보안 헤더(iframe 막기)', /sameorigin/i.test(home.headers.get('x-frame-options') ?? ''), home.headers.get('x-frame-options') ?? '없음');
const bad = await http('POST', '/api/guest-activity', 'not json');
check('기록 라우트가 새 코드다(형식 틀림 → 400)', bad.status === 400, String(bad.status));
const noop = await http('POST', '/api/guest-activity', JSON.stringify({ visitId: 'smoke-noop-000000000000', views: [] }));
check('빈 기록은 쓰지 않고 204', noop.status === 204, String(noop.status));
const stats = await http('GET', '/api/admin/stats/guests');
check('통계는 로그인 필요(401)', stats.status === 401, String(stats.status));

// 페이지가 뜨기 전에 심는다 — 기록 주소로 가는 sendBeacon 은 보낸 척만 하고(true → fetch 대체 경로도 안 탄다) 횟수만 센다
const BEACON_TRAP = () => {
  const orig = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
  navigator.sendBeacon = (url, data) => {
    if (String(url).includes('/api/guest-activity')) { try { window.__beaconSeen?.(); } catch {} return true; }
    return orig ? orig(url, data) : false;
  };
};

const browser = await chromium.launch();
for (const [label, viewport, ua] of [
  ['PC', { width: 1280, height: 900 }, undefined],
  ['휴대폰(인스타 인앱)', { width: 390, height: 844 }, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.0.22.109'],
]) {
  const ctx = await browser.newContext({ viewport, userAgent: ua, baseURL: BASE });
  const page = await ctx.newPage();
  const tried = { guest: 0, visit: 0 };
  await page.exposeBinding('__beaconSeen', () => { tried.guest++; });
  await page.addInitScript(BEACON_TRAP);
  // 보조 — 그래도 새는 요청이 있으면 막고 센다(일간 방문자는 페이지가 떠 있을 때 보내므로 이걸로 막힌다)
  await page.route('**/api/guest-activity', (r) => { tried.guest++; return r.abort(); });
  await page.route('**/api/visits', (r) => { tried.visit++; return r.abort(); });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  for (const url of ['/', '/exhibitions', '/artists', '/galleries', '/community']) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(url === '/' ? 3800 : 1500);   // 첫 화면은 3초에 한 번 미리 보낸다
  }
  // 공모 상세 하나(서식 있는 소개)
  const first = page.locator('a[href^="/exhibitions/"]').first();
  if (await first.count()) { await first.click(); await page.waitForTimeout(2500); }
  const crashed = await page.getByText('앱이 업데이트되었을 수 있어요').count();
  await page.goto('about:blank');
  await page.waitForTimeout(500);
  check(`${label}: 화면 오류 없음`, errors.length === 0 && crashed === 0, errors.join(' | '));
  check(`${label}: 새 화면 코드(비회원 기록 시도 — 막아서 안 쓰임)`, tried.guest > 0, `시도 ${tried.guest}번`);
  await ctx.close();
}
await browser.close();
console.log(out.join('\n'));
