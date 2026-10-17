// 샘플 작가 화면을 통째로 찍어 어디를 잘라 쓸지 본다
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
const APP = 'http://localhost:5173', OUT = '/home/jho4255/ArtLink/scratchpad/guest-intro/out';
const login = await (await fetch('http://localhost:4000/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'intro-sample@artlink.test' }) })).json();
const ex = await fetch('http://localhost:4000/api/exhibitions?scope=open').then((r) => r.json());
const list = Array.isArray(ex) ? ex : ex.exhibitions || ex.items || [];
console.log(list.slice(0, 8).map((e) => `${e.id} ${e.title}`).join('\n'));
const b = await pw.chromium.launch();
const guest = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const g = await guest.newPage();
await g.goto(APP + '/@seojin.yoon', { waitUntil: 'networkidle' }); await g.waitForTimeout(1200);
await g.screenshot({ path: `${OUT}/look-home-pc.png` });
const me = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
await me.addInitScript(([token, user]) => {
  localStorage.setItem('artlink-auth', JSON.stringify({ state: { token, user, isAuthenticated: true }, version: 0 }));
  localStorage.setItem('artlink-homepage-nudge-snooze', JSON.stringify({ [user.id]: 8.64e15 }));
}, [login.token, login.user]);
const m = await me.newPage();
await m.goto(APP + '/mypage?tab=portfolio', { waitUntil: 'networkidle' }); await m.waitForTimeout(2500);
await m.screenshot({ path: `${OUT}/look-maker.png` });
const kinds = await m.$$eval('[data-book-preview] [data-page-index]', (els) => els.map((e) => `${e.getAttribute('data-page-index')}:${e.getAttribute('data-page-kind') || ''}`));
console.log('pages', kinds.join(' '));
if (list[0]) {
  await m.goto(APP + `/exhibitions/${list[0].id}/apply`, { waitUntil: 'networkidle' }); await m.waitForTimeout(2000);
  await m.screenshot({ path: `${OUT}/look-apply.png`, fullPage: true });
}
await b.close();
