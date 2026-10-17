// 미리보기 ?intro=1 — [다시 보지 않기] 를 누른 회원에게도 뜨고, 닫으면 주소에서 떼어져 다시 안 뜨는가. 로컬 데모 DB 전용(개발자 로그인)
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
const APP = 'http://localhost:5173';
const login = await (await fetch('http://localhost:4000/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'artist1@artlink.com' }) })).json();
const b = await pw.chromium.launch();
const out = [];
const check = (n, ok, i = '') => { out.push(`${ok ? '✓' : '✗'} ${n}${i ? ` — ${i}` : ''}`); if (!ok) process.exitCode = 1; };
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(([token, user]) => {
  Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
  localStorage.setItem('artlink-auth', JSON.stringify({ state: { token, user, isAuthenticated: true }, version: 0 }));
  localStorage.setItem('artlink-homepage-nudge-snooze', JSON.stringify({ [user.id]: 8.64e15 }));
  localStorage.setItem('artlink-member-device', '1');
  localStorage.setItem('artlink-intro-hidden', JSON.stringify({ [user.id]: 1 }));   // 다시 보지 않기를 누른 회원
  navigator.sendBeacon = () => true;
}, [login.token, login.user]);
const p = await ctx.newPage();
await p.goto(APP + '/'); await p.waitForTimeout(3500);
check('다시 보지 않기를 누른 회원 — 평소엔 안 뜬다', (await p.getByTestId('guest-intro').count()) === 0);
await p.goto(APP + '/?intro=1');
check('다시 보지 않기를 누른 회원 — ?intro=1 이면 뜬다', await p.getByTestId('guest-intro').waitFor({ timeout: 6000 }).then(() => true, () => false));
await p.getByTestId('guest-intro').getByRole('button', { name: '닫기', exact: true }).last().click();
await p.waitForTimeout(3500);
check('닫으면 주소에서 intro=1 이 빠지고 다시 안 뜬다', !p.url().includes('intro') && (await p.getByTestId('guest-intro').count()) === 0, p.url());
await p.goto(APP + '/exhibitions?scope=open&intro=1');
check('다른 쿼리와 함께여도 뜬다', await p.getByTestId('guest-intro').waitFor({ timeout: 6000 }).then(() => true, () => false));
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
check('ESC 로 닫으면 다른 쿼리는 남긴다', p.url().endsWith('/exhibitions?scope=open'), p.url());
// 로그인 안 한 브라우저 — 미리보기로 보고 닫아도 일반 방문에서 진짜 한 번이 그대로 뜬다(2026-10-18 '안 뜨잖아')
{
  const g = await b.newContext({ viewport: { width: 1280, height: 860 } });
  await g.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); navigator.sendBeacon = () => true; });
  const q = await g.newPage();
  await q.goto(APP + '/?intro=1'); await q.getByTestId('guest-intro').waitFor();
  await q.getByRole('button', { name: '먼저 둘러볼게요' }).click(); await q.waitForTimeout(800);
  await q.goto(APP + '/');
  check('로그인 안 함 — 미리보기로 보고 닫아도 일반 방문에서 뜬다', await q.getByTestId('guest-intro').waitFor({ timeout: 6000 }).then(() => true, () => false));
  await g.close();
}
await b.close();
console.log(out.join('\n'));
