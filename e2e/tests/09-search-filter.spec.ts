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

/**
 * ★ 별점 필터·정렬은 2026-09-10 에 없앴다 (별점 자체를 없앴다).
 *
 * 예전엔 [4점 이상] 을 눌러 4.5점짜리만 남는지 봤다. 지금은 **그 버튼이 화면에 없어야** 하고,
 * 옛 주소로 쿼리가 들어와도 **거르지 않아야** 한다(북마크가 죽으면 안 되므로 400 이 아니라 무시).
 */
test('★ 갤러리 목록에 별점 필터·정렬이 없다', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/galleries');
  await expect(page.getByText('부산 해운대 아트센터', { exact: false })).toBeVisible({ timeout: 10000 });

  for (const gone of ['3점 이상', '4점 이상', '별점순', '별점']) {
    await expect(page.getByText(gone, { exact: false }), `'${gone}' 이 남아 있다`).toHaveCount(0);
  }
  // 별점 대신 리뷰 개수로 정렬한다
  await expect(page.getByRole('button', { name: '리뷰순' })).toBeVisible();
  // 별 아이콘도 남아 있으면 안 된다
  expect(await page.locator('svg.lucide-star').count(), '별 아이콘이 남아 있다').toBe(0);
  await ctx.close();
});

test('★ 옛 별점 필터 주소가 와도 거르지 않는다 (북마크가 죽지 않게)', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/galleries?minRating=4');
  // 시드 별점이 0 이던 갤러리들도 그대로 보여야 한다
  await expect(page.getByText('부산 해운대 아트센터', { exact: false })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('대전 예술의 전당', { exact: false })).toBeVisible();
  await ctx.close();
});
