import { test, expect, request as pwRequest, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import {
  openAs, tokenFor, userIds, ownedGalleryId, createExhibition, applyToExhibition, exhibitionDates,
  exhibitionCard, workspace, workspaceTab, taskButton, openArtistExhibition, openOperation,
  ensurePublicArtworks, openHomepageEditor, openPortfolioMaker,
} from '../lib/helpers';

/**
 * 공모 흐름 개편(규칙 88) 엣지 — 권한 · 알림 도착 · 주소 값 · 읽기 실패 · 부분 실패 · 목록 자리 (2026-11-20,
 * `scratchpad/flow-review-2026-11/TESTCASES.md` WS-02·03·04·06·09 · NTF-01 · REL-04·05 · LST-07·13 · LIF-04·13 · DEV-03).
 */
const API = 'http://localhost:4000/api';
const BASE = 'http://localhost:5173';
const auth = (role: Parameters<typeof tokenFor>[0]) => ({ Authorization: `Bearer ${tokenFor(role)}` });
const newTitle = (what: string) => `E2E엣지 ${what} ${Date.now()}`;
const sleep = (ms: number) => new Promise((f) => setTimeout(f, ms));

async function applyAs(api: APIRequestContext, exId: number, role: 'artist' | 'artist2') {
  const r = await applyToExhibition(api, exId, tokenFor(role));
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()).id as number;
}
async function accept(api: APIRequestContext, exId: number, role: 'artist' | 'artist2') {
  const appId = await applyAs(api, exId, role);
  expect((await api.patch(`${API}/exhibitions/${exId}/applications/${appId}`, { headers: auth('gallery'), data: { status: 'ACCEPTED' } })).status()).toBe(200);
}
async function submitFull(api: APIRequestContext, exId: number, role: 'artist' | 'artist2', work: string) {
  const r = await api.put(`${API}/operations/${exId}/me`, {
    headers: auth(role),
    data: { artworkList: [{ title: work, size: '60x40', medium: '유채', year: '2026', price: '1', image: '' }], cv: { nameKo: work }, note: { statement: 'n', sections: [] }, representativeIndex: 0 },
  });
  expect(r.status(), await r.text()).toBe(200);
}
const lifecycle = (api: APIRequestContext, exId: number, data: Record<string, unknown>) =>
  api.patch(`${API}/operations/${exId}/lifecycle`, { headers: auth('gallery'), data });
async function linkOf(api: APIRequestContext, role: Parameters<typeof tokenFor>[0], type: string, title: string) {
  const list = await (await api.get(`${API}/notifications`, { headers: auth(role) })).json();
  const n = ((list.notifications ?? list) as { type: string; message: string; linkUrl: string }[]).find((x) => x.type === type && x.message.includes(title));
  expect(n, `${role} 의 ${type} 알림`).toBeTruthy();
  return n!.linkUrl;
}
function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}
/** 다른 갤러리 계정 — 가입 API 로 만든다(실행마다 새로) */
async function otherGallery(api: APIRequestContext) {
  const email = `other-gallery-${Date.now()}@e2e.test`;
  const r = await api.post(`${API}/auth/signup`, { data: { name: '다른 갤러리', email, password: 'Gallery1234!', role: 'GALLERY', agreeTerms: true, agreePrivacy: true } });
  expect(r.ok(), await r.text()).toBeTruthy();
  const b = await r.json();
  return { token: b.token as string, user: b.user };
}

// ─────────────────────────────────────────────────────────────
test.describe('WS-04 — 남의 공모는 열리지 않는다(지원자 정보가 새지 않는다)', () => {
  test('★ 다른 갤러리 · 지원하지 않은 작가가 공모 화면 주소를 열면 — 화면은 막히고 운영 API 는 403', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('권한');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api) });
    await applyAs(api, exId, 'artist');
    const other = await otherGallery(api);
    const h = { Authorization: `Bearer ${other.token}` };
    for (const path of [`/operations/${exId}/access`, `/exhibitions/${exId}/applications`, `/operations/${exId}/submissions`, `/operations/${exId}/settlement`]) {
      const r = await api.get(`${API}${path}`, { headers: h });
      expect([403, 404], `${path} → ${r.status()}`).toContain(r.status());
      expect(await r.text(), `${path} 응답에 지원자 이름이 실렸다`).not.toContain('Artist 1');
    }
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [
        { name: 'artlink-auth', value: JSON.stringify({ state: { token: other.token, user: other.user, isAuthenticated: true }, version: 0 }) },
        { name: 'artlink-intro-hidden', value: JSON.stringify({ [String(other.user.id)]: true }) },
      ] }] },
    });
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    await page.goto(`/mypage?tab=my-exhibitions&ex=${exId}`);
    await expect(page.locator('body')).toContainText('이 공모를 열 수 없어요', { timeout: 15000 });
    await expect(page.locator('body')).not.toContainText('Artist 1');
    expect(errors).toEqual([]);
    await ctx.close();

    // 지원하지 않은 작가(artist2) — 그 전시 주소 · 남의 정산 API
    const b = await openAs(browser, 'artist2');
    const bErrors = collectErrors(b.page);
    await b.page.goto(`/mypage?tab=applications&ex=${exId}`);
    await expect(b.page.locator('body')).toContainText('이 전시를 찾지 못했어요', { timeout: 15000 });
    expect((await api.get(`${API}/operations/${exId}/my-settlement`, { headers: auth('artist2') })).status()).toBe(403);
    // 작가가 갤러리 화면 주소로 오면 제 화면으로(깨지지 않는다)
    await b.page.goto(`/mypage?tab=my-exhibitions&ex=${exId}`);
    await expect(b.page.locator('[data-exhibition-workspace]')).toHaveCount(0);
    expect(bErrors).toEqual([]);
    await b.ctx.close();
    await api.dispose();
  });
});

// ─────────────────────────────────────────────────────────────
test.describe('WS-02·06 — 주소의 값이 이상할 때', () => {
  test('★ view 값이 모르는 값 · 잠긴 탭 · 아직 없는 탭이면 단계 기본 탭 · 없는 공모 번호는 막힌 안내', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('주소');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api) });
    const { page, ctx } = await openAs(browser, 'gallery');
    const errors = collectErrors(page);
    for (const v of ['bogus', 'settlement', 'summary']) {
      await page.goto(`/mypage?tab=my-exhibitions&ex=${exId}&view=${v}`);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15000 });
      await expect(workspaceTab(page, '지원자'), `view=${v}`).toHaveAttribute('aria-selected', 'true');
      await expect(workspace(page).getByRole('tabpanel').first(), `view=${v} 에 빈 화면`).toBeVisible();
    }
    for (const bad of ['999999', 'abc', '-1']) {
      await page.goto(`/mypage?tab=my-exhibitions&ex=${bad}`);
      await sleep(1500);
      const body = await page.locator('main').innerText();
      expect(body.includes('이 공모를 열 수 없어요') || body.includes('내 공모'), `ex=${bad}: ${body.slice(0, 80)}`).toBeTruthy();
    }
    expect(errors).toEqual([]);
    await ctx.close();
    await api.dispose();
  });
});

// ─────────────────────────────────────────────────────────────
test.describe('NTF-01 — 새 알림을 누르면 어디에 닿는가', () => {
  test('★ 출품 자료 · 전시 확정 · 모두 확인 · 미선정(D2) 알림 링크가 그 공모의 그 탭으로', async ({ browser }) => {
    test.setTimeout(150_000);
    const api = await pwRequest.newContext();
    const title = newTitle('알림');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    await accept(api, exId, 'artist');
    await applyAs(api, exId, 'artist2');
    expect((await lifecycle(api, exId, { recruitmentClosed: true, rejectPending: true })).status()).toBe(200);
    await submitFull(api, exId, 'artist', '작품A');
    expect((await lifecycle(api, exId, { confirmed: true })).status()).toBe(200);

    const g = await openAs(browser, 'gallery');
    await g.page.goto(await linkOf(api, 'gallery', 'SUBMISSION_RECEIVED', title));
    await expect(g.page).toHaveURL(new RegExp(`tab=my-exhibitions&ex=${exId}`), { timeout: 15000 });
    await expect(workspaceTab(g.page, '출품 자료')).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });

    const a = await openAs(browser, 'artist');
    await a.page.goto(await linkOf(api, 'artist', 'EXHIBITION_CONFIRMED', title));
    await expect(a.page.locator(`[data-artist-workspace="${exId}"]`)).toContainText('갤러리가 전시를 확정해 출품 자료가 잠겼어요', { timeout: 15000 });

    const b = await openAs(browser, 'artist2');
    await b.page.goto(await linkOf(api, 'artist2', 'APPLICATION_STATUS', title));
    await expect(b.page.locator(`[data-artist-workspace="${exId}"]`)).toContainText('선정되지 않았어요', { timeout: 15000 });

    expect((await lifecycle(api, exId, { ended: true })).status()).toBe(200);
    expect((await api.put(`${API}/operations/${exId}/settlement`, { headers: auth('gallery'), data: { sales: [], ratios: [{ artistUserId: userIds().artist, galleryRatio: 40 }] } })).status()).toBe(200);
    expect((await api.post(`${API}/operations/${exId}/settlement/request`, { headers: auth('gallery') })).status()).toBe(200);
    expect((await api.post(`${API}/operations/${exId}/settlement/respond`, { headers: auth('artist'), data: { approve: true } })).status()).toBe(200);
    // 같은 공모 화면을 보는 중에 그 공모의 알림 링크로(같은 주소 재진입 — S5 의 갤러리 쪽)
    await g.page.goto(await linkOf(api, 'gallery', 'SETTLEMENT_ALL_APPROVED', title));
    await expect(workspaceTab(g.page, '정산')).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
    await expect(g.page.locator('[data-task-bar], [data-workspace-bar]').first()).toContainText('모두 정산을 확인했어요', { timeout: 15000 });
    await Promise.all([g.ctx.close(), a.ctx.close(), b.ctx.close()]);
    await api.dispose();
  });
});

// ─────────────────────────────────────────────────────────────
test.describe('REL-04 — 읽기가 실패할 때', () => {
  const fail = async (page: Page, glob: string) => page.route(glob, (r) => (r.request().method() === 'GET'
    ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"실패"}' }) : r.continue()));

  test('★ 운영 접근 · 지원자 · 정산 · 내 전시 목록을 받지 못하면 — 이유를 말하고 틀린 할 일을 말하지 않는다', async ({ browser }) => {
    test.setTimeout(150_000);
    const api = await pwRequest.newContext();
    const title = newTitle('읽기실패');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    await accept(api, exId, 'artist');
    await submitFull(api, exId, 'artist', '작품A');
    expect((await lifecycle(api, exId, { recruitmentClosed: true, confirmed: true, ended: true })).status()).toBe(200);

    // ① 운영 접근 실패 → 막힌 안내(무한 뼈대 금지)
    let { page, ctx } = await openAs(browser, 'gallery');
    await fail(page, `**/api/operations/${exId}/access`);
    await page.goto(`/mypage?tab=my-exhibitions&ex=${exId}`);
    await expect(page.locator('body')).toContainText('이 공모를 열 수 없어요', { timeout: 20000 });
    await ctx.close();

    // ② 지원자 실패 → 지원자 탭은 오류 안내 · 할 일 줄은 '0명' 으로 계산한 말을 하지 않는다
    ({ page, ctx } = await openAs(browser, 'gallery'));
    await fail(page, `**/api/exhibitions/${exId}/applications`);
    await page.goto(`/mypage?tab=my-exhibitions&ex=${exId}&view=applicants`);
    await expect(page.locator('body')).toContainText('지원자 목록을 불러오지 못했습니다', { timeout: 20000 });
    await expect(page.locator('[data-task-bar], [data-workspace-bar]').first()).not.toContainText('수락한 작가가 없어요');
    await ctx.close();

    // ③ 정산 실패 → 정산 탭은 이유 + [다시 시도] · 할 일 줄도 이유
    ({ page, ctx } = await openAs(browser, 'gallery'));
    let settleFails = true;
    await page.route(`**/api/operations/${exId}/settlement`, (r) => (settleFails && r.request().method() === 'GET'
      ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"실패"}' }) : r.continue()));
    await page.goto(`/mypage?tab=my-exhibitions&ex=${exId}&view=settlement`);
    await expect(page.locator('body')).toContainText('정산 내역을 불러오지 못했어요', { timeout: 20000 });
    await expect(page.locator('[data-task-bar], [data-workspace-bar]').first()).toContainText('불러오지 못했어요');
    settleFails = false;
    await page.getByRole('button', { name: '다시 시도' }).click();
    await expect(page.locator('[data-settlement]')).toBeVisible({ timeout: 15000 });
    await ctx.close();

    // ④ 작가 [내 전시] 목록 실패
    const a = await openAs(browser, 'artist');
    await fail(a.page, '**/api/exhibitions/my-applications');
    await a.page.goto('/mypage?tab=applications');
    await expect(a.page.locator('body')).toContainText('내 전시 목록을 불러오는 중 오류가 발생했습니다', { timeout: 20000 });
    await a.ctx.close();
    await api.dispose();
  });
});

// ─────────────────────────────────────────────────────────────
test.describe('REL-05 — 여러 명에게 다시 요청하다 중간에 실패', () => {
  test('★ 이의 둘에게 다시 요청 중 둘째만 실패 — 첫째는 요청됨 · 다시 누르면 남은 사람만 · 첫째에게 알림이 또 가지 않는다', async ({ browser }) => {
    test.setTimeout(150_000);
    const api = await pwRequest.newContext();
    const ids = userIds();
    const title = newTitle('부분실패');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    for (const role of ['artist', 'artist2'] as const) { await accept(api, exId, role); await submitFull(api, exId, role, `작품${role}`); }
    expect((await lifecycle(api, exId, { recruitmentClosed: true, confirmed: true, ended: true })).status()).toBe(200);
    expect((await api.put(`${API}/operations/${exId}/settlement`, { headers: auth('gallery'), data: { sales: [], ratios: [ids.artist, ids.artist2].map((u) => ({ artistUserId: u, galleryRatio: 40 })) } })).status()).toBe(200);
    expect((await api.post(`${API}/operations/${exId}/settlement/request`, { headers: auth('gallery') })).status()).toBe(200);
    for (const role of ['artist', 'artist2'] as const) {
      expect((await api.post(`${API}/operations/${exId}/settlement/respond`, { headers: auth(role), data: { approve: false, comment: `${role} 이의` } })).status()).toBe(200);
    }
    const asksOf = async (role: 'artist' | 'artist2') => {
      const list = await (await api.get(`${API}/notifications`, { headers: auth(role) })).json();
      return ((list.notifications ?? list) as { type: string; message: string }[]).filter((n) => n.message.includes(title) && /확인|요청/.test(n.message) && n.type !== 'SETTLEMENT_ISSUE').length;
    };
    const before = { a1: await asksOf('artist'), a2: await asksOf('artist2') };

    const { page, ctx } = await openAs(browser, 'gallery');
    await openOperation(page, exId, '정산');
    let n = 0;
    await page.route(`**/api/operations/${exId}/settlement/request/artist/*`, (r) => {
      n++;
      return n === 2 ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"잠시 문제가 생겼어요"}' }) : r.continue();
    });
    await taskButton(page, /외 1명에게 다시 요청/).click();
    await expect(page.locator('body')).toContainText('잠시 문제가 생겼어요', { timeout: 10000 });
    await sleep(800);
    await expect(page.locator('[data-task-bar], [data-workspace-bar]').first()).toContainText('이의를 남겼어요', { timeout: 10000 });
    await taskButton(page, /님에게 다시 요청/).click();
    await expect(page.locator('[data-task-bar], [data-workspace-bar]').first()).toContainText('기다리고 있어요', { timeout: 10000 });
    const after = { a1: await asksOf('artist'), a2: await asksOf('artist2') };
    expect(after.a1 - before.a1, '첫째에게 다시 요청 알림이 두 번 갔다').toBe(1);
    expect(after.a2 - before.a2).toBe(1);
    await ctx.close();
    await api.dispose();
  });
});

// ─────────────────────────────────────────────────────────────
test.describe('LST-07 — 목록 자리', () => {
  test('★ 아래쪽 공모를 열었다 [← 내 공모]·뒤로 하면 보던 자리로 돌아온다', async ({ browser }) => {
    test.setTimeout(150_000);
    const api = await pwRequest.newContext();
    const gid = await ownedGalleryId(api);
    const titles: string[] = [];
    for (let i = 0; i < 9; i++) { const t = newTitle(`자리${i}`); titles.push(t); await createExhibition(api, { title: t, galleryId: gid }); }
    const { page, ctx } = await openAs(browser, 'gallery');
    await page.goto('/mypage?tab=my-exhibitions');
    const target = exhibitionCard(page, titles[0]!);   // 가장 먼저 만든 것 — 목록 아래쪽
    await target.scrollIntoViewIfNeeded();
    await sleep(400);
    /* 누르는 순간의 자리를 잰다 — Playwright 의 click 은 누르기 전에 화면을 다시 굴릴 수 있어(하단 탭바에 가리면)
       그 전에 잰 값과 어긋난다. 사람이 누른 그 자리로 돌아오는가가 기준이다 */
    const clickRow = (t: string) => page.evaluate((title) => {
      const row = [...document.querySelectorAll('[data-exhibition-row]')].find((r) => r.textContent?.includes(title));
      const btn = [...(row?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes(title)) as HTMLButtonElement | undefined;
      const y = window.scrollY;
      btn?.click();
      return y;
    }, t);
    const y0 = await clickRow(titles[0]!);
    expect(y0, '목록이 충분히 길지 않다').toBeGreaterThan(200);
    await expect(workspace(page)).toBeVisible({ timeout: 15000 });
    await workspace(page).getByRole('button', { name: '내 공모', exact: true }).click();
    await expect(exhibitionCard(page, titles[0]!)).toBeVisible({ timeout: 15000 });
    await sleep(500);
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - y0), '[← 내 공모] 뒤 자리').toBeLessThan(60);
    const y1 = await clickRow(titles[0]!);
    await expect(workspace(page)).toBeVisible({ timeout: 15000 });
    await page.goBack();
    await expect(exhibitionCard(page, titles[0]!)).toBeVisible({ timeout: 15000 });
    await sleep(500);
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - y1), '뒤로가기 뒤 자리').toBeLessThan(60);
    await ctx.close();
    await api.dispose();
  });
});

// ─────────────────────────────────────────────────────────────
test.describe('DEV-03 — 자판이 뜨면 하단 고정 줄이 자판 바로 위로', () => {
  /*
    안드로이드 앱(WebView)은 자판이 뜨면 화면 높이 자체가 줄고, 그동안 하단 탭바는 감춘다(`hooks/useSoftKeyboard.ts`).
    그런데 탭바 높이만큼 띄워 두던 고정 줄은 그대로 떠 있어 자판과의 틈(57px)으로 본문이 비쳐 보였다(2026-11-21 에뮬레이터 S8).
    칸에 들어간 뒤 창 높이를 줄여 같은 상황을 만든다(헤드리스는 진짜 자판을 못 띄운다).
  */
  const TAB = 'nav[aria-label="하단 내비게이션"]';
  async function keyboardUp(page: Page, bar: string, input: Locator) {
    await input.scrollIntoViewIfNeeded();
    await input.focus();
    await sleep(250);
    const before = await page.evaluate(([sel, tab]) => {
      const r = document.querySelector(sel)!.getBoundingClientRect();
      return { bottom: Math.round(r.bottom), tabTop: Math.round(document.querySelector(tab)!.getBoundingClientRect().top) };
    }, [bar, TAB]);
    expect(Math.abs(before.bottom - before.tabTop), `${bar} — 자판 전엔 탭바 바로 위`).toBeLessThanOrEqual(1);
    const vp = page.viewportSize()!;
    await page.setViewportSize({ width: vp.width, height: Math.round(vp.height * 0.62) });
    await expect(page.locator(TAB)).toBeHidden();
    await sleep(250);
    const after = await page.evaluate((sel) => {
      const el = document.querySelector(sel)!;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.bottom - 4);
      return { gap: Math.round(innerHeight - r.bottom), inside: !!hit && el.contains(hit) };
    }, bar);
    expect(after.gap, `${bar} — 자판(화면 아래 끝)과 줄 사이 틈`).toBeLessThanOrEqual(1);
    expect(after.inside, `${bar} — 줄 아랫부분이 눌린다`).toBeTruthy();
    await page.setViewportSize(vp);
    await expect(page.locator(TAB)).toBeVisible();   // 자판이 내려가면(화면이 돌아오면) 탭바도 돌아온다
  }

  test('★ 정산 카드 수수료 칸(갤러리) · 출품 자료 연락처 칸(작가)', async ({ browser }) => {
    test.setTimeout(150_000);
    const api = await pwRequest.newContext();
    const gid = await ownedGalleryId(api);
    // 갤러리 — 전시가 끝난 공모의 [정산] 탭
    const tA = newTitle('자판정산');
    const exA = await createExhibition(api, { title: tA, galleryId: gid, capacity: 3 });
    for (const role of ['artist', 'artist2'] as const) { await accept(api, exA, role); await submitFull(api, exA, role, `작품${role}`); }
    expect((await lifecycle(api, exA, { recruitmentClosed: true, confirmed: true, ended: true })).status()).toBe(200);
    const g = await openAs(browser, 'gallery');
    await g.page.goto(`/mypage?tab=my-exhibitions&ex=${exA}&view=settlement`);
    await expect(g.page.locator('[data-workspace-bar]')).toBeVisible({ timeout: 15000 });
    await keyboardUp(g.page, '[data-workspace-bar]', g.page.locator('#settle-fee'));
    await g.ctx.close();

    // 작가 — 수락된 공모의 [출품 자료] 탭
    const tB = newTitle('자판출품');
    const exB = await createExhibition(api, { title: tB, galleryId: gid });
    await accept(api, exB, 'artist');
    const a = await openAs(browser, 'artist');
    await a.page.goto(`/mypage?tab=applications&ex=${exB}`);
    const contact = a.page.getByRole('textbox', { name: '연락처' });   // 출품작은 처음엔 비어 있다 — 약력 칸으로
    await expect(contact).toBeVisible({ timeout: 15000 });
    await keyboardUp(a.page, '[data-submission-bar]', contact);
    await a.ctx.close();
    await api.dispose();
  });

  // 2026-11-21 사용자 결정 — 공모 흐름 밖의 같은 줄 셋도(RESULTS O4). 공고 상세 [지원하기] 줄은 글 칸이 없어 뺐다
  test('★ 흐름 밖 셋 — 갤러리 등록 이름 칸 · 홈페이지 편집 한 줄 소개 · 포트폴리오 만들기 아래 바', async ({ browser }) => {
    test.setTimeout(150_000);
    const api = await pwRequest.newContext();
    // 갤러리 등록(등록 화면 셋이 같은 StickySubmitBar)
    const g = await openAs(browser, 'gallery');
    await g.page.goto('/galleries/new');
    const name = g.page.getByPlaceholder('갤러리명');
    await expect(name).toBeVisible({ timeout: 15000 });
    await keyboardUp(g.page, '[data-submit-bar]', name);
    await g.ctx.close();

    // 홈페이지 편집 [소개] — 작품이 있어야 저장 바가 늘 보인다
    await ensurePublicArtworks(api, tokenFor('artist'));
    const a = await openAs(browser, 'artist');
    await openHomepageEditor(a.page, '소개');
    const tagline = a.page.getByLabel('한 줄 소개');
    await expect(tagline).toBeVisible({ timeout: 15000 });
    await keyboardUp(a.page, '[data-save-bar]', tagline);

    // 포트폴리오 만들기 — 휴대폰은 글 칸이 아래 시트(바를 덮는다) 안에 있어 자판 상태만 걸어 바가 바닥으로 내려오는지 본다
    await openPortfolioMaker(a.page);
    const gapOf = () => a.page.evaluate(() => {
      const r = document.querySelector('[data-maker-bar]')!.getBoundingClientRect();
      return Math.round(innerHeight - r.bottom);
    });
    await a.page.evaluate(() => window.scrollTo(0, 0));
    expect(await gapOf(), '자판 전엔 탭바 위').toBeGreaterThan(40);
    await a.page.evaluate(() => document.documentElement.setAttribute('data-tabbar-hidden', ''));
    await sleep(200);
    expect(await gapOf(), '자판이 뜨면 바닥으로').toBeLessThanOrEqual(1);
    await a.ctx.close();
    await api.dispose();
  });
});

// ─────────────────────────────────────────────────────────────
test.describe('이번 점검에서 고친 코드와 맞닿은 P1', () => {
  test('★ WS-09 관리자 단독 운영 화면 — 공모 A 에서 쓰던 저장 안 한 정산 입력이 벨로 연 공모 B 에 남지 않는다', async ({ browser }) => {
    test.setTimeout(180_000);
    const api = await pwRequest.newContext();
    // A — 갤러리 주최 · 전시 종료(정산 탭 열림)
    const tA = newTitle('단독A');
    const exA = await createExhibition(api, { title: tA, galleryId: await ownedGalleryId(api), capacity: 3 });
    await accept(api, exA, 'artist');
    await submitFull(api, exA, 'artist', '작품A');
    expect((await lifecycle(api, exA, { recruitmentClosed: true, confirmed: true, ended: true })).status()).toBe(200);
    // B — 갤러리 없는 아트링크 주최: 출품 자료 알림이 관리자에게 운영 화면 링크로 간다
    const tB = newTitle('단독B');
    const r = await api.post(`${API}/exhibitions/hosted`, { headers: auth('admin'), data: { ...exhibitionDates(), title: tB, type: 'GROUP', recruitOnly: false, capacity: 3, region: 'SEOUL', description: 'E2E 주최 공모', galleryIds: [] } });
    expect(r.ok(), await r.text()).toBeTruthy();
    const exB = (await r.json()).id as number;
    const appB = await applyAs(api, exB, 'artist2');
    expect((await api.patch(`${API}/exhibitions/${exB}/applications/${appB}`, { headers: auth('admin'), data: { status: 'ACCEPTED' } })).status()).toBe(200);
    await submitFull(api, exB, 'artist2', '작품B');
    expect((await api.patch(`${API}/operations/${exB}/lifecycle`, { headers: auth('admin'), data: { recruitmentClosed: true, confirmed: true, ended: true } })).status()).toBe(200);

    const { page, ctx } = await openAs(browser, 'admin');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/exhibitions/${exA}/operation/new?view=settlement`);
    const ratioA = page.locator('#settle-ratio');
    await expect(ratioA).toBeEditable({ timeout: 15000 });
    await ratioA.fill('30');
    page.on('dialog', (d) => { void d.accept(); });   // 저장 안 한 입력 — 벨이 먼저 묻는다(REL-20), 떠나기로 한다
    await page.getByRole('button', { name: '알림' }).first().click();
    await page.getByRole('button').filter({ hasText: tB }).filter({ hasText: '출품 자료' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: tB })).toBeVisible({ timeout: 15000 });
    await workspaceTab(page, '정산').click();
    await expect(page.locator('#settle-ratio'), 'A 에서 쓰던 30 이 B 화면에 남았다').toHaveValue('0', { timeout: 15000 });
    await ctx.close();
    await api.dispose();
  });

  test('★ REL-20 정산 금액을 쓰다 벨 알림을 누르면 먼저 묻는다 — 취소하면 그대로, 확인하면 이동', async ({ browser }) => {
    // 이탈 가드는 링크·뒤로가기·새로고침만 보고 벨의 navigate() 는 못 봐서, 쓰던 정산 금액이 말없이 사라졌다(2026-11-21)
    test.setTimeout(180_000);
    const api = await pwRequest.newContext();
    const gid = await ownedGalleryId(api);
    const tA = newTitle('벨이탈A');
    const exA = await createExhibition(api, { title: tA, galleryId: gid, capacity: 3 });
    await accept(api, exA, 'artist');
    await submitFull(api, exA, 'artist', '벨작품');
    expect((await lifecycle(api, exA, { recruitmentClosed: true, confirmed: true, ended: true })).status()).toBe(200);
    const tB = newTitle('벨이탈B');
    const exB = await createExhibition(api, { title: tB, galleryId: gid, capacity: 3 });
    await accept(api, exB, 'artist2');
    await submitFull(api, exB, 'artist2', '벨작품B');   // → 갤러리에게 B 의 '출품 자료' 알림
    const { page, ctx } = await openAs(browser, 'gallery');
    await page.goto(`/mypage?tab=my-exhibitions&ex=${exA}&view=settlement`);
    const ratio = page.locator('#settle-ratio');
    await expect(ratio).toBeEditable({ timeout: 15000 });
    await ratio.fill('30');
    const asked: string[] = [];
    let answer = false;
    page.on('dialog', (d) => { asked.push(d.message()); void (answer ? d.accept() : d.dismiss()); });
    const openBellItem = async () => {
      await page.getByRole('button', { name: '알림' }).first().click();
      await page.getByRole('button').filter({ hasText: tB }).filter({ hasText: '출품 자료' }).first().click();
    };
    await openBellItem();
    await sleep(800);
    expect(asked.length, '묻지 않고 옮겼다').toBe(1);
    expect(asked[0]).toContain('저장하지 않은 정산 입력');
    await expect(page.getByRole('heading', { level: 1, name: tA })).toBeVisible();
    await expect(ratio).toHaveValue('30');
    answer = true;
    await page.keyboard.press('Escape');   // 열려 있으면 벨 목록을 닫고 다시
    await openBellItem();
    await expect(page.getByRole('heading', { level: 1, name: tB })).toBeVisible({ timeout: 15000 });
    expect(asked.length).toBe(2);
    await ctx.close();
    await api.dispose();
  });

  test('★ WS-03 탭을 옮겨도 정산 입력이 남는다 · LST-13 목록·공모 화면엔 프로필 카드가 없다', async ({ browser }) => {
    test.setTimeout(150_000);
    const api = await pwRequest.newContext();
    const title = newTitle('탭유지');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    await accept(api, exId, 'artist');
    await submitFull(api, exId, 'artist', '탭작품');
    expect((await lifecycle(api, exId, { recruitmentClosed: true, confirmed: true, ended: true })).status()).toBe(200);
    const { page, ctx } = await openAs(browser, 'gallery');
    const dialogs: string[] = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    await page.goto('/mypage?tab=my-exhibitions');
    await expect(exhibitionCard(page, title)).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: '프로필 사진 변경' }), '목록에 프로필 카드').toHaveCount(0);
    await page.goto(`/mypage?tab=my-exhibitions&ex=${exId}&view=settlement`);
    await expect(page.getByRole('checkbox', { name: '탭작품 판매' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: '프로필 사진 변경' }), '공모 화면에 프로필 카드').toHaveCount(0);
    await page.getByRole('checkbox', { name: '탭작품 판매' }).check();
    await page.getByLabel('탭작품 판매가').fill('1500000');
    await workspaceTab(page, '공지').click();
    await workspaceTab(page, '정산').click();
    await expect(page.getByRole('checkbox', { name: '탭작품 판매' })).toBeChecked();
    await expect(page.getByLabel('탭작품 판매가')).toHaveValue(/1,?500,?000/);
    expect(dialogs, '탭을 옮길 때 확인창이 떴다').toEqual([]);
    // 저장 안 한 입력이 있으니 떠날 땐 이탈 확인이 뜬다(설계대로) — 받아들이고 프로필로
    page.removeAllListeners('dialog');
    page.on('dialog', (d) => { void d.accept(); });
    await page.goto('/mypage?tab=profile');
    await expect(page.getByRole('button', { name: '프로필 사진 변경' }).first()).toBeVisible({ timeout: 15000 });
    await ctx.close();
    await api.dispose();
  });

  test('★ LIF-04 마감 창의 미선정 체크는 열 때마다 꺼진 채 · LIF-13 확정 창의 미제출 줄과 완료 알림', async ({ browser }) => {
    test.setTimeout(150_000);
    const api = await pwRequest.newContext();
    const title = newTitle('마감확정');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    await accept(api, exId, 'artist');           // 출품 자료는 내지 않는다
    const pendingId = await applyAs(api, exId, 'artist2');
    const { page, ctx } = await openAs(browser, 'gallery');
    await page.goto(`/mypage?tab=my-exhibitions&ex=${exId}`);
    const bar = page.locator('[data-workspace-bar], [data-task-bar]');
    const closeBtn = bar.getByRole('button', { name: '모집 마감', exact: true }).first();
    await expect(closeBtn).toBeVisible({ timeout: 15000 });
    await closeBtn.click();
    let dlg = page.getByRole('dialog');
    const rest = dlg.getByRole('checkbox', { name: /남은 1명을 미선정으로 처리/ });
    await expect(rest).not.toBeChecked();
    await rest.check();
    await dlg.getByRole('button', { name: '취소' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await closeBtn.click();
    dlg = page.getByRole('dialog');
    await expect(dlg.getByRole('checkbox', { name: /남은 1명을 미선정으로 처리/ }), '다시 열었는데 체크가 남아 있다').not.toBeChecked();
    await dlg.getByRole('button').filter({ hasNotText: '취소' }).last().click();
    await expect(page.locator('body')).toContainText('모집을 마감했어요.', { timeout: 10000 });
    const apps = await (await api.get(`${API}/exhibitions/${exId}/applications`, { headers: auth('gallery') })).json();
    expect(((apps.applications ?? apps) as { id: number; status: string }[]).find((x) => x.id === pendingId)?.status, '체크하지 않았는데 미선정이 됐다').not.toBe('REJECTED');
    const confirmBtn = page.locator('[data-workspace-bar], [data-task-bar]').getByRole('button', { name: '전시 확정', exact: true }).first();
    await expect(confirmBtn).toBeVisible({ timeout: 15000 });
    await confirmBtn.click();
    dlg = page.getByRole('dialog');
    await expect(dlg).toContainText('출품 자료를 아직 다 내지 않은 작가가 1명 있어요.');
    await dlg.getByRole('button').filter({ hasNotText: '취소' }).last().click();
    await expect(page.locator('body')).toContainText('전시를 확정했어요. 작가에게 알림이 가요.', { timeout: 10000 });
    await ctx.close();
    await api.dispose();
  });
});
