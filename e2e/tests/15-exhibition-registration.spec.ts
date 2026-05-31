import { test, expect } from '@playwright/test';
import { openAs } from '../lib/helpers';

/**
 * 공모 등록 풀 UI 폼: 갤러리선택 + 제목 + 4개 날짜 + 소개 + 약관동의 → 등록요청
 * → 관리자 승인(UI) → 작가 검색(/exhibitions)에 노출.
 */
test('공모 등록(4날짜 폼) → 관리자 승인 → 모집공고 노출', async ({ browser }) => {
  const TITLE = 'E2E 공모 ' + Date.now();
  const gallery = await openAs(browser, 'gallery');
  const admin = await openAs(browser, 'admin');

  // 갤러리: 공모 등록 폼
  await gallery.page.goto('/mypage');
  await gallery.page.getByText('내 공모', { exact: false }).first().click();
  await gallery.page.getByRole('button', { name: '공모 등록' }).click();

  // 갤러리 선택(승인된 시드 갤러리)
  await gallery.page.locator('select', { has: gallery.page.getByRole('option', { name: '갤러리 선택 *' }) })
    .selectOption({ label: '서울 현대 갤러리' });
  await gallery.page.getByPlaceholder('공모 제목 *').fill(TITLE);
  await gallery.page.getByPlaceholder('간단 소개 *').fill('E2E 공모 소개입니다');

  // 4개 날짜: 공모시작=오늘(접수중) ≤ 마감 ≤ 전시시작 ≤ 전시종료 (미래)
  // 공모시작이 미래면 /exhibitions(접수중 목록)에 안 뜨므로 오늘부터 시작하게 설정
  const d = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
  const dates = gallery.page.locator('input[type="date"]');
  await dates.nth(0).fill(d(0));    // 공모 시작 = 오늘
  await dates.nth(1).fill(d(60));   // 공모 마감
  await dates.nth(2).fill(d(90));   // 전시 시작
  await dates.nth(3).fill(d(120));  // 전시 종료

  // 약관 동의 → 등록 요청 → 확인 다이얼로그
  await gallery.page.locator('label', { hasText: '위 약관에 동의합니다' }).getByRole('checkbox').check();
  await gallery.page.getByRole('button', { name: '등록 요청' }).first().click();
  await gallery.page.getByRole('button', { name: '등록 요청' }).last().click();
  await expect(gallery.page.locator('body')).toContainText('공모 등록 요청이 제출되었습니다', { timeout: 8000 });

  // 관리자 승인
  await admin.page.goto('/mypage');
  await admin.page.getByText('승인 관리', { exact: false }).first().click();
  const card = admin.page.locator('div.border').filter({ hasText: TITLE }).first();
  await expect(card).toBeVisible({ timeout: 8000 });
  await card.getByRole('button', { name: '승인' }).click();
  await expect(admin.page.locator('body')).toContainText('승인되었습니다', { timeout: 8000 });

  // 작가: 모집공고에 노출
  const artist = await openAs(browser, 'artist');
  await artist.page.goto('/exhibitions');
  await expect(artist.page.getByText(TITLE, { exact: false })).toBeVisible({ timeout: 10000 });

  await gallery.ctx.close();
  await admin.ctx.close();
  await artist.ctx.close();
});
