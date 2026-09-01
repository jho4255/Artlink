import { test, expect, request as pwRequest, type Page } from '@playwright/test';
import { openAs, tokenFor, userIds, createExhibition, seedGalleryLike, settle } from '../lib/helpers';

/**
 * 갤러리 [내 공모] 카드 — 2026-08-28 개편분.
 *
 *  · [상세 운영]은 **페이지 이동이 아니라 카드 안에서 접었다폈다**(OperationBody 를 임베드).
 *  · [추가 질문] 수정은 카드 상단 버튼에서 빼고 **[지원자 관리] 패널 안**으로 옮겼다.
 *  · [작가 초대]: 관심 작품(하트)을 저장한 작가를 이 공모에 바로 초대 — 지원자 관리 패널 안.
 */
const API = 'http://localhost:4000/api';
const DESKTOP = { width: 1440, height: 900 };

async function galleryId(api: any): Promise<number> {
  const gs = await api.get(`${API}/galleries?owned=true`, { headers: { Authorization: `Bearer ${tokenFor('gallery')}` } });
  const gl = await gs.json();
  return (Array.isArray(gl) ? gl : gl.galleries).find((g: any) => g.status === 'APPROVED').id;
}

/** 내 공모 목록에서 제목으로 카드를 특정 */
const cardFor = (page: Page, title: string) =>
  page.locator('article').filter({ hasText: title }).first();

test.describe('상세 운영 인라인', () => {
  let title: string;

  test.beforeAll(async () => {
    const api = await pwRequest.newContext();
    title = `상세운영검증 ${Date.now()}`;
    await createExhibition(api, { title, galleryId: await galleryId(api), description: '상세 운영 E2E' });
    await api.dispose();
  });

  test('★ [상세 운영]은 페이지 이동 없이 카드 안에서 펼쳐진다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'gallery');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage?tab=my-exhibitions');
    await expect(page.locator('body')).toContainText(title, { timeout: 15000 });

    const card = cardFor(page, title);
    await card.getByRole('button', { name: '상세 운영', exact: true }).click();

    // 주소는 그대로 마이페이지 (operation 페이지로 안 나간다)
    await expect(page).toHaveURL(/\/mypage/);
    // 카드 안에 운영 화면 내용(운영 공지)이 들어온다
    await expect(card.getByRole('button', { name: '상세 운영 닫기' })).toBeVisible({ timeout: 10000 });
    await expect(card).toContainText('운영 공지', { timeout: 15000 });

    // 다시 누르면 접힌다
    await card.getByRole('button', { name: '상세 운영 닫기' }).click();
    await settle(page, 500);
    await expect(card).not.toContainText('운영 공지');
    await ctx.close();
  });

  test('★ 운영 페이지 라우트는 그대로 살아 있다 (옛 알림 링크 보존)', async ({ browser }) => {
    /* 카드가 인라인이 됐어도 전용 페이지는 여전히 동작해야 한다.
       옛 알림이 가리키는 주소는 `/operation/new`(OperationPage) — 카드 임베드와 같은 OperationBody 를 쓴다.
       (`/operation` 는 옛 classic 페이지로 별개다) */
    const api = await pwRequest.newContext();
    const list = await (await api.get(`${API}/exhibitions?search=${encodeURIComponent(title)}`)).json();
    const ex = (Array.isArray(list) ? list : list.exhibitions).find((e: any) => e.title === title);
    await api.dispose();

    const { page, ctx } = await openAs(browser, 'gallery');
    await page.goto(`/exhibitions/${ex.id}/operation/new`);
    await expect(page.getByRole('heading', { name: '상세 운영' })).toBeVisible({ timeout: 15000 });
    await ctx.close();
  });
});

test.describe('지원자 관리 패널 안의 도구들', () => {
  let title: string;

  test.beforeAll(async () => {
    const api = await pwRequest.newContext();
    title = `패널도구검증 ${Date.now()}`;
    await createExhibition(api, { title, galleryId: await galleryId(api), description: '패널 도구 E2E' });
    // 갤러리가 새 작품(작가 소유)에 하트 → 초대 후보 확보 (토글 취소 방지)
    await seedGalleryLike(api);
    await api.dispose();
  });

  test('★ [추가 질문]·[작가 초대]는 카드 상단이 아니라 지원자 관리 패널 안에 있다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'gallery');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage?tab=my-exhibitions');
    await expect(page.locator('body')).toContainText(title, { timeout: 15000 });

    const card = cardFor(page, title);
    // 접힌 상태: 상단에 [추가 질문]/[작가 초대] 버튼이 보이지 않는다
    await expect(card.getByRole('button', { name: /추가 질문/ })).toHaveCount(0);
    await expect(card.getByRole('button', { name: '작가 초대' })).toHaveCount(0);

    // 지원자 관리를 펼치면 안에서 나타난다
    await card.getByRole('button', { name: '지원자 관리' }).click();
    await expect(card.getByRole('button', { name: /추가 질문 수정/ })).toBeVisible({ timeout: 10000 });
    await expect(card.getByRole('button', { name: '작가 초대' })).toBeVisible();
    await ctx.close();
  });

  test('★ [작가 초대] → 하트 누른 작가를 골라 초대한다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'gallery');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage?tab=my-exhibitions');
    await expect(page.locator('body')).toContainText(title, { timeout: 15000 });

    const card = cardFor(page, title);
    await card.getByRole('button', { name: '지원자 관리' }).click();
    await card.getByRole('button', { name: '작가 초대' }).click();

    await expect(page.getByRole('heading', { name: '작가 초대' })).toBeVisible({ timeout: 8000 });
    // 관심 작품(하트)을 저장한 작가를 초대할 수 있다는 안내
    await expect(page.locator('body')).toContainText('관심 작품(하트)을 저장한 작가');

    // 첫 작가 선택 → 초대
    await page.locator('.fixed button').filter({ has: page.locator('img') }).first().click();
    await page.getByRole('button', { name: '초대 보내기' }).click();
    await expect(page.locator('body')).toContainText('초대를 보냈습니다', { timeout: 10000 });

    // 서버에 초대가 실제로 생겼는지
    const api = await pwRequest.newContext();
    const list = await (await api.get(`${API}/exhibitions?search=${encodeURIComponent(title)}`)).json();
    const ex = (Array.isArray(list) ? list : list.exhibitions).find((e: any) => e.title === title);
    const invites = await (await api.get(`${API}/exhibitions/invites/received`, {
      headers: { Authorization: `Bearer ${tokenFor('artist')}` },
    })).json();
    expect((invites.invites ?? []).some((i: any) => i.exhibition.id === ex.id), '작가에게 초대가 도착했다').toBe(true);
    expect(userIds().artist).toBeGreaterThan(0);
    await api.dispose();
    await ctx.close();
  });
});
