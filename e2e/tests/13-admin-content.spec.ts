import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor } from '../lib/helpers';

/**
 * Admin 운영 콘텐츠 → 공개 화면 노출. (생성은 API: 폼이 ImageUpload라 UI 구동 까다로움 → 노출은 UI 검증)
 */
const API = 'http://localhost:4000/api';

test('히어로 슬라이드 생성 → 홈 노출', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const adminTok = tokenFor('admin');
  const TITLE = 'E2E 히어로 ' + Date.now();
  await api.post(`${API}/hero-slides`, { headers: { Authorization: `Bearer ${adminTok}` }, data: { title: TITLE, description: '설명', imageUrl: '/uploads/hero.png', linkUrl: '/galleries', order: 99 } });
  await api.dispose();

  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/');
  await expect(page.getByText(TITLE, { exact: false })).toBeVisible({ timeout: 10000 });
  await ctx.close();
});

test('혜택 생성 → 혜택 페이지 노출', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const adminTok = tokenFor('admin');
  const TITLE = 'E2E 혜택 ' + Date.now();
  await api.post(`${API}/benefits`, { headers: { Authorization: `Bearer ${adminTok}` }, data: { title: TITLE, description: 'E2E 혜택 설명' } });
  await api.dispose();

  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/benefits');
  await expect(page.getByText(TITLE, { exact: false })).toBeVisible({ timeout: 10000 });
  await ctx.close();
});
