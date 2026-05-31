import { test, expect } from '@playwright/test';
import { openAs } from '../lib/helpers';

/**
 * 갤러리 목록 검색/필터/정렬 (시드: 서울 현대 4.5 / 부산 해운대 0.0 / 대전 5.0).
 */
test('지역 필터(서울) → 서울 갤러리만, 부산 제외', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/galleries');
  await expect(page.getByText('서울 현대 갤러리', { exact: false })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('부산 해운대 아트센터', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: '서울', exact: true }).click();
  await expect(page.getByText('서울 현대 갤러리', { exact: false })).toBeVisible();
  await expect(page.getByText('부산 해운대 아트센터', { exact: false })).toHaveCount(0);
  await ctx.close();
});

test('별점 필터(4점 이상) → 4.5점 서울현대만, 0점 부산·대전 제외', async ({ browser }) => {
  // 시드 별점: 서울현대 4.5 / 대전 0 / 부산 0
  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/galleries');
  await expect(page.getByText('부산 해운대 아트센터', { exact: false })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: '4점 이상' }).click();
  await expect(page.getByText('서울 현대 갤러리', { exact: false })).toBeVisible(); // 4.5 유지
  await expect(page.getByText('부산 해운대 아트센터', { exact: false })).toHaveCount(0); // 0 제외
  await expect(page.getByText('대전 예술의 전당', { exact: false })).toHaveCount(0);   // 0 제외
  await ctx.close();
});
