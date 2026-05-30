import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor } from '../lib/helpers';

const API = 'http://localhost:4000/api';

/**
 * Tier3 엣지: 정원 초과 지원(알려진 갭) + 권한 매트릭스(UI 레벨).
 */

test('정원(capacity) 초과 지원이 서버에서 차단되어야 함 — 현재 미구현(알려진 갭)', async () => {
  test.fail(); // 현재 백엔드는 정원 초과를 막지 않음 → 이 테스트는 의도적으로 실패 표시(구현되면 알림)
  const api = await pwRequest.newContext();
  const gTok = tokenFor('gallery'); const adminTok = tokenFor('admin');
  const aTok = tokenFor('artist'); const a2Tok = tokenFor('artist2');

  // 정원 1명짜리 공모 생성 + 승인
  const gal = await (await api.get(`${API}/galleries?owned=true`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  const galleryId = (gal.galleries || gal).find((g: any) => g.status === 'APPROVED').id;
  const created = await (await api.post(`${API}/exhibitions`, {
    headers: { Authorization: `Bearer ${gTok}` },
    data: { title: '정원1명공모', type: 'SOLO', deadline: '2027-12-31', exhibitDate: '2028-01-31', capacity: 1, region: '서울', description: '정원 테스트', galleryId },
  })).json();
  await api.patch(`${API}/approvals/exhibition/${created.id}`, { headers: { Authorization: `Bearer ${adminTok}` }, data: { status: 'APPROVED' } });

  // 1명 지원(정원 충족)
  const first = await api.post(`${API}/exhibitions/${created.id}/apply`, { headers: { Authorization: `Bearer ${aTok}` }, data: { customAnswers: [] } });
  expect(first.ok()).toBeTruthy();
  // 2번째 지원 → 정원 초과이므로 차단(400)되어야 함 (현재는 201로 통과됨 → 이 expect가 실패 → 갭 노출)
  const second = await api.post(`${API}/exhibitions/${created.id}/apply`, { headers: { Authorization: `Bearer ${a2Tok}` }, data: { customAnswers: [] } });
  await api.dispose();
  expect(second.status(), '정원 초과 2번째 지원은 막혀야 함').toBe(400);
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
