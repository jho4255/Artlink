import { test, expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';
import {
  openAs, tokenFor, userIds, ownedGalleryId, createExhibition, applyToExhibition, exhibitionCard, workspace, workspaceTab, taskButton, openApplicantManager, applicantRow, openArtistExhibition, openOperation, closeRecruitment,
} from '../lib/helpers';

/**
 * 공모 흐름 개편(규칙 88) 신뢰성 — **두 탭 · 두 사람 · 연타 · 실패 · 늦은 응답 · 새로고침** (2026-11-20,
 * `scratchpad/flow-review-2026-11/TESTCASES.md` §1 의심 지점 S1·S4·S5·S6·S7·S11·S12 + REL-02·03·06·09·10·11·13·15·18).
 * 판정은 화면만 보지 않는다 — 서버 상태 · 알림 수 · 요청 수까지.
 */
const API = 'http://localhost:4000/api';
const auth = (role: Parameters<typeof tokenFor>[0]) => ({ Authorization: `Bearer ${tokenFor(role)}` });
const newTitle = (what: string) => `E2E신뢰 ${what} ${Date.now()}`;
const sleep = (ms: number) => new Promise((f) => setTimeout(f, ms));

async function apply(api: APIRequestContext, exId: number, role: 'artist' | 'artist2') {
  const r = await applyToExhibition(api, exId, tokenFor(role));
  expect(r.status(), `${role} 지원 실패: ${await r.text()}`).toBe(201);
  return (await r.json()).id as number;
}
/** 지원 → 모집 마감 → 수락(수락·거절은 마감한 뒤에만 — 규칙 90). 마감하면 더 지원할 수 없으니 다른 지원은 먼저 받아 둘 것 */
async function acceptVia(api: APIRequestContext, exId: number, role: 'artist' | 'artist2') {
  const appId = await apply(api, exId, role);
  await closeRecruitment(api, exId);
  const p = await api.patch(`${API}/exhibitions/${exId}/applications/${appId}`, { headers: auth('gallery'), data: { status: 'ACCEPTED' } });
  expect(p.status(), await p.text()).toBe(200);
  return appId;
}
/** 초대 코드로 들어온 수락 — 모집 중에 정원이 차는 유일한 길(규칙 57·90) */
async function joinViaCode(api: APIRequestContext, exId: number, role: 'artist' | 'artist2') {
  const made = await api.post(`${API}/exhibitions/${exId}/join-code`, { headers: auth('gallery') });
  expect(made.status(), await made.text()).toBe(200);
  const joined = await api.post(`${API}/exhibitions/join`, { headers: auth(role), data: { code: (await made.json()).code } });
  expect([200, 201], await joined.text()).toContain(joined.status());
}
async function submitFull(api: APIRequestContext, exId: number, role: 'artist' | 'artist2', work = '작품A') {
  const r = await api.put(`${API}/operations/${exId}/me`, {
    headers: auth(role),
    data: {
      artworkList: [{ title: work, size: '60x40', medium: '캔버스에 유채', year: '2026', price: '1000000', image: '' }],
      cv: { nameKo: role === 'artist' ? 'Artist 1' : 'Artist 2' },
      note: { statement: 'E2E 작가노트', sections: [] },
      representativeIndex: 0,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}
const lifecycle = (api: APIRequestContext, exId: number, data: Record<string, unknown>) =>
  api.patch(`${API}/operations/${exId}/lifecycle`, { headers: auth('gallery'), data });
async function notes(api: APIRequestContext, role: Parameters<typeof tokenFor>[0]) {
  const list = await (await api.get(`${API}/notifications`, { headers: auth(role) })).json();
  return (list.notifications ?? list) as { type: string; message: string; linkUrl?: string }[];
}
async function statusOf(api: APIRequestContext, exId: number, userId: number) {
  const apps = await (await api.get(`${API}/exhibitions/${exId}/applications`, { headers: auth('gallery') })).json();
  return (apps.applications ?? apps).find((a: any) => a.userId === userId)?.status as string | undefined;
}
/** 전시가 끝나 정산 확인 요청까지 간 공모 — 작가 1·2 수락 · 출품 · 작가 1 판매 1점 */
async function settlingExhibition(api: APIRequestContext, title: string, opts: { request?: boolean } = {}) {
  const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
  await apply(api, exId, 'artist2');   // 마감하면 더 지원할 수 없다 — 먼저 받아 둔다
  await acceptVia(api, exId, 'artist');
  const second = (await (await api.get(`${API}/exhibitions/${exId}/applications`, { headers: auth('gallery') })).json()).find((a: any) => a.userId === userIds().artist2).id;
  expect((await api.patch(`${API}/exhibitions/${exId}/applications/${second}`, { headers: auth('gallery'), data: { status: 'ACCEPTED' } })).status()).toBe(200);
  await submitFull(api, exId, 'artist', '작품A');
  await submitFull(api, exId, 'artist2', '작품B');
  expect((await lifecycle(api, exId, { recruitmentClosed: true, confirmed: true, ended: true })).status()).toBe(200);
  expect((await api.put(`${API}/operations/${exId}/settlement`, {
    headers: auth('gallery'),
    data: {
      sales: [{ artistUserId: userIds().artist, artworkIndex: 0, title: '작품A', soldPrice: 1200000, paymentMethod: 'CARD' }],
      ratios: [{ artistUserId: userIds().artist, galleryRatio: 40 }, { artistUserId: userIds().artist2, galleryRatio: 40 }],
    },
  })).status()).toBe(200);
  if (opts.request !== false) expect((await api.post(`${API}/operations/${exId}/settlement/request`, { headers: auth('gallery') })).status()).toBe(200);
  return exId;
}
/** 페이지 오류를 모은다 — 테스트 끝에 0 이어야 한다 */
function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}
/** 그 주소·메서드로 나간 요청 수 */
function countRequests(page: Page, method: string, pattern: RegExp) {
  const box = { n: 0 };
  page.on('request', (r) => { if (r.method() === method && pattern.test(r.url())) box.n++; });
  return box;
}

// ─────────────────────────────────────────────────────────────
test.describe('S1·S4 — 목록 버튼으로 들어와 여는 확인창', () => {
  test('★ LST-05(S1) 지원자 목록이 늦게 와도 [모집 마감] 확인창이 지원자 수를 보여 준다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('S1');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 1 });
    await apply(api, exId, 'artist2');      // 검토 대기 1
    await joinViaCode(api, exId, 'artist'); // 초대 코드로 정원 1 이 찼다(모집 중에 정원이 차는 길)

    const { page, ctx } = await openAs(browser, 'gallery');
    const errors = collectErrors(page);
    await page.goto('/mypage?tab=my-exhibitions');
    const row = exhibitionCard(page, title);
    await expect(row).toContainText('정원(1명)이 찼어요', { timeout: 15000 });
    // 공모 화면이 지원자 목록을 받는 데 2초 걸린다
    await page.route(`**/api/exhibitions/${exId}/applications`, async (r) => { await sleep(2000); await r.continue(); });
    await row.getByRole('button', { name: /모집 마감/ }).click();
    const dialog = page.getByRole('dialog', { name: '모집을 마감할까요?' });
    await expect(dialog).toBeVisible({ timeout: 15000 });
    // 초대 코드로 정원이 이미 다 찼다 — 마감하면 선정도 함께 끝난다(규칙 90, closeOutIfFull). 늦게 온 지원자 수를 그 줄이 말한다
    await expect(dialog).toContainText('정원이 이미 다 차 있어 검토 대기 1명은 미선정이 돼요.', { timeout: 6000 });
    await expect(dialog.locator('[data-confirm-warning]')).toHaveText('모집 마감은 되돌릴 수 없어요.');
    expect(errors).toEqual([]);
    await api.dispose();
    await ctx.close();
  });

  test('★ LST-06(S4) 목록 버튼으로 연 확인창을 취소하면 새로고침·뒤로·앞으로에서 다시 뜨지 않는다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('S4');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 1 });
    await joinViaCode(api, exId, 'artist');   // 정원이 차 목록의 할 일이 [모집 마감]

    const { page, ctx } = await openAs(browser, 'gallery');
    await page.goto('/mypage?tab=my-exhibitions');
    await exhibitionCard(page, title).getByRole('button', { name: /모집 마감/ }).click();
    const dialog = page.getByRole('dialog', { name: '모집을 마감할까요?' });
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await dialog.getByRole('button', { name: '취소' }).click();
    await expect(dialog).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15000 });
    await sleep(1500);
    await expect(page.getByRole('dialog', { name: '모집을 마감할까요?' }), '새로고침했더니 확인창이 다시 떴다').toHaveCount(0);

    await page.goBack();
    await expect(page).toHaveURL(/\/mypage\?tab=my-exhibitions$/);
    await page.goForward();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15000 });
    await sleep(1500);
    await expect(page.getByRole('dialog', { name: '모집을 마감할까요?' }), '앞으로 가기로 돌아왔더니 확인창이 다시 떴다').toHaveCount(0);
    await api.dispose();
    await ctx.close();
  });
});

// ─────────────────────────────────────────────────────────────
test.describe('S5 — 작가가 열어 둔 전시 화면이 갤러리의 확정을 따라오는가', () => {
  test('★ NTF-06(S5) 화면을 연 채 확정 알림을 누르면 잠긴 화면으로 바뀐다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('S5a');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    await acceptVia(api, exId, 'artist');
    expect((await lifecycle(api, exId, { recruitmentClosed: true })).status()).toBe(200);

    const { page, ctx } = await openAs(browser, 'artist');
    const errors = collectErrors(page);
    const ws = await openArtistExhibition(page, exId);
    await expect(ws.getByRole('button', { name: '갤러리에 제출' })).toBeVisible({ timeout: 15000 });

    expect((await lifecycle(api, exId, { confirmed: true })).status()).toBe(200);
    // 벨 → 그 전시의 '전시가 확정되었어요'
    await page.getByRole('button', { name: '알림' }).first().click();
    await page.getByRole('button', { name: new RegExp(`${title}.*전시가 확정되었어요`) }).first().click();
    await expect(ws, '알림을 눌렀는데 옛 편집 화면 그대로다').toContainText('갤러리가 전시를 확정해 출품 자료가 잠겼어요', { timeout: 10000 });
    await expect(ws.getByRole('button', { name: '갤러리에 제출' })).toHaveCount(0);
    expect(errors).toEqual([]);
    await api.dispose();
    await ctx.close();
  });

  test('★ SUB-09(S5) 화면을 연 채 확정됐는데 [갤러리에 제출]을 누르면 — 이유를 말하고 잠긴 화면으로', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('S5b');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    await acceptVia(api, exId, 'artist');
    await submitFull(api, exId, 'artist', '작품A');   // 낸 뒤 고치는 중
    expect((await lifecycle(api, exId, { recruitmentClosed: true })).status()).toBe(200);

    const { page, ctx } = await openAs(browser, 'artist');
    const ws = await openArtistExhibition(page, exId);
    const titleInput = ws.locator('label').filter({ hasText: '작품명' }).first().locator('input');
    await expect(titleInput).toBeVisible({ timeout: 15000 });
    await titleInput.fill('작품A 고침');

    expect((await lifecycle(api, exId, { confirmed: true })).status()).toBe(200);
    await ws.getByRole('button', { name: /제출/ }).last().click();
    await expect(page.locator('body')).toContainText('전시 정보가 확정되어 더 이상 수정할 수 없습니다', { timeout: 10000 });
    await expect(ws, '403 뒤에도 고칠 수 있는 화면이 남아 있다').toContainText('갤러리가 전시를 확정해 출품 자료가 잠겼어요', { timeout: 10000 });
    await api.dispose();
    await ctx.close();
  });
});

// ─────────────────────────────────────────────────────────────
test.describe('S6 — 옛 화면(다른 탭)에서 한 결정', () => {
  test('★ REV-07(S6) 옛 탭에서 선정 마감일이 지난 뒤 [수락하기]를 누르면 — 이유 토스트 · 줄이 미선정으로 바뀐다(되돌릴 수 없다, 규칙 90)', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('S6');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    await apply(api, exId, 'artist');
    await apply(api, exId, 'artist2');
    await closeRecruitment(api, exId);   // 결정은 마감한 뒤에(규칙 90)

    const { page: b, ctx } = await openAs(browser, 'gallery');   // 옛 탭(B) — 먼저 화면을 띄워 둔다
    const managerB = await openApplicantManager(b, title);
    await expect(applicantRow(managerB, 'Artist 1')).toContainText('검토 대기');

    // 그 사이 선정 마감일이 지났다(DB 시각을 옮긴다 — 등록 API 는 지난 날을 받지 않는다)
    const dbUrl = process.env.DATABASE_URL;
    expect(dbUrl, 'DATABASE_URL 을 명시해 돌릴 것').toBeTruthy();
    const { execFileSync } = await import('child_process');
    execFileSync('psql', [dbUrl!, '-v', 'ON_ERROR_STOP=1'], { input: `UPDATE "Exhibition" SET "selectionDeadline" = now() - interval '2 days' WHERE id = ${exId};`, encoding: 'utf-8' });

    await applicantRow(managerB, 'Artist 1').getByRole('button').first().click();
    const sheet = b.getByRole('dialog', { name: 'Artist 1 지원서' });
    await sheet.locator('[data-decision-bar]').getByRole('button', { name: '수락하기', exact: true }).click();
    await b.getByRole('dialog', { name: /Artist 1 님을 수락할까요/ }).getByRole('button', { name: '수락하기', exact: true }).click();
    await expect(b.locator('body')).toContainText('선정 마감일이 지나 더 수락할 수 없어요.', { timeout: 10000 });
    if (await sheet.count()) await b.keyboard.press('Escape');
    await expect(applicantRow(managerB, 'Artist 1'), '실패하면 다시 받아 지금 상태(미선정)를 그린다').toContainText('미선정', { timeout: 8000 });
    expect(await statusOf(api, exId, userIds().artist)).toBe('REJECTED');
    await api.dispose();
    await ctx.close();
  });
});

// ─────────────────────────────────────────────────────────────
test.describe('S7 — 정산 입력 중 서버 값이 바뀌면', () => {
  test('★ SET-19(S7) 판매가를 고치는 중 망이 끊겼다 붙고(다시 받기) 그 사이 다른 작가가 확인해도 — 입력이 남는다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('S7');
    const exId = await settlingExhibition(api, title);

    const { page, ctx } = await openAs(browser, 'gallery');
    await openOperation(page, exId, '정산');
    const price = page.getByLabel('작품A 판매가', { exact: true });
    await expect(price).toBeVisible({ timeout: 15000 });
    await price.fill('1500000');

    // 그 사이 작가 2가 확인한다(서버 값이 바뀐다)
    expect((await api.post(`${API}/operations/${exId}/settlement/respond`, { headers: auth('artist2'), data: { approve: true } })).status()).toBe(200);
    // 휴대폰 망이 끊겼다 다시 붙는다 → 화면이 데이터를 다시 받는다
    await ctx.setOffline(true);
    await sleep(500);
    await ctx.setOffline(false);
    await sleep(2500);
    await expect(price, '다시 받은 서버 값이 입력 중이던 판매가를 덮었다').toHaveValue(/1,?500,?000/);
    await api.dispose();
    await ctx.close();
  });
});

// ─────────────────────────────────────────────────────────────
test.describe('S11 — 확인창을 연 채 새 지원이 온다', () => {
  test('LIF-08(S11) 창이 떠 있는 동안 온 지원도 마감 뒤 선정 대상 — 마감은 아무도 미선정으로 바꾸지 않는다 · 결과 알림은 없다(규칙 90)', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('S11');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    await apply(api, exId, 'artist');

    const { page, ctx } = await openAs(browser, 'gallery');
    await openOperation(page, exId);
    await taskButton(page, '모집 마감').click();
    const dialog = page.getByRole('dialog', { name: '모집을 마감할까요?' });
    await expect(dialog).toBeVisible();
    await apply(api, exId, 'artist2');   // 창이 떠 있는 동안 새 지원
    await dialog.getByRole('button', { name: '모집 마감', exact: true }).click();
    await expect(page.locator('body')).toContainText('모집을 마감했어요.', { timeout: 10000 });
    await expect(page.locator('[data-task-bar]')).toContainText(/까지 선정하세요 · 검토 대기 2명/, { timeout: 15000 });
    expect(await statusOf(api, exId, userIds().artist)).toBe('SUBMITTED');
    expect(await statusOf(api, exId, userIds().artist2)).toBe('SUBMITTED');
    for (const role of ['artist', 'artist2'] as const) {
      expect((await notes(api, role)).filter((n) => n.type === 'APPLICATION_STATUS' && n.message.includes(title))).toHaveLength(0);
    }
    await api.dispose();
    await ctx.close();
  });
});

// ─────────────────────────────────────────────────────────────
test.describe('S12·REL-02 — 연타(응답이 1.5초 늦을 때)', () => {
  const slow = async (page: Page, glob: string) => page.route(glob, async (r) => { await sleep(1500); await r.continue(); });

  test('★ 단계 전환 확인창 · 수락 확인창을 두 번 눌러도 요청은 한 번', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('연타1');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    await apply(api, exId, 'artist');
    await apply(api, exId, 'artist2');

    const { page, ctx } = await openAs(browser, 'gallery');
    const errors = collectErrors(page);
    const accepts = countRequests(page, 'PATCH', /\/api\/exhibitions\/\d+\/applications\/\d+$/);
    const lifecycles = countRequests(page, 'PATCH', /\/lifecycle$/);
    await slow(page, '**/api/exhibitions/*/applications/*');
    await slow(page, '**/api/operations/*/lifecycle');

    const manager = await openApplicantManager(page, title);
    // 마감 먼저(수락·거절은 마감한 뒤에만 — 규칙 90)
    await taskButton(page, '모집 마감').click();
    await page.getByRole('dialog', { name: '모집을 마감할까요?' }).getByRole('button', { name: '모집 마감', exact: true }).dblclick();
    await sleep(2500);
    expect(lifecycles.n, '마감 요청이 두 번 나갔다').toBe(1);

    await applicantRow(manager, 'Artist 1').getByRole('button').first().click();
    await page.getByRole('dialog', { name: 'Artist 1 지원서' }).locator('[data-decision-bar]').getByRole('button', { name: '수락하기', exact: true }).click();
    await page.getByRole('dialog', { name: /Artist 1 님을 수락할까요/ }).getByRole('button', { name: '수락하기', exact: true }).dblclick();
    await sleep(2500);
    expect(accepts.n, '수락 요청이 두 번 나갔다').toBe(1);
    await page.keyboard.press('Escape');
    expect((await notes(api, 'artist')).filter((n) => n.type === 'APPLICATION_STATUS' && n.message.includes(title))).toHaveLength(1);
    await expect(page.locator('body')).not.toContainText('변경하지 못했습니다');
    expect(errors).toEqual([]);
    await api.dispose();
    await ctx.close();
  });

  test('★ [작가 N명에게 확인 요청] · 작가 [정산 확인] 을 두 번 눌러도 요청은 한 번 · 오류 토스트 없음', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('연타2');
    const exId = await settlingExhibition(api, title, { request: false });

    const g = await openAs(browser, 'gallery');
    const requests = countRequests(g.page, 'POST', /\/settlement\/request$/);
    await slow(g.page, '**/api/operations/*/settlement/request');
    await openOperation(g.page, exId, '정산');
    await taskButton(g.page, /작가 2명에게 확인 요청/).dblclick();
    await sleep(2500);
    expect(requests.n, '확인 요청이 두 번 나갔다').toBe(1);
    await expect(g.page.locator('body')).not.toContainText('이미 정산 확인을 요청했습니다');
    await g.ctx.close();

    const a = await openAs(browser, 'artist');
    const responds = countRequests(a.page, 'POST', /\/settlement\/respond$/);
    await slow(a.page, '**/api/operations/*/settlement/respond');
    const ws = await openArtistExhibition(a.page, exId);
    await ws.locator('[data-settle-bar]').getByRole('button', { name: '정산 확인', exact: true }).dblclick();
    await sleep(2500);
    expect(responds.n, '정산 확인이 두 번 나갔다').toBe(1);
    await expect(a.page.locator('body')).not.toContainText('처리에 실패했습니다');
    await a.ctx.close();
    await api.dispose();
  });
});

// ─────────────────────────────────────────────────────────────
test.describe('REL-03 — 서버가 실패할 때(500)', () => {
  const failOnce = async (page: Page, glob: string, method: string) => {
    let done = false;
    await page.route(glob, async (r) => {
      if (!done && r.request().method() === method) { done = true; await r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"잠시 문제가 생겼어요"}' }); }
      else await r.continue();
    });
  };

  test('★ 모집 마감 · 수락 · 정산 확인 요청 · 정산 완료가 한 번 실패해도 — 이유를 말하고 상태 그대로, 다시 누르면 된다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('실패');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    await apply(api, exId, 'artist');

    const { page, ctx } = await openAs(browser, 'gallery');
    const errors = collectErrors(page);
    const manager = await openApplicantManager(page, title);
    // 모집 마감 — 한 번 실패해도 단계는 그대로, 다시 누르면 된다(수락·거절은 마감한 뒤에만 — 규칙 90)
    await failOnce(page, '**/api/operations/*/lifecycle', 'PATCH');
    await taskButton(page, '모집 마감').click();
    await page.getByRole('dialog', { name: '모집을 마감할까요?' }).getByRole('button', { name: '모집 마감', exact: true }).click();
    await expect(page.locator('body')).toContainText('잠시 문제가 생겼어요', { timeout: 8000 });
    await expect(workspace(page).locator('ol[aria-label="진행 단계"] [aria-current="step"]')).toContainText('모집');
    await sleep(600);   // 사람 손 간격 — 할 일 버튼은 0.4초 안의 두 번째 클릭을 연타로 본다
    await taskButton(page, '모집 마감').click();
    await page.getByRole('dialog', { name: '모집을 마감할까요?' }).getByRole('button', { name: '모집 마감', exact: true }).click();
    await expect(workspace(page).locator('ol[aria-label="진행 단계"] [aria-current="step"]')).toContainText('전시 준비', { timeout: 10000 });

    // 수락 — 한 번 실패해도 상태 그대로, 다시 누르면 된다
    await failOnce(page, '**/api/exhibitions/*/applications/*', 'PATCH');
    await applicantRow(manager, 'Artist 1').getByRole('button').first().click();
    const sheet = page.getByRole('dialog', { name: 'Artist 1 지원서' });
    await sheet.locator('[data-decision-bar]').getByRole('button', { name: '수락하기', exact: true }).click();
    await page.getByRole('dialog', { name: /Artist 1 님을 수락할까요/ }).getByRole('button', { name: '수락하기', exact: true }).click();
    await expect(page.locator('body')).toContainText('잠시 문제가 생겼어요', { timeout: 8000 });
    expect(await statusOf(api, exId, userIds().artist)).toBe('SUBMITTED');
    // 다시 누르면 된다 — 창이 그대로 있으면 거기서, 닫혔으면 줄에서
    if (!(await sheet.isVisible())) await applicantRow(manager, 'Artist 1').getByRole('button').first().click();
    await sheet.locator('[data-decision-bar]').getByRole('button', { name: '수락하기', exact: true }).click();
    await page.getByRole('dialog', { name: /Artist 1 님을 수락할까요/ }).getByRole('button', { name: '수락하기', exact: true }).click();
    await expect.poll(() => statusOf(api, exId, userIds().artist), { timeout: 8000 }).toBe('ACCEPTED');
    expect(errors).toEqual([]);
    await api.dispose();
    await ctx.close();
  });

  test('★ 정산: 확인 요청 · 작가 확인 · 정산 완료가 한 번 실패해도 — 입력 그대로, 다시 누르면 된다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('실패정산');
    const exId = await settlingExhibition(api, title, { request: false });

    const g = await openAs(browser, 'gallery');
    const errors = collectErrors(g.page);
    await failOnce(g.page, '**/api/operations/*/settlement/request', 'POST');
    await openOperation(g.page, exId, '정산');
    const price = g.page.getByLabel('작품A 판매가', { exact: true });
    await price.fill('1300000');
    await taskButton(g.page, /확인 요청/).click();
    await expect(g.page.locator('body')).toContainText('잠시 문제가 생겼어요', { timeout: 8000 });
    await expect(price, '실패 뒤 입력이 사라졌다').toHaveValue(/1,?300,?000/);
    await sleep(600);   // 사람 손 간격 — 할 일 버튼은 0.4초 안의 두 번째 클릭을 연타로 본다
    await taskButton(g.page, /확인 요청/).click();
    await expect(g.page.locator('[data-task-bar], [data-workspace-bar]').first()).toContainText(/기다리고 있어요|확인 요청/, { timeout: 10000 });

    for (const role of ['artist', 'artist2'] as const) {
      const a = await openAs(browser, role);
      await failOnce(a.page, '**/api/operations/*/settlement/respond', 'POST');
      const ws = await openArtistExhibition(a.page, exId);
      const bar = ws.locator('[data-settle-bar]');
      await bar.getByRole('button', { name: '정산 확인', exact: true }).click();
      await expect(a.page.locator('body')).toContainText('잠시 문제가 생겼어요', { timeout: 8000 });
      await expect(bar, '실패했는데 답하는 줄이 사라졌다').toBeVisible();
      await bar.getByRole('button', { name: '정산 확인', exact: true }).click();
      await expect(ws.locator('[data-settle-status]')).toContainText('확인했어요', { timeout: 10000 });
      await a.ctx.close();
    }

    await failOnce(g.page, '**/api/operations/*/settlement/complete', 'POST');
    await g.page.reload();
    await taskButton(g.page, '정산 완료').click();
    await g.page.getByRole('dialog', { name: '정산을 완료할까요?' }).getByRole('button', { name: '정산 완료' }).click();
    await expect(g.page.locator('body')).toContainText('잠시 문제가 생겼어요', { timeout: 8000 });
    await taskButton(g.page, '정산 완료').click();
    await g.page.getByRole('dialog', { name: '정산을 완료할까요?' }).getByRole('button', { name: '정산 완료' }).click();
    await expect(workspaceTab(g.page, '요약')).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
    expect(errors).toEqual([]);
    await g.ctx.close();
    await api.dispose();
  });
});

// ─────────────────────────────────────────────────────────────
test.describe('REL-06 — 옛 화면에서 누를 때', () => {
  test('★ 다른 탭이 이미 정산 확인을 요청했는데 옛 탭에서 또 요청 — 이유를 말하고 화면이 기다림으로 바뀐다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('옛탭요청');
    const exId = await settlingExhibition(api, title, { request: false });
    const { page, ctx } = await openAs(browser, 'gallery');
    await openOperation(page, exId, '정산');
    await expect(taskButton(page, /확인 요청/)).toBeVisible({ timeout: 15000 });
    expect((await api.post(`${API}/operations/${exId}/settlement/request`, { headers: auth('gallery') })).status()).toBe(200);
    await taskButton(page, /확인 요청/).click();
    await expect(page.locator('body')).toContainText('이미 정산 확인을 요청했습니다', { timeout: 8000 });
    await expect(page.locator('[data-task-bar], [data-workspace-bar]').first(), '실패한 뒤에도 옛 할 일([확인 요청])이 남아 있다')
      .toContainText(/기다리고 있어요/, { timeout: 8000 });
    await api.dispose();
    await ctx.close();
  });

  test('★ SET-10 작가가 정산 탭을 연 채 갤러리가 금액을 고치면 — [정산 확인]은 409, 새 금액으로 다시 그리고 다시 누르면 된다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('409');
    const exId = await settlingExhibition(api, title);
    const { page, ctx } = await openAs(browser, 'artist');
    const ws = await openArtistExhibition(page, exId);
    await expect(ws.locator('[data-my-settlement]')).toContainText('720,000', { timeout: 15000 });   // 120만 × 60%
    expect((await api.put(`${API}/operations/${exId}/settlement`, {
      headers: auth('gallery'),
      data: {
        sales: [{ artistUserId: userIds().artist, artworkIndex: 0, title: '작품A', soldPrice: 1500000, paymentMethod: 'CARD' }],
        ratios: [{ artistUserId: userIds().artist, galleryRatio: 40 }, { artistUserId: userIds().artist2, galleryRatio: 40 }],
      },
    })).status()).toBe(200);
    await ws.locator('[data-settle-bar]').getByRole('button', { name: '정산 확인', exact: true }).click();
    await expect(page.locator('body')).toContainText('정산 내역이 방금 수정되었습니다', { timeout: 8000 });
    await expect(ws.locator('[data-my-settlement]')).toContainText('900,000', { timeout: 8000 });
    await ws.locator('[data-settle-bar]').getByRole('button', { name: '정산 확인', exact: true }).click();
    await expect(ws.locator('[data-settle-status]')).toContainText('확인했어요', { timeout: 8000 });
    await api.dispose();
    await ctx.close();
  });

  test('★ 정산이 끝난 뒤 옛 화면의 작가가 [이의 제기] — 이유를 말하고 화면이 끝난 정산으로 바뀐다 · 쓴 글은 창에 남는다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('끝난뒤');
    const exId = await settlingExhibition(api, title);
    const { page, ctx } = await openAs(browser, 'artist');
    const ws = await openArtistExhibition(page, exId);
    await expect(ws.locator('[data-settle-bar]')).toBeVisible({ timeout: 15000 });
    for (const role of ['artist', 'artist2'] as const) {
      expect((await api.post(`${API}/operations/${exId}/settlement/respond`, { headers: auth(role), data: { approve: true } })).status()).toBe(200);
    }
    expect((await api.post(`${API}/operations/${exId}/settlement/complete`, { headers: auth('gallery') })).status()).toBe(200);
    await ws.locator('[data-settle-bar]').getByRole('button', { name: '이의 제기' }).click();
    const dialog = page.getByRole('dialog', { name: '어떤 점이 다른가요?' });
    await dialog.getByRole('textbox').fill('판매가가 다릅니다');
    await dialog.getByRole('button', { name: '이의 보내기' }).click();
    await expect(page.locator('body')).toContainText('이미 정산이 완료되었습니다', { timeout: 8000 });
    await expect(dialog.getByRole('textbox'), '실패했는데 쓴 글이 사라졌다').toHaveValue('판매가가 다릅니다');
    await page.keyboard.press('Escape');
    await expect(ws.locator('[data-settle-status]'), '실패한 뒤에도 옛 화면(답하는 줄)이 남아 있다').toContainText('정산이 끝났어요', { timeout: 8000 });
    await api.dispose();
    await ctx.close();
  });
});

// ─────────────────────────────────────────────────────────────
test.describe('REL-13 — 응답이 늦을 때 틀린 문장이 번쩍이지 않는다', () => {
  test('★ 전시 준비 단계 공모를 열 때 지원자·출품 자료가 3초 늦게 와도 "수락한 작가가 없어요" 가 보이지 않는다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('늦음');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    await acceptVia(api, exId, 'artist');
    expect((await lifecycle(api, exId, { recruitmentClosed: true })).status()).toBe(200);

    const { page, ctx } = await openAs(browser, 'gallery');
    await page.route(`**/api/exhibitions/${exId}/applications`, async (r) => { await sleep(3000); await r.continue(); });
    await page.route(`**/api/operations/${exId}/submissions`, async (r) => { await sleep(3000); await r.continue(); });
    await page.goto(`/mypage?tab=my-exhibitions&ex=${exId}`);
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const t = await page.locator('[data-task-bar], [data-workspace-bar], [data-exhibition-workspace] p').allInnerTexts().catch(() => []);
      t.forEach((x) => seen.add(x.trim()));
      await sleep(200);
    }
    const flashes = [...seen].filter((x) => x.includes('수락한 작가가 없어요'));
    expect(flashes, `불러오는 동안 틀린 할 일이 보였다: ${flashes.join(' / ')}`).toEqual([]);
    await expect(page.locator('[data-task-bar], [data-workspace-bar]').first()).toContainText('출품 자료를 아직 내지 않은 작가가 1명', { timeout: 10000 });
    await api.dispose();
    await ctx.close();
  });
});

// ─────────────────────────────────────────────────────────────
test.describe('REL-09·10·11 — 뒤로 · 앞으로 · 갈아 끼우기 · 저장 안 한 입력', () => {
  test('★ REL-09 목록 → 공모 → 탭을 바꿔도 뒤로 한 번에 목록, 앞으로 하면 그 공모', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('뒤로');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    const { page, ctx } = await openAs(browser, 'gallery');
    await page.goto('/mypage?tab=my-exhibitions');
    await exhibitionCard(page, title).getByRole('button', { name: title }).first().click();
    await expect(page).toHaveURL(new RegExp(`ex=${exId}`));
    await workspaceTab(page, '공지').click();
    await workspaceTab(page, '지원자').click();
    await page.goBack();
    await expect(page).toHaveURL(/\/mypage\?tab=my-exhibitions$/);
    await page.goForward();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15000 });
    await api.dispose();
    await ctx.close();
  });

  test('★ REL-10 주소로 바로 연 공모에서 [← 내 공모] 를 누른 뒤 뒤로 가도 공모 화면으로 되돌아가지 않는다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('갈아끼움');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    const { page, ctx } = await openAs(browser, 'gallery');
    await page.goto('/');
    await page.goto(`/mypage?tab=my-exhibitions&ex=${exId}`);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15000 });
    await workspace(page).getByRole('button', { name: '내 공모', exact: true }).click();
    await expect(page).toHaveURL(/\/mypage\?tab=my-exhibitions$/);
    await page.goBack();
    await expect(page).not.toHaveURL(new RegExp(`ex=${exId}`));
    await api.dispose();
    await ctx.close();
  });

  test('★ REL-11 판매가를 고친 채 하단 탭·알림으로 나가려 하면 한 번 묻고, 취소면 값이 남는다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('가드');
    const exId = await settlingExhibition(api, title, { request: false });
    const { page, ctx } = await openAs(browser, 'gallery');
    await openOperation(page, exId, '정산');
    const price = page.getByLabel('작품A 판매가', { exact: true });
    await price.fill('1400000');

    let asked = 0;
    page.on('dialog', (d) => { asked++; void d.dismiss(); });
    await page.getByRole('navigation', { name: '하단 내비게이션' }).getByRole('link', { name: '홈' }).click();
    await sleep(800);
    expect(asked, '하단 탭으로 나갈 때 한 번 물어야 한다').toBe(1);
    await expect(price).toHaveValue(/1,?400,?000/);

    await page.getByRole('button', { name: '알림' }).first().click();
    const anyNote = page.locator('[role="menu"] button, [data-notification] button').first();
    if (await anyNote.count()) {
      await anyNote.click();
      await sleep(800);
      expect(asked, '알림으로 나갈 때도 물어야 한다').toBe(2);
      await expect(price).toHaveValue(/1,?400,?000/);
    }
    await api.dispose();
    await ctx.close();
  });
});

// ─────────────────────────────────────────────────────────────
test.describe('REL-15·18 — 창을 여러 번 · 겹친 창', () => {
  test('★ REL-18 지원서 창 위의 수락 확인창에서 Esc → 확인창만 · 한 번 더 → 지원서 창 · REL-15 열고 닫기 10번 뒤에도 페이지가 스크롤된다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('겹침');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    await apply(api, exId, 'artist');
    await apply(api, exId, 'artist2');
    await closeRecruitment(api, exId);   // 수락 확인창은 마감한 뒤에만 열린다(규칙 90)
    const { page, ctx } = await openAs(browser, 'gallery');
    const manager = await openApplicantManager(page, title);
    await applicantRow(manager, 'Artist 1').getByRole('button').first().click();
    const sheet = page.getByRole('dialog', { name: 'Artist 1 지원서' });
    await sheet.locator('[data-decision-bar]').getByRole('button', { name: '수락하기', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: /Artist 1 님을 수락할까요/ });
    await expect(confirm).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(confirm).toHaveCount(0);
    await expect(sheet, 'Esc 한 번에 지원서 창까지 닫혔다').toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);

    for (let i = 0; i < 10; i++) {
      await applicantRow(manager, 'Artist 2').getByRole('button').first().click();
      await expect(page.getByRole('dialog', { name: 'Artist 2 지원서' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Artist 2 지원서' })).toHaveCount(0);
    }
    const overflow = await page.evaluate(() => [getComputedStyle(document.body).overflow, getComputedStyle(document.documentElement).overflow]);
    expect(overflow.join(' '), '창을 닫았는데 스크롤 잠금이 남았다').not.toContain('hidden');
    await api.dispose();
    await ctx.close();
  });
});
