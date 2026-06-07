import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor, applyToExhibition } from '../lib/helpers';

/**
 * 리뷰 작성 UI: 수락된 지원이 있는 작가가 갤러리 상세에서 별점+내용 리뷰 작성 → 노출 + 갤러리 별점 반영.
 * 전제(API): 작가 지원 → 갤러리가 수락(ACCEPTED) → reviewable 됨.
 */
const API = 'http://localhost:4000/api';

let exId: number, galleryId: number, exTitle: string;

test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  const gTok = tokenFor('gallery'); const aTok = tokenFor('artist');
  const myEx = await (await api.get(`${API}/exhibitions/my-exhibitions`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  const ex = (Array.isArray(myEx) ? myEx : myEx.exhibitions || []).find((e: any) => e.status === 'APPROVED');
  exId = ex.id; galleryId = ex.galleryId; exTitle = ex.title;

  await applyToExhibition(api, exId, aTok);

  // 지원 수락
  const apps = await (await api.get(`${API}/exhibitions/${exId}/applications`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  const app = (apps.applications || apps)[0];
  await api.patch(`${API}/exhibitions/${exId}/applications/${app.id}`, { headers: { Authorization: `Bearer ${gTok}` }, data: { status: 'REVIEWED' } });
  await api.patch(`${API}/exhibitions/${exId}/applications/${app.id}`, { headers: { Authorization: `Bearer ${gTok}` }, data: { status: 'ACCEPTED' } });
  await api.dispose();
});

test('수락된 작가가 리뷰 작성 → 노출 + 갤러리 별점 반영', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  const CONTENT = '정말 좋은 전시 경험이었습니다 ' + Date.now();

  await page.goto(`/galleries/${galleryId}`);
  // 리뷰 작성 폼: 공모 선택 + 별점 + 내용
  await expect(page.getByText('리뷰 작성', { exact: false }).first()).toBeVisible({ timeout: 10000 });
  await page.locator('select').filter({ has: page.getByRole('option', { name: exTitle }) }).selectOption({ label: exTitle });

  // 별점: 4번째 별 클릭(=4점) → 기본 5점에서 변경되는지
  const stars = page.locator('button:has(svg.lucide-star)');
  await stars.nth(3).click();
  await page.getByPlaceholder('리뷰를 작성해주세요').fill(CONTENT);

  // 제출(폼 등록) → 확인 다이얼로그 등록
  await page.getByRole('button', { name: '등록', exact: true }).first().click();
  await page.getByRole('button', { name: '등록', exact: true }).last().click();
  await expect(page.locator('body')).toContainText('리뷰가 등록되었습니다', { timeout: 8000 });

  // 리뷰 내용 노출 + 갤러리 별점이 0이 아니게 반영
  await expect(page.getByText(CONTENT, { exact: false })).toBeVisible({ timeout: 8000 });
  const api = await pwRequest.newContext();
  const g = await (await api.get(`${API}/galleries/${galleryId}`)).json();
  await api.dispose();
  expect(g.rating, '리뷰 후 별점 반영(>0)').toBeGreaterThan(0);

  await ctx.close();
});
