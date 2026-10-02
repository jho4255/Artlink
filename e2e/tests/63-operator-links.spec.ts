import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor, exhibitionDates, createExhibition, ownedGalleryId, cardToggle, settle } from '../lib/helpers';

/**
 * 운영 화면의 [지원자 보기]·[← 목록] 은 **보는 사람의 역할에 맞는 곳**으로 간다 (2026-10-02)
 *
 * 운영 화면(`/exhibitions/:id/operation/new`)의 링크 셋이 전부 갤러리의 `/mypage?tab=my-exhibitions…` 였다.
 * 그 탭은 갤러리에게만 있어서, 관리자가 [운영 조회] → [운영 페이지] → [지원자 보기] 를 누르면
 * **프로필(닉네임 입력 칸)** 이 떴다. 주소가 문자열이라 타입도 단위 테스트도 못 잡았고, 빈 화면이 아니라 멀쩡한
 * 프로필이 떠서 눈에도 안 띄었다. 그래서 여기서는 **눌러서 어디에 도착하는지**를 본다.
 *
 *   갤러리             → [내 공모] 의 그 카드, [지원자] 탭이 열린 채
 *   관리자 · 갤러리 주최  → [운영 조회] 의 그 공모 지원 현황
 *   관리자 · 아트링크 주최 → [주최 공모] 의 그 카드, 지원자 관리가 열린 채
 */
const API = 'http://localhost:4000/api';
const DESKTOP = { width: 1280, height: 800 };
const stamp = Date.now();
const TITLE_G = `E2E 링크 갤러리주최 ${stamp}`;
const TITLE_H = `E2E 링크 아트링크주최 ${stamp}`;
let galleryEx = 0;
let hostedEx = 0;

/** 프로필 탭에만 있는 칸 — 이게 보이면 역할 폴백으로 떨어진 것이다 */
const nickname = (page: import('@playwright/test').Page) => page.getByPlaceholder('닉네임을 입력하세요');

test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  const gid = await ownedGalleryId(api);
  galleryEx = await createExhibition(api, { title: TITLE_G, galleryId: gid, type: 'GROUP' });
  // 아트링크 주최 + 이 갤러리에 운영 위임
  const r = await api.post(`${API}/exhibitions/hosted`, {
    headers: { Authorization: `Bearer ${tokenFor('admin')}` },
    data: { ...exhibitionDates(), title: TITLE_H, type: 'GROUP', recruitOnly: false, capacity: 3, region: 'SEOUL', description: 'E2E 주최 공모', galleryIds: [gid] },
  });
  if (!r.ok()) throw new Error(`주최 공모 등록 실패 ${r.status()}: ${await r.text()}`);
  hostedEx = (await r.json()).id;
  await api.dispose();
});

test.describe('관리자', () => {
  test('★ 운영 조회 → [운영 페이지] → [지원자 보기] → 운영 조회의 그 공모 지원 현황 (프로필이 아니다)', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'admin');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage?tab=oversight');
    await page.getByRole('button', { name: new RegExp(TITLE_G) }).click();
    await page.getByRole('button', { name: /운영 페이지/ }).click();
    await page.waitForURL(new RegExp(`/exhibitions/${galleryEx}/operation/new`));

    // 뒤로가기 글자도 관리자의 일터 이름이다 — 관리자에겐 [내 공모] 가 없다
    const back = page.locator('main header a').first();
    await expect(back).toHaveText(/운영 조회/, { timeout: 15000 });
    await expect(page.locator('main header')).not.toContainText('내 공모');

    await page.getByRole('link', { name: '지원자 보기' }).click();
    await expect(page).toHaveURL(new RegExp(`/mypage\\?tab=oversight&ex=${galleryEx}$`));
    const detail = page.getByTestId('ov-ex-detail');
    await expect(detail).toContainText(`${TITLE_G} — 지원 현황`, { timeout: 15000 });
    await expect(detail).toBeInViewport();
    await expect(nickname(page), '프로필로 떨어졌다 — 관리자에게 없는 탭 주소로 보냈다').toHaveCount(0);
    await ctx.close();
  });

  test('★ [← 운영 조회] 와 할 일 상자의 [지원자 보기] 도 같은 곳으로 간다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'admin');
    await page.setViewportSize(DESKTOP);
    for (const click of [
      () => page.locator('main header a').first().click(),
      () => page.locator('main').getByRole('button', { name: '지원자 보기' }).click(),
    ]) {
      await page.goto(`/exhibitions/${galleryEx}/operation/new`);
      await expect(page.getByText('진행 단계').first()).toBeVisible({ timeout: 15000 });
      await click();
      await expect(page).toHaveURL(new RegExp(`/mypage\\?tab=oversight&ex=${galleryEx}$`));
      await expect(page.getByTestId('ov-ex-detail')).toContainText(TITLE_G, { timeout: 15000 });
      await expect(nickname(page)).toHaveCount(0);
    }
    await ctx.close();
  });

  test('★ 아트링크 주최 공모 → [지원자 보기] → [주최 공모] 의 그 카드, 지원자 관리가 열려 있다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'admin');
    await page.setViewportSize(DESKTOP);
    await page.goto(`/exhibitions/${hostedEx}/operation/new`);
    await expect(page.locator('main header a').first()).toHaveText(/주최 공모/, { timeout: 15000 });
    await page.getByRole('link', { name: '지원자 보기' }).click();
    await expect(page).toHaveURL(new RegExp(`/mypage\\?tab=hosted-exhibitions&ex=${hostedEx}&panel=applicants$`));

    const card = page.locator(`#hosted-ex-${hostedEx}`);
    await expect(card).toContainText(TITLE_H, { timeout: 15000 });
    await expect(card.getByRole('button', { name: '지원자 관리 닫기' })).toBeVisible();   // 열려 있다
    await expect(card.getByText(/수락 \d+\/\d+/).first()).toBeVisible();                   // ApplicantManager 가 그려졌다
    await expect(card).toBeInViewport();
    await expect(nickname(page)).toHaveCount(0);

    // 닫으면 닫힌 채로 있다 — 목록을 다시 받아도 딥링크가 또 열지 않는다
    await card.getByRole('button', { name: '지원자 관리 닫기' }).click();
    await settle(page, 1200);
    await expect(card.getByRole('button', { name: '지원자 관리', exact: true })).toBeVisible();
    await ctx.close();
  });

  test('★ 갤러리의 [내 공모] 주소를 관리자가 열어도 프로필이 아니라 [운영 조회] 다 (공유받은 링크)', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'admin');
    await page.setViewportSize(DESKTOP);
    await page.goto(`/mypage?tab=my-exhibitions&ex=${galleryEx}&panel=applicants`);
    await expect(page.getByTestId('ov-ex-detail')).toContainText(TITLE_G, { timeout: 15000 });
    await expect(page).toHaveURL(/[?&]tab=oversight(&|$)/);     // 주소도 갈아끼운다
    await expect(page).toHaveURL(new RegExp(`[?&]ex=${galleryEx}(&|$)`));
    await expect(nickname(page)).toHaveCount(0);
    await ctx.close();
  });
});

test.describe('갤러리 — 원래 되던 길이 그대로 된다', () => {
  for (const vp of [DESKTOP, null] as const) {
    const where = vp ? 'PC' : '모바일';
    test(`★ 운영 화면 [지원자 보기] → [내 공모] 의 그 카드, [지원자] 탭 (${where})`, async ({ browser }) => {
      const { page, ctx } = await openAs(browser, 'gallery');
      if (vp) await page.setViewportSize(vp);
      await page.goto(`/exhibitions/${galleryEx}/operation/new`);   // 새 지원자 알림이 보내는 주소
      await expect(page.locator('main header a').first()).toHaveText(/내 공모/, { timeout: 15000 });
      await page.getByRole('link', { name: '지원자 보기' }).click();
      await expect(page).toHaveURL(new RegExp(`/mypage\\?tab=my-exhibitions&ex=${galleryEx}&panel=applicants$`));

      const card = page.locator(`#ex-card-${galleryEx}`);
      await expect(card).toContainText(TITLE_G, { timeout: 15000 });
      await expect(cardToggle(card, 'applicants')).toHaveAttribute('aria-expanded', 'true');
      await expect(cardToggle(card, 'operation')).toHaveAttribute('aria-expanded', 'false');
      await expect(card).toBeInViewport();
      await expect(nickname(page)).toHaveCount(0);
      await ctx.close();
    });
  }

  test('[← 내 공모] 는 그 카드의 [운영] 탭을, 공모 상세 [지원자 보기] 는 [지원자] 탭을 연다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'gallery');
    await page.setViewportSize(DESKTOP);
    await page.goto(`/exhibitions/${galleryEx}/operation/new`);
    await page.locator('main header a').first().click();
    const card = page.locator(`#ex-card-${galleryEx}`);
    await expect(cardToggle(card, 'operation')).toHaveAttribute('aria-expanded', 'true', { timeout: 15000 });

    await page.goto(`/exhibitions/${galleryEx}`);
    await page.locator('main').getByRole('button', { name: '지원자 보기' }).click();
    await expect(cardToggle(page.locator(`#ex-card-${galleryEx}`), 'applicants')).toHaveAttribute('aria-expanded', 'true', { timeout: 15000 });
    await ctx.close();
  });

  test('★ 위임받은 아트링크 주최 공모도 [내 공모] 의 그 카드로 간다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'gallery');
    await page.setViewportSize(DESKTOP);
    await page.goto(`/exhibitions/${hostedEx}/operation/new`);
    await expect(page.locator('main header a').first()).toHaveText(/내 공모/, { timeout: 15000 });
    await page.getByRole('link', { name: '지원자 보기' }).click();
    const card = page.locator(`#ex-card-${hostedEx}`);
    await expect(card).toContainText(TITLE_H, { timeout: 15000 });
    await expect(cardToggle(card, 'applicants')).toHaveAttribute('aria-expanded', 'true');
    await expect(nickname(page)).toHaveCount(0);
    await ctx.close();
  });
});
