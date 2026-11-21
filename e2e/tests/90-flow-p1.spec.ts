import { test, expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';
import {
  openAs, tokenFor, ownedGalleryId, createExhibition, applyToExhibition, ensurePublicArtworks, exhibitionCard, workspace, applicantRow, closeRecruitment,
} from '../lib/helpers';

/**
 * 공모 흐름 개편(규칙 88) P1 묶음 — 지원서 실패·연타·돌려보내기 · 상태별 새로고침 · 미선정 확인 연타 · 마감 되돌리기 · 승인 전 화면
 * (2026-11-21, `scratchpad/flow-review-2026-11/TESTCASES.md` APL-03·05·10 · REL-08 · ART-03 · LIF-10 · WS-08).
 */
const API = 'http://localhost:4000/api';
const auth = (role: Parameters<typeof tokenFor>[0]) => ({ Authorization: `Bearer ${tokenFor(role)}` });
const newTitle = (what: string) => `E2E P1 ${what} ${Date.now()}`;
const sleep = (ms: number) => new Promise((f) => setTimeout(f, ms));
const day = (n: number) => new Date(Date.now() + 9 * 3600e3 + n * 864e5).toISOString().slice(0, 10);

async function applyAs(api: APIRequestContext, exId: number, role: 'artist' | 'artist2') {
  const r = await applyToExhibition(api, exId, tokenFor(role));
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()).id as number;
}
const setStatus = (api: APIRequestContext, exId: number, appId: number, status: string) =>
  api.patch(`${API}/exhibitions/${exId}/applications/${appId}`, { headers: auth('gallery'), data: { status } });
function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test.describe('지원서', () => {
  test('★ APL-03·05 빈 필수는 창을 열지 않고 알림 · 보내기가 실패하면 폼이 남고 다시 내면 된다 · 확인 창 연타에도 요청은 한 번 · APL-10 낸 뒤 주소로 오면 상세로', async ({ browser }) => {
    test.setTimeout(150_000);
    const api = await pwRequest.newContext();
    await ensurePublicArtworks(api, tokenFor('artist'), 2);
    const exId = await createExhibition(api, { title: newTitle('지원실패'), galleryId: await ownedGalleryId(api) });
    const { page, ctx } = await openAs(browser, 'artist');
    const errors = collectErrors(page);
    await page.goto(`/exhibitions/${exId}/apply`);
    await expect(page.locator('#apply-images img').first()).toBeVisible({ timeout: 15000 });
    const bio = page.getByPlaceholder('작가 소개·약력을 입력하세요.');
    await bio.fill('');
    await page.getByRole('button', { name: '지원하기', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '지원서를 보낼까요?' })).toHaveCount(0);
    await expect(page.locator('body')).toContainText('아직 채울 것: 작가 약력');
    await bio.fill('E2E 약력');

    let posts = 0;
    let failNext = true;
    await page.route(`**/api/exhibitions/${exId}/apply`, async (r) => {
      if (r.request().method() !== 'POST') return r.continue();
      posts++;
      if (failNext) { failNext = false; return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"잠시 문제가 생겼어요"}' }); }
      await sleep(1500);
      return r.continue();
    });
    const sendViaSheet = async (dbl: boolean) => {
      await page.getByRole('button', { name: '지원하기', exact: true }).click();
      const sheet = page.getByRole('dialog', { name: '지원서를 보낼까요?' });
      await sheet.getByRole('checkbox', { name: /작가 지원 약관에 동의합니다/ }).check();
      const btn = sheet.getByRole('button', { name: '지원하기', exact: true });
      if (dbl) await btn.dblclick(); else await btn.click();
    };
    // ① 실패 → 폼 그대로 · 오류 안내
    await sendViaSheet(false);
    await expect(page.locator('body')).toContainText('잠시 문제가 생겼어요', { timeout: 10000 });
    await expect(page).toHaveURL(new RegExp(`/exhibitions/${exId}/apply$`));
    await expect(bio).toHaveValue('E2E 약력');
    // ② 다시 — 확인 창 [지원하기] 를 연타해도 한 번만 간다
    await sleep(600);
    await sendViaSheet(true);
    await page.waitForURL(new RegExp(`/exhibitions/${exId}$`), { timeout: 15000 });
    await expect(page.getByText('지원 완료', { exact: true })).toBeVisible({ timeout: 10000 });
    await sleep(1000);
    expect(posts, '지원 요청 수(실패 1 + 성공 1)').toBe(2);
    await expect(page.getByRole('dialog', { name: '지원서를 보낼까요?' }), '연타한 둘째 클릭이 창을 다시 열었다').toHaveCount(0);
    // APL-10 — 이미 낸 공모의 지원서 주소는 상세로
    await page.goto(`/exhibitions/${exId}/apply`);
    await expect(page).toHaveURL(new RegExp(`/exhibitions/${exId}$`), { timeout: 10000 });
    expect(errors).toEqual([]);
    await ctx.close();
    await api.dispose();
  });

  test('★ APL-10 지원할 수 없는 공모의 지원서 주소 — 아직 시작 전 · 모집 마감 → 상세로', async ({ browser }) => {
    test.setTimeout(120_000);
    const api = await pwRequest.newContext();
    const gid = await ownedGalleryId(api);
    const notYet = await createExhibition(api, { title: newTitle('시작전'), galleryId: gid, dates: { deadlineStart: day(3) } });
    const closed = await createExhibition(api, { title: newTitle('마감'), galleryId: gid });
    expect((await api.patch(`${API}/operations/${closed}/lifecycle`, { headers: auth('gallery'), data: { recruitmentClosed: true } })).status()).toBe(200);
    const { page, ctx } = await openAs(browser, 'artist2');
    for (const id of [notYet, closed]) {
      await page.goto(`/exhibitions/${id}/apply`);
      await expect(page, `공모 ${id}`).toHaveURL(new RegExp(`/exhibitions/${id}$`), { timeout: 10000 });
    }
    await ctx.close();
    await api.dispose();
  });
});

test.describe('새로고침 · 연타', () => {
  test('★ REL-08 공모 화면의 상태마다 새로고침 — 지원서 창 · 확인창 · 메뉴 · 일괄 선택 · 탭 → 같은 공모, 확인창이 다시 뜨지 않는다', async ({ browser }) => {
    test.setTimeout(150_000);
    const api = await pwRequest.newContext();
    const title = newTitle('새로고침');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    await applyAs(api, exId, 'artist');
    await applyAs(api, exId, 'artist2');
    const { page, ctx } = await openAs(browser, 'gallery');
    const errors = collectErrors(page);
    const url = `/mypage?tab=my-exhibitions&ex=${exId}`;
    const sameScreen = async (label: string) => {
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: title }), label).toBeVisible({ timeout: 15000 });
      await expect(workspace(page).getByRole('tablist').first(), label).toBeVisible();
      await expect(page.getByRole('dialog'), `${label} — 새로고침 뒤 창이 남았다`).toHaveCount(0);
    };
    await page.goto(url);
    const manager = page.locator('[data-applicant-manager]').first();
    await expect(manager).toBeVisible({ timeout: 15000 });
    // 지원서 창
    await applicantRow(manager, 'Artist 1').getByRole('button').first().click();
    await expect(page.getByRole('dialog', { name: /지원서$/ })).toBeVisible();
    await sameScreen('지원서 창');
    // 확인창(모집 마감)
    await page.locator('[data-workspace-bar], [data-task-bar]').getByRole('button', { name: '모집 마감', exact: true }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await sameScreen('확인창');
    // 메뉴
    await workspace(page).getByRole('button', { name: '더 보기' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await sameScreen('메뉴');
    // 일괄 선택 — 수락·거절(일괄 포함)은 모집을 마감한 뒤에만 있다(규칙 90)
    await closeRecruitment(api, exId);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15000 });
    await page.locator('[data-applicant-manager]').first().getByRole('checkbox', { name: /Artist 1.*선택|선택.*Artist 1/ }).first().check();
    await sameScreen('일괄 선택');
    // 탭(공지)
    await workspace(page).getByRole('tab', { name: /공지/ }).click();
    await sameScreen('공지 탭');
    expect(errors).toEqual([]);
    await ctx.close();
    await api.dispose();
  });

  test('★ ART-03 미선정 [확인]을 연타해도 한 번 · 줄이 사라지고 새로고침해도 없다 · 주소로는 열린다', async ({ browser }) => {
    test.setTimeout(120_000);
    const api = await pwRequest.newContext();
    const title = newTitle('미선정확인');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api) });
    const appId = await applyAs(api, exId, 'artist2');
    await closeRecruitment(api, exId);
    // 거절은 따로 없다(규칙 90) — 전시를 확정하면 선정이 끝나 남은 검토 대기(artist2)가 미선정이 된다(알림 없음)
    expect((await api.patch(`http://localhost:4000/api/operations/${exId}/lifecycle`, { headers: { Authorization: `Bearer ${tokenFor('gallery')}` }, data: { confirmed: true } })).status()).toBe(200);
    expect(appId).toBeTruthy();
    const { page, ctx } = await openAs(browser, 'artist2');
    const errors = collectErrors(page);
    let acks = 0;
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/acknowledge-rejection')) acks++; });
    await page.goto('/mypage?tab=applications');
    // 미선정 확인을 기다리는 줄은 [심사 중] 에 있다 — 진행 중인 전시가 있는 작가는 목록이 [진행 중] 으로 열린다(앞 스펙이 artist2 를 수락해 두면 그렇다)
    const reviewingTab = page.getByRole('tab', { name: /심사 중/ });
    await expect(reviewingTab.or(page.locator('[data-exhibition-row]')).first()).toBeVisible({ timeout: 15000 });
    if (await reviewingTab.count()) await reviewingTab.click();
    const row = exhibitionCard(page, title);
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.getByRole('button').filter({ hasText: '확인' }).last().dblclick();
    await expect(row).toHaveCount(0, { timeout: 10000 });
    await sleep(1000);
    expect(acks, '미선정 확인 요청 수').toBe(1);
    await expect(page.locator('body')).not.toContainText('처리에 실패했습니다');
    await page.reload();
    await expect(page.locator('[data-exhibition-row]').first().or(page.getByText(/아직|없어요/).first())).toBeVisible({ timeout: 15000 });
    if (await reviewingTab.count()) await reviewingTab.click();
    await expect(exhibitionCard(page, title)).toHaveCount(0);
    await page.goto(`/mypage?tab=applications&ex=${exId}`);
    await expect(page.locator(`[data-artist-workspace="${exId}"]`)).toContainText('선정되지 않았어요', { timeout: 15000 });
    expect(errors).toEqual([]);
    await ctx.close();
    await api.dispose();
  });
});

test.describe('단계', () => {
  test('★ LIF-10 모집 마감은 되돌릴 수 없다(규칙 90) — [⋯]에 되돌리기가 없고 서버도 400 · 모집공고에 다시 뜨지 않는다 · 결정은 마감 뒤에', async ({ browser }) => {
    test.setTimeout(120_000);
    const api = await pwRequest.newContext();
    const title = newTitle('마감되돌리기');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    const accepted = await applyAs(api, exId, 'artist');
    const pending = await applyAs(api, exId, 'artist2');
    expect((await setStatus(api, exId, accepted, 'ACCEPTED')).status(), '모집 중엔 수락할 수 없다').toBe(400);
    expect((await api.patch(`${API}/operations/${exId}/lifecycle`, { headers: auth('gallery'), data: { recruitmentClosed: true } })).status()).toBe(200);
    expect((await setStatus(api, exId, accepted, 'ACCEPTED')).status()).toBe(200);
    const openIds = async () => ((await (await api.get(`${API}/exhibitions?scope=open`)).json()) as { id: number }[] | { exhibitions: { id: number }[] });
    const ids = (d: Awaited<ReturnType<typeof openIds>>) => (Array.isArray(d) ? d : d.exhibitions).map((e) => e.id);
    expect(ids(await openIds())).not.toContain(exId);

    const { page, ctx } = await openAs(browser, 'gallery');
    await page.goto(`/mypage?tab=my-exhibitions&ex=${exId}`);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15000 });
    await workspace(page).getByRole('button', { name: '더 보기' }).click();
    await expect(page.getByRole('menuitem').first()).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /모집 마감/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    for (const role of ['gallery', 'admin'] as const) {
      const r = await api.patch(`${API}/operations/${exId}/lifecycle`, { headers: auth(role), data: { recruitmentClosed: false } });
      expect(r.status(), role).toBe(400);
      expect((await r.json()).error).toBe('모집 마감은 되돌릴 수 없어요.');
    }
    expect(ids(await openIds())).not.toContain(exId);
    const apps = await (await api.get(`${API}/exhibitions/${exId}/applications`, { headers: auth('gallery') })).json();
    const list = (apps.applications ?? apps) as { id: number; status: string }[];
    expect(list.find((a) => a.id === pending)?.status, '마감은 아무도 미선정으로 바꾸지 않는다 — 선정할 차례').toBe('SUBMITTED');
    expect(list.find((a) => a.id === accepted)?.status).toBe('ACCEPTED');
    await ctx.close();
    await api.dispose();
  });

  test('★ WS-08 승인 대기 · 반려 공모 화면 — 탭·할 일 없이 상태만, 반려는 사유', async ({ browser }) => {
    test.setTimeout(120_000);
    const api = await pwRequest.newContext();
    const gid = await ownedGalleryId(api);
    const tWait = newTitle('승인대기');
    const waiting = await createExhibition(api, { title: tWait, galleryId: gid, approve: false });
    const tRej = newTitle('반려');
    const rejected = await createExhibition(api, { title: tRej, galleryId: gid, approve: false });
    expect((await api.patch(`${API}/approvals/exhibition/${rejected}`, { headers: auth('admin'), data: { status: 'REJECTED', rejectReason: 'E2E 반려 사유 — 포스터를 바꿔 주세요' } })).status()).toBe(200);
    const { page, ctx } = await openAs(browser, 'gallery');
    const errors = collectErrors(page);
    for (const [id, t, extra] of [[waiting, tWait, '승인 대기'], [rejected, tRej, 'E2E 반려 사유 — 포스터를 바꿔 주세요']] as const) {
      await page.goto(`/mypage?tab=my-exhibitions&ex=${id}`);
      await expect(page.getByRole('heading', { level: 1, name: t })).toBeVisible({ timeout: 15000 });
      await expect(workspace(page)).toContainText(extra);
      await expect(workspace(page).getByRole('tablist'), `${t} — 탭이 있다`).toHaveCount(0);
      // 상태 문장은 있어도 된다 — 누를 할 일(버튼)은 없다
      await expect(page.locator('[data-workspace-bar], [data-task-bar]').getByRole('button'), `${t} — 할 일 버튼이 있다`).toHaveCount(0);
    }
    expect(errors).toEqual([]);
    await ctx.close();
    await api.dispose();
  });
});

// ─────────────────────────────────────────────────────────────
/*
  REL-12 · O6 — 로그인이 풀려도 쓰던 입력이 남는다(2026-11-21, 사용자 결정 "남겨" · lib/authStash).
  예전엔 로그인(7일)이 끝나 아무 요청이나 401 을 받으면 곧바로 로그아웃되고, 다시 로그인해 같은 화면으로 돌아와도 쓰던 정산·출품 자료·지원서가 사라져 있었다.
  만료는 API 를 잠깐 401 로 바꿔 흉내 내고, 다시 로그인은 로그인 화면의 [개발자 로그인]으로 **실제로** 한다(돌아갈 곳까지 실제 길로).
*/
test.describe('로그인이 풀렸을 때 — 쓰던 입력이 남는다(REL-12)', () => {
  const API_ALL = '**/api/**';
  const expire = (page: Page) => page.route(API_ALL, (r) => r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: '인증이 필요합니다.' }) }));
  async function loginAgain(page: Page, email: string, role: '작가' | '갤러리', name: string) {
    await expect(page).toHaveURL(/\/login/, { timeout: 40_000 });
    await page.unroute(API_ALL);
    await page.getByRole('button', { name: /다른 계정으로 로그인/ }).click();
    await page.getByRole('button', { name: role, exact: true }).click();
    await page.getByPlaceholder('이름 또는 이메일로 검색').fill(email);
    await page.getByRole('button', { name: new RegExp(`^${name}\\s*${role}`) }).first().click();
    await page.waitForURL((u) => u.pathname !== '/login', { timeout: 15_000 });
  }
  const accept = async (api: APIRequestContext, exId: number, role: 'artist' | 'artist2') => {
    const appId = await applyAs(api, exId, role);
    await closeRecruitment(api, exId);   // 수락은 마감한 뒤에(규칙 90)
    expect((await setStatus(api, exId, appId, 'ACCEPTED')).status()).toBe(200);
  };

  test('★ 갤러리 — 정산을 쓰다 [저장만 하기]에서 로그인이 풀림 → 다시 로그인하면 같은 공모 [정산] 탭에 쓰던 값 · 서버는 그대로 · 한 번만 되살린다', async ({ browser }) => {
    test.setTimeout(150_000);
    const api = await pwRequest.newContext();
    const title = newTitle('만료정산');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    await accept(api, exId, 'artist');
    expect((await api.put(`${API}/operations/${exId}/me`, { headers: auth('artist'), data: { artworkList: [{ title: '만료작품', size: '60x40', medium: '유채', year: '2026', price: '1', image: '' }], cv: { nameKo: 'a' }, note: { statement: 'n', sections: [] }, representativeIndex: 0 } })).status()).toBe(200);
    expect((await api.patch(`${API}/operations/${exId}/lifecycle`, { headers: auth('gallery'), data: { recruitmentClosed: true, confirmed: true, ended: true } })).status()).toBe(200);

    const { page, ctx } = await openAs(browser, 'gallery');
    const errors = collectErrors(page);
    await page.goto(`/mypage?tab=my-exhibitions&ex=${exId}&view=settlement`);
    const ratio = page.locator('#settle-ratio');
    await expect(ratio).toBeEditable({ timeout: 15000 });
    await ratio.fill('35');
    await expire(page);
    await page.getByRole('button', { name: '저장만 하기' }).first().click();
    await loginAgain(page, 'gallery@artlink.com', '갤러리', 'Gallery Owner');
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15000 });
    await expect(ratio, '쓰던 갤러리 몫이 사라졌다').toHaveValue('35', { timeout: 15000 });
    await expect(page.locator('body')).toContainText('쓰던 정산 입력을 되살렸어요');
    // 저장은 사람이 누른다 — 서버는 아직 그대로
    const before = await (await api.get(`${API}/operations/${exId}/settlement`, { headers: auth('gallery') })).json();
    expect(before.artists[0].galleryRatio).not.toBe(35);
    // 한 번만 — 새로고침하면 서버 값(되살린 것은 이미 지웠다)
    page.on('dialog', (d) => { void d.accept(); });
    await page.reload();
    await expect(ratio).toBeEditable({ timeout: 15000 });
    await expect(ratio).not.toHaveValue('35');
    expect(errors).toEqual([]);
    await ctx.close();
    await api.dispose();
  });

  test('★ 작가 — 지원서를 쓰다 화면이 알림 숫자를 받다 로그인이 풀림(저장 버튼이 아니어도) → 다시 로그인하면 같은 지원서에 쓰던 약력', async ({ browser }) => {
    test.setTimeout(150_000);
    const api = await pwRequest.newContext();
    const exId = await createExhibition(api, { title: newTitle('만료지원'), galleryId: await ownedGalleryId(api) });
    const { page, ctx } = await openAs(browser, 'artist');
    const errors = collectErrors(page);
    await page.goto(`/exhibitions/${exId}/apply`);
    const bio = page.getByPlaceholder('작가 소개·약력을 입력하세요.');
    await expect(bio).toBeEditable({ timeout: 15000 });
    const text = `만료 전에 쓰던 약력 ${Date.now()}`;
    await bio.fill(text);
    await expire(page);   // 30초마다 도는 알림 숫자 요청이 401 을 받는다
    await loginAgain(page, 'artist1@artlink.com', '작가', 'Artist 1');
    await expect(page).toHaveURL(new RegExp(`/exhibitions/${exId}/apply`));
    await expect(bio).toHaveValue(text, { timeout: 15000 });
    await expect(page.locator('body')).toContainText('쓰던 지원서를 되살렸어요');
    expect(errors).toEqual([]);
    await ctx.close();
    await api.dispose();
  });

  test('★ 작가 — 출품 자료를 쓰다 [임시저장]에서 로그인이 풀림 → 다시 로그인하면 [출품 자료]에 쓰던 연락처', async ({ browser }) => {
    test.setTimeout(150_000);
    const api = await pwRequest.newContext();
    const title = newTitle('만료출품');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api) });
    await accept(api, exId, 'artist');
    const { page, ctx } = await openAs(browser, 'artist');
    const errors = collectErrors(page);
    await page.goto(`/mypage?tab=applications&ex=${exId}`);
    const contact = page.getByRole('textbox', { name: '연락처' });
    await expect(contact).toBeEditable({ timeout: 15000 });
    await contact.fill('010-1234-5678');
    await expire(page);
    await page.getByRole('button', { name: '임시저장' }).first().click();
    await loginAgain(page, 'artist1@artlink.com', '작가', 'Artist 1');
    await expect(contact).toHaveValue('010-1234-5678', { timeout: 15000 });
    await expect(page.locator('body')).toContainText('되살렸어요');
    expect(errors).toEqual([]);
    await ctx.close();
    await api.dispose();
  });
});
