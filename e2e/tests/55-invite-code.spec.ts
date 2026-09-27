import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor, ownedGalleryId, createExhibition } from '../lib/helpers';

/**
 * 공모 초대 코드 (2026-09-27) — 이미 선정이 끝난 공모를 옮겨 올 때, 갤러리가 코드(링크)를 선정 작가들에게 돌리면
 * 받은 작가는 **지원서 없이 곧바로 수락**되어 [내 전시]에서 자료 제출을 이어 간다.
 *
 * '버튼이 보이는가'가 아니라 **눌러서 무엇이 바뀌는가**를 본다(50번 스펙의 교훈).
 */
const API = 'http://localhost:4000/api';

test('★ 갤러리가 코드를 만들고 → 작가가 링크로 참여하면 곧바로 수락된다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const galleryId = await ownedGalleryId(api);
  const title = `E2E 초대코드 ${Date.now()}`;
  const exId = await createExhibition(api, { title, galleryId, capacity: 3 });
  await api.dispose();

  // 1) 갤러리 — [지원자 관리] 맨 위 초대 코드 상자에서 만들기 (지원자 0명이어도 보여야 한다)
  const g = await openAs(browser, 'gallery');
  await g.page.setViewportSize({ width: 1440, height: 900 });
  await g.page.goto('/mypage?tab=my-exhibitions');
  const card = g.page.locator('article', { hasText: title });
  await card.getByRole('button', { name: /지원자 관리/ }).click();
  await card.getByRole('button', { name: '초대 코드 만들기' }).click();
  const codeText = (await card.getByTestId('join-code').innerText({ timeout: 10000 })).trim();
  expect(codeText).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await expect(card.getByText('선정 0/3명')).toBeVisible();
  const code = codeText.replace('-', '');
  await g.ctx.close();

  // 2) 비로그인 — 링크를 열면 공모를 먼저 보여 주고 로그인으로 보낸다
  const guest = await browser.newPage();
  await guest.goto(`/join/${code}`);
  await expect(guest.getByRole('heading', { level: 1 })).toContainText(title, { timeout: 15000 });
  await guest.getByRole('button', { name: '로그인하고 참여하기' }).click();
  await guest.waitForURL(/\/login/);
  await guest.close();

  // 3) 작가 — 링크로 참여 → [내 전시]로, 수락 상태
  const a = await openAs(browser, 'artist2');
  await a.page.goto(`/join/${code.toLowerCase()}`);   // 소문자로 와도 같은 코드
  await a.page.getByRole('button', { name: '참여하기' }).click();
  await a.page.waitForURL(/tab=applications&ex=/, { timeout: 15000 });
  await expect(a.page.locator('body')).toContainText(title);
  // 다시 열면 '이미 참여'
  await a.page.goto(`/join/${code}`);
  await expect(a.page.getByText('이미 이 공모에 참여하고 있어요')).toBeVisible({ timeout: 10000 });
  // 공모 상세에는 [지원하기] 대신 '선정되었습니다'
  await a.page.goto(`/exhibitions/${exId}`);
  await expect(a.page.getByText('선정되었습니다')).toBeVisible({ timeout: 10000 });
  await expect(a.page.getByRole('button', { name: '지원하기' })).toHaveCount(0);
  await a.ctx.close();

  // 4) 서버 — ACCEPTED + joinedVia CODE, 갤러리 목록에 '코드 참여'
  const api2 = await pwRequest.newContext();
  const apps = await (await api2.get(`${API}/exhibitions/${exId}/applications`, { headers: { Authorization: `Bearer ${tokenFor('gallery')}` } })).json();
  expect(apps).toHaveLength(1);
  expect(apps[0]).toMatchObject({ status: 'ACCEPTED', joinedVia: 'CODE' });
  await api2.dispose();
  const g2 = await openAs(browser, 'gallery');
  await g2.page.setViewportSize({ width: 1440, height: 900 });
  await g2.page.goto('/mypage?tab=my-exhibitions');
  const card2 = g2.page.locator('article', { hasText: title });
  await card2.getByRole('button', { name: /지원자 관리/ }).click();
  await expect(card2.getByText('코드 참여')).toBeVisible({ timeout: 10000 });
  await expect(card2.getByText('선정 1/3명')).toBeVisible();
  await g2.ctx.close();
});

test('★ 코드만 받은 작가는 [내 전시]의 입력칸으로 들어온다 · 틀린 코드는 안내', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const galleryId = await ownedGalleryId(api);
  const title = `E2E 코드입력 ${Date.now()}`;
  const exId = await createExhibition(api, { title, galleryId });
  const made = await api.post(`${API}/exhibitions/${exId}/join-code`, { headers: { Authorization: `Bearer ${tokenFor('gallery')}` } });
  const { code } = await made.json();
  await api.dispose();

  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/mypage?tab=applications');
  const input = page.getByLabel('초대 코드').first();
  await input.fill('ZZZ');
  await page.getByRole('button', { name: '확인' }).first().click();
  await expect(page.getByText('초대 코드 8자리를 확인해주세요.')).toBeVisible();
  await input.fill(`${code.slice(0, 4)}-${code.slice(4)}`);
  await page.getByRole('button', { name: '확인' }).first().click();
  await page.waitForURL(new RegExp(`/join/${code}`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText(title);
  await page.getByRole('button', { name: '참여하기' }).click();
  await page.waitForURL(/tab=applications&ex=/, { timeout: 15000 });
  await ctx.close();
});

test('★ 끈 코드·없는 코드는 "유효하지 않은 초대 코드" — 빈 화면이 아니다', async ({ page }) => {
  await page.goto('/join/ABCDEFGH');
  await expect(page.getByRole('heading', { name: '유효하지 않은 초대 코드입니다' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByLabel('초대 코드')).toBeVisible();   // 다시 넣을 수 있게
});
