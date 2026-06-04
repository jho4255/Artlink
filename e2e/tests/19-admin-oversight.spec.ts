import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor } from '../lib/helpers';

/**
 * Admin 운영 조회: 특정 공모 지원현황/수락·거절 여부, 작가 지원이력, 갤러리 게시물.
 * 셋업(API): 작가 지원 → 갤러리가 수락 처리. 이후 admin 전용 API + UI로 조회 검증.
 */
const API = 'http://localhost:4000/api';

let exId: number;
let exTitle: string;
let galleryName: string;
let appUserId: number;

test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  const gTok = tokenFor('gallery');
  const aTok = tokenFor('artist');

  // 승인된 시드 공모 찾기
  const myEx = await (await api.get(`${API}/exhibitions/my-exhibitions`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  const approved = (Array.isArray(myEx) ? myEx : myEx.exhibitions || []).find((e: any) => e.status === 'APPROVED');
  if (!approved) throw new Error('승인된 시드 공모 없음');
  exId = approved.id; exTitle = approved.title;

  const detail = await (await api.get(`${API}/exhibitions/${exId}`)).json();
  galleryName = detail.gallery?.name;

  // 작가 지원 (이미 지원돼 있어도 OK)
  const answers = (detail.customFields || []).filter((f: any) => f.required).map((f: any) => ({
    fieldId: f.id, value: f.type === 'select' || f.type === 'multiselect' ? (f.options?.[0] ?? '') : '답변',
  }));
  const ar = await api.post(`${API}/exhibitions/${exId}/apply`, { headers: { Authorization: `Bearer ${aTok}` }, data: { customAnswers: answers } });
  expect([200, 201, 400, 409].includes(ar.status()), `지원 실패 ${ar.status()}`).toBeTruthy();

  // 갤러리가 지원자 목록 조회 → 수락 처리
  const apps = await (await api.get(`${API}/exhibitions/${exId}/applications`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  expect(apps.length).toBeGreaterThan(0);
  appUserId = apps[0].user.id;
  await api.patch(`${API}/exhibitions/${exId}/applications/${apps[0].id}`, { headers: { Authorization: `Bearer ${gTok}` }, data: { status: 'ACCEPTED' } });

  await api.dispose();
});

test('admin 전용 API: 공모 지원현황 / 작가 이력 / 갤러리 게시물', async () => {
  const api = await pwRequest.newContext();
  const tok = tokenFor('admin');
  const auth = { Authorization: `Bearer ${tok}` };

  // 1) 공모별 지원현황 + 수락 여부
  const apps = await (await api.get(`${API}/admin/exhibitions/${exId}/applications`, { headers: auth })).json();
  expect(apps.exhibition.title).toBe(exTitle);
  expect(apps.counts.ACCEPTED).toBeGreaterThanOrEqual(1);
  const accepted = apps.applications.find((a: any) => a.status === 'ACCEPTED');
  expect(accepted, '수락된 지원 존재').toBeTruthy();
  expect(accepted.decidedAt).toBeTruthy();

  // 2) 작가 지원이력 (수락 포함)
  const hist = await (await api.get(`${API}/admin/users/${appUserId}/applications`, { headers: auth })).json();
  expect(hist.user.id).toBe(appUserId);
  expect(hist.applications.some((a: any) => a.exhibition?.title === exTitle && a.status === 'ACCEPTED')).toBeTruthy();

  // 3) 갤러리 게시물 (공모 + 전시)
  const galleries = await (await api.get(`${API}/admin/galleries`, { headers: auth })).json();
  const g = galleries.find((x: any) => x.name === galleryName);
  expect(g, '갤러리 검색됨').toBeTruthy();
  const posts = await (await api.get(`${API}/admin/galleries/${g.id}/posts`, { headers: auth })).json();
  expect(posts.exhibitions.some((e: any) => e.id === exId)).toBeTruthy();
  expect(Array.isArray(posts.shows)).toBeTruthy();

  // 권한: 갤러리 토큰으로 admin API 접근 시 403
  const forbidden = await api.get(`${API}/admin/exhibitions/${exId}/applications`, { headers: { Authorization: `Bearer ${tokenFor('gallery')}` } });
  expect(forbidden.status()).toBe(403);

  await api.dispose();
});

test('admin UI: 운영 조회 탭에서 지원현황·작가이력·갤러리 게시물 확인', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'admin');
  await page.goto('/mypage');

  // 운영 조회 탭
  await page.getByRole('button', { name: '운영 조회' }).click();

  // --- 공모 지원현황 (기본 서브탭) ---
  await expect(page.getByText(exTitle, { exact: false }).first()).toBeVisible({ timeout: 10000 });
  await page.getByText(exTitle, { exact: false }).first().click();
  // 지원자 + 수락 배지
  await expect(page.getByText('지원 현황', { exact: false })).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('수락', { exact: false }).first()).toBeVisible({ timeout: 8000 });
  // 첫 지원 하이라이팅 배지 (시드 작가는 이 갤러리 첫 지원)
  await expect(page.getByText('첫 지원', { exact: false }).first()).toBeVisible({ timeout: 8000 });

  // --- 작가 지원이력 ---
  await page.getByRole('button', { name: '작가 지원이력' }).click();
  await page.getByPlaceholder('작가 이름/이메일 검색').fill('Artist 1');
  await page.getByRole('button', { name: '검색' }).click();
  await expect(page.getByText('Artist 1', { exact: false }).first()).toBeVisible({ timeout: 8000 });
  await page.getByText('Artist 1', { exact: false }).first().click();
  await expect(page.getByText('지원 이력', { exact: false })).toBeVisible({ timeout: 8000 });
  await expect(page.getByText(exTitle, { exact: false }).first()).toBeVisible({ timeout: 8000 });

  // --- 갤러리 게시물 ---
  await page.getByRole('button', { name: '갤러리 게시물' }).click();
  await page.getByRole('button', { name: '검색' }).click(); // 전체 목록
  await expect(page.getByText(galleryName, { exact: false }).first()).toBeVisible({ timeout: 8000 });
  await page.getByText(galleryName, { exact: false }).first().click();
  await expect(page.getByText('게시물', { exact: false }).first()).toBeVisible({ timeout: 8000 });
  await expect(page.getByText(exTitle, { exact: false }).first()).toBeVisible({ timeout: 8000 });

  await ctx.close();
});
