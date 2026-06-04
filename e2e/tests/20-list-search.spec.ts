import { test, expect } from '@playwright/test';
import { openAs } from '../lib/helpers';

/**
 * 목록 검색: 갤러리 페이지에서 키워드 검색 → 일치 항목만 노출, 지우면 복원.
 * 시드 갤러리: '서울 현대 갤러리', '부산 해운대 아트센터', '대전 예술의 전당'
 */
test('갤러리 검색 → 일치 항목만 노출, 검색어 지우면 전체 복원', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/galleries');

  // 초기: 여러 갤러리 노출
  await expect(page.getByText('서울 현대 갤러리', { exact: false }).first()).toBeVisible({ timeout: 10000 });

  // '해운대' 검색
  const box = page.getByPlaceholder('갤러리 이름·주소 검색');
  await box.fill('해운대');
  await box.press('Enter');

  await expect(page.getByText('부산 해운대 아트센터', { exact: false }).first()).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('서울 현대 갤러리', { exact: false })).toHaveCount(0);
  // 적용된 검색어 칩 노출
  await expect(page.getByText('"해운대"', { exact: false }).first()).toBeVisible();

  // 검색어 지우기 → 전체 복원
  await page.getByRole('button', { name: '검색어 지우기' }).click();
  await expect(page.getByText('서울 현대 갤러리', { exact: false }).first()).toBeVisible({ timeout: 8000 });

  await ctx.close();
});
