import { test, expect } from '@playwright/test';
import { openAs } from '../lib/helpers';

/**
 * 포트폴리오(신규 구조): 작가 약력 + 경력(연도/내용) + 포트폴리오 파일 + 작품사진(최대10).
 * 약력·경력 수정 → 저장 → 새로고침 후 유지 검증.
 */
test('작가 약력/경력 수정 후 저장 → 새로고침해도 유지', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  const BIO = 'E2E 약력 ' + Date.now();
  const CAREER = 'E2E 개인전 ' + Date.now();

  await page.goto('/mypage?tab=portfolio');

  // 편집 모드
  await page.getByRole('button', { name: '수정', exact: true }).first().click();

  // 약력
  await page.getByPlaceholder('작가 소개·약력을 입력하세요.').fill(BIO);

  // 경력: 개인전은 자유 입력 textarea (한 줄=한 건). 연도/내용 행 UI는 폐지됨
  await page.locator('textarea[placeholder*="개인전"]').first().fill(CAREER);

  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.locator('body')).toContainText('포트폴리오가 저장되었습니다', { timeout: 8000 });

  // 새로고침 → 값 유지 (읽기 전용 뷰)
  await page.reload();
  await expect(page.getByText(BIO, { exact: false })).toBeVisible({ timeout: 8000 });
  await expect(page.getByText(CAREER, { exact: false })).toBeVisible({ timeout: 8000 });
  await ctx.close();
});
