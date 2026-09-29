import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor, ownedGalleryId, createExhibition, cardToggle, openSection } from '../lib/helpers';

/**
 * 공모 초대 코드 (2026-09-27) — 이미 선정이 끝난 공모를 옮겨 올 때, 갤러리가 코드(링크)를 선정 작가들에게 돌리면
 * 받은 작가는 **지원서 없이 곧바로 수락**되어 [내 전시]에서 자료 제출을 이어 간다.
 *
 * '버튼이 보이는가'가 아니라 **눌러서 무엇이 바뀌는가**를 본다(50번 스펙의 교훈).
 *
 * 2026-09-29: 초대 코드 상자는 목록 **아래 한 줄**(`이미 선정한 작가를 초대 코드로 데려오기`)로 접혔고,
 * 작가 [내 전시]의 입력칸도 `초대 코드가 있나요?` 한 줄 안에 있다. 정원 표시는 목록 머리의 '수락 N/M명'.
 */
const API = 'http://localhost:4000/api';

test('★ 갤러리가 코드를 만들고 → 작가가 링크로 참여하면 곧바로 수락된다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const galleryId = await ownedGalleryId(api);
  const title = `E2E 초대코드 ${Date.now()}`;
  const exId = await createExhibition(api, { title, galleryId, capacity: 3 });
  await api.dispose();

  // 1) 갤러리 — [지원자] 목록 아래 접힌 줄을 펴서 만들기 (지원자 0명이어도 보여야 한다)
  const g = await openAs(browser, 'gallery');
  await g.page.setViewportSize({ width: 1440, height: 900 });
  await g.page.goto('/mypage?tab=my-exhibitions');
  const card = g.page.locator('article', { hasText: title });
  await cardToggle(card, 'applicants').click();
  await openSection(card, '이미 선정한 작가를 초대 코드로 데려오기');
  await card.getByRole('button', { name: '초대 코드 만들기' }).click();
  const codeText = (await card.getByTestId('join-code').innerText({ timeout: 10000 })).trim();
  expect(codeText).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await expect(card.getByText(/수락 0\/3명/)).toBeVisible();
  // 접어도 코드가 켜져 있다는 게 줄에 남는다
  await expect(card.getByRole('button', { name: /초대 코드로 데려오기/ })).toContainText('코드 켜짐');
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
  // 공모 상세에는 [지원하기] 대신 '선정되었어요'
  await a.page.goto(`/exhibitions/${exId}`);
  await expect(a.page.getByText('선정되었어요')).toBeVisible({ timeout: 10000 });
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
  await cardToggle(card2, 'applicants').click();
  await expect(card2.getByText('초대 코드로 참여')).toBeVisible({ timeout: 10000 });
  await expect(card2.getByText(/수락 1\/3명/)).toBeVisible();
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
  // 입력칸은 '초대 코드가 있나요?' 한 줄 안에 있다(목록이 비어 있으면 펼쳐져 있다)
  await openSection(page, '초대 코드가 있나요');
  // ⚠️ [확인] 은 이 입력칸의 것으로 — 미선정 카드에도 [확인](결과 확인) 버튼이 있다
  const box = page.locator('form').filter({ has: page.getByLabel('초대 코드') }).first();
  const input = box.getByLabel('초대 코드');
  await input.fill('ZZZ');
  await box.getByRole('button', { name: '확인' }).click();
  await expect(page.getByText('초대 코드 8자리를 확인해주세요.')).toBeVisible();
  await input.fill(`${code.slice(0, 4)}-${code.slice(4)}`);
  await box.getByRole('button', { name: '확인' }).click();
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
