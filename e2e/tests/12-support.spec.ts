import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor } from '../lib/helpers';

/**
 * 고객센터 — 2026-08-28 정리분.
 *
 *  · 머리말('Support / 도움이 필요하신가요')과 [자주 묻는 질문] 탭을 없앴다.
 *    남은 게 1:1 문의 하나뿐이라 탭이 있을 이유가 없고, 화면 이름은 사이드바가 알려준다.
 *    ⚠️ `FaqSection` 과 백엔드 `/api/inquiries/faq` 는 **그대로 살아 있다**(되살릴 수 있게).
 *  · Navbar 가운데 메뉴에서 [고객센터]를 뺐다 → 진입은 사이드바 맨 아래 [1:1 문의].
 *  · 회원 탈퇴는 프로필이 아니라 **이 화면 우측 하단**(로그인 시에만).
 */
const API = 'http://localhost:4000/api';
const DESKTOP = { width: 1440, height: 900 };

test('★ 머리말과 [자주 묻는 질문] 탭이 사라졌다', async ({ browser }) => {
  // FAQ 데이터가 있어도 화면에 나오면 안 된다
  const api = await pwRequest.newContext();
  await api.post(`${API}/inquiries/faq`, {
    headers: { Authorization: `Bearer ${tokenFor('admin')}` },
    data: { question: '되살아나면 안 되는 질문', answer: '되살아나면 안 되는 답', order: 0 },
  });
  await api.dispose();

  const { page, ctx } = await openAs(browser, 'artist');
  await page.setViewportSize(DESKTOP);
  await page.goto('/support');
  await expect(page.getByRole('button', { name: '문의하기' })).toBeVisible({ timeout: 15000 });

  const body = await page.locator('main').innerText();
  expect(body).not.toContain('도움이 필요하신가요');
  expect(body).not.toContain('자주 묻는 질문');
  expect(body).not.toContain('되살아나면 안 되는 질문');
  await ctx.close();
});

test('★ 사이드바 [1:1 문의]가 유일한 진입점이다 (Navbar 에는 고객센터가 없다)', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  await page.setViewportSize(DESKTOP);
  await page.goto('/');

  await expect(page.locator('nav').first()).not.toContainText('고객센터');
  await page.locator('aside nav').getByRole('link', { name: '1:1 문의' }).click();
  await page.waitForURL(/\/support/, { timeout: 10000 });
  await expect(page.getByRole('button', { name: '문의하기' })).toBeVisible({ timeout: 15000 });
  await ctx.close();
});

test('1:1 문의 작성 → 관리자 답변 → 작성자 화면에 답변 표시', async ({ browser }) => {
  const SUBJECT = 'E2E 문의 ' + Date.now();
  const REPLY = 'E2E 관리자 답변입니다';
  const { page, ctx } = await openAs(browser, 'artist');
  await page.setViewportSize(DESKTOP);

  await page.goto('/support');
  await page.getByRole('button', { name: '문의하기' }).click();
  await page.getByPlaceholder('문의 제목을 입력해주세요').fill(SUBJECT);
  await page.getByPlaceholder('문의 내용을 자세히 작성해주세요').fill('테스트 문의 내용');
  await page.getByRole('button', { name: '등록', exact: true }).click();
  await expect(page.locator('body')).toContainText('문의가 등록되었습니다', { timeout: 8000 });

  const api = await pwRequest.newContext();
  const mine = await (await api.get(`${API}/inquiries`, { headers: { Authorization: `Bearer ${tokenFor('artist')}` } })).json();
  const inq = (mine.inquiries || mine).find((i: any) => i.subject === SUBJECT);
  expect(inq, '내 문의가 목록에 있어야').toBeTruthy();
  await api.patch(`${API}/inquiries/${inq.id}/reply`, {
    headers: { Authorization: `Bearer ${tokenFor('admin')}` }, data: { reply: REPLY },
  });
  await api.dispose();

  await page.goto('/support');
  await expect(page.getByText(SUBJECT, { exact: false }).first()).toBeVisible({ timeout: 10000 });
  await page.getByText(SUBJECT, { exact: false }).first().click();
  await expect(page.getByText(REPLY, { exact: false })).toBeVisible({ timeout: 5000 });
  await ctx.close();
});

test('★ 회원 탈퇴는 이 화면 우측 하단에 있다 (프로필 화면이 아니라)', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  await page.setViewportSize(DESKTOP);

  await page.goto('/mypage');
  await expect(page.locator('main').getByRole('button', { name: /회원 탈퇴/ })).toHaveCount(0);

  await page.goto('/support');
  const btn = page.getByRole('button', { name: /회원 탈퇴/ });
  await expect(btn).toBeVisible({ timeout: 15000 });

  const box = await btn.boundingBox();
  const main = await page.locator('main').boundingBox();
  expect(box!.x, '우측에 있어야 한다').toBeGreaterThan(main!.x + main!.width / 2);
  await ctx.close();
});

test('비로그인에게는 탈퇴 버튼을 보여주지 않는다 (누를 계정이 없다)', async ({ page }) => {
  await page.goto('/support');
  await expect(page.getByRole('button', { name: /회원 탈퇴/ })).toHaveCount(0);
});
