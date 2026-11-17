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

  // '해운대' 검색 — 휴대폰은 돋보기 단추를 눌러야 칸이 열린다(2026-11-15 개편, PC 는 제목 줄에 늘 있다)
  const opener = page.getByRole('button', { name: '갤러리 검색' });
  if (await opener.isVisible()) await opener.click();
  const box = page.getByPlaceholder('갤러리 이름·주소 검색');
  await box.fill('해운대');
  await box.press('Enter');

  await expect(page.getByText('부산 해운대 아트센터', { exact: false }).first()).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('서울 현대 갤러리', { exact: false })).toHaveCount(0);
  // 걸린 검색어는 칸에 그대로 보인다(주소의 ?q= 와 같다) — 무엇으로 거른 목록인지 알 수 있게
  await expect(box).toHaveValue('해운대');
  await expect(page).toHaveURL(/[?&]q=%ED%95%B4%EC%9A%B4%EB%8C%80/);

  // 검색어 지우기 → 전체 복원
  await page.getByRole('button', { name: '검색어 지우기' }).click();
  await expect(page.getByText('서울 현대 갤러리', { exact: false }).first()).toBeVisible({ timeout: 8000 });

  await ctx.close();
});
