// ArtTalk 현황 실측 — 로컬 전용, 가상 계정만(intro-gallery@artlink.test → intro-sample@artlink.test)
// 쓰기: 갠톡 하나 + 메시지 몇 줄(가상 계정끼리). node probe.cjs [desktop|mobile]
const { chromium, devices } = require('/home/jho4255/ArtLink/e2e/node_modules/playwright');
const BASE = 'http://localhost:5173';
const API = 'http://localhost:4000/api';
const OUT = __dirname + '/out';
require('fs').mkdirSync(OUT, { recursive: true });
const mode = process.argv[2] || 'desktop';

async function session(browser, email) {
  const ctx = await browser.newContext(mode === 'mobile' ? { ...devices['Pixel 7'] } : { viewport: { width: 1440, height: 900 } });
  const r = await (await ctx.request.post(API + '/auth/dev-login', { data: { email } })).json();
  await ctx.addInitScript(([t, u]) => {
    localStorage.setItem('artlink-auth', JSON.stringify({ state: { token: t, user: u, isAuthenticated: true }, version: 0 }));
    localStorage.setItem('artlink-homepage-nudge-snooze', JSON.stringify({ [String(u.id)]: 8.64e15 }));
  }, [r.token, r.user]);
  const page = await ctx.newPage();
  const reqs = [];
  page.on('request', (q) => { const u = q.url(); if (u.includes('/api/chats')) reqs.push({ t: Date.now(), m: q.method(), u: u.replace(/^.*\/api/, '') }); });
  page.on('pageerror', (e) => console.log('  pageerror', e.message));
  return { ctx, page, reqs, user: r.user, token: r.token };
}
const listText = (page) => page.evaluate(() => {
  const ul = [...document.querySelectorAll('ul')].find((x) => x.className.includes('divide-y'));
  const empty = document.body.innerText.includes('아직 대화가 없습니다.');
  return { rooms: ul ? ul.querySelectorAll('li').length : 0, empty };
});

(async () => {
  const b = await chromium.launch();
  const g = await session(b, 'intro-gallery@artlink.test');
  const { page } = g;
  // 1) ArtTalk 먼저(빈 목록이 캐시에 든다)
  await page.goto(BASE + '/messages'); await page.waitForTimeout(1500);
  console.log('1 list before', JSON.stringify(await listText(page)));
  await page.screenshot({ path: `${OUT}/${mode}-1-list-before.png` });
  // 2) 작가 홈페이지 → 문의하기(앱 안 이동 — 캐시 유지)
  await page.evaluate(() => { window.history.pushState({}, '', '/@seojin.yoon'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForTimeout(2500);
  const inq = page.getByRole('button', { name: '문의하기' }).first();
  await inq.click();
  await page.getByTestId('inquiry-sheet').locator('textarea').fill('실측: 문의 드립니다 ' + Date.now());
  const t0 = Date.now();
  await page.getByTestId('inquiry-sheet').getByRole('button', { name: '보내기' }).click();
  await page.getByText('메시지를 보냈어요').waitFor();
  console.log('2 sent in', Date.now() - t0, 'ms');
  await page.screenshot({ path: `${OUT}/${mode}-2-sent.png` });
  // 3) 대화 보기 → 목록이 언제 따라오는가
  const t1 = Date.now();
  await page.getByRole('button', { name: '대화 보기' }).click();
  await page.waitForURL(/messages\?chat=/);
  await page.waitForTimeout(1200);
  console.log('3 right after 대화 보기', JSON.stringify(await listText(page)), page.url().replace(BASE, ''));
  await page.screenshot({ path: `${OUT}/${mode}-3-after-view.png` });
  if (mode === 'mobile') {
    // 휴대폰: [←] 목록으로 → 목록이 비어 있는가 · 그 뒤 뒤로가기가 어디로 가는가
    await page.getByRole('button', { name: '목록으로' }).click(); await page.waitForTimeout(600);
    console.log('3m list after ←', JSON.stringify(await listText(page)), page.url().replace(BASE, ''));
    await page.screenshot({ path: `${OUT}/${mode}-3m-list-after-back.png` });
    await page.goBack(); await page.waitForTimeout(600);
    console.log('3m after device back →', page.url().replace(BASE, ''));
    await page.goto(BASE + '/messages'); await page.waitForTimeout(300);
  }
  let appeared = null;
  for (let i = 0; i < 40; i++) { const s = await listText(page); if (s.rooms > 0) { appeared = Date.now() - t1; break; } await page.waitForTimeout(500); }
  console.log('3 list caught up after', appeared, 'ms');
  console.log('  chat requests since send:', g.reqs.filter((x) => x.t >= t0).map((x) => `${x.m} ${x.u} +${x.t - t0}`).join(' | '));

  // 4) 받는 쪽(작가) — 배지 · 목록 · 방 열고 난 뒤 배지가 언제 꺼지는가
  const a = await session(b, 'intro-sample@artlink.test');
  await a.page.goto(BASE + '/'); await a.page.waitForTimeout(2500);
  const badge = () => a.page.evaluate(() => { const el = [...document.querySelectorAll('button[aria-label="대화"]')].find((x) => x.offsetParent); return el ? (el.querySelector('span')?.textContent || '') : 'no-button'; });
  console.log('4 artist navbar badge', JSON.stringify(await badge()));
  await a.page.locator('button[aria-label="대화"]:visible').click(); await a.page.waitForTimeout(2000);
  console.log('4 artist list', JSON.stringify(await listText(a.page)), a.page.url().replace(BASE, ''));
  await a.page.screenshot({ path: `${OUT}/${mode}-4-artist-messages.png` });
  if (mode === 'mobile') { await a.page.locator('ul li button').first().click(); await a.page.waitForTimeout(1500); await a.page.screenshot({ path: `${OUT}/${mode}-4-artist-room.png` }); }
  const t2 = Date.now(); let cleared = null;
  for (let i = 0; i < 80; i++) { if (!(await badge())) { cleared = Date.now() - t2; break; } await a.page.waitForTimeout(500); }
  console.log('4 navbar badge cleared after', cleared, 'ms (방을 연 뒤)');
  // 5) 답장 — 줄바꿈이 되는가(입력 칸 종류) · 보낸 뒤 화면
  const input = a.page.getByPlaceholder('메시지를 입력하세요');
  console.log('5 composer tag', await input.evaluate((el) => el.tagName));
  await input.fill('답장 드립니다'); await a.page.getByRole('button', { name: '보내기' }).click(); await a.page.waitForTimeout(1200);
  await a.page.screenshot({ path: `${OUT}/${mode}-5-artist-replied.png` });
  // 6) 갤러리 쪽 — 열어 둔 방에 답이 뜨기까지
  if (mode !== 'mobile') {
    const t3 = Date.now(); let got = null;
    for (let i = 0; i < 40; i++) { if (await page.getByText('답장 드립니다').count()) { got = Date.now() - t3; break; } await page.waitForTimeout(500); }
    console.log('6 gallery saw reply after', got, 'ms');
    await page.screenshot({ path: `${OUT}/${mode}-6-gallery-room.png` });
  }
  // 7) 창 접근성 — 이웃 피커에 role=dialog 가 있는가
  await a.page.goto(BASE + '/messages'); await a.page.waitForTimeout(800);
  await a.page.getByText('이웃에게 메시지').first().click().catch(() => {}); await a.page.waitForTimeout(500);
  console.log('7 picker dialogs', await a.page.locator('[role="dialog"]').count(), '· aria-modal', await a.page.locator('[aria-modal="true"]').count());
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
