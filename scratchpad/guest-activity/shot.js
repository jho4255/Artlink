// Admin [통계] 탭의 '비회원 둘러보기' 칸을 찍는다 — 데모 DB(5183) 관리자 계정. PC·모바일
//   cd e2e && node ../scratchpad/guest-activity/shot.js
const path = require('path');
const L = require('../flow-audit/lib.js');
(async () => {
  const browser = await L.chromium.launch();
  for (const screen of ['pc', 'mobile']) {
    const { page, ctx, log } = await L.open(browser, 'admin', screen);
    await page.goto('/mypage?tab=stats', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '비회원 둘러보기' }).waitFor({ timeout: 15000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(800);
    // 찍을 때만 — 위쪽 고정 메뉴·아래 탭바가 요소 사진 위에 겹쳐 찍힌다(화면 자체의 문제가 아니다)
    await page.addStyleTag({ content: 'nav.sticky{position:static!important} nav.fixed,div.fixed.bottom-0{display:none!important}' });
    const sec = page.locator('section[aria-labelledby="stats-guests"]');
    await sec.scrollIntoViewIfNeeded();
    await sec.screenshot({ path: path.join(__dirname, 'out', `guest-${screen}.png`) });
    const m = await L.measure(page);
    console.log(screen, '가로 넘침', m.overflowX, '| 잘림', m.clipped.slice(0, 3), '| 오류', log.pageErrors, log.failed);
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
