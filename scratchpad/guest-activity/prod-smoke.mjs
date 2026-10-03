// 배포 뒤 실서버 확인 — **DB 에 아무것도 쓰지 않는다** (2026-10-03)
//   cd e2e && node ../scratchpad/guest-activity/prod-smoke.mjs [https://artlink.cc]
// - 기록 라우트: 형식이 틀린 본문(400) · 화면 없는 본문(204 — 서버가 DB 에 닿기 전에 돌려보낸다)만 보낸다.
// - 브라우저: 비회원으로 몇 화면을 열되 /api/guest-activity 와 /api/visits 는 **막는다**(내 확인이 방문으로 세어지지 않게).
//   막힌 요청이 '시도됐다'는 것으로 새 화면 코드가 올라갔는지 본다.
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

const browser = await chromium.launch();
for (const [label, viewport, ua] of [
  ['PC', { width: 1280, height: 900 }, undefined],
  ['휴대폰(인스타 인앱)', { width: 390, height: 844 }, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.0.22.109'],
]) {
  const ctx = await browser.newContext({ viewport, userAgent: ua, baseURL: BASE });
  const page = await ctx.newPage();
  const tried = { guest: 0, visit: 0 };
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
