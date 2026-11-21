import { test, expect, request as pwRequest } from '@playwright/test';
import {
  openAs, tokenFor, applyToExhibition, closeRecruitment, createExhibition, ownedGalleryId,
} from '../lib/helpers';

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

  // 이 스펙의 공모를 만든다 — 예전엔 '첫 승인 공모'를 골라 실행 순서에 따라 접수 마감이 지난 시드 공모(지원 400)를 집기도 했다
  exTitle = `E2E 운영조회 ${Date.now()}`;
  exId = await createExhibition(api, { title: exTitle, galleryId: await ownedGalleryId(api), capacity: 3 });

  const detail = await (await api.get(`${API}/exhibitions/${exId}`)).json();
  galleryName = detail.gallery?.name;

  // 작가 지원
  const ar = await applyToExhibition(api, exId, aTok);
  expect(ar.status(), `지원 실패 ${ar.status()}`).toBe(201);

  // 갤러리가 지원자 목록 조회 → 수락 처리
  const apps = await (await api.get(`${API}/exhibitions/${exId}/applications`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  expect(apps.length).toBeGreaterThan(0);
  appUserId = apps[0].user.id;
  await closeRecruitment(api, exId);   // 수락은 모집을 마감한 뒤에만(규칙 90)
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

test('admin UI: 운영 조회(공모·갤러리) · 사용자 관리의 회원 한 명에 지원 이력 (2026-11-21 개편)', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'admin');
  await page.goto('/mypage?tab=oversight');

  // --- 공모: 찾고 → 줄을 눌러 한 건(휴대폰은 창) ---
  await page.getByRole('searchbox', { name: '공모 제목으로 찾기' }).fill(exTitle);
  await page.getByRole('button', { name: exTitle }).first().click();
  const detail = page.getByTestId('ov-ex-detail');
  await expect(detail).toContainText(exTitle, { timeout: 10000 });
  await expect(detail).toContainText('수락됨');
  // 이 갤러리에 몇 번째 지원인지 — 앞 스펙이 같은 작가를 이 갤러리 공모에 먼저 지원시켰으면 '첫 지원'이 아니다(실행 순서에 기대지 않는다)
  await expect(detail).toContainText(/첫 지원|이 갤러리 \d+번째/);
  await page.keyboard.press('Escape');

  // --- 갤러리: 게시물 ---
  await page.getByRole('tab', { name: '갤러리', exact: true }).click();
  await page.getByRole('searchbox', { name: '갤러리 이름으로 찾기' }).fill(galleryName);
  await page.getByRole('button', { name: galleryName }).first().click();
  await expect(page.getByTestId('ov-gallery-detail')).toContainText(exTitle, { timeout: 10000 });
  await page.keyboard.press('Escape');

  // --- 작가 지원 이력은 [사용자 관리]의 회원 한 명으로 옮겼다 ---
  await page.goto('/mypage?tab=user-manage&role=ARTIST&q=Artist%201');
  await page.getByRole('button', { name: /^Artist 1/ }).first().click();
  const user = page.getByTestId('admin-user-detail');
  await expect(user).toContainText('지원 이력', { timeout: 10000 });
  await expect(user).toContainText(exTitle);

  await ctx.close();
});
