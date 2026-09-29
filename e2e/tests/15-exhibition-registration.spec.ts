import { test, expect } from '@playwright/test';
import { openAs, openMyPageTab } from '../lib/helpers';

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
  await openMyPageTab(gallery.page, '내 공모', 'gallery');
  await gallery.page.getByRole('button', { name: '공모 등록' }).click();

  // 갤러리 선택(승인된 시드 갤러리) — 칸마다 라벨과 id 가 있다(2026-09-29)
  await gallery.page.locator('#ex-gallery').selectOption({ label: '서울 현대 갤러리' });
  await gallery.page.getByPlaceholder('공모 제목').fill(TITLE);
  await gallery.page.getByPlaceholder('공모 소개').fill('E2E 공모 소개입니다');

  /* 날짜 5칸 — 2026-08-19 에 **[작가 자료제출 마감일]이 필수로 추가**됐다.
     순서 규칙: 공모마감 < 자료제출마감 < 전시시작 (서버가 검사한다).
     2026-09-29 부터 칸이 **일어나는 순서대로** 놓인다(예전엔 자료제출 마감이 맨 끝이었다) — 위치 대신 id 로 채운다. */
  const d = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
  await gallery.page.locator('#ex-start').fill(d(0));        // 공모 시작 = 오늘 (미래면 접수중 목록에 안 뜬다)
  await gallery.page.locator('#ex-deadline').fill(d(60));    // 공모 마감
  await gallery.page.locator('#ex-submission').fill(d(75));  // 작가 자료제출 마감 (마감 60 < 75 < 전시시작 90)
  await gallery.page.locator('#ex-show-start').fill(d(90));  // 전시 시작
  await gallery.page.locator('#ex-show-end').fill(d(120));   // 전시 종료
  // 한눈에 보는 일정 줄 — 칸을 채우면 아래에 요약이 뜬다
  await expect(gallery.page.getByText(/지원 \d+\/\d+–\d+\/\d+ · 자료 제출 ~\d+\/\d+ · 전시/)).toBeVisible();

  // 약관 동의 → 등록 요청 → 확인 다이얼로그
  await gallery.page.locator('label', { hasText: '위 약관에 동의합니다' }).getByRole('checkbox').check();
  await gallery.page.getByRole('button', { name: '등록 요청' }).first().click();
  await gallery.page.getByRole('dialog').getByRole('button', { name: '등록 요청' }).click();
  await expect(gallery.page.locator('body')).toContainText('공모 등록 요청이 제출되었습니다', { timeout: 8000 });

  // 관리자 승인
  await admin.page.goto('/mypage');
  await openMyPageTab(admin.page, '승인 관리', 'admin');
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
