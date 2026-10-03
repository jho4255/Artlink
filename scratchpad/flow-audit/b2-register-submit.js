// B2. 폼을 다 채워 등록 요청 → 확인창 → [내 공모] 승인 대기. 결과를 state.json 에 남긴다.
const L = require('./lib.js');
const { png } = require('./b-register.js');
const fs = require('fs'); const path = require('path');
const STATE = path.join(__dirname, 'out', 'state.json');
(async () => {
  const browser = await L.chromium.launch();
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
  for (const screen of ['pc', 'mobile']) {
    const title = `점검 ${screen === 'pc' ? 'PC' : '모바일'} 공모`;
    const { page, ctx } = await L.open(browser, 'gallery', screen);
    await page.goto('/exhibitions/new'); await page.waitForLoadState('networkidle');
    const fresh = page.getByRole('button', { name: '새로 쓰기' });
    if (await fresh.isVisible().catch(() => false)) { console.log('  (작성하던 공고 안내가 떴다 → 새로 쓰기)'); await fresh.click(); }
    await page.locator('input[type=file]').first().setInputFiles([{ name: 'poster.png', mimeType: 'image/png', buffer: png(420, 594, screen === 'pc' ? [200, 80, 60] : [40, 90, 160]) }]);
    await page.waitForTimeout(1500);
    await page.selectOption('#ex-gallery', { index: 1 });
    await page.selectOption('#ex-type', 'GROUP');
    await page.fill('#ex-title', title);
    await page.fill('#ex-capacity', '2');
    await page.fill('#ex-desc', '점검용 공모입니다.\n둘째 줄 — 줄바꿈이 상세에 보이는지.\nhttps://example.com 링크 글자');
    await page.fill('#ex-start', '2026-10-03'); await page.fill('#ex-deadline', '2026-10-10');
    await page.fill('#ex-submission', '2026-10-15'); await page.fill('#ex-show-start', '2026-10-20'); await page.fill('#ex-show-end', '2026-10-30');
    await page.getByRole('button', { name: /주관식 질문/ }).click();
    await page.getByRole('button', { name: /객관식 질문/ }).click();
    const q = page.getByPlaceholder('질문을 입력하세요');
    await q.nth(0).fill('설치 가능한 날짜를 알려 주세요');
    await q.nth(1).fill('작품 운송 방식');
    await page.getByPlaceholder('선택지 1').fill('직접 운송');
    // 선택지 하나만 넣고 제출 → 2개 이상 경고가 나오는지
    await page.getByRole('button', { name: '등록 요청' }).click();
    await page.waitForTimeout(600);
    await L.mark(page, 'B2-one-option-warning', { full: false });
    await page.getByRole('button', { name: /선택지 추가/ }).click();
    const opts = page.locator('input[placeholder^="선택지"]');
    console.log('  선택지 칸 수:', await opts.count());
    await opts.nth(1).fill('택배');
    // 약관 미동의로 제출
    await page.waitForTimeout(4200);
    await page.getByRole('button', { name: '등록 요청' }).click();
    await page.waitForTimeout(700);
    await L.mark(page, 'B3-terms-warning', { full: false });
    await page.getByLabel('위 약관에 동의합니다').check();
    await page.getByRole('button', { name: '등록 요청' }).click();
    await page.waitForTimeout(500);
    await L.mark(page, 'B4-confirm-dialog', { full: false });
    const dlg = page.getByRole('dialog');
    console.log('  확인창 글:', (await dlg.innerText().catch(() => '확인창 없음')).replace(/\n+/g, ' / '));
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/exhibitions') && r.request().method() === 'POST'),
      dlg.getByRole('button', { name: '등록 요청' }).click(),
    ]);
    const body = await resp.json().catch(() => null);
    console.log('  POST /exhibitions →', resp.status(), body && body.id, JSON.stringify(resp.request().postDataJSON()).slice(0, 400));
    state[screen] = { id: body && body.id, title };
    await page.waitForURL(/tab=my-exhibitions/, { timeout: 10000 }).catch(() => console.log('  ⚠ 내 공모로 안 갔다:', page.url()));
    await page.waitForLoadState('networkidle');
    await L.mark(page, 'B5-after-submit', { full: false });
    const card = page.locator('article').filter({ hasText: title }).first();
    console.log('  카드 글:', (await card.innerText().catch(() => '카드 없음')).replace(/\n+/g, ' / ').slice(0, 400));
    // 다시 /exhibitions/new 에 가면 임시저장이 남아 있는가
    await page.goto('/exhibitions/new'); await page.waitForLoadState('networkidle');
    console.log('  등록 뒤 새 폼에 초안 안내:', await page.getByText('작성하던 공고가 있어요').isVisible().catch(() => false));
    await ctx.close();
  }
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
