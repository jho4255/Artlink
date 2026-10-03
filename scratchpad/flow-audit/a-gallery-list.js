const L = require('./lib.js');
(async () => {
  const browser = await L.chromium.launch();
  for (const screen of ['pc', 'mobile']) {
    const { page, ctx } = await L.open(browser, 'gallery', screen);
    await page.goto('/mypage?tab=my-exhibitions'); await page.waitForLoadState('networkidle');
    await L.mark(page, 'A1-gallery-my-exhibitions');
    await page.goto('/exhibitions/new'); await page.waitForLoadState('networkidle');
    await L.mark(page, 'A2-register-form');
    // 아무것도 안 넣고 제출
    const submit = page.getByRole('button', { name: /등록|요청|제출/ }).last();
    console.log('  제출 버튼:', await submit.innerText().catch(() => '없음'), JSON.stringify(await L.hit(page, submit)));
    await submit.scrollIntoViewIfNeeded(); await submit.click().catch((e) => console.log('click 실패', e.message));
    await page.waitForTimeout(800);
    await L.mark(page, 'A3-register-empty-submit', { full: false });
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
