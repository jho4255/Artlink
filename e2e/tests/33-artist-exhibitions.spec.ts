import { test, expect, request as pwRequest, type Page } from '@playwright/test';
import { openAs, tokenFor, userIds, applyToExhibition, settle, createExhibition, ensurePublicArtworks, seedGalleryLike } from '../lib/helpers';

/**
 * 작가 [내 전시] — 2026-08-27~28 개편분.
 *
 *  · [받은 초대] 메뉴 탭은 없앴다 → **[내 전시]의 첫 탭 '받은 초대'**.
 *  · 초대 [참여하기] = **지원 없이 바로 참가**(ACCEPTED). 정원·마감은 그대로 지킨다.
 *  · 수락된 전시는 카드 안에서 **운영 공지·제출 자료·정산 확인**까지 끝낸다(운영페이지 왕복 없음).
 *  · 카드 우측 상단은 [전시 관리] 하나 — [공모 상세] 버튼은 없앴다.
 *  · 일정 줄은 **항상** 그린다 (없다고 빼면 카드 높이가 제각각이 된다).
 */
const API = 'http://localhost:4000/api';
const DESKTOP = { width: 1440, height: 900 };

async function galleryId(api: any): Promise<number> {
  const gs = await api.get(`${API}/galleries?owned=true`, { headers: { Authorization: `Bearer ${tokenFor('gallery')}` } });
  const gl = await gs.json();
  return (Array.isArray(gl) ? gl : gl.galleries).find((g: any) => g.status === 'APPROVED').id;
}

/**
 * 작가1 초대. ⚠️ 경로는 `/invite`(단수), 필드는 `artistId` 다 —
 * `/invites` 로 부르면 **404 가 나는데 테스트는 조용히 지나가** 초대가 없는 채로 화면을 보게 된다.
 * ⚠️ 하루 초대 상한(갤러리당 10명)이 있어 앞선 테스트가 다 써 버릴 수 있다 → 상태를 확인해 알려준다.
 */
async function invite(api: any, exhibitionId: number, message?: string) {
  // ⚠️ 2026-08-29 부터 **초대 관문**이 있다(`lib/inviteEligibility.ts`) — 갤러리는 하트를 저장했거나
  //    서로 이웃인 작가만 초대할 수 있다. 안 눌러 두면 여기가 **403** 이고, 그러면 이 파일의
  //    모든 테스트가 "탭이 없다"로 엉뚱하게 죽는다(원인이 증상과 안 닮았다).
  await seedGalleryLike(api, 'artist');
  const r = await api.post(`${API}/exhibitions/${exhibitionId}/invite`, {
    headers: { Authorization: `Bearer ${tokenFor('gallery')}` },
    data: { artistId: userIds().artist, ...(message ? { message } : {}) },
  });
  if (!r.ok()) throw new Error(`초대 실패 ${r.status()}: ${await r.text()}`);
}

async function makeExhibition(api: any, title: string, capacity = 5) {
  return createExhibition(api, { title, galleryId: await galleryId(api), capacity, type: 'GROUP', description: '내전시 E2E' });
}

/**
 * [내 전시] 화면은 **지원도 초대도 하나 없으면 탭 자체를 그리지 않는다**
 * ("아직 지원하거나 참여한 전시가 없습니다"). 그래서 탭 구성을 보려면 먼저 데이터가 있어야 한다.
 * 이걸 안 깔아두면 "탭이 없다"는 실패가 나는데, 원인은 탭이 아니라 빈 목록이다.
 */
test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  const id = await makeExhibition(api, `기본초대 ${Date.now()}`);
  await invite(api, id, '기본 데이터');
  await api.dispose();
});

const gotoMyExhibitions = async (page: Page) => {
  await page.goto('/mypage?tab=applications');
  await expect(page.getByRole('button', { name: '받은 초대' })).toBeVisible({ timeout: 15000 });
};

test.describe('탭 구성', () => {
  test('★ 첫 탭이 [받은 초대] 다 (별도 메뉴 탭은 없앴다)', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await gotoMyExhibitions(page);

    /* 탭 라벨 뒤에는 개수가 붙는다 — '받은 초대 (2)'. 개수를 떼고 비교한다
       (그냥 비교하면 개수가 0 인 탭만 걸려 목록이 뒤죽박죽으로 보인다). */
    const tabs = await page.locator('main button').evaluateAll(bs =>
      bs.map(b => b.textContent!.trim().replace(/\s*\(\d+\)$/, ''))
        .filter(t => ['받은 초대', '심사중', '진행중', '진행종료'].includes(t)));
    expect(tabs.slice(0, 4)).toEqual(['받은 초대', '심사중', '진행중', '진행종료']);

    // 사이드바에는 없어야 한다
    await expect(page.locator('aside nav')).not.toContainText('받은 초대');
    await ctx.close();
  });
});

test.describe('초대 → 바로 참가', () => {
  let exId: number;
  let title: string;

  test.beforeAll(async () => {
    const api = await pwRequest.newContext();
    title = `초대검증 ${Date.now()}`;
    exId = await makeExhibition(api, title);
    await invite(api, exId, '작품 잘 보았습니다. 함께해요.');
    // ⚠️ 초대 수락(=바로 참가)은 작가 포트폴리오에 작품이 있어야 통과한다.
    //    격리 실행 시 artist1 포트폴리오가 비어 있어 accept 가 조용히 400 이 났다(전체 실행에선 앞 스펙이 채워줬다).
    await ensurePublicArtworks(api, tokenFor('artist'), 1);
    await api.dispose();
  });

  test('★ [참여하기] 하나로 지원서 없이 참가자가 된다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await gotoMyExhibitions(page);
    await page.getByRole('button', { name: '받은 초대' }).click();
    await expect(page.locator('body')).toContainText(title, { timeout: 12000 });

    /* ⚠️ 초대가 여럿일 수 있다(다른 테스트가 남긴 것). `.first()` 로 아무거나 누르면 엉뚱한 초대를 수락한다.
       **이 테스트의 공모 카드**를 제목으로 특정해 그 안의 [참여하기]를 누른다. */
    const card = page.locator('article').filter({ hasText: title }).first();
    await expect(card).toContainText('작품 잘 보았습니다');
    await card.getByRole('button', { name: '참여하기' }).click();
    await settle(page, 2000);

    // 진행중 탭에 수락 상태로 들어와 있어야 한다
    await page.getByRole('button', { name: '진행중' }).click();
    await expect(page.locator('body')).toContainText(title, { timeout: 12000 });
    await ctx.close();

    // 서버 상태도 확인 — ACCEPTED 지원이 만들어졌다
    const api = await pwRequest.newContext();
    const r = await api.get(`${API}/exhibitions/${exId}/applications`, {
      headers: { Authorization: `Bearer ${tokenFor('gallery')}` },
    });
    const apps = await r.json();
    const mine = (Array.isArray(apps) ? apps : apps.applications).find((a: any) => a.userId === userIds().artist);
    expect(mine.status).toBe('ACCEPTED');
    await api.dispose();
  });

  test('★ 정원이 찼으면 초대가 있어도 못 들어간다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const t = `정원검증 ${Date.now()}`;
    const id = await makeExhibition(api, t, 1);

    // 정원 1을 artist2 가 채운다
    const ap = await applyToExhibition(api, id, tokenFor('artist2'));
    const appId = (await ap.json()).id;
    await api.patch(`${API}/exhibitions/${id}/applications/${appId}`, {
      headers: { Authorization: `Bearer ${tokenFor('gallery')}` }, data: { status: 'ACCEPTED' },
    });
    // 그 뒤 artist1 을 초대 → 서버가 막는다(정원이 찬 공모)
    const inv = await api.post(`${API}/exhibitions/${id}/invite`, {
      headers: { Authorization: `Bearer ${tokenFor('gallery')}` },
      data: { artistId: userIds().artist },
    });
    expect([400, 409], `정원이 찼는데 초대가 통과했다 (${inv.status()})`).toContain(inv.status());
    await api.dispose();
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
    await page.getByRole('button', { name: '진행중' }).click();
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
    await page.getByRole('button', { name: '진행중' }).click();
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
    await page.getByRole('button', { name: '진행중' }).click();
    await settle(page, 1500);

    const heights = await page.locator('article').evaluateAll(els =>
      els.map(e => Math.round(e.getBoundingClientRect().height)).filter(h => h > 50));
    if (heights.length >= 2) {
      const spread = Math.max(...heights) - Math.min(...heights);
      expect(spread, `카드 높이가 ${heights.join('/')} 로 벌어졌다 — 일정 줄이 빠진 카드가 있다`).toBeLessThan(60);
    }
    await ctx.close();
  });
});
