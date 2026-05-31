import { test, expect } from '@playwright/test';
import { openAs } from '../lib/helpers';

/**
 * 라이프사이클(UI 폼): 갤러리 등록 폼 작성 → 관리자 승인/거절 → 공개 노출 / 거절사유 전달.
 * (지원→상태→리뷰 하류는 03 + 감사 API로 이미 커버)
 */

async function registerGallery(page: any, name: string) {
  await page.goto('/mypage');
  await page.getByText('내 갤러리', { exact: false }).first().click();
  await page.getByRole('button', { name: '갤러리 등록' }).click();
  await page.getByPlaceholder('갤러리명 *').fill(name);
  await page.getByPlaceholder('주소 *').fill('서울시 종로구 테스트로 1');
  await page.getByPlaceholder('대표자명 *').fill('홍길동');
  await page.getByPlaceholder('전화번호 *').fill('02-1234-5678');
  await page.getByPlaceholder('한줄 소개 *').fill('E2E 테스트용 갤러리입니다');
  // 약관 동의 체크(제출 버튼 활성화 조건)
  await page.locator('label', { hasText: '위 약관에 동의합니다' }).getByRole('checkbox').check();
  // 폼 제출 → 확인 다이얼로그 → 확인
  await page.getByRole('button', { name: '등록 요청' }).first().click();
  await page.getByRole('button', { name: '등록 요청' }).last().click();
  await expect(page.locator('body')).toContainText('갤러리 등록 요청이 제출되었습니다', { timeout: 8000 });
}

test('갤러리 등록(폼) → 관리자 승인(UI) → 공개 목록 노출', async ({ browser }) => {
  const NAME = 'E2E 승인될 갤러리';
  const gallery = await openAs(browser, 'gallery');
  const admin = await openAs(browser, 'admin');

  await registerGallery(gallery.page, NAME);

  // 관리자: 승인 대기에서 해당 카드 승인
  await admin.page.goto('/mypage');
  await admin.page.getByText('승인 관리', { exact: false }).first().click();
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
  await gallery.page.getByText('내 갤러리', { exact: false }).first().click();
  await gallery.page.getByRole('button', { name: '갤러리 등록' }).click();
  // 갤러리명을 비운 채 나머지만 채우고 동의
  await gallery.page.getByPlaceholder('주소 *').fill('주소만 입력');
  await gallery.page.getByPlaceholder('대표자명 *').fill('홍길동');
  await gallery.page.getByPlaceholder('전화번호 *').fill('02-0000-0000');
  await gallery.page.getByPlaceholder('한줄 소개 *').fill('소개');
  await gallery.page.locator('label', { hasText: '위 약관에 동의합니다' }).getByRole('checkbox').check();
  await gallery.page.getByRole('button', { name: '등록 요청' }).first().click();
  // 필수 누락 안내 + 확인 다이얼로그로 진행되지 않음
  await expect(gallery.page.locator('body')).toContainText('필수 항목을 모두 입력해주세요', { timeout: 8000 });
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
  await admin.page.getByText('승인 관리', { exact: false }).first().click();
  const card = admin.page.locator('div.border').filter({ hasText: NAME }).first();
  await expect(card).toBeVisible({ timeout: 8000 });
  await card.getByRole('button', { name: '거절' }).click();
  await card.getByPlaceholder('거절 사유를 입력하세요 (필수)').fill(REASON);
  await card.getByRole('button', { name: '거절 확인' }).click();
  await expect(admin.page.locator('body')).toContainText('거절되었습니다', { timeout: 8000 });

  // 갤러리: 내 갤러리에서 거절 사유 확인
  await gallery.page.goto('/mypage');
  await gallery.page.getByText('내 갤러리', { exact: false }).first().click();
  await expect(gallery.page.getByText(REASON, { exact: false })).toBeVisible({ timeout: 8000 });

  await gallery.ctx.close();
  await admin.ctx.close();
});
