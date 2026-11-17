import { test, expect } from '@playwright/test';
import { openAs, openMyPageTab, submitRegistration } from '../lib/helpers';

/**
 * 라이프사이클(UI 폼): 갤러리 등록 폼 작성 → 관리자 승인/거절 → 공개 노출 / 거절사유 전달.
 * (지원→상태→리뷰 하류는 03 + 감사 API로 이미 커버)
 */

async function registerGallery(page: any, name: string) {
  await page.goto('/mypage');
  await openMyPageTab(page, '내 갤러리', 'gallery');
  await page.getByRole('button', { name: '갤러리 등록' }).click();
  await page.getByPlaceholder('갤러리명').fill(name);
  await page.getByPlaceholder('주소', { exact: true }).fill('서울시 종로구 테스트로 1');
  await page.getByPlaceholder('대표자명').fill('홍길동');
  await page.getByPlaceholder('전화번호').fill('02-1234-5678');
  await page.getByPlaceholder('갤러리 한줄 소개').fill('E2E 테스트용 갤러리입니다');
  // 하단 줄 [등록 요청] → 확인 창에서 약관 동의 → [등록 요청] (2026-11-15 — 약관은 확인 창 안)
  await submitRegistration(page);
  await expect(page.locator('body')).toContainText('갤러리 등록 요청이 제출되었습니다', { timeout: 8000 });
}

test('갤러리 등록(폼) → 관리자 승인(UI) → 공개 목록 노출', async ({ browser }) => {
  const NAME = 'E2E 승인될 갤러리';
  const gallery = await openAs(browser, 'gallery');
  const admin = await openAs(browser, 'admin');

  await registerGallery(gallery.page, NAME);

  // 관리자: 승인 대기에서 해당 카드 승인
  await admin.page.goto('/mypage');
  await openMyPageTab(admin.page, '승인 관리', 'admin');
  const card = admin.page.locator('div.border').filter({ hasText: NAME }).first();
  await expect(card).toBeVisible({ timeout: 8000 });
  await card.getByRole('button', { name: '승인' }).click();
  await expect(admin.page.locator('body')).toContainText('승인되었습니다', { timeout: 8000 });

  // 공개 갤러리 목록에 노출
  await gallery.page.goto('/galleries');
  await expect(gallery.page.getByText(NAME, { exact: false }).first()).toBeVisible({ timeout: 10000 });

  await gallery.ctx.close();
  await admin.ctx.close();
});

test('폼 검증: 필수 항목(갤러리명) 누락 시 등록 거절 + 안내', async ({ browser }) => {
  const gallery = await openAs(browser, 'gallery');
  await gallery.page.goto('/mypage');
  await openMyPageTab(gallery.page, '내 갤러리', 'gallery');
  await gallery.page.getByRole('button', { name: '갤러리 등록' }).click();
  // 갤러리명을 비운 채 나머지만 채우고 동의
  await gallery.page.getByPlaceholder('주소', { exact: true }).fill('주소만 입력');
  await gallery.page.getByPlaceholder('대표자명').fill('홍길동');
  await gallery.page.getByPlaceholder('전화번호').fill('02-0000-0000');
  await gallery.page.getByPlaceholder('갤러리 한줄 소개').fill('소개');
  await gallery.page.locator('[data-submit-bar]').getByRole('button', { name: '등록 요청', exact: true }).click();
  // 필수 누락 — 하단 줄이 남은 칸을 말하고, 그 칸(갤러리 이름)으로 데려간다. 확인 창으로 넘어가지 않는다
  await expect(gallery.page.locator('[data-submit-bar]')).toContainText('남은 필수 1 · 갤러리 이름');
  await expect(gallery.page.getByPlaceholder('갤러리명')).toBeFocused();
  await expect(gallery.page.getByRole('dialog')).toHaveCount(0);
  await expect(gallery.page.locator('body')).not.toContainText('갤러리 등록 요청이 제출되었습니다');
  await gallery.ctx.close();
});

test('갤러리 등록 → 관리자 거절(사유) → 갤러리 화면에 거절+사유 표시', async ({ browser }) => {
  const NAME = 'E2E 거절될 갤러리';
  const REASON = '정보가 불충분합니다 (E2E)';
  const gallery = await openAs(browser, 'gallery');
  const admin = await openAs(browser, 'admin');

  await registerGallery(gallery.page, NAME);

  // 관리자: 거절 + 사유
  await admin.page.goto('/mypage');
  await openMyPageTab(admin.page, '승인 관리', 'admin');
  const card = admin.page.locator('div.border').filter({ hasText: NAME }).first();
  await expect(card).toBeVisible({ timeout: 8000 });
  await card.getByRole('button', { name: '거절' }).click();
  await card.getByPlaceholder('거절 사유를 입력하세요 (필수)').fill(REASON);
  await card.getByRole('button', { name: '거절 확인' }).click();
  await expect(admin.page.locator('body')).toContainText('거절되었습니다', { timeout: 8000 });

  // 갤러리: 내 갤러리에서 거절 사유 확인
  await gallery.page.goto('/mypage');
  await openMyPageTab(gallery.page, '내 갤러리', 'gallery');
  await expect(gallery.page.getByText(REASON, { exact: false })).toBeVisible({ timeout: 8000 });

  await gallery.ctx.close();
  await admin.ctx.close();
});
