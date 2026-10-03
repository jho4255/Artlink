// T. 화면을 옮길 때 스크롤 위치가 따라오는가(SPA 이동) + 공모만 진행 문구
const L = require('./lib.js');
const say = (k, v) => console.log(`  ${k}:`, typeof v === 'string' ? v.replace(/\n+/g, ' / ') : JSON.stringify(v));
(async () => {
  const browser = await L.chromium.launch();
  for (const screen of ['pc', 'mobile']) {
    console.log(`\n== ${screen} ==`);
    // 작가(지원 안 한 계정): 목록을 내려서 카드 클릭 → 상세 → [지원하기] → 지원서
    const a = await L.open(browser, 'haewon.noh@demo.artlink.local', screen);
    await a.page.goto('/exhibitions'); await a.page.waitForLoadState('networkidle');
    const link = a.page.locator('a[href^="/exhibitions/"]').filter({ hasText: /단계 03/ }).first();
    await link.scrollIntoViewIfNeeded(); await a.page.evaluate(() => window.scrollBy(0, 200));
    say('목록 scrollY', await a.page.evaluate(() => Math.round(window.scrollY)));
    await link.click(); await a.page.waitForURL(/\/exhibitions\/\d+$/); await a.page.waitForLoadState('networkidle'); await a.page.waitForTimeout(600);
    say('목록 → 상세 도착 scrollY', await a.page.evaluate(() => Math.round(window.scrollY)));
    await L.mark(a.page, 'T1-detail-arrival', { full: false });
    const apply = a.page.getByRole('button', { name: /지원하기/ }).or(a.page.getByRole('link', { name: /지원하기/ })).first();
    await apply.scrollIntoViewIfNeeded(); say('상세에서 [지원하기]까지 내린 scrollY', await a.page.evaluate(() => Math.round(window.scrollY)));
    await apply.click(); await a.page.waitForURL(/\/apply/); await a.page.waitForLoadState('networkidle'); await a.page.waitForTimeout(800);
    say('상세 → 지원서 도착 scrollY', await a.page.evaluate(() => Math.round(window.scrollY)));
    await L.mark(a.page, 'T2-apply-arrival', { full: false });
    say('지원서 첫 화면에 제목이 보이나', await a.page.getByText('지원서', { exact: true }).first().evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; }).catch(() => '없음'));
    await a.ctx.close();
    // 갤러리: 상세 → [지원자 보기], [운영 …]
    const g = await L.open(browser, 'gallery', screen);
    await g.page.goto('/exhibitions/16'); await g.page.waitForLoadState('networkidle');
    const op = g.page.getByRole('button', { name: /지원자 보기/ }).or(g.page.getByRole('link', { name: /지원자 보기/ })).first();
    await op.scrollIntoViewIfNeeded(); say('상세에서 [지원자 보기]까지 scrollY', await g.page.evaluate(() => Math.round(window.scrollY)));
    await op.click(); await g.page.waitForURL(/mypage/); await g.page.waitForLoadState('networkidle'); await g.page.waitForTimeout(1500);
    const card = g.page.locator('#ex-card-16');
    say('도착 scrollY / 카드 top', [await g.page.evaluate(() => Math.round(window.scrollY)), await card.evaluate((el) => Math.round(el.getBoundingClientRect().top)).catch(() => '카드 없음')]);
    // 공모만 진행 — 수락 확인창 문구
    const row = card.locator('li').filter({ hasText: '검토 대기' }).first();
    await row.locator('button[aria-expanded]').first().click(); await g.page.waitForTimeout(400);
    await row.getByRole('button', { name: '수락하기', exact: true }).click(); await g.page.waitForTimeout(300);
    say('공모만 진행 — 수락 확인창', await g.page.getByRole('dialog').innerText());
    await g.page.getByRole('dialog').getByRole('button', { name: '취소' }).click();
    const accRow = card.locator('li').filter({ hasText: '수락됨' }).first();
    await accRow.locator('button[aria-expanded]').first().click(); await g.page.waitForTimeout(400);
    say('공모만 진행 — 수락된 줄 안내', (await accRow.innerText()).split('/').slice(-3).join('/').slice(-160));
    await g.ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
