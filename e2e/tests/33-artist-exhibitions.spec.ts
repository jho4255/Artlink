import { test, expect, request as pwRequest, type Page } from '@playwright/test';
import { openAs, tokenFor, applyToExhibition, settle, createExhibition } from '../lib/helpers';

/**
 * 작가 [내 전시] — 2026-08-27~28 개편분.
 *
 *  · 수락된 전시는 카드 안에서 **운영 공지·제출 자료·정산 확인**까지 끝낸다(운영페이지 왕복 없음).
 *  · 카드 우측 상단은 [전시 관리] 하나 — [공모 상세] 버튼은 없앴다.
 *  · 일정 줄은 **항상** 그린다 (없다고 빼면 카드 높이가 제각각이 된다).
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

test.describe('수락된 전시 카드 — 운영페이지 안 들어가고 처리한다', () => {
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

  test('★ 카드 우측 상단은 [전시 관리] 하나 — [공모 상세] 버튼은 없다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await gotoMyExhibitions(page);
    await tab(page, '진행 중').click();
    await expect(page.locator('body')).toContainText(title, { timeout: 15000 });

    const card = page.locator('article').filter({ hasText: title }).first();
    await expect(card.getByRole('button', { name: '전시 관리' })).toBeVisible();
    await expect(card.getByRole('button', { name: '공모 상세' })).toHaveCount(0);
    await ctx.close();
  });

  test('★ 펼치면 운영 공지·제출 자료·정산이 카드 안에 들어온다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await gotoMyExhibitions(page);
    await tab(page, '진행 중').click();
    await expect(page.locator('body')).toContainText(title, { timeout: 15000 });

    const card = page.locator('article').filter({ hasText: title }).first();
    await card.getByRole('button', { name: '전시 관리' }).click();
    await settle(page, 1200);

    const text = await card.innerText();
    /* 공지·제출 자료는 항상. **정산은 전시가 끝나야 블록 자체가 생긴다**
       (`ArtistOperationPanel`: 끝나기 전엔 그리지 않는다) — 진행중 카드에서 찾으면 안 된다. */
    for (const need of ['공지', '제출']) {
      expect(text, `카드 안에 '${need}' 블록이 없다 — 운영페이지로 왕복하게 된다`).toContain(need);
    }
    /* 갤러리가 올린 공지가 실제로 읽힌다.
       ⚠️ [운영 공지] 블록은 **접힌 채로 시작**한다(할 일만 자동으로 펼친다) — 눌러서 펴야 내용이 보인다. */
    await card.getByRole('button', { name: /운영 공지/ }).click();
    await settle(page, 800);
    expect(await card.innerText(), '공지를 폈는데 내용이 없다').toContain('설치 안내');

    // 카드를 다시 누르면 작업 영역이 통째로 접힌다
    await card.getByRole('button', { name: '닫기' }).click();
    await settle(page, 600);
    expect(await card.innerText()).not.toContain('설치 안내');
    await ctx.close();
  });

  test('★ 작가가 운영페이지 주소로 오면 마이페이지로 되돌려 보낸다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.goto(`/exhibitions/${cardExId}/operation/new`);
    await page.waitForURL(/\/mypage/, { timeout: 15000 });
    await ctx.close();
  });

  test('★ 카드 높이가 제각각이지 않다 (일정 줄을 항상 그린다)', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await gotoMyExhibitions(page);
    await tab(page, '진행 중').click();
    await settle(page, 1500);

    /* '지금 할 일' 줄(`data-task-line`)은 **할 일이 있는 카드에만** 있다 — 그건 들쭉날쭉이 아니라 정보라서 빼고 잰다.
       여기서 잡으려는 건 일정 줄처럼 **데이터가 없다고 빠지는** 줄이다. */
    const heights = await page.locator('article').evaluateAll(els =>
      els.map(e => {
        const t = e.querySelector('[data-task-line]') as HTMLElement | null;
        const th = t ? t.getBoundingClientRect().height + parseFloat(getComputedStyle(t).marginTop) : 0;
        return Math.round(e.getBoundingClientRect().height - th);
      }).filter(h => h > 50));
    if (heights.length >= 2) {
      const spread = Math.max(...heights) - Math.min(...heights);
      expect(spread, `카드 높이가 ${heights.join('/')} 로 벌어졌다 — 일정 줄이 빠진 카드가 있다`).toBeLessThan(60);
    }
    await ctx.close();
  });
});
