// shots.cjs 를 한 번 돌린 뒤(데이터가 바뀐 상태) 지원자 탭 두 장만 다시 찍는다 — 데모 5183 전용
const { chromium } = require('/home/jho4255/ArtLink/e2e/node_modules/playwright');
const { execSync } = require('child_process');
const path = require('path');
const SP = process.env.SP; const FE = 'http://localhost:5183';
const OUT = path.join(__dirname, 'shots');
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const t = execSync(`node ${SP}/tok.cjs 3 GALLERY`).toString();
  await c.addInitScript(([t]) => {
    localStorage.setItem('artlink-auth', JSON.stringify({ state: { token: t, user: { id: 3, name: 'Gallery Owner', email: 'gallery@artlink.com', role: 'GALLERY' }, isAuthenticated: true }, version: 0 }));
    localStorage.setItem('artlink-homepage-nudge-snooze', JSON.stringify({ 3: 8.64e15 }));
  }, [t]);
  const p = await c.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(`${FE}/mypage?tab=my-exhibitions&ex=30&view=applicants`);
  await p.locator('[data-applicant-manager]').waitFor();
  await p.getByRole('button', { name: /Artist 1/ }).first().click();
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(OUT, '06-gallery-applicants-edited.png') });
  await p.goto(`${FE}/mypage?tab=my-exhibitions&ex=18&view=applicants`);
  await p.locator('[data-applicant-manager]').waitFor();
  await p.getByRole('button', { name: /서진우/ }).first().click();
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(OUT, '13-after-close-applicants-pc.png') });
  console.log('errors', errs.length);
  await b.close();
})();
