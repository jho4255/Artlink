// 갤러리의 공모 운영 화면 후보를 찍어 본다(로컬 데모 DB · gallery@artlink.com)
import pw from '/home/jho4255/ArtLink/e2e/node_modules/playwright/index.js';
const APP = 'http://localhost:5173', OUT = '/home/jho4255/ArtLink/scratchpad/guest-intro/out';
const login = await (await fetch('http://localhost:4000/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'gallery@artlink.com' }) })).json();
const b = await pw.chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(([token, user]) => {
  localStorage.setItem('artlink-auth', JSON.stringify({ state: { token, user, isAuthenticated: true }, version: 0 }));
  navigator.sendBeacon = () => true;
}, [login.token, login.user]);
const p = await ctx.newPage();
await p.goto(APP + '/mypage?tab=my-exhibitions', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/look-g-list.png`, fullPage: true });
for (const id of [8, 13]) {
  await p.goto(APP + `/exhibitions/${id}/operation/new`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/look-g-op${id}.png`, fullPage: true });
}
await b.close();
