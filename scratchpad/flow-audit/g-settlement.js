// G. 정산: 갤러리 판매 입력·확인 요청 → 작가 확인(PC=수락 / 모바일=이의 → 수정 → 수락) → 갤러리 정산 완료 → 양쪽 종료 화면
const L = require('./lib.js');
const fs = require('fs'); const path = require('path');
const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'state.json'), 'utf8'));
const say = (k, v) => console.log(`  ${k}:`, typeof v === 'string' ? v.replace(/\n+/g, ' / ') : JSON.stringify(v));
(async () => {
  const browser = await L.chromium.launch();
  for (const screen of (process.env.SCREEN ? [process.env.SCREEN] : ['pc', 'mobile'])) {
    const { id, title } = state[screen];
    // ── 갤러리: 판매 입력 + 요청
    const g = await L.open(browser, 'gallery', screen);
    await g.page.goto(`/exhibitions/${id}/operation/new`); await g.page.waitForLoadState('networkidle'); await g.page.waitForTimeout(1000);
    await L.mark(g.page, 'G1-operation-page', { full: false });
    say('운영 전용 화면 머리', (await g.page.locator('main').last().innerText()).slice(0, 500));
    const setReg = g.page.locator(`#op-${id}-settlement`);
    const soldBox = setReg.getByRole('checkbox', { name: /판매됨/ }).first();
    await soldBox.scrollIntoViewIfNeeded(); await soldBox.check();
    await setReg.getByLabel('판매가').first().fill('1500000');
    await setReg.getByLabel('갤러리 비율(%)').first().fill('40');
    await setReg.getByRole('button', { name: '작가에게 확인 요청' }).click(); await g.page.waitForTimeout(1500);
    say('요청 뒤 토스트', (await g.page.locator('[role=status]').allInnerTexts()).join(' | '));
    await L.mark(g.page, 'G2-requested', { full: false });
    say('요청 뒤 정산 구역', (await setReg.innerText()).slice(0, 600));

    // ── 작가: 알림 → 정산 확인
    const a = await L.open(browser, 'artist', screen);
    const notif = await L.api('artist', 'GET', '/notifications');
    const n = (notif.body.notifications || notif.body).find((x) => x.type === 'SETTLEMENT_CONFIRM_REQUEST' && x.message.includes(title));
    say('작가 정산 알림', n && [n.message, n.linkUrl]);
    await a.page.goto(n ? n.linkUrl : `/mypage?tab=applications&ex=${id}`); await a.page.waitForLoadState('networkidle'); await a.page.waitForTimeout(1200);
    const card = a.page.locator('article').filter({ hasText: title }).first();
    await L.mark(a.page, 'G3-artist-settlement', { full: false });
    say('작가 카드 글', (await card.innerText()).slice(0, 700));
    if (screen === 'mobile') {
      await card.getByRole('button', { name: '문제 제기' }).click(); await a.page.waitForTimeout(300);
      await card.getByPlaceholder(/어떤 점이 틀렸는지/).fill('판매가가 180만원이었습니다.');
      await L.mark(a.page, 'G4-artist-issue-form', { full: false });
      await card.getByRole('button', { name: '갤러리에 전달' }).click(); await a.page.waitForTimeout(1200);
      say('이의 뒤 작가 카드', (await card.innerText()).slice(0, 400));
      // 갤러리: 이의 확인 → 금액 수정 → 저장
      await g.page.reload(); await g.page.waitForLoadState('networkidle'); await g.page.waitForTimeout(1000);
      await L.mark(g.page, 'G5-gallery-issue', { full: false });
      say('이의 뒤 갤러리 화면', (await g.page.locator('main').last().innerText()).slice(0, 700));
      const price = setReg.getByLabel('판매가').first();
      if (!(await price.isVisible().catch(() => false))) await setReg.getByRole('button', { name: /Artist 1/ }).first().click();
      await price.fill('1800000'); await g.page.waitForTimeout(300);
      await setReg.getByRole('button', { name: '변경 저장' }).click(); await g.page.waitForTimeout(1500);
      say('수정 저장 토스트', (await g.page.locator('[role=status]').allInnerTexts()).join(' | '));
      // 작가: 옛 화면 그대로 [수락] → 409 가 나오는가
      await card.getByRole('button', { name: /정산 확인\(수락\)/ }).click().catch(() => say('수락 버튼', '없음')); await a.page.waitForTimeout(1500);
      say('옛 화면에서 수락 → 토스트', (await a.page.locator('[role=status]').allInnerTexts()).join(' | '));
      await L.mark(a.page, 'G6-artist-stale-accept', { full: false });
      await a.page.waitForTimeout(800);
    }
    const acc = card.getByRole('button', { name: /정산 확인\(수락\)/ });
    await acc.scrollIntoViewIfNeeded(); say('[정산 확인(수락)] 눌림', await L.hit(a.page, acc));
    await acc.click(); await a.page.waitForTimeout(1500);
    await L.mark(a.page, 'G7-artist-approved', { full: false });
    say('수락 뒤 작가 카드', (await card.innerText()).slice(0, 500));
    // 서진우도 수락(API)
    const fp = await L.api('jinwoo.seo@demo.artlink.local', 'GET', `/operations/${id}/my-settlement`);
    const r2 = await L.api('jinwoo.seo@demo.artlink.local', 'POST', `/operations/${id}/settlement/respond`, { approve: true, fingerprint: fp.body.fingerprint });
    say('서진우 수락(API)', [r2.status, r2.body]);
    // ── 갤러리: 정산 완료
    await g.page.reload(); await g.page.waitForLoadState('networkidle'); await g.page.waitForTimeout(1000);
    await L.mark(g.page, 'G8-gallery-all-approved', { full: false });
    say('모두 확인 뒤 갤러리 화면', (await g.page.locator('main').last().innerText()).slice(0, 600));
    const done = setReg.getByRole('button', { name: '정산 완료', exact: true });
    await done.scrollIntoViewIfNeeded(); await done.click(); await g.page.waitForTimeout(400);
    say('정산 완료 확인창', await g.page.getByRole('dialog').innerText());
    await g.page.getByRole('dialog').getByRole('button', { name: '동의하고 정산 완료' }).click(); await g.page.waitForTimeout(1500);
    await g.page.evaluate(() => window.scrollTo(0, 0)); await L.mark(g.page, 'G9-gallery-settled');
    say('정산 완료 뒤 갤러리 화면', (await g.page.locator('main').last().innerText()).slice(0, 700));
    // 내 공모 목록에서 어디로 갔는가
    await g.page.goto('/mypage?tab=my-exhibitions'); await g.page.waitForLoadState('networkidle');
    say('진행 중 목록에 남아 있나', await g.page.locator('article').filter({ hasText: title }).count());
    say('목록 필터 버튼', await g.page.getByRole('button', { name: /진행|종료/ }).allInnerTexts());
    // ── 작가: 종료 화면
    await a.page.reload(); await a.page.waitForLoadState('networkidle'); await a.page.waitForTimeout(1200);
    await L.mark(a.page, 'G10-artist-settled', { full: false });
    say('정산 완료 뒤 작가 화면 탭/카드', (await a.page.locator('main').last().innerText()).slice(0, 700));
    await g.ctx.close(); await a.ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
