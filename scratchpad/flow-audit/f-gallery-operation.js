// F. 갤러리: [내 공모] 카드의 [운영] — 모집 마감 → 출품 자료 → 전시 확정 → 공지 → 전시 종료 → 판매 입력 → 정산 확인 요청
const L = require('./lib.js');
const fs = require('fs'); const path = require('path');
const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'state.json'), 'utf8'));
const say = (k, v) => console.log(`  ${k}:`, typeof v === 'string' ? v.replace(/\n+/g, ' / ') : JSON.stringify(v));
(async () => {
  const browser = await L.chromium.launch();
  for (const screen of (process.env.SCREEN ? [process.env.SCREEN] : ['pc', 'mobile'])) {
    const { id, title } = state[screen];
    const { page, ctx } = await L.open(browser, 'gallery', screen);
    await page.goto(`/mypage?tab=my-exhibitions&ex=${id}&panel=operation`); await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
    const card = page.locator('article').filter({ hasText: title }).first();
    await L.mark(page, 'F1-operation-open', { full: false });
    say('scrollY/카드 top', [await page.evaluate(() => window.scrollY), await card.evaluate((el) => Math.round(el.getBoundingClientRect().top))]);
    say('운영 패널 글', (await card.innerText()).slice(0, 900));
    const dialog = page.getByRole('dialog');
    const step = async (btn, confirm, shotName) => {
      const b = card.getByRole('button', { name: btn });
      await b.scrollIntoViewIfNeeded(); say(`[${btn}] 눌림`, await L.hit(page, b));
      await b.click(); await page.waitForTimeout(400);
      say(`${btn} 확인창`, await dialog.innerText());
      await L.mark(page, shotName, { full: false });
      await dialog.getByRole('button', { name: confirm, exact: true }).click(); await page.waitForTimeout(1500);
    };
    // 1) 모집 마감
    await step('모집 마감하기', '모집 마감', 'F2-close-confirm');
    say('모집 마감 뒤 지금', await card.locator('p', { hasText: '지금 ·' }).innerText());
    // 2) 출품 자료 구역
    const subToggle = card.locator('button[aria-controls][aria-expanded]').filter({ hasText: /^출품 자료/ }).first();
    if ((await subToggle.getAttribute('aria-expanded')) !== 'true') await subToggle.click();
    await page.waitForTimeout(800); await subToggle.scrollIntoViewIfNeeded();
    await L.mark(page, 'F3-submissions', { full: false });
    const subRegion = card.locator(`#op-${id}-submissions`);
    say('출품 자료 구역 글', (await subRegion.innerText()).slice(0, 700));
    say('출품 자료 구역 버튼', await subRegion.getByRole('button').allInnerTexts().then((a) => a.map((t) => t.trim()).filter(Boolean)));
    // 3) 전시 확정
    await step('전시 확정하기', '전시 확정', 'F4-confirm-confirm');
    say('확정 뒤 지금', await card.locator('p', { hasText: '지금 ·' }).innerText());
    // 4) 운영 공지
    const noticeToggle = card.locator('button[aria-controls][aria-expanded]').filter({ hasText: /^운영 공지/ }).first();
    if ((await noticeToggle.getAttribute('aria-expanded')) !== 'true') await noticeToggle.click();
    await page.waitForTimeout(500);
    const nReg = card.locator(`#op-${id}-notices`);
    say('공지 구역 버튼', await nReg.getByRole('button').allInnerTexts().then((a) => a.map((t) => t.trim()).filter(Boolean)));
    await nReg.getByRole('button', { name: /공지 (쓰기|작성|추가)|새 공지/ }).first().click().catch(() => say('공지 쓰기 버튼', '못 찾음'));
    await page.waitForTimeout(300);
    say('공지 입력칸', await nReg.locator('input, textarea').evaluateAll((els) => els.map((e) => e.placeholder)));
    const nInputs = nReg.locator('input, textarea');
    if (await nInputs.count() >= 2) {
      await nInputs.nth(0).fill('반입 안내'); await nInputs.nth(1).fill('10월 18일 오전 10시까지 작품을 반입해 주세요.\n주차는 지하 2층.');
      await nReg.scrollIntoViewIfNeeded(); await L.mark(page, 'F5-notice-form', { full: false });
      await nReg.getByRole('button', { name: /등록|올리기|저장/ }).first().click(); await page.waitForTimeout(1200);
      say('공지 등록 뒤', (await nReg.innerText()).slice(0, 300));
    }
    // 5) 전시 종료
    await step('전시 종료하기', '전시 종료', 'F6-end-confirm');
    say('종료 뒤 지금', await card.locator('p', { hasText: '지금 ·' }).innerText());
    // 6) 정산
    const setReg = card.locator(`#op-${id}-settlement`);
    await page.waitForTimeout(800);
    const setToggle = card.locator('button[aria-controls][aria-expanded]').filter({ hasText: /^정산/ }).first();
    say('정산 구역 펼쳐졌나', await setToggle.getAttribute('aria-expanded'));
    if ((await setToggle.getAttribute('aria-expanded')) !== 'true') await setToggle.click();
    await page.waitForTimeout(800); await setToggle.scrollIntoViewIfNeeded();
    await L.mark(page, 'F7-settlement-empty', { full: false });
    say('정산 구역 글', (await setReg.innerText()).slice(0, 800));
    // Artist 1 작품 판매 체크(판매가 비운 채) → 요청 → 0원 경고가 있는가
    const soldBox = setReg.getByRole('checkbox', { name: /판매됨/ }).first();
    await soldBox.scrollIntoViewIfNeeded(); await soldBox.check(); await page.waitForTimeout(300);
    await L.mark(page, 'F8-sold-checked', { full: false });
    await setReg.getByRole('button', { name: '작가에게 확인 요청' }).click(); await page.waitForTimeout(600);
    say('판매가 0원·비율 0% 로 요청 눌렀을 때 확인창', await dialog.innerText().catch(() => '(확인창 없음 — 그대로 요청됨)'));
    if (await dialog.isVisible().catch(() => false)) { await dialog.getByRole('button', { name: '비율 고치기' }).click(); await page.waitForTimeout(400); }
    // 판매가·비율 입력
    await setReg.getByLabel('판매가').first().fill('1500000');
    await setReg.getByLabel('갤러리 비율(%)').first().fill('40');
    await page.waitForTimeout(300);
    await L.mark(page, 'F9-sale-filled', { full: false });
    // 구역을 접었다 펴면 입력이 남는가
    await setToggle.click(); await page.waitForTimeout(300); await setToggle.click(); await page.waitForTimeout(500);
    say('접었다 편 뒤 판매가 칸', await setReg.getByLabel('판매가').first().inputValue().catch(() => '(칸 없음 — 입력이 사라졌다)'));
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
