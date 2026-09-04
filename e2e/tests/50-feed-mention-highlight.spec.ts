import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs } from '../lib/helpers';

/**
 * ArtStory — @멘션과 하이라이트가 **실제로 동작하는가**.
 *
 * ⚠️ 예전 이 파일은 "입력칸이 보이는가"만 봤다. 그때 멘션은 없는 API(`/users/search`)를 부르고 있었고
 *    하이라이트 동그라미는 `onClick` 이 없었는데, **두 테스트 모두 통과했다.** 보이는지가 아니라
 *    눌러서 무슨 일이 일어나는지를 본다.
 */
const API = process.env.API_URL || 'http://localhost:4000/api';

test('멘션: @를 치면 부를 수 있는 사람만 뜬다 (ArtLink 는 누구에게나)', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');

  await page.goto('/feed');
  const box = page.getByPlaceholder(/작업 소식/);
  await expect(box).toBeVisible();

  await box.click();
  await box.type('@');

  // ArtLink(운영)는 이웃이 없어도 부를 수 있다 — 문의·신고 창구
  const artlink = page.getByRole('button', { name: '@ArtLink' });
  await expect(artlink).toBeVisible({ timeout: 5000 });

  // 골라 넣으면 본문에 들어간다
  await artlink.click();
  await expect(box).toHaveValue('@ArtLink ');

  await ctx.close();
});

test('★ 멘션 목록은 전체 회원 검색이 아니다 — 서로 이웃 아닌 사람은 안 나온다', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  const api = await pwRequest.newContext();

  // 서버에 직접 물어 규칙을 확인한다(화면 목록의 출처가 이 응답이다)
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('auth-storage') || '{}')?.state?.token);
  const r = await api.get(`${API}/mentions`, { headers: { Authorization: `Bearer ${token}` } });
  expect(r.status()).toBe(200);
  const labels = (await r.json()).map((t: any) => t.label);

  expect(labels).toContain('ArtLink');
  // 갤러리 시드 계정은 이 작가와 서로 이웃이 아니다 → 부를 수 없어야 한다
  expect(labels).not.toContain('Gallery Owner');

  await ctx.close();
});

test('하이라이트: 만들고 → 소식을 담고 → 눌러서 본다', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/feed');

  // ① 만들기 — 맨 위 [+ 추가]
  const name = `E2E-${Date.now()}`;
  await page.getByRole('button', { name: '추가' }).click();
  await page.getByPlaceholder('하이라이트 이름').fill(name);
  await page.getByRole('button', { name: '생성' }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();

  // ② 소식을 하나 올린다
  const caption = `하이라이트 확인 ${Date.now()}`;
  await page.getByPlaceholder(/작업 소식/).fill(caption);
  await page.getByRole('button', { name: '올리기' }).click();
  const card = page.locator('article').filter({ hasText: caption }).first();
  await expect(card).toBeVisible();

  // ③ 카드 오른쪽 아래 별로 담는다
  await card.getByRole('button', { name: '하이라이트에 담기' }).click();
  await card.getByRole('button', { name, exact: true }).click();
  await expect(page.getByText('하이라이트에 추가했어요.')).toBeVisible();

  // ④ ★ 동그라미를 누르면 실제로 열린다 (예전엔 onClick 이 없어 아무 일도 없었다)
  await page.getByRole('button', { name }).first().click();
  await expect(page.getByText(caption)).toBeVisible();

  // 인스타처럼 한 장씩 넘기는 화면이라 닫기가 있어야 한다
  await page.getByRole('button', { name: '닫기' }).click();

  await ctx.close();
});
