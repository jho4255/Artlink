import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, userIds, tokenFor } from '../lib/helpers';

/**
 * 고객센터: FAQ 노출/펼침 + 1:1 문의 작성 → 관리자 답변 → 작성자 화면에 답변·ANSWERED 반영.
 */
const API = 'http://localhost:4000/api';

test('FAQ 노출 + 아코디언 펼침', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const adminTok = tokenFor('admin');
  const Q = 'E2E 자주 묻는 질문?';
  const A = 'E2E 답변 내용입니다';
  await api.post(`${API}/inquiries/faq`, { headers: { Authorization: `Bearer ${adminTok}` }, data: { question: Q, answer: A, order: 0 } });
  await api.dispose();

  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/support'); // 기본 FAQ 탭
  await expect(page.getByText(Q, { exact: false })).toBeVisible({ timeout: 8000 });
  await page.getByText(Q, { exact: false }).click(); // 아코디언 펼침
  await expect(page.getByText(A, { exact: false })).toBeVisible({ timeout: 5000 });
  await ctx.close();
});

test('1:1 문의 작성 → 관리자 답변 → 작성자 화면에 답변 표시', async ({ browser }) => {
  const SUBJECT = 'E2E 문의 ' + Date.now();
  const REPLY = 'E2E 관리자 답변입니다';
  const { page, ctx } = await openAs(browser, 'artist');

  await page.goto('/support');
  await page.getByRole('button', { name: '1:1 문의' }).click();
  await page.getByRole('button', { name: '문의하기' }).click();
  await page.getByPlaceholder('문의 제목을 입력해주세요').fill(SUBJECT);
  await page.getByPlaceholder('문의 내용을 자세히 작성해주세요').fill('테스트 문의 내용');
  await page.getByRole('button', { name: '등록', exact: true }).click();
  await expect(page.locator('body')).toContainText('문의가 등록되었습니다', { timeout: 8000 });

  // 관리자가 답변 (API) — 내 문의 id 찾기
  const api = await pwRequest.newContext();
  const aTok = tokenFor('artist'); const adminTok = tokenFor('admin');
  const mine = await (await api.get(`${API}/inquiries`, { headers: { Authorization: `Bearer ${aTok}` } })).json();
  const inq = (mine.inquiries || mine).find((i: any) => i.subject === SUBJECT);
  expect(inq, '내 문의가 목록에 있어야').toBeTruthy();
  await api.patch(`${API}/inquiries/${inq.id}/reply`, { headers: { Authorization: `Bearer ${adminTok}` }, data: { reply: REPLY } });
  await api.dispose();

  // 작성자: 문의 목록에서 해당 문의 펼쳐 답변 확인
  await page.goto('/support');
  await page.getByRole('button', { name: '1:1 문의' }).click();
  await expect(page.getByText(SUBJECT, { exact: false }).first()).toBeVisible({ timeout: 8000 });
  await page.getByText(SUBJECT, { exact: false }).first().click(); // 아코디언 펼침
  await expect(page.getByText(REPLY, { exact: false })).toBeVisible({ timeout: 5000 });
  await ctx.close();
});
