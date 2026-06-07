import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor, applyToExhibition } from '../lib/helpers';

/**
 * 지원서(고정 양식) 갤러리 열람 + 등록 폼 약관(placeholder 아님) 검증.
 */
const API = 'http://localhost:4000/api';

test('갤러리 지원자 관리에서 작가 제출 지원서(약력) 표시', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const gTok = tokenFor('gallery'); const adminTok = tokenFor('admin');
  const gal = await (await api.get(`${API}/galleries?owned=true`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  const galleryId = (gal.galleries || gal).find((g: any) => g.status === 'APPROVED').id;
  const future = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const ex = await (await api.post(`${API}/exhibitions`, {
    headers: { Authorization: `Bearer ${gTok}` },
    data: { title: '지원서열람공모 ' + Date.now(), type: 'SOLO', deadlineStart: new Date().toISOString().slice(0, 10), deadline: future, exhibitStartDate: future, exhibitDate: future, capacity: 5, region: '서울', description: 'x', galleryId },
  })).json();
  await api.patch(`${API}/approvals/exhibition/${ex.id}`, { headers: { Authorization: `Bearer ${adminTok}` }, data: { status: 'APPROVED' } });
  await applyToExhibition(api, ex.id, tokenFor('artist'), { biography: 'E2E_제출약력_표시확인' });
  await api.dispose();

  const { page, ctx } = await openAs(browser, 'gallery');
  await page.goto(`/exhibitions/${ex.id}`);
  await page.getByText('지원자 관리', { exact: false }).click();
  await expect(page.getByText('Artist 1', { exact: false }).first()).toBeVisible({ timeout: 10000 });
  // 지원자 펼치기 (이름 클릭은 포트폴리오 이동이므로 행의 펼치기 chevron 클릭) → 지원서 내용 표시
  await page.locator('svg.lucide-chevron-down').first().click();
  await expect(page.getByText('지원서 내용', { exact: false }).first()).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('E2E_제출약력_표시확인', { exact: false })).toBeVisible({ timeout: 8000 });
  await ctx.close();
});

test('등록 폼 약관이 placeholder가 아닌 실제 약관 텍스트', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'gallery');

  // 갤러리 등록 폼
  await page.goto('/mypage');
  await page.getByText('내 갤러리', { exact: false }).first().click();
  await page.getByRole('button', { name: '갤러리 등록' }).click();
  await expect(page.locator('body')).toContainText('갤러리 등록 약관', { timeout: 8000 });
  await expect(page.locator('body')).not.toContainText('sample_약관');

  // 공모 등록 폼
  await page.goto('/mypage');
  await page.getByText('내 공모', { exact: false }).first().click();
  await page.getByRole('button', { name: '공모 등록' }).click();
  await expect(page.locator('body')).toContainText('공모 등록 약관', { timeout: 8000 });

  // 전시 등록 폼
  await page.goto('/mypage');
  await page.getByText('내 전시', { exact: false }).first().click();
  await page.getByRole('button', { name: '전시 등록' }).click();
  await expect(page.locator('body')).toContainText('전시 등록 약관', { timeout: 8000 });
  await expect(page.locator('body')).not.toContainText('sample_약관');

  await ctx.close();
});
