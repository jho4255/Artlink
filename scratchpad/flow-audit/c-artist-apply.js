// C. 작가: 모집공고 목록 → 상세 → 지원서 → 지원 → 상세·내 전시
const L = require('./lib.js');
const fs = require('fs'); const path = require('path');
const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'state.json'), 'utf8'));
(async () => {
  const browser = await L.chromium.launch();
  for (const screen of (process.env.SCREEN ? [process.env.SCREEN] : ['pc', 'mobile'])) {
    const { id, title } = state[screen];
    const { page, ctx } = await L.open(browser, 'artist', screen);
    await page.goto('/exhibitions'); await page.waitForLoadState('networkidle');
    await L.mark(page, 'C1-list', { full: false });
    const card = page.getByText(title).first();
    console.log('  목록에 새 공모가 보이는가:', await card.isVisible().catch(() => false));
    await page.goto(`/exhibitions/${id}`); await page.waitForLoadState('networkidle');
    await L.mark(page, 'C2-detail');
    const applyBtn = page.getByRole('button', { name: /지원하기/ }).or(page.getByRole('link', { name: /지원하기/ })).first();
    console.log('  [지원하기] 첫 화면에서 눌리는가:', JSON.stringify(await L.hit(page, applyBtn)));
    await applyBtn.scrollIntoViewIfNeeded(); await applyBtn.click();
    await page.waitForURL(/\/apply/, { timeout: 8000 }).catch(() => console.log('  ⚠ 지원서로 안 갔다', page.url()));
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(800);
    await L.mark(page, 'C3-apply-prefilled');
    const submit = page.getByRole('button', { name: '지원하기', exact: true });
    console.log('  하단 [지원하기] 눌리는가:', JSON.stringify(await L.hit(page, submit)));
    console.log('  남은 것 줄:', (await page.locator('p', { hasText: /남은 것|다 채웠어요/ }).last().innerText().catch(() => '')).replace(/\n/g, ' '));
    console.log('  경력 칸 이름:', JSON.stringify(await page.locator('#apply-bio ~ * label, section label').allInnerTexts().catch(() => [])).slice(0, 300));
    await submit.click(); await page.waitForTimeout(900);
    await L.mark(page, 'C4-apply-missing', { full: false });
    // 추가 질문 답
    const ta = page.locator('#apply-questions textarea');
    if (await ta.count()) await ta.first().fill('10월 18~19일 설치 가능합니다.');
    const sel = page.locator('#apply-questions select');
    if (await sel.count()) await sel.first().selectOption({ index: 1 });
    await page.getByLabel('위 약관에 동의합니다').check();
    await page.waitForTimeout(300);
    await L.mark(page, 'C5-apply-ready', { full: false });
    const [resp] = await Promise.all([
      page.waitForResponse((r) => /\/apply$/.test(r.url()) && r.request().method() === 'POST'),
      submit.click(),
    ]);
    const sent = resp.request().postDataJSON();
    console.log('  POST apply →', resp.status(), 'career keys:', Object.keys(sent.career || {}), 'images:', (sent.artworkImages || []).length, 'file:', sent.portfolioFileUrl, 'answers:', JSON.stringify(sent.customAnswers));
    await page.waitForURL(new RegExp(`/exhibitions/${id}$`), { timeout: 8000 }).catch(() => console.log('  ⚠ 상세로 안 돌아왔다', page.url()));
    await page.waitForLoadState('networkidle');
    await L.mark(page, 'C6-detail-after-apply', { full: false });
    console.log('  scrollY after apply:', await page.evaluate(() => window.scrollY));
    await page.goto('/mypage?tab=applications'); await page.waitForLoadState('networkidle');
    await L.mark(page, 'C7-my-exhibitions', { full: false });
    const mine = page.locator('article').filter({ hasText: title }).first();
    console.log('  내 전시 카드:', (await mine.innerText().catch(() => '카드 없음')).replace(/\n+/g, ' / ').slice(0, 300));
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
