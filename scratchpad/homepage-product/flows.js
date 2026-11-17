/**
 * 홈페이지 개편(규칙 82) — 눌러서 무슨 일이 나는가(비회원). 작품 → 작품 페이지 → 문의 창 → Esc → Esc → 목록 · [소식] 탭 · 뒤로가기.
 * ⚠️ 로컬 전용 · 가상 계정만. node scratchpad/homepage-product/flows.js [artistPath]
 */
const { BASE, launch, devices, path } = require('../community-editor/lib');

const OUT = process.env.OUT || '/tmp/claude-1000/-home-jho4255-ArtLink/aabb9dca-5a67-40f0-bba1-6510126c6f16/scratchpad/hp-impl';
const ARTIST = process.argv[2] || '/@hanjiwoo.studio';
const ENGINES = (process.env.ENGINES || 'chromium').split(',');
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1; };

(async () => {
  for (const engine of ENGINES) {
    const browser = await launch(engine);
    for (const form of ['desktop', 'mobile']) {
      const o = form === 'mobile' ? { ...devices['iPhone 13'] } : { viewport: { width: 1280, height: 800 } };
      if (engine === 'chromium' && form === 'mobile') delete o.defaultBrowserType;
      const ctx = await browser.newContext(o);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const tag = `${engine}-${form}`;
      await page.goto(`${BASE}${ARTIST}`);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      // 작품 목록에서 두 번째 작품을 누른다(첫째는 표지와 같을 수 있다)
      const tiles = page.locator('[role="tabpanel"] figure button');
      await tiles.nth(1).scrollIntoViewIfNeeded();
      const before = page.url();
      await tiles.nth(1).click();
      const sheet = page.getByTestId('work-sheet');
      await sheet.waitFor({ timeout: 8000 });
      ok(/[?&]work=\d+/.test(page.url()), `${tag} 작품 페이지 주소에 ?work=`);
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, `work-${tag}.png`) });
      const inquire = sheet.getByRole('button', { name: '작품 문의하기' }).filter({ visible: true }).first();
      ok(await inquire.isVisible(), `${tag} [작품 문의하기] 보임`);
      await inquire.click();
      const inq = page.getByTestId('inquiry-sheet');
      await inq.waitFor({ timeout: 5000 });
      ok(await inq.getByRole('button', { name: '로그인' }).isVisible(), `${tag} 비회원(받기 꺼짐) → 로그인 안내`);
      await page.screenshot({ path: path.join(OUT, `inquiry-${tag}.png`) });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      ok(!(await inq.isVisible().catch(() => false)) && await sheet.isVisible(), `${tag} Esc 한 번 = 문의 창만 닫힘`);
      // 다음 작품
      if (form === 'desktop') {
        const w1 = page.url();
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(300);
        ok(page.url() !== w1, `${tag} → 키로 다음 작품(주소가 바뀐다)`);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      ok(!(await sheet.isVisible().catch(() => false)), `${tag} Esc 두 번째 = 작품 페이지 닫힘`);
      ok(page.url() === before, `${tag} 닫으면 목록 주소로(뒤로) — ${page.url()}`);
      // [소식] 탭
      const newsTab = page.getByRole('tab', { name: /^소식/ }).filter({ visible: true }).first();
      if (await newsTab.count()) {
        await newsTab.click();
        await page.getByTestId('homepage-news').waitFor({ timeout: 8000 });
        await page.waitForTimeout(800);
        ok(/[?&]tab=news/.test(page.url()), `${tag} [소식] 탭 주소 ?tab=news`);
        const cards = await page.locator('[data-story-card]').count();
        ok(cards > 0, `${tag} 소식 카드 ${cards}장`);
        await page.screenshot({ path: path.join(OUT, `news-${tag}.png`) });
        await page.locator('[data-story-card]').first().click();
        const viewer = page.getByRole('dialog').filter({ visible: true }).first();
        await viewer.waitFor({ timeout: 8000 });
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(OUT, `news-viewer-${tag}.png`) });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
      } else ok(false, `${tag} [소식] 탭 없음`);
      if (errors.length) console.log('PAGE ERRORS', tag, errors);
      ok(errors.length === 0, `${tag} 페이지 오류 없음`);
      await ctx.close();
    }
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
