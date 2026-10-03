// E. 작가: 선정 알림 → [내 전시] 카드 → 출품 자료(작품·약력·노트) → 임시저장 → 제출
const L = require('./lib.js');
const { png } = require('./b-register.js');
const fs = require('fs'); const path = require('path');
const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'state.json'), 'utf8'));
(async () => {
  const browser = await L.chromium.launch();
  for (const screen of (process.env.SCREEN ? [process.env.SCREEN] : ['pc', 'mobile'])) {
    const { id, title } = state[screen];
    const { page, ctx } = await L.open(browser, 'artist', screen);
    const notif = await L.api('artist', 'GET', '/notifications');
    const list = notif.body.notifications || notif.body;
    const mine = list.find((n) => n.type === 'APPLICATION_STATUS' && n.message.includes(title));
    console.log('  선정 알림:', JSON.stringify(mine && [mine.message, mine.linkUrl]));
    await page.goto(mine ? mine.linkUrl : `/mypage?tab=applications&ex=${id}`); await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
    await L.mark(page, 'E1-card-open', { full: false });
    const card = page.locator('article').filter({ hasText: title }).first();
    console.log('  scrollY:', await page.evaluate(() => window.scrollY), '카드 top:', await card.evaluate((el) => Math.round(el.getBoundingClientRect().top)));
    console.log('  카드 글:', (await card.innerText()).replace(/\n+/g, ' / ').slice(0, 700));
    // 빈 채로 제출
    const submit = card.getByRole('button', { name: '갤러리에 제출' });
    console.log('  [갤러리에 제출] 눌리는가:', JSON.stringify(await L.hit(page, submit)));
    await submit.scrollIntoViewIfNeeded(); await submit.click(); await page.waitForTimeout(700);
    await L.mark(page, 'E2-empty-submit', { full: false });
    // 사진 3장 한 번에
    const bulk = card.locator('input[type=file][multiple]');
    await bulk.setInputFiles([
      { name: '푸른 밤.png', mimeType: 'image/png', buffer: png(600, 400, [30, 60, 140]) },
      { name: '붉은 낮.png', mimeType: 'image/png', buffer: png(400, 600, [180, 50, 40]) },
      { name: '무제.png', mimeType: 'image/png', buffer: png(500, 500, [90, 120, 80]) },
    ]);
    await page.waitForTimeout(3500);
    await L.mark(page, 'E3-after-bulk', { full: false });
    // 첫 작품만 다 채운다
    const art0 = card.locator('[id$="-art-0"]');
    await art0.getByLabel('세로').fill('72.7'); await art0.getByLabel('가로').fill('60.6');
    await art0.getByLabel('재료').fill('Oil on canvas'); await art0.getByLabel('제작년도').fill('2026'); await art0.getByLabel('가격').fill('1500000');
    await page.waitForTimeout(300);
    await art0.scrollIntoViewIfNeeded();
    await L.mark(page, 'E4-art0-filled', { full: false });
    // 임시저장
    await card.getByRole('button', { name: '임시저장' }).click(); await page.waitForTimeout(1200);
    console.log('  임시저장 뒤 상태 줄:', (await card.locator('section p.text-sm.text-gray-600').first().innerText().catch(() => '')).replace(/\n/g, ' '));
    // 갤러리에 보이는가(임시저장 = draft)
    const subs = await L.api('gallery', 'GET', `/operations/${id}/submissions`);
    const me = (subs.body || []).find((s) => s.user.id === 1);
    console.log('  갤러리가 보는 Artist 1 작품 수(임시저장 뒤):', me && me.submission.artworkList.length);
    // 제출 → 빈 칸 경고
    await card.getByRole('button', { name: '갤러리에 제출' }).click(); await page.waitForTimeout(800);
    await L.mark(page, 'E5-submit-missing', { full: false });
    console.log('  빈 칸 안내:', JSON.stringify(await card.locator('p.text-accent').allInnerTexts()));
    // 나머지 두 점은 뺀다 → 한 점만 제출
    for (const n of [3, 2]) { await card.getByRole('button', { name: `작품 ${n} 빼기` }).click(); await page.waitForTimeout(200); }
    await card.getByRole('button', { name: '갤러리에 제출' }).click(); await page.waitForTimeout(700);
    const dlg = page.getByRole('dialog');
    console.log('  약력·노트 빈 채 제출 확인창:', (await dlg.innerText().catch(() => '없음')).replace(/\n+/g, ' / '));
    await L.mark(page, 'E6-partial-confirm', { full: false });
    await dlg.getByRole('button', { name: '계속 작성' }).click(); await page.waitForTimeout(400);
    // 약력 탭 → 홈페이지에서 불러오기
    await card.getByRole('button', { name: '홈페이지에서 불러오기' }).click().catch((e) => console.log('  불러오기 버튼 없음', e.message.slice(0, 80)));
    await page.waitForTimeout(1000);
    await L.mark(page, 'E7-cv-loaded', { full: false });
    console.log('  약력 칸:', JSON.stringify(await card.locator('[role=tabpanel] label span:first-child').allInnerTexts()));
    // 작가노트
    await card.getByRole('tab', { name: /작가노트/ }).click(); await page.waitForTimeout(300);
    await card.getByPlaceholder('작품 세계 전반에 대한 이야기를 자유롭게 작성하세요.').fill('빛과 시간에 대한 작업입니다.');
    await card.getByRole('button', { name: /갤러리에 제출|변경 내용 제출/ }).click(); await page.waitForTimeout(1500);
    await L.mark(page, 'E8-submitted', { full: false });
    console.log('  제출 뒤 카드 글:', (await card.innerText()).replace(/\n+/g, ' / ').slice(0, 500));
    const subs2 = await L.api('gallery', 'GET', `/operations/${id}/submissions`);
    const me2 = (subs2.body || []).find((s) => s.user.id === 1);
    console.log('  갤러리가 보는 Artist 1(제출 뒤):', JSON.stringify({ works: me2.submission.artworkList.length, rep: me2.submission.representativeIndex, cv: Object.fromEntries(Object.entries(me2.submission.cv || {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])), note: (me2.submission.note || {}).statement }));
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
