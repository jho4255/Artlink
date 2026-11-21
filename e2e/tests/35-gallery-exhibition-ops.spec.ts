import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor, createExhibition, exhibitionCard, workspace, workspaceTab, openWorkspaceTab } from '../lib/helpers';

/**
 * 갤러리 [내 공모] — 2026-11-20 개편(규칙 88): 카드 → **줄 목록 + 공모 한 건 화면**.
 *
 *  · 줄을 누르면 마이페이지 안에서 그 공모 화면이 열린다(주소 `?tab=my-exhibitions&ex=<id>` — 운영 주소로 나가지 않는다).
 *    [← 내 공모]·뒤로가기로 목록에 돌아온다.
 *  · 옛 운영 주소(`/exhibitions/:id/operation/new`)는 살아 있다 — 이미 나간 알림이 들고 있다. 갤러리는 그 공모 화면으로 간다.
 *  · [추가 질문 수정]은 목록에 없고 공모 화면 [지원자] 탭의 도구 줄에 있다. [작가 초대]는 2026-11-19 에 없앴다 — 초대 **코드** 줄은 그대로.
 */
const API = 'http://localhost:4000/api';
const DESKTOP = { width: 1440, height: 900 };

async function galleryId(api: any): Promise<number> {
  const gs = await api.get(`${API}/galleries?owned=true`, { headers: { Authorization: `Bearer ${tokenFor('gallery')}` } });
  const gl = await gs.json();
  return (Array.isArray(gl) ? gl : gl.galleries).find((g: any) => g.status === 'APPROVED').id;
}

test.describe('공모 한 건 화면', () => {
  let title: string;
  let exId: number;

  test.beforeAll(async () => {
    const api = await pwRequest.newContext();
    title = `상세운영검증 ${Date.now()}`;
    exId = await createExhibition(api, { title, galleryId: await galleryId(api), description: '상세 운영 E2E' });
    await api.dispose();
  });

  test('★ 줄을 누르면 마이페이지 안에서 공모 화면이 열리고 [← 내 공모]·뒤로가기로 돌아온다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'gallery');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage?tab=my-exhibitions');
    await expect(page.locator('body')).toContainText(title, { timeout: 15000 });

    const row = exhibitionCard(page, title);
    // 줄에는 진행 띠가 있다(다섯 칸)
    await expect(row.locator('ol[aria-label="진행 단계"] > li')).toHaveCount(5);
    await row.getByRole('button', { name: title }).first().click();

    // 주소는 마이페이지 그대로 + ex — 운영 주소로 나가지 않는다
    await expect(page).toHaveURL(new RegExp(`/mypage\\?tab=my-exhibitions&ex=${exId}`));
    await expect(workspace(page)).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    // 모집 중이라 처음 열리는 탭은 [지원자] · 전시가 끝나기 전엔 [정산] 이 잠겨 있다
    await expect(workspaceTab(page, '지원자')).toHaveAttribute('aria-selected', 'true');
    await expect(workspaceTab(page, '정산')).toHaveAttribute('aria-disabled', 'true');
    // 공모 화면에서는 프로필 카드를 그리지 않는다
    await expect(page.getByRole('button', { name: '프로필 사진 변경' })).toHaveCount(0);

    // [← 내 공모] → 목록
    await page.getByRole('button', { name: '내 공모', exact: true }).first().click();
    await expect(page).toHaveURL(/\/mypage\?tab=my-exhibitions$/);
    await expect(exhibitionCard(page, title)).toBeVisible();

    // 다시 열고 브라우저 뒤로가기 → 목록
    await exhibitionCard(page, title).getByRole('button', { name: title }).first().click();
    await expect(workspace(page)).toBeVisible({ timeout: 15000 });
    await page.goBack();
    await expect(page).toHaveURL(/\/mypage\?tab=my-exhibitions$/);
    await expect(workspace(page)).toHaveCount(0);
    await ctx.close();
  });

  test('★ 옛 운영 주소는 살아 있다 — 갤러리는 [내 공모]의 그 공모 화면으로', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'gallery');
    await page.goto(`/exhibitions/${exId}/operation/new?view=notices`);
    await expect(page).toHaveURL(new RegExp(`/mypage\\?tab=my-exhibitions&ex=${exId}`), { timeout: 15000 });
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15000 });
    // 알림이 실어 온 탭(view=)으로 연다
    await expect(workspaceTab(page, '공지')).toHaveAttribute('aria-selected', 'true');
    await ctx.close();
  });

  test('★ 관리자는 운영 주소에서 같은 공모 화면을 본다(돌아갈 곳은 [운영 조회])', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'admin');
    await page.goto(`/exhibitions/${exId}/operation/new`);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15000 });
    await expect(workspace(page).getByRole('link', { name: '운영 조회', exact: true })).toBeVisible();
    await ctx.close();
  });
});

test.describe('[지원자] 탭의 도구', () => {
  let title: string;

  test.beforeAll(async () => {
    const api = await pwRequest.newContext();
    title = `패널도구검증 ${Date.now()}`;
    await createExhibition(api, { title, galleryId: await galleryId(api), description: '패널 도구 E2E' });
    await api.dispose();
  });

  test('★ [추가 질문 수정]은 목록이 아니라 [지원자] 탭 도구 줄 · [작가 초대]는 어디에도 없다(2026-11-19)', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'gallery');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage?tab=my-exhibitions');
    await expect(page.locator('body')).toContainText(title, { timeout: 15000 });

    const row = exhibitionCard(page, title);
    await expect(row.getByRole('button', { name: /추가 질문/ })).toHaveCount(0);

    await row.getByRole('button', { name: title }).first().click();
    await openWorkspaceTab(page, '지원자');
    const manager = page.locator('[data-applicant-manager]');
    await expect(manager.getByRole('button', { name: /추가 질문 수정/ })).toBeVisible({ timeout: 10000 });
    await expect(manager).toContainText('초대 코드');
    await expect(manager.getByRole('button', { name: '작가 초대' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '작가 초대' })).toHaveCount(0);

    // 누르면 추가 질문 창이 열린다
    await manager.getByRole('button', { name: /추가 질문 수정/ }).click();
    await expect(page.getByRole('dialog')).toContainText('추가 질문', { timeout: 10000 });
    await ctx.close();
  });
});
