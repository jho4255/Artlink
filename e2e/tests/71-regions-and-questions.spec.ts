import { test, expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';
import { openAs, tokenFor, statePath, ownedGalleryId, createExhibition, openApplicantManager, exhibitionDates } from '../lib/helpers';

/**
 * 지역 넷 추가 · 올린 공모의 지역 바꾸기 · 추가 질문 수정/삭제 (2026-10-08 사용자 요청) — **눌러서 무슨 일이 나는가**를 본다.
 *
 *  A. 관리자 [주최 공모] [추가 질문] — 고치고 지운 뒤 다시 열면 바뀐 질문이 보인다(PC·휴대폰).
 *     예전엔 주최 공모 목록을 다시 받지 않아 옛 질문이 그대로 떠 저장이 안 된 것처럼 보였다(서버엔 저장돼 있었다).
 *  B. 갤러리 [내 공모] [지원자] [추가 질문 수정] — 같은 흐름 + 전부 지우기
 *  C. 등록 폼에 경북·경남·전북·전남 · 공고 상세 [지역 변경] → 목록 필터에 새 지역으로 걸린다
 *  D. 아트링크 주최 공모 — 위임 갤러리에겐 [지역 변경]이 없고 관리자는 바꾼다
 */
const API = 'http://localhost:4000/api';
const auth = (role: Parameters<typeof tokenFor>[0]) => ({ Authorization: `Bearer ${tokenFor(role)}` });
const newTitle = (what: string) => `E2E지역 ${what} ${Date.now()}`;
const QUESTIONS = [
  { id: 'q1', label: '질문A', type: 'textarea', required: false },
  { id: 'q2', label: '질문B', type: 'select', required: true, options: ['가', '나'], maxSelect: 1 },
];

async function hosted(api: APIRequestContext, title: string, galleryIds: number[] = []) {
  const r = await api.post(`${API}/exhibitions/hosted`, {
    headers: auth('admin'),
    data: { ...exhibitionDates(), title, type: 'GROUP', capacity: 5, region: 'SEOUL', description: '<p>E2E</p>', galleryIds, customFields: QUESTIONS },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()).id as number;
}

const questionModal = (page: Page) => page.locator('div.fixed').filter({ hasText: '이미 지원한 작가의 기존 답변' });
const labelsIn = (page: Page) => questionModal(page).locator('input[placeholder="질문을 입력하세요"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

/** 열린 창에서 첫 질문을 고치고 둘째를 지운 뒤 저장 */
async function editAndDelete(page: Page) {
  const modal = questionModal(page);
  await expect(modal).toBeVisible();
  await modal.locator('input[placeholder="질문을 입력하세요"]').first().fill('질문A-고침');
  await modal.getByRole('button', { name: '삭제', exact: true }).nth(1).click();
  await modal.getByRole('button', { name: '저장', exact: true }).click();
  await expect(modal).toBeHidden();
}
async function deleteAll(page: Page) {
  const modal = questionModal(page);
  while (await modal.getByRole('button', { name: '삭제', exact: true }).count()) {
    await modal.getByRole('button', { name: '삭제', exact: true }).first().click();
  }
  await modal.getByRole('button', { name: '저장', exact: true }).click();
  await expect(modal).toBeHidden();
}

test.describe('추가 질문 수정·삭제', () => {
  test('A. 관리자 [주최 공모] — 고치고 지운 뒤 다시 열면 바뀐 질문(PC·휴대폰), 전부 지우면 빈 창', async ({ browser }) => {
    const api = await pwRequest.newContext();
    for (const viewport of [{ width: 1280, height: 900 }, null]) {
      const title = newTitle(viewport ? '주최PC' : '주최폰');
      const exId = await hosted(api, title);
      const ctx = viewport
        ? await browser.newContext({ storageState: statePath('admin'), viewport })
        : await browser.newContext({ storageState: statePath('admin') });
      const page = await ctx.newPage();
      await page.goto('/mypage?tab=hosted-exhibitions');
      const card = page.locator('article').filter({ hasText: title });
      await card.getByRole('button', { name: '추가 질문', exact: true }).click();
      await editAndDelete(page);
      // ★ 다시 열면 바뀐 질문 — 새로고침 없이
      await card.getByRole('button', { name: '추가 질문', exact: true }).click();
      await expect.poll(() => labelsIn(page)).toEqual(['질문A-고침']);
      await deleteAll(page);
      await card.getByRole('button', { name: '추가 질문', exact: true }).click();
      await expect(questionModal(page).locator('input[placeholder="질문을 입력하세요"]')).toHaveCount(0);
      await page.keyboard.press('Escape').catch(() => {});
      // 서버도 같은 답
      const list = await (await api.get(`${API}/exhibitions/hosted`, { headers: auth('admin') })).json();
      expect(list.find((e: any) => e.id === exId).customFields ?? []).toEqual([]);
      await ctx.close();
    }
  });

  test('B. 갤러리 [내 공모] — 고치고 지운 뒤 다시 열면 바뀐 질문, 전부 지우면 빈 창', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('갤러리');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), extra: { customFields: QUESTIONS } });
    const { ctx, page } = await openAs(browser, 'gallery');
    const card = await openApplicantManager(page, title);
    await card.getByRole('button', { name: '추가 질문 수정' }).click();
    await editAndDelete(page);
    await card.getByRole('button', { name: '추가 질문 수정' }).click();
    await expect.poll(() => labelsIn(page)).toEqual(['질문A-고침']);
    await deleteAll(page);
    await card.getByRole('button', { name: '추가 질문 수정' }).click();
    await expect(questionModal(page).locator('input[placeholder="질문을 입력하세요"]')).toHaveCount(0);
    const detail = await (await api.get(`${API}/exhibitions/${exId}`, { headers: auth('gallery') })).json();
    expect(detail.customFields ?? []).toEqual([]);
    await ctx.close();
  });
});

test.describe('지역', () => {
  test('C. 등록 폼에 새 지역 넷 · 공고 상세 [지역 변경] → 목록 필터에 새 지역으로 걸린다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const { ctx, page } = await openAs(browser, 'gallery');

    await page.goto('/exhibitions/new');
    const regionSelect = page.locator('select').filter({ has: page.locator('option[value="SEOUL"]') }).first();
    await expect(regionSelect).toBeVisible({ timeout: 15000 });
    for (const label of ['경북', '경남', '전북', '전남']) await expect(regionSelect.locator('option', { hasText: label })).toHaveCount(1);

    const title = newTitle('바꾸기');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), region: 'SEOUL' });
    await page.goto(`/exhibitions/${exId}`);
    await page.getByRole('button', { name: '지역 변경' }).click();
    await page.getByRole('combobox', { name: '지역 고르기' }).selectOption('GYEONGNAM');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByRole('button', { name: '지역 변경' })).toBeVisible();
    await expect(page.locator('body')).toContainText('경남');
    expect((await (await api.get(`${API}/exhibitions/${exId}`)).json()).region).toBe('GYEONGNAM');

    // 목록 [지역] 필터의 '경남' 으로 찾는다
    await page.goto('/exhibitions');
    await page.getByRole('button', { name: '경남', exact: true }).click();
    await expect(page.locator('body')).toContainText(title, { timeout: 15000 });
    await ctx.close();

    // 방문자(작가)에게는 [지역 변경]이 없다
    const artist = await openAs(browser, 'artist');
    await artist.page.goto(`/exhibitions/${exId}`);
    await expect(artist.page.locator('body')).toContainText('경남');
    await expect(artist.page.getByRole('button', { name: '지역 변경' })).toHaveCount(0);
    await artist.ctx.close();
  });

  test('D. 아트링크 주최 공모 — 위임 갤러리에겐 [지역 변경]이 없고(서버 403) 관리자는 바꾼다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('주최');
    const exId = await hosted(api, title, [await ownedGalleryId(api)]);

    const gallery = await openAs(browser, 'gallery');
    await gallery.page.goto(`/exhibitions/${exId}`);
    await expect(gallery.page.locator('body')).toContainText(title, { timeout: 15000 });
    await expect(gallery.page.getByRole('button', { name: '지역 변경' })).toHaveCount(0);
    expect((await api.patch(`${API}/exhibitions/${exId}/region`, { headers: auth('gallery'), data: { region: 'BUSAN' } })).status()).toBe(403);
    await gallery.ctx.close();

    const admin = await openAs(browser, 'admin');
    await admin.page.goto(`/exhibitions/${exId}`);
    await admin.page.getByRole('button', { name: '지역 변경' }).click();
    await admin.page.getByRole('combobox', { name: '지역 고르기' }).selectOption('JEONNAM');
    await admin.page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(admin.page.getByRole('button', { name: '지역 변경' })).toBeVisible();
    await expect(admin.page.locator('body')).toContainText('전남');
    // 관리자 [주최 공모] 목록에도 바로 바뀐 지역
    await admin.page.goto('/mypage?tab=hosted-exhibitions');
    await expect(admin.page.locator('article').filter({ hasText: title })).toContainText('전남');
    await admin.ctx.close();
  });
});
