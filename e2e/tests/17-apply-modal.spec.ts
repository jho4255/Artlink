import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor } from '../lib/helpers';

/**
 * 지원 모달(고정 양식): 작가약력(필수) + 경력 + 작품사진(1장 이상 필수) + 포트폴리오 파일.
 * - 빈 제출 → 검증 차단
 * - 약력 + 작품사진 + 경력/파일 '없음' → 제출 성공 → 지원 내역 반영
 */
const API = 'http://localhost:4000/api';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('고정 양식 지원: 검증 차단 → 정상 제출 → 지원 내역 반영', async ({ browser }) => {
  // 공모 생성 + 승인 (customFields 없음 — 제거된 기능)
  const api = await pwRequest.newContext();
  const gTok = tokenFor('gallery'); const adminTok = tokenFor('admin');
  const gal = await (await api.get(`${API}/galleries?owned=true`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  const galleryId = (gal.galleries || gal).find((g: any) => g.status === 'APPROVED').id;
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const ex = await (await api.post(`${API}/exhibitions`, {
    headers: { Authorization: `Bearer ${gTok}` },
    data: { title: '고정양식공모 ' + Date.now(), type: 'SOLO', deadlineStart: today, deadline: future, exhibitStartDate: future, exhibitDate: future, capacity: 5, region: '서울', description: '고정 양식 지원 테스트', galleryId },
  })).json();
  await api.patch(`${API}/approvals/exhibition/${ex.id}`, { headers: { Authorization: `Bearer ${adminTok}` }, data: { status: 'APPROVED' } });
  await api.dispose();

  const { page, ctx } = await openAs(browser, 'artist2'); // artist2: 포트폴리오 비어있어 깨끗한 폼
  await page.goto(`/exhibitions/${ex.id}`);

  // 지원하기 → 모달
  await page.getByRole('button', { name: '지원하기' }).first().click();
  await expect(page.getByText('지원서 작성', { exact: false })).toBeVisible({ timeout: 8000 });

  // 1) 빈 제출 → 검증 토스트
  await page.getByRole('button', { name: '지원하기' }).last().click();
  await expect(page.locator('body')).toContainText('다음 항목을 확인해주세요', { timeout: 8000 });

  // 2) 약력 입력
  await page.getByPlaceholder('작가 소개·약력을 입력하세요.').fill('E2E 지원 약력');

  // 3) 작품사진 1장 업로드 (image 파일 input)
  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({ name: 'art.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('img[src*="/uploads/"]').first()).toBeVisible({ timeout: 12000 });

  // 4) 경력 3종 + 포트폴리오 파일 '없음' 체크 (빈칸 제출 게이트 통과)
  const nones = page.getByText('없음', { exact: true });
  const cnt = await nones.count();
  for (let i = 0; i < cnt; i++) await nones.nth(i).click();

  // 5) 제출 → 확인 다이얼로그 → 지원하기
  await page.getByRole('button', { name: '지원하기' }).last().click();
  await page.getByRole('button', { name: '지원하기' }).last().click();
  await expect(page.locator('body')).toContainText(/지원이 완료|지원.*완료/, { timeout: 10000 });

  // 지원 내역 반영
  await page.goto('/mypage');
  await page.getByText('지원 내역', { exact: false }).first().click();
  await expect(page.getByText('고정양식공모', { exact: false }).first()).toBeVisible({ timeout: 8000 });
  await ctx.close();
});
