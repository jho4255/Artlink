import { test, expect } from '@playwright/test';
import { openAs, userIds } from '../lib/helpers';

/**
 * 작가 홈페이지 내용 저장 — 약력 + 경력(개인전) 이 저장되고 공개 페이지에 남는가.
 *
 * ⚠️ 2026-08-27 개편으로 **탭이 갈렸다.**
 *   · `?tab=portfolio`     → PDF 포맷 4종 (내용 편집 아님)
 *   · `?tab=homepage-edit` → 내용 편집. 공개 페이지의 [수정]으로 들어오는 숨은 탭이고,
 *                            **들어오자마자 편집 모드**라 [수정]을 또 누르지 않는다.
 *   · 저장하면 공개 작가 페이지로 돌아간다.
 * 예전 이 테스트는 `?tab=portfolio` 에서 [수정]을 찾다가 죽었다.
 */
test('작가 약력/경력 수정 후 저장 → 공개 홈페이지에 남는다', async ({ browser }) => {
  const ids = userIds();
  const { page, ctx } = await openAs(browser, 'artist');
  const BIO = 'E2E 약력 ' + Date.now();
  const CAREER = 'E2E 개인전 ' + Date.now();

  await page.goto('/mypage?tab=homepage-edit');

  // 들어오자마자 편집 모드 — [수정]을 다시 누를 필요가 없다
  const bio = page.getByPlaceholder('작가 소개·약력을 입력하세요.');
  await expect(bio).toBeVisible({ timeout: 15000 });
  await bio.fill(BIO);

  // 경력: 개인전은 자유 입력 textarea (한 줄 = 한 건)
  await page.locator('textarea[placeholder*="개인전"]').first().fill(CAREER);

  await page.getByRole('button', { name: '저장' }).click();

  // 저장하면 공개 페이지로 돌아간다 (편집 전용 화면에 갇히지 않게)
  await page.waitForURL(new RegExp(`/portfolio/${ids.artist}`), { timeout: 15000 });
  await expect(page.getByText(BIO, { exact: false })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(CAREER, { exact: false })).toBeVisible({ timeout: 10000 });

  // 새로고침해도 유지
  await page.reload();
  await expect(page.getByText(BIO, { exact: false })).toBeVisible({ timeout: 10000 });
  await ctx.close();
});

test('★ [포트폴리오] 탭은 PDF 포맷 고르는 화면이다 (내용 편집이 아니다)', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/mypage?tab=portfolio');
  await expect(page.getByRole('heading', { name: 'PortFolio' })).toBeVisible({ timeout: 15000 });

  // 포맷 카드에는 '포맷 A' 같은 이름과 설명을 두지 않는다 — 단서는 표지 그림과 판형 배지다
  const body = await page.locator('main').innerText();
  expect(body).not.toContain('포맷 A');
  expect(body).not.toContain('포맷 B');

  // 내용 입력칸이 여기 있으면 안 된다
  await expect(page.getByPlaceholder('작가 소개·약력을 입력하세요.')).toHaveCount(0);
  await ctx.close();
});
