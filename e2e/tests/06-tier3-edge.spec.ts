import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor, applyToExhibition, exhibitionDates } from '../lib/helpers';

const API = 'http://localhost:4000/api';

/**
 * Tier3 엣지: 정원(=선정 인원) + 권한 매트릭스(UI 레벨).
 */

// 2026-09-27 — 정원은 '선정 인원'이다(사용자 결정). 지원은 무제한, 수락이 정원까지만 된다.
test('정원(capacity)은 선정 인원 — 지원은 넘겨도 받고, 수락은 정원까지만', async () => {
  const api = await pwRequest.newContext();
  const gTok = tokenFor('gallery'); const adminTok = tokenFor('admin');
  const aTok = tokenFor('artist'); const a2Tok = tokenFor('artist2');

  const gal = await (await api.get(`${API}/galleries?owned=true`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  const galleryId = (gal.galleries || gal).find((g: any) => g.status === 'APPROVED').id;
  const created = await (await api.post(`${API}/exhibitions`, {
    headers: { Authorization: `Bearer ${gTok}` },
    data: { title: '정원1명공모', type: 'SOLO', deadline: '2027-12-31', exhibitDate: '2028-01-31', capacity: 1, region: 'SEOUL', description: '정원 테스트', galleryId, ...exhibitionDates() },
  })).json();
  await api.patch(`${API}/approvals/exhibition/${created.id}`, { headers: { Authorization: `Bearer ${adminTok}` }, data: { status: 'APPROVED' } });

  const first = await applyToExhibition(api, created.id, aTok);
  const second = await applyToExhibition(api, created.id, a2Tok);
  expect(first.status()).toBe(201);
  expect(second.status(), '정원 1명이어도 두 번째 지원은 받는다').toBe(201);

  const accept = (appId: number) => api.patch(`${API}/exhibitions/${created.id}/applications/${appId}`, { headers: { Authorization: `Bearer ${gTok}` }, data: { status: 'ACCEPTED' } });
  expect((await accept((await first.json()).id)).status()).toBe(200);
  const over = await accept((await second.json()).id);
  expect(over.status(), '정원(1명)을 넘는 수락은 막혀야 함').toBe(400);
  expect((await over.json()).error).toContain('선정 인원');
  await api.dispose();
});

test('권한 매트릭스: Admin은 갤러리 목록에서 찜 버튼이 없다', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'admin');
  await page.goto('/galleries');
  await expect(page.locator('img').first()).toBeVisible({ timeout: 10000 }); // 목록 로드 확인
  await expect(page.getByRole('button', { name: '찜하기' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '찜 해제' })).toHaveCount(0);
  await ctx.close();
});

test('권한 매트릭스: 역할별 마이페이지 메뉴가 다르다', async ({ browser }) => {
  // 작가: 포트폴리오 O / 승인 관리 X
  const a = await openAs(browser, 'artist');
  await a.page.goto('/mypage');
  await expect(a.page.getByText('포트폴리오', { exact: false }).first()).toBeVisible();
  await expect(a.page.getByText('승인 관리', { exact: false })).toHaveCount(0);
  await a.ctx.close();

  // 갤러리: 내 갤러리 O / 포트폴리오 X
  const g = await openAs(browser, 'gallery');
  await g.page.goto('/mypage');
  await expect(g.page.getByText('내 갤러리', { exact: false }).first()).toBeVisible();
  await expect(g.page.getByText('포트폴리오', { exact: false })).toHaveCount(0);
  await g.ctx.close();

  // 관리자: 승인 관리 O / 내 갤러리 X
  const ad = await openAs(browser, 'admin');
  await ad.page.goto('/mypage');
  await expect(ad.page.getByText('승인 관리', { exact: false }).first()).toBeVisible();
  await expect(ad.page.getByText('내 갤러리', { exact: false })).toHaveCount(0);
  await ad.ctx.close();
});
