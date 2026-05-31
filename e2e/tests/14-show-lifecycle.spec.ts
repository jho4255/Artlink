import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor } from '../lib/helpers';

/**
 * 전시(Show) 등록 → 관리자 승인 → 공개 전시 목록 노출 + 작가 배열 파싱.
 * (등록은 API: 폼이 포스터 ImageUpload 포함 → 노출/승인 흐름은 UI/검증)
 */
const API = 'http://localhost:4000/api';

test('전시 등록 → 승인 → /shows 노출', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const gTok = tokenFor('gallery'); const adminTok = tokenFor('admin');
  const TITLE = 'E2E 전시 ' + Date.now();

  const gal = await (await api.get(`${API}/galleries?owned=true`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  const galleryId = (gal.galleries || gal).find((g: any) => g.status === 'APPROVED').id;

  const show = await (await api.post(`${API}/shows`, {
    headers: { Authorization: `Bearer ${gTok}` },
    data: {
      title: TITLE, description: '전시 설명', startDate: '2027-06-01', endDate: '2027-06-30',
      openingHours: '10:00-18:00', admissionFee: '무료', location: '1관', region: '서울',
      artists: ['김작가', '이작가'], posterImage: '/uploads/poster.png', galleryId,
    },
  })).json();
  expect(show.id, '전시 생성').toBeTruthy();

  // 승인 전: 공개 목록에 안 보임
  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/shows');
  await page.waitForTimeout(1500);
  await expect(page.getByText(TITLE, { exact: false })).toHaveCount(0);

  // 관리자 승인 → 공개 노출
  await api.patch(`${API}/approvals/show/${show.id}`, { headers: { Authorization: `Bearer ${adminTok}` }, data: { status: 'APPROVED' } });
  await page.goto('/shows');
  await expect(page.getByText(TITLE, { exact: false })).toBeVisible({ timeout: 10000 });

  // 상세에서 작가 배열 파싱 확인
  await page.getByText(TITLE, { exact: false }).first().click();
  await expect(page.getByText('김작가', { exact: false }).first()).toBeVisible({ timeout: 8000 });

  await api.dispose();
  await ctx.close();
});
