// 실서버 읽기 전용 점검 — '전에 와 본 브라우저'가 배포 뒤 새 판으로 넘어갈 때 새로고침이 몇 번 일어나는가(무한 반복 없는가)
// 사용: node prod-sw-check.mjs before <프로필 폴더>   (배포 전: 지금 판으로 한 번 열어 서비스워커를 받아 둔다)
//       node prod-sw-check.mjs after  <프로필 폴더>   (배포 뒤: 같은 프로필로 다시 연다)
// 비회원으로만 연다. 기록은 남기지 않는다 — 비회원 둘러보기(sendBeacon)·일간 방문자(/api/visits) 둘 다 페이지 안에서 막는다.
import { chromium, devices } from 'playwright';
const [, , phase, dir] = process.argv;
const BASE = 'https://artlink.cc';
const ctx = await chromium.launchPersistentContext(dir, { ...devices['Pixel 7'], serviceWorkers: 'allow' });
await ctx.addInitScript(() => {
  const ob = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
  navigator.sendBeacon = (u, d) => (/\/api\/(guest-activity|visits)/.test(String(u)) ? true : (ob ? ob(u, d) : false));
  const oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u, ...r) { if (/\/api\/visits/.test(String(u))) throw new Error('blocked'); return oo.call(this, m, u, ...r); };
  const of = window.fetch;
  window.fetch = (i, o) => (/\/api\/(guest-activity|visits)/.test(String(i?.url ?? i)) ? Promise.resolve(new Response(null, { status: 204 })) : of(i, o));
});
await ctx.route('**/api/visits', (r) => r.abort());
await ctx.route('**/api/guest-activity', (r) => r.abort());
const page = ctx.pages()[0] || await ctx.newPage();
const loads = []; const t0 = Date.now();
page.on('load', async () => { try { loads.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${(await page.evaluate(() => [...document.scripts].map((s) => s.src).filter((s) => /assets\/index-/.test(s)).map((s) => s.split('/').pop()).join(','))) || '?'}`); } catch {} });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE + '/');
if (phase === 'before') {
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30000 });
  const reg = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL);
  console.log('배포 전 — 받아 둔 서비스워커:', reg?.replace('https://artlink.cc', ''));
} else {
  await page.waitForTimeout(25000);
  console.log('배포 뒤 다시 열기 — 로드:', loads.join(' | '));
  const reg = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL);
  console.log('   지금 서비스워커:', reg?.replace('https://artlink.cc', ''));
  loads.length = 0; const t1 = Date.now();
  await page.reload(); await page.waitForTimeout(12000);
  console.log(`   한 번 더 열기 — 로드 ${loads.length}번(1 이 맞다 — 반복 새로고침 없음) · 화면 오류 ${errors.length}`);
  console.log('   화면 정상:', await page.evaluate(() => document.body.innerText.length > 200));
}
await ctx.close();
