// 소개 팝업 — 작가/갤러리 바꾸기 · 회원(하루 한 번 · 다시 보지 않기 · 홈페이지 완성 팝업에 양보). 로컬 데모 DB 전용(개발자 로그인)
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
const APP = 'http://localhost:5173', API = 'http://localhost:4000/api';
const wk = process.env.ENGINE === 'webkit';
const b = await (wk ? pw.webkit : pw.chromium).launch(wk ? { executablePath: `${process.env.HOME}/.cache/wk-deps/run.sh` } : {});
const out = [];
const check = (n, ok, i = '') => { out.push(`${ok ? '✓' : '✗'} ${n}${i ? ` — ${i}` : ''}`); if (!ok) process.exitCode = 1; };
const HUMAN = () => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); navigator.sendBeacon = () => true; };
const dlg = (p) => p.getByTestId('guest-intro');
const shows = (p, ms = 6000) => dlg(p).waitFor({ timeout: ms }).then(() => true, () => false);
const login = async (email) => (await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) })).json();
const asMember = async (ctx, l) => ctx.addInitScript(([token, user]) => {
  localStorage.setItem('artlink-auth', JSON.stringify({ state: { token, user, isAuthenticated: true }, version: 0 }));
}, [l.token, l.user]);

// 1) 비회원 — 작가/갤러리 바꾸기 · 갤러리 쪽 가입
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(HUMAN);
  const p = await ctx.newPage();
  await p.goto(APP + '/');
  check('비회원 — 뜬다(작가 쪽부터)', await shows(p) && (await dlg(p).getAttribute('data-side')) === 'artist');
  check('제목 Welcome to ArtLink', (await dlg(p).getByRole('heading').textContent()).replace(/\s+/g, ' ').trim() === 'Welcome to ArtLink');
  check('작가 — 네 칸', (await dlg(p).locator('li').count()) === 4);
  await dlg(p).getByRole('tab', { name: '갤러리' }).click();
  const lead = await dlg(p).locator('p').first().textContent();
  check('갤러리로 바꾸면 네 칸(ArtLook·공모 운영·갤러리 홈페이지·전시 홍보) · 2027년 6월까지 무료', (await dlg(p).locator('li').count()) === 4 && lead.includes('2027년 6월까지'), lead);
  await p.screenshot({ path: '/home/jho4255/ArtLink/scratchpad/guest-intro/out/side-gallery.png' });
  await dlg(p).getByRole('button', { name: '무료로 시작하기' }).click();
  await p.waitForURL('**/signup?role=GALLERY');
  check('갤러리 쪽 [무료로 시작하기] → 갤러리를 골라 둔 가입', (await p.getByRole('radio', { name: /갤러리/ }).getAttribute('aria-checked')) === 'true');
  await ctx.close();
}

// 2) 갤러리 회원 — 갤러리 쪽부터 · 닫으면 그날은 안 뜬다 · 다음 날 다시 · [다시 보지 않기] 면 다음 날에도 안 뜬다
{
  const l = await login('gallery@artlink.com');
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(HUMAN); await asMember(ctx, l);
  const p = await ctx.newPage();
  await p.goto(APP + '/exhibitions');
  check('갤러리 회원 — 뜬다(갤러리 쪽부터)', await shows(p) && (await dlg(p).getAttribute('data-side')) === 'gallery');
  check('회원에겐 [다시 보지 않기]·[닫기] — [무료로 시작하기] 없음', (await dlg(p).getByRole('button', { name: '다시 보지 않기' }).count()) === 1 && (await dlg(p).getByRole('button', { name: '무료로 시작하기' }).count()) === 0);
  await p.screenshot({ path: '/home/jho4255/ArtLink/scratchpad/guest-intro/out/member-gallery.png' });
  await dlg(p).getByRole('button', { name: '닫기', exact: true }).last().click();
  await p.reload(); await p.waitForTimeout(3000);
  check('닫으면 그날은 다시 안 뜬다', (await dlg(p).count()) === 0);
  await p.evaluate(() => localStorage.removeItem('artlink-intro-member-day'));   // 다음 날로
  await p.goto(APP + '/galleries');
  check('다음 날엔 다시 뜬다', await shows(p));
  await dlg(p).getByRole('button', { name: '다시 보지 않기' }).click();
  await p.evaluate(() => localStorage.removeItem('artlink-intro-member-day'));   // 다음 날로
  await p.goto(APP + '/'); await p.waitForTimeout(3500);
  check('[다시 보지 않기] 를 누르면 다음 날에도 안 뜬다', (await dlg(p).count()) === 0);
  await ctx.close();
}

// 3) 홈페이지를 덜 채운 작가 — 홈페이지 완성 팝업이 먼저 뜨고, 소개 팝업은 그날 양보한다
{
  const l = await login('intro-sample@artlink.test');
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(HUMAN); await asMember(ctx, l);
  const p = await ctx.newPage();
  await p.goto(APP + '/');
  const nudge = await p.getByTestId('homepage-nudge').waitFor({ timeout: 8000 }).then(() => true, () => false);
  await p.waitForTimeout(2500);
  check('덜 채운 작가 — 홈페이지 완성 팝업만 뜬다(둘이 겹치지 않는다)', nudge && (await dlg(p).count()) === 0, `완성 팝업 ${nudge}`);
  if (nudge) await p.getByTestId('homepage-nudge').getByRole('button', { name: '나중에' }).click();
  await p.waitForTimeout(3500);
  check('완성 팝업을 닫아도 그날은 소개 팝업이 뒤따라 뜨지 않는다', (await dlg(p).count()) === 0);
  await ctx.close();
}
await b.close();
console.log(out.join('\n') + `\n${out.filter((x) => x.startsWith('✗')).length ? '실패 있음' : '전부 통과'}`);
