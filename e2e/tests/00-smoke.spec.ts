import { test, expect } from '@playwright/test';
import { openAs, Role } from '../lib/helpers';

/**
 * 스모크: 하네스(세션 주입)가 동작하고 3역할이 각자 마이페이지에 진입하는지.
 * 이게 통과해야 나머지 멀티유저 테스트의 전제가 성립.
 */
const cases: Array<{ role: Role; menu: string }> = [
  { role: 'artist', menu: '포트폴리오' },
  { role: 'gallery', menu: '내 갤러리' },
  { role: 'admin', menu: '승인 관리' },
];

for (const { role, menu } of cases) {
  test(`스모크: ${role} 세션→마이페이지에 '${menu}' 메뉴`, async ({ browser }) => {
    const { page, ctx } = await openAs(browser, role);
    await page.goto('/mypage');
    await expect(page).toHaveURL(/\/mypage/);
    await expect(page.getByText(menu, { exact: false }).first()).toBeVisible();
    await ctx.close();
  });
}

test('스모크: 비로그인 보호페이지 접근 시 로그인으로 리다이렉트', async ({ browser }) => {
  const ctx = await browser.newContext(); // 세션 없음
  const page = await ctx.newPage();
  await page.goto('/mypage');
  await expect(page).toHaveURL(/\/login/);
  await ctx.close();
});
