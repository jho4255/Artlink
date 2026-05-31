import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor } from '../lib/helpers';

/**
 * 지원 모달(커스텀 필드) UI: 커스텀 질문이 있는 공모에 작가가 지원 → 모달에서 답변 입력 → 제출.
 */
const API = 'http://localhost:4000/api';

test('커스텀 필드 공모에 지원 모달로 답변 입력 후 지원', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const gTok = tokenFor('gallery'); const adminTok = tokenFor('admin');
  const gal = await (await api.get(`${API}/galleries?owned=true`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  const galleryId = (gal.galleries || gal).find((g: any) => g.status === 'APPROVED').id;
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);

  const ex = await (await api.post(`${API}/exhibitions`, {
    headers: { Authorization: `Bearer ${gTok}` },
    data: {
      title: '커스텀필드공모 ' + Date.now(), type: 'SOLO',
      deadlineStart: today, deadline: future, exhibitStartDate: future, exhibitDate: future,
      capacity: 5, region: '서울', description: '커스텀 지원 테스트', galleryId,
      customFields: [{ id: 'q1', label: '작품 설명', type: 'text', required: true }],
    },
  })).json();
  await api.patch(`${API}/approvals/exhibition/${ex.id}`, { headers: { Authorization: `Bearer ${adminTok}` }, data: { status: 'APPROVED' } });
  await api.dispose();

  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto(`/exhibitions/${ex.id}`);

  // 지원하기 → 모달 → 답변 입력 → 모달 지원하기 → 확인 다이얼로그 지원하기
  await page.getByRole('button', { name: '지원하기' }).first().click();
  await expect(page.getByText('지원 정보 입력', { exact: false })).toBeVisible({ timeout: 8000 });
  await page.getByPlaceholder('입력해주세요').first().fill('추상 회화 연작 3점');
  await page.getByRole('button', { name: '지원하기' }).last().click();   // 모달 제출
  await page.getByRole('button', { name: '지원하기' }).last().click();   // 확인 다이얼로그
  await expect(page.locator('body')).toContainText(/지원.*완료|지원하였습니다|지원이 접수/, { timeout: 8000 });

  // 작가 지원 내역에 반영
  await page.goto('/mypage');
  await page.getByText('지원 내역', { exact: false }).first().click();
  await expect(page.getByText('커스텀필드공모', { exact: false }).first()).toBeVisible({ timeout: 8000 });
  await ctx.close();
});
