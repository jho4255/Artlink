// D. 갤러리: [내 공모] 카드 → 지원자 → 펼치기 → 수락/거절/정원 초과
const L = require('./lib.js');
const fs = require('fs'); const path = require('path');
const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'state.json'), 'utf8'));
const TERMS = fs.readFileSync(path.resolve(__dirname, '../../backend/src/lib/terms.ts'), 'utf8').match(/ARTIST_APPLY_TERMS_VERSION\s*=\s*['"]([^'"]+)['"]/)[1];
(async () => {
  // 다른 작가 둘이 API 로 지원해 둔다(정원 2 → 3번째 수락은 막혀야 한다)
  for (const screen of ['pc', 'mobile']) for (const who of ['artist2', 'jinwoo.seo@demo.artlink.local']) {
    const r = await L.api(who, 'POST', `/exhibitions/${state[screen].id}/apply`, { biography: `${who} 약력`, career: { artFair: [], solo: [], group: [] }, artworkImages: ['/demo-art/a01.jpg'], portfolioFileUrl: null, termsAgreed: true, termsVersion: TERMS });
    if (r.status !== 201 && !/이미 지원/.test(JSON.stringify(r.body))) console.log('  apply', who, r.status, JSON.stringify(r.body).slice(0, 120));
  }
  const browser = await L.chromium.launch();
  for (const screen of (process.env.SCREEN ? [process.env.SCREEN] : ['pc', 'mobile'])) {
    const { id, title } = state[screen];
    const { page, ctx } = await L.open(browser, 'gallery', screen);
    // 알림 → 어디로 가는가
    const notif = await L.api('gallery', 'GET', '/notifications');
    const list = notif.body.notifications || notif.body;
    console.log('  새 지원 알림:', JSON.stringify(list.filter((n) => n.type === 'NEW_APPLICANT').slice(0, 2).map((n) => [n.message, n.linkUrl])));
    await page.goto(`/exhibitions/${id}`); await page.waitForLoadState('networkidle');
    await L.mark(page, 'D0-detail-as-owner');
    console.log('  상세의 운영자 버튼:', JSON.stringify(await page.getByRole('button').allInnerTexts().then((a) => a.map((t) => t.trim()).filter(Boolean).slice(0, 30))));
    await page.goto('/mypage?tab=my-exhibitions'); await page.waitForLoadState('networkidle');
    const card = page.locator('article').filter({ hasText: title }).first();
    await card.scrollIntoViewIfNeeded();
    console.log('  카드 글:', (await card.innerText()).replace(/\n+/g, ' / ').slice(0, 300));
    await card.getByRole('button', { name: /^지원자 \d+$/ }).click();
    await page.waitForTimeout(1200);
    await card.scrollIntoViewIfNeeded();
    await L.mark(page, 'D1-applicants-open', { full: false });
    const rows = card.locator('li');
    console.log('  지원자 줄 수:', await rows.count());
    // Artist 1 줄 펼치기
    const row = rows.filter({ hasText: 'Artist 1' }).first();
    await row.locator('button[aria-expanded]').first().click();
    await page.waitForTimeout(800);
    await row.scrollIntoViewIfNeeded();
    await L.mark(page, 'D2-applicant-expanded', { full: false });
    console.log('  펼친 지원서 글:', (await row.innerText()).replace(/\n+/g, ' / ').slice(0, 900));
    // 수락
    const acc = row.getByRole('button', { name: '수락하기', exact: true });
    await acc.scrollIntoViewIfNeeded(); await acc.click(); await page.waitForTimeout(400);
    await L.mark(page, 'D3-accept-confirm', { full: false });
    console.log('  수락 확인창:', (await page.getByRole('dialog').innerText()).replace(/\n+/g, ' / '));
    await page.getByRole('dialog').getByRole('button', { name: '수락하기', exact: true }).click();
    await page.waitForTimeout(1500);
    // 나머지 둘 일괄 수락 → 정원 2라 하나는 실패해야 한다
    const all = card.getByLabel(/모두 선택|전체 선택/);
    if (await all.count()) { await all.first().check(); await page.waitForTimeout(300); }
    await L.mark(page, 'D4-batch-selected', { full: false });
    await card.getByRole('button', { name: '선택 수락' }).click(); await page.waitForTimeout(300);
    console.log('  일괄 수락 확인창:', (await page.getByRole('dialog').innerText()).replace(/\n+/g, ' / '));
    await page.getByRole('dialog').getByRole('button', { name: '수락하기', exact: true }).click();
    await page.waitForTimeout(2500);
    await L.mark(page, 'D5-after-batch', { full: false });
    console.log('  토스트/머리줄:', (await page.locator('[role=status]').allInnerTexts()).join(' | '), '||', (await card.getByText(/수락 \d/).first().innerText()).replace(/\n/g, ' '));
    // 남은 한 명 거절
    const pending = card.locator('li').filter({ hasText: '검토 대기' }).first();
    if (await pending.count()) {
      await pending.locator('button[aria-expanded]').first().click(); await page.waitForTimeout(500);
      await pending.getByRole('button', { name: '거절', exact: true }).click(); await page.waitForTimeout(300);
      console.log('  거절 확인창:', (await page.getByRole('dialog').innerText()).replace(/\n+/g, ' / '));
      await page.getByRole('dialog').getByRole('button', { name: '거절', exact: true }).click();
      await page.waitForTimeout(1500);
    }
    await card.scrollIntoViewIfNeeded();
    await L.mark(page, 'D6-final', { full: false });
    console.log('  카드 글(끝):', (await card.innerText()).replace(/\n+/g, ' / ').slice(0, 500));
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
