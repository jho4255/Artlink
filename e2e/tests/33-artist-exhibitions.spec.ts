import { test, expect, request as pwRequest, type Page } from '@playwright/test';
import { openAs, tokenFor, applyToExhibition, createExhibition, exhibitionCard, artistTab, openArtistTab } from '../lib/helpers';

/**
 * 작가 [내 전시] — 2026-08-27~28 개편분.
 *
 *  · 2026-11-20(규칙 88): 카드 → **줄 목록 + 전시 화면**. 줄을 누르면 마이페이지 안에서 그 전시 화면(탭: 출품 자료 · 정산 · 공지 · 내 지원서)이 열린다.
 *    줄에는 진행 띠와 지금 할 일(+ 그 탭으로 데려가는 버튼). 운영 주소로 오면 그 전시 화면으로 되돌려 보낸다.
 *  · 2026-09-29: 탭이 밑줄 탭(`role="tab"`)이 되고 이름이 갤러리 [내 공모]와 같아졌다 — 심사 중 · 진행 중 · 종료.
 *  · 2026-11-19: 1:1 공모 초대를 통째로 없앴다 → '받은 초대' 탭도 없다. 이미 선정된 작가는 초대 **코드**로 들어온다(e2e 55).
 */
const API = 'http://localhost:4000/api';
const DESKTOP = { width: 1440, height: 900 };

async function galleryId(api: any): Promise<number> {
  const gs = await api.get(`${API}/galleries?owned=true`, { headers: { Authorization: `Bearer ${tokenFor('gallery')}` } });
  const gl = await gs.json();
  return (Array.isArray(gl) ? gl : gl.galleries).find((g: any) => g.status === 'APPROVED').id;
}

async function makeExhibition(api: any, title: string, capacity = 5) {
  return createExhibition(api, { title, galleryId: await galleryId(api), capacity, type: 'GROUP', description: '내전시 E2E' });
}

/**
 * [내 전시] 화면은 **지원이 하나도 없으면 탭 자체를 그리지 않는다**
 * ("아직 지원하거나 참여한 전시가 없습니다"). 그래서 탭 구성을 보려면 먼저 데이터가 있어야 한다.
 * 이걸 안 깔아두면 "탭이 없다"는 실패가 나는데, 원인은 탭이 아니라 빈 목록이다.
 */
test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  const id = await makeExhibition(api, `기본지원 ${Date.now()}`);
  const r = await applyToExhibition(api, id, tokenFor('artist'));
  if (!r.ok()) throw new Error(`기본 지원 실패 ${r.status()}: ${await r.text()}`);
  await api.dispose();
});

const gotoMyExhibitions = async (page: Page) => {
  await page.goto('/mypage?tab=applications');
  await expect(page.getByRole('tab', { name: /^심사 중/ })).toBeVisible({ timeout: 15000 });
};
/** 탭 이름 뒤에 개수가 붙는다('진행 중3') — 이름만으로 찾는다 */
const tab = (page: Page, name: string) => page.getByRole('tablist', { name: '내 전시 분류' }).getByRole('tab', { name: new RegExp(`^${name}`) });

test.describe('탭 구성', () => {
  test('★ 탭은 심사 중 · 진행 중 · 종료 — 받은 초대 탭은 없다(2026-11-19)', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await gotoMyExhibitions(page);

    /* 탭 이름 뒤에는 개수가 따로 붙는다(`<span>`) — 첫 글자 마디(이름)만 읽어 비교한다 */
    const tabs = await page.getByRole('tablist', { name: '내 전시 분류' }).getByRole('tab').evaluateAll(bs =>
      bs.map(b => (b.firstChild?.textContent ?? '').trim()));
    expect(tabs).toEqual(['심사 중', '진행 중', '종료']);

    // 사이드바에도 없어야 한다
    await expect(page.locator('aside nav')).not.toContainText('받은 초대');
    // 초대 코드 입력 줄은 남아 있다(이미 선정된 작가용)
    await expect(page.locator('main')).toContainText('초대 코드', { timeout: 10000 });
    await ctx.close();
  });
});

test.describe('수락된 전시 — 목록 줄 → 전시 화면에서 처리한다(2026-11-20)', () => {
  let title: string;
  let cardExId: number;

  test.beforeAll(async () => {
    const api = await pwRequest.newContext();
    title = `카드운영 ${Date.now()}`;
    const id = await makeExhibition(api, title);
    cardExId = id;
    const ap = await applyToExhibition(api, id, tokenFor('artist'));
    const appId = (await ap.json()).id;
    await api.patch(`${API}/exhibitions/${id}/applications/${appId}`, {
      headers: { Authorization: `Bearer ${tokenFor('gallery')}` }, data: { status: 'ACCEPTED' },
    });
    await api.post(`${API}/operations/${id}/notices`, {
      headers: { Authorization: `Bearer ${tokenFor('gallery')}` },
      data: { title: '설치 안내', content: '전시 전날 오후 2시에 오세요.' },
    });
    await api.dispose();
  });

  test('★ 줄에는 진행 띠와 지금 할 일 — 누르면 마이페이지 안에서 전시 화면이 열린다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await gotoMyExhibitions(page);
    await tab(page, '진행 중').click();
    await expect(page.locator('body')).toContainText(title, { timeout: 15000 });

    const row = exhibitionCard(page, title);
    await expect(row.locator('ol[aria-label="진행 단계"] > li')).toHaveCount(5);
    await expect(row).toContainText('출품 자료를 제출해 주세요');
    // 할 일 버튼 → 그 전시 화면의 [출품 자료] 탭
    await row.getByRole('button', { name: '제출하기' }).click();
    await expect(page).toHaveURL(new RegExp(`/mypage\\?tab=applications&ex=${cardExId}`));
    await expect(artistTab(page, '출품 자료')).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
    // 정산은 전시가 끝나야 열린다(잠긴 탭)
    await expect(artistTab(page, '정산')).toHaveAttribute('aria-disabled', 'true');
    await ctx.close();
  });

  test('★ 공지·내 지원서는 탭 — 공지를 누르면 갤러리가 올린 글이 보이고, [← 내 전시]로 보던 탭에 돌아온다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await gotoMyExhibitions(page);
    await tab(page, '진행 중').click();
    await exhibitionCard(page, title).getByRole('button', { name: title }).first().click();
    const ws = page.locator(`[data-artist-workspace="${cardExId}"]`);
    await expect(ws).toBeVisible({ timeout: 15000 });

    await openArtistTab(page, '공지');
    await expect(ws).toContainText('설치 안내', { timeout: 10000 });
    await openArtistTab(page, '내 지원서');
    await expect(ws).toContainText('작가 약력');

    await ws.getByRole('button', { name: '내 전시', exact: true }).click();
    await expect(page).toHaveURL(/\/mypage\?tab=applications$/);
    await expect(tab(page, '진행 중')).toHaveAttribute('aria-selected', 'true');
    await expect(exhibitionCard(page, title)).toBeVisible();
    await ctx.close();
  });

  test('★ 작가가 운영페이지 주소로 오면 마이페이지의 그 전시로 되돌려 보낸다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.goto(`/exhibitions/${cardExId}/operation/new`);
    await page.waitForURL(new RegExp(`/mypage\\?tab=applications&ex=${cardExId}`), { timeout: 15000 });
    await expect(page.locator(`[data-artist-workspace="${cardExId}"]`)).toBeVisible({ timeout: 15000 });
    await ctx.close();
  });
});
