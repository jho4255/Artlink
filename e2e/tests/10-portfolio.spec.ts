import { test, expect } from '@playwright/test';
import { openAs } from '../lib/helpers';

/**
 * 포트폴리오: 약력/이력 수정 → 저장 → 새로고침 후 유지.
 */
test('작가 약력/이력 수정 후 저장 → 새로고침해도 유지', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  const BIO = 'E2E 약력 ' + Date.now();
  const HIST = 'E2E 전시이력 ' + Date.now();

  await page.goto('/mypage');
  await page.getByText('포트폴리오', { exact: false }).first().click();

  // '수정' 눌러 편집 모드 → 약력/이력 textarea(2개) 채우고 저장
  await page.getByRole('button', { name: '수정' }).first().click();
  const tas = page.locator('textarea');
  await tas.nth(0).fill(BIO);
  await tas.nth(1).fill(HIST);
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.locator('body')).toContainText('포트폴리오가 저장되었습니다', { timeout: 8000 });

  // 새로고침 → 값 유지
  await page.reload();
  await page.getByText('포트폴리오', { exact: false }).first().click();
  await expect(page.getByText(BIO, { exact: false })).toBeVisible({ timeout: 8000 });
  await expect(page.getByText(HIST, { exact: false })).toBeVisible();
  await ctx.close();
});
