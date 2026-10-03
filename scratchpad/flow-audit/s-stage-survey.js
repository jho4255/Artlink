// S. 단계별 화면 글 훑기 — 갤러리 카드([지원자]·[운영])와 작가 카드를 단계마다 펼쳐 글만 뽑는다
const L = require('./lib.js');
const one = (s, n = 1200) => s.replace(/\n+/g, ' / ').slice(0, n);
(async () => {
  const browser = await L.chromium.launch();
  const screen = process.env.SCREEN || 'pc';
  const ov = await L.api('gallery', 'GET', '/exhibitions/my-operation-overview');
  const stages = ov.body.filter((e) => /^\[단계/.test(e.title)).sort((a, b) => a.id - b.id);
  const g = await L.open(browser, 'gallery', screen);
  for (const ex of stages) {
    console.log(`\n━━ 갤러리 · ${ex.title} (id ${ex.id}) ━━`);
    await g.page.goto(`/mypage?tab=my-exhibitions&ex=${ex.id}&panel=operation`); await g.page.waitForLoadState('networkidle'); await g.page.waitForTimeout(900);
    // 종료 탭으로 넘어간 것도 딥링크가 찾아 준다
    const card = g.page.locator(`#ex-card-${ex.id}`);
    if (!(await card.count())) { console.log('  ⚠ 카드를 못 찾음'); continue; }
    console.log('  [운영]', one(await card.innerText()));
    const appBtn = card.getByRole('button', { name: /^지원자 \d+$/ });
    if (await appBtn.count()) { await appBtn.click(); await g.page.waitForTimeout(700); console.log('  [지원자]', one((await card.innerText()).split('접기').slice(1).join('접기'), 700)); }
    const r = await L.mark(g.page, `S-gallery-${ex.id}`, { full: false });
  }
  await g.ctx.close();
  const a = await L.open(browser, 'artist', screen);
  const apps = await L.api('artist', 'GET', '/exhibitions/my-applications');
  for (const app of apps.body.filter((x) => /^\[단계/.test(x.exhibition.title)).sort((x, y) => x.exhibitionId - y.exhibitionId)) {
    console.log(`\n━━ 작가 · ${app.exhibition.title} (${app.status}) ━━`);
    await a.page.goto(`/mypage?tab=applications&ex=${app.exhibitionId}`); await a.page.waitForLoadState('networkidle'); await a.page.waitForTimeout(900);
    const card = a.page.locator(`#app-card-${app.id}`);
    if (!(await card.count())) { console.log('  ⚠ 카드를 못 찾음(다른 탭?)', one(await a.page.locator('main').last().innerText(), 300)); continue; }
    console.log('  ', one(await card.innerText()));
    await L.mark(a.page, `S-artist-${app.exhibitionId}`, { full: false });
  }
  await a.ctx.close();
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
