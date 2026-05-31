import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor } from '../lib/helpers';

/**
 * 탐색(Explore): 포트폴리오 이미지를 '둘러보기 공개'로 켜면 피드에 노출 + 좋아요 반영.
 */
const API = 'http://localhost:4000/api';

test('포트폴리오 이미지 공개 토글 → 탐색 피드 노출 + 좋아요 카운트', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const aTok = tokenFor('artist');

  // 포트폴리오 이미지 확보 + 둘러보기 공개로 설정
  let pf = await (await api.get(`${API}/portfolio`, { headers: { Authorization: `Bearer ${aTok}` } })).json();
  let img = (pf.images || [])[0];
  if (!img) {
    img = await (await api.post(`${API}/portfolio/images`, { headers: { Authorization: `Bearer ${aTok}` }, data: { url: '/uploads/art1.png' } })).json();
  }
  if (!img.showInExplore) {
    await api.patch(`${API}/portfolio/images/${img.id}/explore`, { headers: { Authorization: `Bearer ${aTok}` } });
  }

  // UI: 탐색 피드에 이미지 노출
  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/explore');
  await expect(page.locator('img').first()).toBeVisible({ timeout: 10000 });
  const feedCount = await page.locator('img').count();
  expect(feedCount, '탐색 피드에 공개 이미지가 1개 이상').toBeGreaterThan(0);

  // 좋아요 (다른 유저=gallery가 누름) → 카운트 1 반영
  const gTok = tokenFor('gallery');
  await api.post(`${API}/explore/${img.id}/like`, { headers: { Authorization: `Bearer ${gTok}` } });
  const feed = await (await api.get(`${API}/explore`)).json();
  const arr = feed.images || feed.data || feed;
  const target = (Array.isArray(arr) ? arr : []).find((x: any) => x.id === img.id);
  expect(target?.likeCount, '좋아요 1 반영').toBe(1);

  await api.dispose();
  await ctx.close();
});
