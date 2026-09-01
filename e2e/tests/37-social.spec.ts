import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor } from '../lib/helpers';

/**
 * 소셜 — 이웃(단방향 팔로우) + 스토리([소식] 피드) + 방명록 — Phase 2.
 *  · 이웃 추가 → 상대 소식이 내 [소식] 피드에 뜬다
 *  · 스토리 공개범위는 글마다(전체공개/이웃공개)
 *  · 방명록: 남기면 방 주인에게, 답글은 방 주인만
 */
const API = 'http://localhost:4000/api';

test('★ 작가 홈페이지에서 이웃 추가 → 상대 스토리가 [소식] 피드에 뜬다', async ({ browser }) => {
  // artist2 가 스토리를 하나 올려둔다(전체공개)
  const api = await pwRequest.newContext();
  const cap = `작업 소식 ${Date.now()}`;
  await api.post(`${API}/stories`, {
    headers: { Authorization: `Bearer ${tokenFor('artist2')}` },
    data: { caption: cap, visibility: 'PUBLIC' },
  });
  await api.dispose();

  // artist 가 artist2(=id 2) 홈페이지에서 [이웃 추가]
  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/portfolio/2');
  const followBtn = page.getByRole('button', { name: /이웃 추가/ });
  await expect(followBtn).toBeVisible({ timeout: 15000 });
  await followBtn.click();
  await expect(page.getByRole('button', { name: /^이웃$/ })).toBeVisible({ timeout: 8000 });

  // [소식] 피드로 가면 artist2 의 스토리가 보인다
  await page.goto('/feed');
  await expect(page.locator('body')).toContainText(cap, { timeout: 15000 });
  await ctx.close();
});

test('★ [소식] 에서 직접 스토리를 올리면 내 피드에 바로 뜬다', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/feed');
  const cap = `내 소식 ${Date.now()}`;
  await page.getByPlaceholder(/작업 소식을 남겨보세요/).fill(cap);
  await page.getByRole('button', { name: '올리기' }).click();
  await expect(page.locator('body')).toContainText(cap, { timeout: 12000 });
  await ctx.close();
});

test('★ 이웃공개 스토리는 비이웃에게 안 보인다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const secretCap = `이웃만 ${Date.now()}`;
  await api.post(`${API}/stories`, {
    headers: { Authorization: `Bearer ${tokenFor('gallery')}` },
    data: { caption: secretCap, visibility: 'NEIGHBORS' },
  });
  // gallery(=id 3) 를 팔로우하지 않은 artist 의 홈페이지 조회 → PUBLIC 만
  const res = await api.get(`${API}/stories/user/3`, { headers: { Authorization: `Bearer ${tokenFor('artist')}` } });
  const body = await res.json();
  expect(body.stories.some((s: any) => s.caption === secretCap)).toBe(false);
  expect(body.canSeeNeighbors).toBe(false);
  await api.dispose();
});

test('★ 방명록 — 남기면 목록에 뜨고, 방 주인만 답글을 단다', async ({ browser }) => {
  const stamp = Date.now();
  const msg = `방명록 ${stamp}`;

  // artist2 가 artist(=id 1) 홈페이지 방명록에 글을 남긴다
  const { page, ctx } = await openAs(browser, 'artist2');
  await page.goto('/portfolio/1');
  const box = page.getByPlaceholder(/응원의 한마디를 남겨보세요/);
  await expect(box).toBeVisible({ timeout: 15000 });
  await box.fill(msg);
  await page.getByRole('button', { name: '남기기' }).click();
  await expect(page.locator('body')).toContainText(msg, { timeout: 10000 });
  // 남의 방이라 [답글] 버튼이 없다
  await expect(page.getByRole('button', { name: '답글' })).toHaveCount(0);
  await ctx.close();

  // 방 주인(artist=id 1)이 자기 홈페이지에서 답글
  const owner = await openAs(browser, 'artist');
  await owner.page.goto('/portfolio/1');
  await expect(owner.page.locator('body')).toContainText(msg, { timeout: 15000 });
  await owner.page.getByRole('button', { name: '답글' }).first().click();
  const reply = `고마워요 ${stamp}`;
  await owner.page.getByPlaceholder('답글을 남겨보세요.').fill(reply);
  await owner.page.getByRole('button', { name: '답글' }).last().click();
  await expect(owner.page.locator('body')).toContainText(reply, { timeout: 10000 });
  await owner.ctx.close();
});

test('★ 비밀 방명록은 제3자에게 본문이 가려진다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const secret = `비밀 ${Date.now()}`;
  await api.post(`${API}/guestbook/1`, {
    headers: { Authorization: `Bearer ${tokenFor('artist2')}` },
    data: { body: secret, secret: true },
  });
  // 제3자(gallery)가 조회 → locked, 본문 없음
  const res = await api.get(`${API}/guestbook/1`, { headers: { Authorization: `Bearer ${tokenFor('gallery')}` } });
  const body = await res.json();
  const found = body.entries.find((e: any) => e.locked === true);
  expect(found).toBeTruthy();
  expect(found.body).toBe('');
  await api.dispose();
});
