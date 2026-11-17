import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor, applyToExhibition, openApplicantManager, applicantRow, openMyPageTab, exhibitionDates } from '../lib/helpers';

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
    data: { title: '지원서열람공모 ' + Date.now(), type: 'SOLO', deadlineStart: new Date().toISOString().slice(0, 10), deadline: future, exhibitStartDate: future, exhibitDate: future, capacity: 5, region: 'SEOUL', description: 'x', galleryId, ...exhibitionDates() },
  })).json();
  await api.patch(`${API}/approvals/exhibition/${ex.id}`, { headers: { Authorization: `Bearer ${adminTok}` }, data: { status: 'APPROVED' } });
  await applyToExhibition(api, ex.id, tokenFor('artist'), { biography: 'E2E_제출약력_표시확인' });
  await api.dispose();

  const { page, ctx } = await openAs(browser, 'gallery');
  const card = await openApplicantManager(page, ex.title);
  const row = applicantRow(card, 'Artist 1');
  await expect(row).toBeVisible({ timeout: 10000 });
  // 줄을 누르면 펼쳐진다 → 지원서(작가 약력·경력·작품 사진…)와 그 아래 [수락하기]·[거절]
  await row.locator('button[aria-expanded]').first().click();
  await expect(row.getByText('작가 약력', { exact: true })).toBeVisible({ timeout: 8000 });
  await expect(row.getByText('E2E_제출약력_표시확인', { exact: false })).toBeVisible({ timeout: 8000 });
  await expect(row.getByRole('button', { name: '수락하기', exact: true })).toBeVisible();
  await ctx.close();
});

test('등록 폼 약관이 placeholder가 아닌 실제 약관 텍스트', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'gallery');

  /* 2026-11-15 부터 약관은 폼 끝 상자가 아니라 [등록 요청] 확인 창 안([약관 보기]로 펼친다, CLAUDE.md 규칙 84).
     세 폼이 여는 파일이 실제 약관인지는 파일로 보고, 화면은 갤러리 등록에서 끝까지 눌러 본다(공모·전시는 83 이 확인 창을 거쳐 등록한다). */
  for (const [file, head] of [['gallery-registration', '갤러리 등록 약관'], ['exhibition-application', '공모 등록 약관'], ['show-registration', '전시 등록 약관']]) {
    const txt = await (await page.request.get(`/terms/${file}.txt`)).text();
    expect(txt.trimStart().startsWith(`[${head}]`), file).toBe(true);
    expect(txt).not.toContain('sample_약관');
  }

  // 갤러리 등록 폼 — 필수 칸을 채우고 [등록 요청] → 확인 창의 [약관 보기]
  await page.goto('/mypage');
  await openMyPageTab(page, '내 갤러리', 'gallery');
  await page.getByRole('button', { name: '갤러리 등록' }).click();
  await page.getByPlaceholder('갤러리명').fill('약관 확인용');
  await page.getByPlaceholder('갤러리 한줄 소개').fill('소개');
  await page.getByPlaceholder('주소', { exact: true }).fill('서울 종로구 삼일대로 445');
  await page.getByPlaceholder('전화번호').fill('02-0000-0000');
  await page.getByPlaceholder('대표자명').fill('홍길동');
  await page.locator('[data-submit-bar]').getByRole('button', { name: '등록 요청', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '등록을 요청할까요?' });
  await sheet.getByRole('button', { name: /약관 보기/ }).click();
  await expect(sheet).toContainText('갤러리 등록 약관', { timeout: 8000 });
  await expect(sheet).not.toContainText('sample_약관');
  await sheet.getByRole('button', { name: '고치기' }).click();
  await page.evaluate(() => localStorage.removeItem('draft_gallery_form'));
  await ctx.close();
});

