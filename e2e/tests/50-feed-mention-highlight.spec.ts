import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor, authHeader } from '../lib/helpers';

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

  // 소식 올리기 화면(2026-11-14 — 피드 위 글쓰기 칸 대신 [+] → 곧바로 /story/new)
  await page.goto('/feed');
  await page.getByRole('button', { name: '소식 올리기' }).first().click();
  await page.waitForURL(/\/story\/new/);
  const box = page.getByLabel('글', { exact: true });
  await expect(box).toBeVisible();

  await box.click();
  await box.pressSequentially('@');

  // ArtLink(운영)는 이웃이 없어도 부를 수 있다 — 문의·신고 창구
  // 목록 항목은 role="option" 이다(2026-09-19 키보드 자동완성 — 예전 button). 이름엔 머리글자·'운영' 표시도 붙는다
  const artlink = page.getByRole('option', { name: /@ArtLink/ });
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
  const r = await api.get(`${API}/mentions`, { headers: authHeader(tokenFor('artist')) });
  expect(r.status()).toBe(200);
  const labels = (await r.json()).map((t: any) => t.label);

  expect(labels).toContain('ArtLink');
  // 갤러리 시드 계정은 이 작가와 서로 이웃이 아니다 → 부를 수 없어야 한다
  expect(labels).not.toContain('Gallery Owner');

  await ctx.close();
});

test('하이라이트: 만들고 → 소식을 담고 → 눌러서 본다', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  // 하이라이트는 ArtStory [내 소식] 탭(2026-11-14)
  await page.goto('/feed?tab=mine');

  // ① 만들기 — 맨 위 [+ 추가]
  const name = `E2E-${Date.now()}`;
  await page.getByRole('button', { name: '추가' }).click();
  await page.getByPlaceholder('하이라이트 이름').fill(name);
  await page.getByRole('button', { name: '만들기' }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();

  // ② 소식을 하나 올린다(글만 — 카드에 글이 보인다)
  const caption = `하이라이트 확인 ${Date.now()}`;
  const api = await pwRequest.newContext();
  await api.post(`${API}/stories`, { headers: authHeader(tokenFor('artist')), data: { caption } });
  await api.dispose();
  await page.reload();
  const card = page.locator('[data-story-card]').filter({ hasText: caption }).first();
  await expect(card).toBeVisible();

  // ③ 보기 화면 [더 보기] → [하이라이트에 담기] → 이름
  await card.click();
  const story = page.locator('[data-story-viewer]');
  await expect(story).toBeVisible();
  await story.getByRole('button', { name: '더 보기', exact: true }).click();
  await page.getByRole('dialog', { name: '소식 메뉴' }).getByRole('button', { name: '하이라이트에 담기' }).click();
  await page.getByRole('dialog', { name: '하이라이트에 담기' }).getByRole('button', { name, exact: true }).click();
  await expect(page.getByText('하이라이트에 담았어요.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(story).toBeHidden();

  // ④ ★ 동그라미를 누르면 실제로 열린다 (예전엔 onClick 이 없어 아무 일도 없었다)
  //    ⚠️ 뒤 격자에도 같은 글이 그대로 있으므로 **뷰어 안에서** 찾아야 한다. 뷰어 이름 = 하이라이트 이름
  await page.getByRole('button', { name }).first().click();
  const viewer = page.getByRole('dialog', { name });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByText(caption)).toBeVisible();

  // 한 장씩 넘기는 화면이다 — 넘기기·닫기가 있어야 한다
  await expect(viewer.getByRole('button', { name: '다음', exact: true })).toBeVisible();
  await viewer.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(viewer).toBeHidden();

  await ctx.close();
});
