import { test, expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';
import {
  openAs, tokenFor, userIds, ownedGalleryId, createExhibition, applyToExhibition, crowdUsers, exhibitionDates, exhibitionCard, workspace, workspaceTab, taskButton, openApplicantManager, applicantRow, openArtistExhibition, openOperation, artistTab, closeRecruitment,
} from '../lib/helpers';

/**
 * 공모 흐름 개편(규칙 88) 복합 여정 — 실사용자처럼 처음부터 끝까지 (2026-11-20, `scratchpad/flow-review-2026-11/TESTCASES.md` JRN-01~11).
 * 체크포인트마다 ① 줄·할 일 ② 진행 띠 ③ 알림 ④ 서버 값을 함께 본다. 끝에서 알림 중복을 센다(부록 C).
 * 셋업은 API, 사람이 누르는 핵심 지점은 화면으로. 갤러리는 휴대폰(기본), 작가는 PC 를 섞는다.
 */
const API = 'http://localhost:4000/api';
const DESKTOP = { width: 1440, height: 900 };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const auth = (role: Parameters<typeof tokenFor>[0]) => ({ Authorization: `Bearer ${tokenFor(role)}` });
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const newTitle = (what: string) => `E2E여정 ${what} ${Date.now()}`;
const sleep = (ms: number) => new Promise((f) => setTimeout(f, ms));

async function applyAs(api: APIRequestContext, exId: number, token: string) {
  const r = await applyToExhibition(api, exId, token);
  expect(r.status(), `지원 실패: ${await r.text()}`).toBe(201);
  return (await r.json()).id as number;
}
/** 수락·거절 — 모집을 먼저 마감한다(수락·거절은 마감한 뒤에만, 규칙 90). 마감하면 더 지원할 수 없으니 지원은 먼저 다 받을 것 */
async function decide(api: APIRequestContext, exId: number, appId: number, status: 'ACCEPTED' | 'REJECTED', role: 'gallery' | 'admin' = 'gallery') {
  await closeRecruitment(api, exId);
  const r = await api.patch(`${API}/exhibitions/${exId}/applications/${appId}`, { headers: auth(role), data: { status } });
  expect(r.status(), await r.text()).toBe(200);
}
/** 여러 작가를 지원시킨 뒤 마감하고 모두 수락한다 */
async function acceptAll(api: APIRequestContext, exId: number, tokens: string[]) {
  const ids: number[] = [];
  for (const t of tokens) ids.push(await applyAs(api, exId, t));
  for (const id of ids) await decide(api, exId, id, 'ACCEPTED');
  return ids;
}
async function submitFull(api: APIRequestContext, exId: number, token: string, work: string, opts: { draft?: boolean } = {}) {
  const r = await api.put(`${API}/operations/${exId}/me`, {
    headers: bearer(token),
    data: {
      artworkList: [{ title: work, size: '60x40', medium: '캔버스에 유채', year: '2026', price: '1000000', image: '', ...(opts.draft ? { draft: true } : {}) }],
      cv: opts.draft ? null : { nameKo: work },
      note: opts.draft ? null : { statement: `${work} 작가노트`, sections: [] },
      representativeIndex: 0,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}
const lifecycle = (api: APIRequestContext, exId: number, data: Record<string, unknown>, role: 'gallery' | 'admin' = 'gallery') =>
  api.patch(`${API}/operations/${exId}/lifecycle`, { headers: auth(role), data });
async function notesOf(api: APIRequestContext, headers: Record<string, string>, title: string, type?: string) {
  const list = await (await api.get(`${API}/notifications`, { headers })).json();
  return ((list.notifications ?? list) as { type: string; message: string; linkUrl?: string; read: boolean }[])
    .filter((n) => n.message.includes(title) && (!type || n.type === type));
}
async function appsOf(api: APIRequestContext, exId: number, role: 'gallery' | 'admin' = 'gallery') {
  const r = await (await api.get(`${API}/exhibitions/${exId}/applications`, { headers: auth(role) })).json();
  return (r.applications ?? r) as { id: number; userId: number; status: string; joinedVia?: string | null }[];
}
/** 데모·테스트 DB 의 날짜를 옮긴다 — 등록 API 는 과거 날짜를 받지 않는다. 접속정보는 DATABASE_URL 로만(38·56 스펙과 같은 규칙) */
async function sql(query: string) {
  const dbUrl = process.env.DATABASE_URL;
  expect(dbUrl, 'DATABASE_URL 을 명시해 돌릴 것').toBeTruthy();
  const { execFileSync } = await import('child_process');
  execFileSync('psql', [dbUrl!, '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf-8' });
}
function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}
async function notesByLink(api: APIRequestContext, headers: Record<string, string>, link: string, type: string) {
  const list = await (await api.get(`${API}/notifications`, { headers })).json();
  return ((list.notifications ?? list) as { type: string; linkUrl?: string }[]).filter((n) => n.type === type && n.linkUrl === link);
}
const stripNow = (page: Page) => workspace(page).locator('ol[aria-label="진행 단계"] [aria-current="step"]');
const barText = (page: Page) => page.locator('[data-task-bar], [data-workspace-bar]').first();
async function hosted(api: APIRequestContext, title: string, galleryIds: number[], extra: Record<string, unknown> = {}) {
  const r = await api.post(`${API}/exhibitions/hosted`, {
    headers: auth('admin'),
    data: { ...exhibitionDates(), title, type: 'GROUP', capacity: 5, region: 'SEOUL', description: '<p>E2E 여정</p>', galleryIds, ...extra },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()).id as number;
}
async function settleSales(api: APIRequestContext, exId: number, sales: { uid: number; title: string; price: number; method: 'CARD' | 'CASH' }[], ratios: number[], fee = 0, role: 'gallery' | 'admin' = 'gallery') {
  const r = await api.put(`${API}/operations/${exId}/settlement`, {
    headers: auth(role),
    data: {
      sales: sales.map((s) => ({ artistUserId: s.uid, artworkIndex: 0, title: s.title, soldPrice: s.price, paymentMethod: s.method })),
      ratios: ratios.map((uid) => ({ artistUserId: uid, galleryRatio: 40 })),
      cardFeeRate: fee,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}

// ─────────────────────────────────────────────────────────────
test('★ JRN-01 전시까지 한 바퀴 — 갤러리(휴대폰) · 작가(PC) · 셋째 작가', async ({ browser }) => {
  test.setTimeout(300_000);
  const api = await pwRequest.newContext();
  const [c] = await crowdUsers(api, 1);          // 셋째 작가 '무리0'
  const ids = userIds();
  const title = newTitle('한바퀴');
  const galleryId = await ownedGalleryId(api);
  const exId = await createExhibition(api, { title, galleryId, capacity: 2 });

  // 1) 지원 — 작가1은 PC 화면(지원서 → 확인 창 → 약관 → 지원하기), 작가2·셋째는 API
  const a = await openAs(browser, 'artist');
  await a.page.setViewportSize(DESKTOP);
  const aErrors = collectErrors(a.page);
  await a.page.goto(`/exhibitions/${exId}/apply`);
  const bio = a.page.getByPlaceholder('작가 소개·약력을 입력하세요.');
  await expect(bio).toBeVisible({ timeout: 15000 });
  if (!(await bio.inputValue())) await bio.fill('E2E 여정 약력');
  if (await a.page.locator('#apply-images img').count() === 0) {
    await a.page.locator('#apply-images input[type="file"]').first().setInputFiles({ name: 'art.png', mimeType: 'image/png', buffer: PNG });
    await expect(a.page.locator('#apply-images img[src*="/uploads/"]').first()).toBeVisible({ timeout: 12000 });
    await sleep(900);
  }
  await a.page.getByRole('button', { name: '지원하기', exact: true }).click();
  const sheet = a.page.getByRole('dialog', { name: '지원서를 보낼까요?' });
  await sheet.getByRole('checkbox', { name: /작가 지원 약관에 동의합니다/ }).check();
  await sheet.getByRole('button', { name: '지원하기', exact: true }).click();
  await a.page.waitForURL(new RegExp(`/exhibitions/${exId}$`), { timeout: 15000 });
  await applyAs(api, exId, tokenFor('artist2'));
  await applyAs(api, exId, c!.token);
  // '새 지원자' 문구에는 공모 제목이 없다(갤러리 이름만 — 기존 문구, TESTCASES 관찰 O1) — 링크로 센다
  expect(await notesByLink(api, auth('gallery'), `/exhibitions/${exId}/operation/new?view=applicants`, 'NEW_APPLICANT')).toHaveLength(3);

  // 2) 갤러리(휴대폰) 목록 — 모집 중엔 지원이 들어와도 할 일이 아니다(수락·거절은 마감 뒤에만 — 규칙 90)
  const g = await openAs(browser, 'gallery');
  const gErrors = collectErrors(g.page);
  await g.page.goto('/mypage?tab=my-exhibitions');
  const row = exhibitionCard(g.page, title);
  // 휴대폰 목록의 '기다리는 중' 줄은 할 일 문장 없이 보조 글만(설계) — 모집 중이고 [지원자 심사] 같은 할 일 버튼이 없다
  await expect(row).toContainText('모집 중', { timeout: 15000 });
  await expect(row.getByRole('button', { name: /지원자 심사|선정 마치기/ })).toHaveCount(0);
  await openOperation(g.page, exId);
  await expect(barText(g.page)).toContainText('지원을 받고 있어요 · 지원 3명', { timeout: 15000 });

  // 3) [모집 마감] — 되돌릴 수 없다 · 이제 선정한다(아무도 미선정이 되지 않는다) · 선정 마감일이 지나면 미선정
  await taskButton(g.page, '모집 마감').click();
  const close = g.page.getByRole('dialog', { name: '모집을 마감할까요?' });
  await expect(close.locator('[data-confirm-warning]')).toHaveText('모집 마감은 되돌릴 수 없어요.');
  await expect(close).toContainText('이제 지원자 3명 가운데 수락할 작가를 고를 수 있어요.');
  await expect(close).toContainText('이 지나면 수락하지 않은 지원자는 미선정이 돼요.');
  await close.getByRole('button', { name: '모집 마감', exact: true }).click();
  await expect(stripNow(g.page)).toContainText('전시 준비', { timeout: 10000 });
  // 새 공고 — 선정 마감일까지 선정하라고(규칙 90)
  await expect(barText(g.page)).toContainText(/까지 선정하세요 · 검토 대기 3명/, { timeout: 15000 });
  await expect(barText(g.page)).toContainText('그날이 지나면 수락하지 않은 지원자는 미선정이 돼요');
  await expect(workspaceTab(g.page, '지원자')).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
  expect((await appsOf(api, exId)).every((x) => x.status === 'SUBMITTED')).toBe(true);

  // 4) 한 장씩 — 버튼은 [수락하기]뿐(거절은 없다). 작가1·셋째 수락, 작가2 는 남긴다
  const manager = g.page.locator('[data-applicant-manager]');
  await applicantRow(manager, 'Artist 1').getByRole('button').first().click();
  const bar1 = g.page.getByRole('dialog', { name: 'Artist 1 지원서' }).locator('[data-decision-bar]');
  await expect(bar1.getByRole('button', { name: '거절', exact: true })).toHaveCount(0);
  await bar1.getByRole('button', { name: '수락하기', exact: true }).click();
  await g.page.getByRole('dialog', { name: /Artist 1 님을 수락할까요/ }).getByRole('button', { name: '수락하기', exact: true }).click();
  await expect.poll(async () => (await appsOf(api, exId)).find((x) => x.userId === ids.artist)?.status).toBe('ACCEPTED');
  if (await g.page.getByRole('dialog', { name: /지원서$/ }).count()) await g.page.keyboard.press('Escape');
  await applicantRow(manager, '무리0').getByRole('button').first().click();
  await g.page.getByRole('dialog', { name: '무리0 지원서' }).locator('[data-decision-bar]').getByRole('button', { name: '수락하기', exact: true }).click();
  await g.page.getByRole('dialog', { name: /무리0 님을 수락할까요/ }).getByRole('button', { name: '수락하기', exact: true }).click();
  await expect.poll(async () => (await appsOf(api, exId)).find((x) => x.userId === c!.id)?.status).toBe('ACCEPTED');
  if (await g.page.getByRole('dialog', { name: /지원서$/ }).count()) await g.page.keyboard.press('Escape');

  // 5) 선정 마감일이 지나면 — 남은 검토 대기(작가2)는 알림 없이 미선정 · 더는 수락할 수 없다(되돌릴 수 없다)
  await sql(`UPDATE "Exhibition" SET "selectionDeadline" = now() - interval '2 days' WHERE id = ${exId};`);
  await g.page.reload();
  await workspaceTab(g.page, '지원자').click();
  await applicantRow(manager, 'Artist 2').getByRole('button').first().click();
  const bar2 = g.page.getByRole('dialog', { name: 'Artist 2 지원서' }).locator('[data-decision-bar]');
  await expect(bar2).toContainText('미선정 — 선정 마감일이 지나 바꿀 수 없어요.', { timeout: 15000 });
  await expect(bar2.getByRole('button', { name: '수락하기', exact: true })).toHaveCount(0);
  await g.page.keyboard.press('Escape');
  await expect.poll(async () => (await appsOf(api, exId)).find((x) => x.userId === ids.artist2)?.status).toBe('REJECTED');
  expect(await notesOf(api, auth('artist2'), title, 'APPLICATION_STATUS'), '선정 마감일이 지나 미선정이 되면 알리지 않는다').toHaveLength(0);

  // 6) 출품 자료 — 임시저장은 조용히 · 다 채운 순간 (1/2) · 둘째가 내면 같은 줄이 '모두 모였어요 (2/2)'
  await submitFull(api, exId, tokenFor('artist'), '작품A', { draft: true });
  expect(await notesOf(api, auth('gallery'), title, 'SUBMISSION_RECEIVED')).toHaveLength(0);
  await submitFull(api, exId, tokenFor('artist'), '작품A');
  let sub = await notesOf(api, auth('gallery'), title, 'SUBMISSION_RECEIVED');
  expect(sub).toHaveLength(1);
  expect(sub[0]!.message).toContain('(1/2)');
  await submitFull(api, exId, c!.token, '작품C');
  sub = await notesOf(api, auth('gallery'), title, 'SUBMISSION_RECEIVED');
  expect(sub, '한 줄을 고쳐 쓴다').toHaveLength(1);
  expect(sub[0]!.message).toContain('모두 모였어요 (2/2)');

  // 7) 목록의 [전시 확정] → 도착해서 확인창 → 확정 → 작가마다 확정 알림 한 통 · 작가 화면 잠김
  await g.page.goto('/mypage?tab=my-exhibitions');
  await expect(exhibitionCard(g.page, title)).toContainText('출품 자료가 모두 모였어요', { timeout: 15000 });
  await exhibitionCard(g.page, title).getByRole('button', { name: /전시 확정/ }).click();
  await g.page.getByRole('dialog', { name: '전시를 확정할까요?' }).getByRole('button', { name: '전시 확정' }).click();
  await expect.poll(async () => (await notesOf(api, auth('artist'), title, 'EXHIBITION_CONFIRMED')).length, { timeout: 10000 }).toBe(1);
  expect(await notesOf(api, bearer(c!.token), title, 'EXHIBITION_CONFIRMED')).toHaveLength(1);
  const aws = await openArtistExhibition(a.page, exId);
  await expect(aws).toContainText('갤러리가 전시를 확정해 출품 자료가 잠겼어요', { timeout: 15000 });

  // 8) 시간이 흐른다 — 시작일 어제(전시 중) → 종료일 어제(전시 종료 차례) → [전시 종료] → 정산 탭
  await sql(`update "Exhibition" set "exhibitStartDate" = (now() at time zone 'utc') - interval '3 days', "exhibitDate" = (now() at time zone 'utc') + interval '5 days' where id = ${exId};`);
  await openOperation(g.page, exId);
  await expect(stripNow(g.page)).toContainText('전시', { timeout: 15000 });
  await expect(barText(g.page)).toContainText('전시 중이에요');
  await sql(`update "Exhibition" set "exhibitDate" = (now() at time zone 'utc') - interval '1 days' where id = ${exId};`);
  await g.page.reload();
  await expect(barText(g.page)).toContainText('전시 기간이 끝났어요', { timeout: 15000 });
  await taskButton(g.page, '전시 종료').click();
  await g.page.getByRole('dialog', { name: '전시를 종료할까요?' }).getByRole('button', { name: '전시 종료' }).click();
  await expect(workspaceTab(g.page, '정산')).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });

  // 9) 판매(카드 120만 · 현금 80만, 갤러리 40% · 수수료 3%) → 화면에서 [작가 2명에게 확인 요청]
  await settleSales(api, exId, [{ uid: ids.artist, title: '작품A', price: 1_200_000, method: 'CARD' }, { uid: c!.id, title: '작품C', price: 800_000, method: 'CASH' }], [ids.artist, c!.id], 3);
  await g.page.reload();
  await taskButton(g.page, /작가 2명에게 확인 요청/).click();
  await expect(barText(g.page)).toContainText('기다리고 있어요', { timeout: 15000 });

  // 10) 작가1 이의(PC 화면) · 셋째 확인(API)
  const aws2 = await openArtistExhibition(a.page, exId);
  await aws2.locator('[data-settle-bar]').getByRole('button', { name: '이의 제기' }).click();
  const issue = a.page.getByRole('dialog', { name: '어떤 점이 다른가요?' });
  await issue.getByRole('textbox').fill('작품A 는 150만 원에 팔렸어요.');
  await issue.getByRole('button', { name: '이의 보내기' }).click();
  await expect(aws2.locator('[data-settle-status]')).toContainText('이의를 보냈어요', { timeout: 10000 });
  expect((await api.post(`${API}/operations/${exId}/settlement/respond`, { headers: bearer(c!.token), data: { approve: true } })).status()).toBe(200);

  // 11) 갤러리 — 이의 글 → 판매가 150만 → [저장하고 Artist 1 님에게 다시 요청] → 셋째의 확인은 그대로 → 작가1 확인 → '모두 확인' 알림
  await g.page.reload();
  await expect(barText(g.page)).toContainText('Artist 1 님이 정산에 이의를 남겼어요', { timeout: 15000 });
  await expect(g.page.locator('[data-settle-issue]')).toContainText('150만 원에 팔렸어요');
  await g.page.getByLabel('작품A 판매가', { exact: true }).fill('1500000');
  await taskButton(g.page, '저장하고 Artist 1 님에게 다시 요청').click();
  await expect(barText(g.page)).toContainText('기다리고 있어요', { timeout: 15000 });
  const settle = await (await api.get(`${API}/operations/${exId}/settlement`, { headers: auth('gallery') })).json();
  const statusOf = (uid: number) => settle.artists.find((x: any) => x.user.id === uid)?.approval?.status;
  expect([statusOf(ids.artist), statusOf(c!.id)], '고친 작가만 다시 묻는다').toEqual(['PENDING', 'APPROVED']);
  const aws3 = await openArtistExhibition(a.page, exId);
  await expect(aws3.locator('[data-my-settlement]')).toContainText('873,000', { timeout: 15000 });   // (150만 − 수수료 4.5만) × 60%
  await aws3.locator('[data-settle-bar]').getByRole('button', { name: '정산 확인', exact: true }).click();
  await expect.poll(async () => (await notesOf(api, auth('gallery'), title, 'SETTLEMENT_ALL_APPROVED')).length, { timeout: 10000 }).toBe(1);

  // 12) [정산 완료] → 요약 숫자 → 목록 [종료] → 작가1 '정산이 끝났어요' + [갤러리 리뷰 쓰기] → 리뷰 탭
  await g.page.reload();
  await taskButton(g.page, '정산 완료').click();
  await g.page.getByRole('dialog', { name: '정산을 완료할까요?' }).getByRole('button', { name: '정산 완료' }).click();
  await expect(workspaceTab(g.page, '요약')).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
  const summary = g.page.locator('[data-workspace-summary]');
  await expect(summary).toContainText('2,300,000');     // 판매 합계
  await expect(summary).toContainText('1,353,000');     // 작가 지급 873,000 + 480,000
  await g.page.goto('/mypage?tab=my-exhibitions');
  await g.page.getByRole('tab', { name: /종료/ }).first().click();
  await expect(exhibitionCard(g.page, title)).toContainText('정산 완료', { timeout: 15000 });   // 휴대폰 줄 — 상태와 날짜(할 일 문장은 PC 에서)
  const aws4 = await openArtistExhibition(a.page, exId);
  await expect(aws4.locator('[data-settle-status]')).toContainText('정산이 끝났어요', { timeout: 15000 });
  await aws4.getByRole('link', { name: '갤러리 리뷰 쓰기' }).click();
  await expect(a.page).toHaveURL(new RegExp(`/galleries/${galleryId}\\?tab=reviews|/@.+\\?tab=reviews`), { timeout: 15000 });

  // 끝: 작가2 — 미선정 줄 + [확인] → 사라진다
  const b = await openAs(browser, 'artist2');
  await b.page.goto('/mypage?tab=applications');
  await b.page.getByRole('tab', { name: /심사 중/ }).click();
  const bRow = exhibitionCard(b.page, title);
  await expect(bRow).toContainText('이번 공모에서는 선정되지 않았어요', { timeout: 15000 });
  await bRow.getByRole('button', { name: /확인/ }).first().click();
  await expect(exhibitionCard(b.page, title)).toHaveCount(0, { timeout: 10000 });

  // 부록 C — 알림이 겹치지 않았다
  expect(await notesOf(api, auth('gallery'), title, 'SUBMISSION_RECEIVED')).toHaveLength(1);
  expect(await notesOf(api, auth('gallery'), title, 'SETTLEMENT_ALL_APPROVED')).toHaveLength(1);
  expect(await notesOf(api, auth('artist'), title, 'EXHIBITION_CONFIRMED')).toHaveLength(1);
  expect((await notesOf(api, auth('artist'), title, 'SETTLEMENT_SHARED')).filter((n) => n.message.includes('공개'))).toHaveLength(1);
  expect([...aErrors, ...gErrors]).toEqual([]);
  await Promise.all([a.ctx.close(), g.ctx.close(), b.ctx.close()]);
  await api.dispose();
});

// ─────────────────────────────────────────────────────────────
test('★ JRN-02 공모만 진행(선정 마감일이 없는 옛 공고) — 띠 두 칸 · 탭 둘 · 마감 뒤 선정 · 할 일 줄의 [선정 마치기]로 미선정 처리 · 출품·정산 없음', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const title = newTitle('공모만');
  const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3, extra: { recruitOnly: true } });
  // 이미 올라간 옛 공고처럼 — 선정 마감일이 없다(남은 사람이 저절로 미선정이 될 날이 없어 [선정 마치기]가 끝낸다, 규칙 90)
  await sql(`UPDATE "Exhibition" SET "selectionDeadline" = NULL WHERE id = ${exId};`);
  const app1 = await applyAs(api, exId, tokenFor('artist'));
  await applyAs(api, exId, tokenFor('artist2'));

  const g = await openAs(browser, 'gallery');
  await openOperation(g.page, exId);
  await expect(workspace(g.page).locator('ol[aria-label="진행 단계"] > li')).toHaveCount(2);
  const tabs = g.page.getByRole('tablist', { name: '공모 운영' }).getByRole('tab');
  await expect(tabs).toHaveText([/지원자/, /공지/]);
  await taskButton(g.page, '모집 마감').click();
  const dialog = g.page.getByRole('dialog', { name: '모집을 마감할까요?' });
  await expect(dialog).toContainText('출품 자료·전시·정산 단계가 없어요');
  await expect(dialog).toContainText('이제 지원자 2명 가운데 수락할 작가를 고를 수 있어요.');
  await dialog.getByRole('button', { name: '모집 마감', exact: true }).click();
  // 마감 뒤 결정을 기다리는 지원이 남았다 — '선정 중'(선정 칸이 지금)
  await expect(stripNow(g.page)).toContainText('선정', { timeout: 10000 });
  await expect(barText(g.page)).toContainText('지원자 2명이 검토를 기다리고 있어요', { timeout: 15000 });
  await decide(api, exId, app1, 'ACCEPTED');
  await g.page.reload();
  // 할 일 줄의 버튼(모든 공고, 2026-11-21 사용자 결정 — [⋯] 메뉴엔 없다)
  await workspace(g.page).getByRole('button', { name: '더 보기' }).first().click();
  await expect(g.page.getByRole('menuitem', { name: /선정 마치기/ })).toHaveCount(0);
  await g.page.keyboard.press('Escape');
  await taskButton(g.page, '선정 마치기').click();
  const finish = g.page.getByRole('dialog', { name: '선정을 마칠까요?' });
  await expect(finish.locator('[data-confirm-warning]')).toHaveText('선정을 마치면 되돌릴 수 없어요.');
  await expect(finish).toContainText('수락한 1명으로 선정을 마쳐요.');
  await expect(finish).toContainText('수락하지 않은 1명은 미선정이 돼요.');
  await finish.getByRole('button', { name: '선정 마치기', exact: true }).click();
  await expect(barText(g.page)).toContainText('선정을 마쳤어요', { timeout: 15000 });
  expect((await appsOf(api, exId)).map((x) => x.status).sort()).toEqual(['ACCEPTED', 'REJECTED']);

  const a = await openAs(browser, 'artist');
  await openArtistExhibition(a.page, exId);
  await expect(a.page.getByRole('tablist', { name: '전시' }).getByRole('tab')).toHaveText([/공지/, /내 지원서/]);
  expect((await api.put(`${API}/operations/${exId}/me`, { headers: auth('artist'), data: { artworkList: [], cv: null, note: null } })).status()).toBe(400);
  expect((await api.get(`${API}/operations/${exId}/settlement`, { headers: auth('gallery') })).status()).toBe(400);
  expect(await notesOf(api, auth('artist'), title, 'EXHIBITION_CONFIRMED')).toHaveLength(0);
  expect(await notesOf(api, auth('artist2'), title, 'APPLICATION_STATUS'), '선정을 마칠 때 미선정은 알리지 않는다(규칙 90)').toHaveLength(0);
  await Promise.all([g.ctx.close(), a.ctx.close()]);
  await api.dispose();
});

// ─────────────────────────────────────────────────────────────
test('★ JRN-03 아트링크 주최 + 운영 갤러리 — 갤러리가 운영하고 관리자는 [주최 공모]에서 같은 화면을 본다', async ({ browser }) => {
  test.setTimeout(180_000);
  const api = await pwRequest.newContext();
  const title = newTitle('주최위임');
  const exId = await hosted(api, title, [await ownedGalleryId(api)]);
  const app1 = await applyAs(api, exId, tokenFor('artist'));
  expect((await lifecycle(api, exId, { recruitmentClosed: true })).status()).toBe(200);   // 선정은 마감한 뒤에(규칙 90)

  const g = await openAs(browser, 'gallery');
  await g.page.goto('/mypage?tab=my-exhibitions');
  await expect(exhibitionCard(g.page, title)).toContainText(/까지 선정하세요 · 검토 대기 1명/, { timeout: 15000 });
  // 줄의 할 일 버튼은 [선정 마치기](규칙 90) — 심사하러는 줄을 눌러 들어간다(선정 중이면 [지원자] 탭부터)
  await expect(exhibitionCard(g.page, title).getByRole('button', { name: '선정 마치기' })).toBeVisible();
  await exhibitionCard(g.page, title).getByRole('button', { name: title }).first().click();
  await applicantRow(g.page.locator('[data-applicant-manager]'), 'Artist 1').getByRole('button').first().click();
  await g.page.getByRole('dialog', { name: 'Artist 1 지원서' }).locator('[data-decision-bar]').getByRole('button', { name: '수락하기', exact: true }).click();
  await g.page.getByRole('dialog', { name: /Artist 1 님을 수락할까요/ }).getByRole('button', { name: '수락하기', exact: true }).click();
  await expect.poll(async () => (await appsOf(api, exId)).find((x) => x.id === app1)?.status).toBe('ACCEPTED');

  expect((await lifecycle(api, exId, { recruitmentClosed: true })).status()).toBe(200);
  await submitFull(api, exId, tokenFor('artist'), '작품A');
  expect(await notesOf(api, auth('gallery'), title, 'SUBMISSION_RECEIVED'), '운영을 맡은 갤러리에게 간다').toHaveLength(1);
  await openOperation(g.page, exId);
  await taskButton(g.page, '전시 확정').click();
  await g.page.getByRole('dialog', { name: '전시를 확정할까요?' }).getByRole('button', { name: '전시 확정' }).click();
  await expect.poll(async () => (await notesOf(api, auth('artist'), title, 'EXHIBITION_CONFIRMED')).length, { timeout: 10000 }).toBe(1);

  const adm = await openAs(browser, 'admin');
  await adm.page.goto(`/exhibitions/${exId}/operation/new`);
  // 2026-11-21(규칙 89): 관리자의 아트링크 주최 공모는 마이페이지 [주최 공모]의 그 공모 화면에서 연다(같은 화면 · 메뉴·배지가 있는 자리)
  await expect(adm.page).toHaveURL(new RegExp(`/mypage\\?tab=hosted-exhibitions&ex=${exId}$`), { timeout: 15000 });
  await expect(adm.page.getByRole('heading', { name: title })).toBeVisible({ timeout: 15000 });
  await expect(workspace(adm.page).getByRole('button', { name: '주최 공모', exact: true })).toBeVisible();
  await expect(stripNow(adm.page)).toContainText('전시 준비');
  await Promise.all([g.ctx.close(), adm.ctx.close()]);
  await api.dispose();
});

// ─────────────────────────────────────────────────────────────
test('★ JRN-04 갤러리 없는 아트링크 주최 — 운영 알림은 관리자에게 · 작가에겐 [갤러리 리뷰 쓰기]가 없다', async ({ browser }) => {
  test.setTimeout(180_000);
  const api = await pwRequest.newContext();
  const title = newTitle('주최단독');
  const exId = await hosted(api, title, []);
  const app1 = await applyAs(api, exId, tokenFor('artist'));
  await decide(api, exId, app1, 'ACCEPTED', 'admin');
  expect((await lifecycle(api, exId, { recruitmentClosed: true }, 'admin')).status()).toBe(200);
  await submitFull(api, exId, tokenFor('artist'), '작품A');
  expect(await notesOf(api, auth('admin'), title, 'SUBMISSION_RECEIVED'), '관리자에게').toHaveLength(1);
  expect((await lifecycle(api, exId, { confirmed: true, ended: true }, 'admin')).status()).toBe(200);
  await settleSales(api, exId, [{ uid: userIds().artist, title: '작품A', price: 500_000, method: 'CARD' }], [userIds().artist], 0, 'admin');
  expect((await api.post(`${API}/operations/${exId}/settlement/request`, { headers: auth('admin') })).status()).toBe(200);
  expect((await api.post(`${API}/operations/${exId}/settlement/respond`, { headers: auth('artist'), data: { approve: false, comment: '확인이 필요해요' } })).status()).toBe(200);
  expect(await notesOf(api, auth('admin'), title, 'SETTLEMENT_ISSUE'), '이의가 관리자에게').toHaveLength(1);
  expect((await api.post(`${API}/operations/${exId}/settlement/request/artist/${userIds().artist}`, { headers: auth('admin') })).status()).toBe(200);
  expect((await api.post(`${API}/operations/${exId}/settlement/respond`, { headers: auth('artist'), data: { approve: true } })).status()).toBe(200);
  expect(await notesOf(api, auth('admin'), title, 'SETTLEMENT_ALL_APPROVED')).toHaveLength(1);
  expect((await api.post(`${API}/operations/${exId}/settlement/complete`, { headers: auth('admin') })).status()).toBe(200);

  const a = await openAs(browser, 'artist');
  const ws = await openArtistExhibition(a.page, exId);
  await expect(ws.locator('[data-settle-status]')).toContainText('정산이 끝났어요', { timeout: 15000 });
  await expect(ws.getByRole('link', { name: '갤러리 리뷰 쓰기' })).toHaveCount(0);
  await a.ctx.close();
  await api.dispose();
});

// ─────────────────────────────────────────────────────────────
test('★ JRN-05 초대 코드로 옮겨 온 공모 — 지원서 없이 수락 · 심사 창은 코드 참여 · 내 지원서 탭이 깨지지 않는다', async ({ browser }) => {
  test.setTimeout(180_000);
  const api = await pwRequest.newContext();
  const title = newTitle('코드');
  const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
  const made = await api.post(`${API}/exhibitions/${exId}/join-code`, { headers: auth('gallery') });
  expect(made.status(), await made.text()).toBe(200);
  const code = (await made.json()).code as string;

  const a = await openAs(browser, 'artist');
  const aErrors = collectErrors(a.page);
  await a.page.goto(`/join/${code}`);
  await a.page.getByRole('button', { name: '참여하기' }).click();
  await a.page.waitForURL(/tab=applications&ex=/, { timeout: 15000 });
  expect([200, 201]).toContain((await api.post(`${API}/exhibitions/join`, { headers: auth('artist2'), data: { code } })).status());
  expect((await appsOf(api, exId)).map((x) => [x.status, x.joinedVia])).toEqual([['ACCEPTED', 'CODE'], ['ACCEPTED', 'CODE']]);

  const ws = await openArtistExhibition(a.page, exId);
  await artistTab(a.page, '내 지원서').click();
  await expect(ws).toBeVisible();

  const g = await openAs(browser, 'gallery');
  const manager = await openApplicantManager(g.page, title);
  await applicantRow(manager, 'Artist 1').getByRole('button').first().click();
  await expect(g.page.getByRole('dialog', { name: 'Artist 1 지원서' })).toContainText('초대 코드로 참여');

  for (const role of ['artist', 'artist2'] as const) await submitFull(api, exId, tokenFor(role), `작품${role}`);
  expect((await lifecycle(api, exId, { recruitmentClosed: true, confirmed: true, ended: true })).status()).toBe(200);
  await settleSales(api, exId, [], [userIds().artist, userIds().artist2]);
  expect((await api.post(`${API}/operations/${exId}/settlement/request`, { headers: auth('gallery') })).status()).toBe(200);
  for (const role of ['artist', 'artist2'] as const) {
    expect((await api.post(`${API}/operations/${exId}/settlement/respond`, { headers: auth(role), data: { approve: true } })).status()).toBe(200);
  }
  expect((await api.post(`${API}/operations/${exId}/settlement/complete`, { headers: auth('gallery') })).status()).toBe(200);
  const ws2 = await openArtistExhibition(a.page, exId);
  await expect(ws2.locator('[data-settle-status]')).toContainText('정산이 끝났어요', { timeout: 15000 });
  expect(aErrors).toEqual([]);
  await Promise.all([a.ctx.close(), g.ctx.close()]);
  await api.dispose();
});

// ─────────────────────────────────────────────────────────────
test('★ JRN-06 공모 셋을 동시에 굴리는 갤러리 — 지금 할 일 셋 · 공모끼리 창·선택이 섞이지 않는다', async ({ browser }) => {
  test.setTimeout(240_000);
  const api = await pwRequest.newContext();
  const gid = await ownedGalleryId(api);
  // A 마감 · 검토 대기 1 · B 출품 자료 받는 중(1/2) · C 정산 이의
  const tA = newTitle('셋A'); const exA = await createExhibition(api, { title: tA, galleryId: gid });
  await applyAs(api, exA, tokenFor('artist'));
  await closeRecruitment(api, exA);   // 마감했고 선정할 차례(모집 중엔 지원이 와도 할 일이 아니다 — 규칙 90)
  const tB = newTitle('셋B'); const exB = await createExhibition(api, { title: tB, galleryId: gid });
  await acceptAll(api, exB, [tokenFor('artist'), tokenFor('artist2')]);
  expect((await lifecycle(api, exB, { recruitmentClosed: true })).status()).toBe(200);
  await submitFull(api, exB, tokenFor('artist'), '작품B');
  const tC = newTitle('셋C'); const exC = await createExhibition(api, { title: tC, galleryId: gid });
  await decide(api, exC, await applyAs(api, exC, tokenFor('artist')), 'ACCEPTED');
  await submitFull(api, exC, tokenFor('artist'), '작품C');
  expect((await lifecycle(api, exC, { recruitmentClosed: true, confirmed: true, ended: true })).status()).toBe(200);
  await settleSales(api, exC, [{ uid: userIds().artist, title: '작품C', price: 900_000, method: 'CARD' }], [userIds().artist]);
  expect((await api.post(`${API}/operations/${exC}/settlement/request`, { headers: auth('gallery') })).status()).toBe(200);
  expect((await api.post(`${API}/operations/${exC}/settlement/respond`, { headers: auth('artist'), data: { approve: false, comment: '금액 확인 부탁드려요' } })).status()).toBe(200);

  const g = await openAs(browser, 'gallery');
  const errors = collectErrors(g.page);
  await g.page.goto('/mypage?tab=my-exhibitions');
  for (const [t, text] of [[tA, '까지 선정하세요 · 검토 대기'], [tB, '출품 자료를 아직 내지 않은 작가가 1명'], [tC, '정산에 이의를 남겼어요']] as const) {
    await expect(exhibitionCard(g.page, t), t).toContainText(text, { timeout: 15000 });
  }
  // A: 지원서 창을 열어 둔 채 목록으로 → B 를 열면 창이 없다
  await exhibitionCard(g.page, tA).getByRole('button', { name: tA }).first().click();
  await applicantRow(g.page.locator('[data-applicant-manager]'), 'Artist 1').getByRole('button').first().click();
  await expect(g.page.getByRole('dialog', { name: 'Artist 1 지원서' })).toBeVisible();
  await g.page.keyboard.press('Escape');
  await workspace(g.page).getByRole('button', { name: '내 공모', exact: true }).click();
  await exhibitionCard(g.page, tB).getByRole('button', { name: /안내 보내기/ }).click();
  const remind = g.page.getByRole('dialog').filter({ hasText: '출품 자료 제출 안내' });
  await expect(remind).toBeVisible({ timeout: 15000 });
  await expect(g.page.getByRole('dialog', { name: /지원서$/ })).toHaveCount(0);
  await remind.getByRole('button', { name: /1명에게 보내기/ }).click();
  await expect(g.page.locator('body')).toContainText(/보냈|안내/, { timeout: 10000 });
  // C: 이의 → 금액 그대로 다시 요청
  await workspace(g.page).getByRole('button', { name: '내 공모', exact: true }).click();
  await exhibitionCard(g.page, tC).getByRole('button', { name: /이의 보기/ }).click();
  await expect(workspaceTab(g.page, '정산')).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
  await taskButton(g.page, 'Artist 1 님에게 다시 요청').click();
  await expect(barText(g.page)).toContainText('기다리고 있어요', { timeout: 15000 });
  await workspace(g.page).getByRole('button', { name: '내 공모', exact: true }).click();
  // 휴대폰 목록의 '기다리는 중' 줄은 할 일 문장 없이 보조 글만(설계) — 이의 문장이 사라지고 '확인 요청 날짜'
  await expect(exhibitionCard(g.page, tC)).toContainText('확인 요청', { timeout: 15000 });
  await expect(exhibitionCard(g.page, tC)).not.toContainText('이의를 남겼어요');
  expect(errors).toEqual([]);
  await g.ctx.close();
  await api.dispose();
});

// ─────────────────────────────────────────────────────────────
test('★ JRN-07 전시 셋에 걸친 작가 — 지금 할 일 둘 · 처리하면 기다리는 중으로', async ({ browser }) => {
  test.setTimeout(180_000);
  const api = await pwRequest.newContext();
  const gid = await ownedGalleryId(api);
  const tX = newTitle('작가X'); const exX = await createExhibition(api, { title: tX, galleryId: gid });
  await applyAs(api, exX, tokenFor('artist'));                                     // 심사 중
  const tY = newTitle('작가Y'); const exY = await createExhibition(api, { title: tY, galleryId: gid });
  await decide(api, exY, await applyAs(api, exY, tokenFor('artist')), 'ACCEPTED');  // 출품 자료 미제출
  const tZ = newTitle('작가Z'); const exZ = await createExhibition(api, { title: tZ, galleryId: gid });
  await decide(api, exZ, await applyAs(api, exZ, tokenFor('artist')), 'ACCEPTED');
  await submitFull(api, exZ, tokenFor('artist'), '작품Z');
  expect((await lifecycle(api, exZ, { recruitmentClosed: true, confirmed: true, ended: true })).status()).toBe(200);
  await settleSales(api, exZ, [], [userIds().artist]);
  expect((await api.post(`${API}/operations/${exZ}/settlement/request`, { headers: auth('gallery') })).status()).toBe(200);

  const a = await openAs(browser, 'artist');
  await a.page.goto('/mypage?tab=applications');
  await a.page.getByRole('tab', { name: /진행 중/ }).click();
  await expect(exhibitionCard(a.page, tY)).toContainText('출품 자료를 제출해 주세요', { timeout: 15000 });
  await expect(exhibitionCard(a.page, tZ)).toContainText('정산 확인 요청이 왔어요');
  await a.page.getByRole('tab', { name: /심사 중/ }).click();
  // 심사 중 — 언제 결과가 나오는지(선정 마감일, 규칙 90). 미선정은 알림이 없어 '결과는 알림으로'라고 하지 않는다
  await expect(exhibitionCard(a.page, tX)).toContainText(/까지 선정 결과가 나와요/);

  await submitFull(api, exY, tokenFor('artist'), '작품Y');
  await a.page.getByRole('tab', { name: /진행 중/ }).click();
  await exhibitionCard(a.page, tZ).getByRole('button', { name: /확인하기/ }).click();
  const ws = a.page.locator(`[data-artist-workspace="${exZ}"]`);
  await ws.locator('[data-settle-bar]').getByRole('button', { name: '정산 확인', exact: true }).click();
  await expect(ws.locator('[data-settle-status]')).toContainText('확인했어요', { timeout: 10000 });
  await ws.getByRole('button', { name: '내 전시', exact: true }).click();
  await expect(exhibitionCard(a.page, tY)).toContainText('출품 자료 제출 완료', { timeout: 15000 });
  await expect(exhibitionCard(a.page, tZ)).toContainText('확인함 · 갤러리 마무리 대기');
  // 두 줄 모두 할 일 버튼이 없다(= '기다리는 중'). '지금 할 일' 머리는 다른 여정의 정산 요청 때문에 남을 수 있다 — 줄로 본다
  await expect(exhibitionCard(a.page, tY).getByRole('button', { name: /제출하기/ })).toHaveCount(0);
  await expect(exhibitionCard(a.page, tZ).getByRole('button', { name: /확인하기/ })).toHaveCount(0);
  await a.ctx.close();
  await api.dispose();
});

// ─────────────────────────────────────────────────────────────
test('★ JRN-08 실수하고 되돌리기 — 모집 마감은 되돌릴 수 없고(규칙 90), 확정·종료는 되돌리고 다시', async ({ browser }) => {
  test.setTimeout(180_000);
  const api = await pwRequest.newContext();
  const title = newTitle('되돌리기');
  const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api) });
  const app = await applyAs(api, exId, tokenFor('artist'));
  const g = await openAs(browser, 'gallery');
  await openOperation(g.page, exId);
  const undo = async (label: RegExp) => {
    await workspace(g.page).getByRole('button', { name: '더 보기' }).click();
    await g.page.getByRole('menuitem', { name: label }).click();
    await g.page.getByRole('dialog', { name: /되돌릴까요/ }).getByRole('button', { name: '되돌리기' }).click();
  };
  const openList = async () => (await (await api.get(`${API}/exhibitions?scope=open`)).json()) as any;
  const inOpen = async () => { const l = await openList(); return (l.exhibitions ?? l).some((e: any) => e.title === title); };

  await taskButton(g.page, '모집 마감').click();
  await g.page.getByRole('dialog', { name: '모집을 마감할까요?' }).getByRole('button', { name: '모집 마감', exact: true }).click();
  await expect(stripNow(g.page)).toContainText('전시 준비', { timeout: 10000 });
  expect(await inOpen()).toBe(false);
  // 모집 마감은 되돌릴 수 없다 — [⋯]에 그 항목이 없고 서버도 400
  await workspace(g.page).getByRole('button', { name: '더 보기' }).click();
  await expect(g.page.getByRole('menuitem', { name: /모집 마감/ })).toHaveCount(0);
  await g.page.keyboard.press('Escape');
  expect((await lifecycle(api, exId, { recruitmentClosed: false })).status()).toBe(400);
  expect(await inOpen(), '마감한 공고는 모집공고에 다시 뜨지 않는다').toBe(false);
  await decide(api, exId, app, 'ACCEPTED');   // 선정은 마감한 뒤에(규칙 90)

  expect((await lifecycle(api, exId, { confirmed: true })).status()).toBe(200);
  await g.page.reload();
  await undo(/'전시 확정' 되돌리기/);
  await expect.poll(async () => (await api.put(`${API}/operations/${exId}/me`, {
    headers: auth('artist'), data: { artworkList: [{ title: '고친 작품', size: '10x10', medium: '유채', year: '2026', price: '1', image: '' }], cv: { nameKo: 'A' }, note: { statement: 'n', sections: [] } },
  })).status(), { timeout: 10000 }).toBe(200);
  expect((await lifecycle(api, exId, { confirmed: true })).status()).toBe(200);
  expect(await notesOf(api, auth('artist'), title, 'EXHIBITION_CONFIRMED'), '다시 잠겼다는 새 소식').toHaveLength(2);

  expect((await lifecycle(api, exId, { ended: true })).status()).toBe(200);
  await g.page.reload();
  await expect(workspaceTab(g.page, '정산')).not.toHaveAttribute('aria-disabled', 'true', { timeout: 15000 });
  await undo(/'전시 종료' 되돌리기/);
  await expect(workspaceTab(g.page, '정산')).toHaveAttribute('aria-disabled', 'true', { timeout: 10000 });
  await g.ctx.close();
  await api.dispose();
});

// ─────────────────────────────────────────────────────────────
test('★ JRN-09 늦게 합류하는 작가 — 다 모인 뒤 코드로 한 명 → 할 일이 되돌아가고 그가 내면 다시 모두 모였어요', async ({ browser }) => {
  test.setTimeout(180_000);
  const api = await pwRequest.newContext();
  const [c] = await crowdUsers(api, 2).then((xs) => [xs[1]]);
  const title = newTitle('늦은합류');
  const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
  await acceptAll(api, exId, [tokenFor('artist'), tokenFor('artist2')]);
  expect((await lifecycle(api, exId, { recruitmentClosed: true })).status()).toBe(200);
  for (const role of ['artist', 'artist2'] as const) await submitFull(api, exId, tokenFor(role), `작품${role}`);
  const made = await api.post(`${API}/exhibitions/${exId}/join-code`, { headers: auth('gallery') });
  const code = (await made.json()).code as string;

  const g = await openAs(browser, 'gallery');
  await openOperation(g.page, exId);
  await expect(barText(g.page)).toContainText('출품 자료가 모두 모였어요', { timeout: 15000 });
  expect([200, 201]).toContain((await api.post(`${API}/exhibitions/join`, { headers: bearer(c!.token), data: { code } })).status());
  await g.page.reload();
  await expect(barText(g.page)).toContainText('출품 자료를 아직 내지 않은 작가가 1명', { timeout: 15000 });
  await expect(workspaceTab(g.page, '출품 자료')).toContainText('2/3');
  await submitFull(api, exId, c!.token, '작품무리');
  const sub = await notesOf(api, auth('gallery'), title, 'SUBMISSION_RECEIVED');
  expect(sub.filter((n) => !n.read)).toHaveLength(1);
  expect(sub.find((n) => !n.read)!.message).toContain('모두 모였어요 (3/3)');
  await g.page.reload();
  await expect(barText(g.page)).toContainText('출품 자료가 모두 모였어요', { timeout: 15000 });
  await g.ctx.close();
  await api.dispose();
});

// ─────────────────────────────────────────────────────────────
test('★ JRN-10 길어지는 정산 — 이의 두 번 · 금액 그대로 다시 요청 · 고쳐 다시 요청 · 무응답 3일 자동 확인 · 완료', async ({ browser }) => {
  test.setTimeout(240_000);
  const api = await pwRequest.newContext();
  const ids = userIds();
  const title = newTitle('긴정산');
  const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
  await acceptAll(api, exId, [tokenFor('artist'), tokenFor('artist2')]);
  for (const role of ['artist', 'artist2'] as const) await submitFull(api, exId, tokenFor(role), `작품${role}`);
  expect((await lifecycle(api, exId, { recruitmentClosed: true, confirmed: true, ended: true })).status()).toBe(200);
  await settleSales(api, exId, [{ uid: ids.artist, title: '작품artist', price: 1_000_000, method: 'CARD' }], [ids.artist, ids.artist2]);
  expect((await api.post(`${API}/operations/${exId}/settlement/request`, { headers: auth('gallery') })).status()).toBe(200);
  const respond = (role: 'artist' | 'artist2', data: any) => api.post(`${API}/operations/${exId}/settlement/respond`, { headers: auth(role), data });

  expect((await respond('artist', { approve: false, comment: '첫 이의' })).status()).toBe(200);
  const g = await openAs(browser, 'gallery');
  await openOperation(g.page, exId, '정산');
  await taskButton(g.page, 'Artist 1 님에게 다시 요청').click();       // 금액 그대로
  await expect(barText(g.page)).toContainText('기다리고 있어요', { timeout: 15000 });
  expect((await respond('artist', { approve: false, comment: '둘째 이의 — 120만 원이에요' })).status()).toBe(200);
  await g.page.reload();
  await expect(g.page.locator('[data-settle-issue]')).toContainText('둘째 이의');
  await g.page.getByLabel('작품artist 판매가', { exact: true }).fill('1200000');
  await taskButton(g.page, '저장하고 Artist 1 님에게 다시 요청').click();
  await expect(barText(g.page)).toContainText('기다리고 있어요', { timeout: 15000 });
  expect((await respond('artist', { approve: true })).status()).toBe(200);
  expect(await notesOf(api, auth('gallery'), title, 'SETTLEMENT_ALL_APPROVED'), '작가2 가 아직이다').toHaveLength(0);

  // 작가2 는 답하지 않는다 → 4일 전에 물은 것으로 → 갤러리가 정산을 열면 자동 확인 + 작가2 통보 + 모두 확인 알림
  // ⚠️ DB 세션 시간대가 Asia/Seoul — 열은 UTC 를 담으므로 UTC 로 계산해 넣는다(그냥 now() 면 9시간 어긋나 기한 안이 된다)
  await sql(`update "SettlementApproval" set "askedAt" = (now() at time zone 'utc') - interval '4 days' where "exhibitionId" = ${exId} and "artistUserId" = ${ids.artist2};`);
  await g.page.reload();
  await expect(barText(g.page)).toContainText('모두 정산을 확인했어요', { timeout: 15000 });
  expect((await notesOf(api, auth('artist2'), title, 'SETTLEMENT_SHARED')).filter((n) => n.message.includes('자동 수락'))).toHaveLength(1);
  expect(await notesOf(api, auth('gallery'), title, 'SETTLEMENT_ALL_APPROVED')).toHaveLength(1);
  const b = await openAs(browser, 'artist2');
  const bws = await openArtistExhibition(b.page, exId);
  await expect(bws.locator('[data-settle-status]')).toContainText('자동으로 확인됐어요', { timeout: 15000 });
  await taskButton(g.page, '정산 완료').click();
  await g.page.getByRole('dialog', { name: '정산을 완료할까요?' }).getByRole('button', { name: '정산 완료' }).click();
  await expect(workspaceTab(g.page, '요약')).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
  await Promise.all([g.ctx.close(), b.ctx.close()]);
  await api.dispose();
});

// ─────────────────────────────────────────────────────────────
test('JRN-11 나갔다 오는 사용자 — 새 창(저장소 비움)에서도 할 일·숫자 그대로 · 임시저장한 출품 자료가 남는다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const title = newTitle('다시옴');
  const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
  await acceptAll(api, exId, [tokenFor('artist'), tokenFor('artist2')]);
  expect((await lifecycle(api, exId, { recruitmentClosed: true })).status()).toBe(200);
  await submitFull(api, exId, tokenFor('artist'), '임시저장작품', { draft: true });

  for (let i = 0; i < 2; i++) {
    const g = await openAs(browser, 'gallery');
    await g.page.goto('/mypage?tab=my-exhibitions');
    await expect(exhibitionCard(g.page, title)).toContainText('출품 자료를 아직 내지 않은 작가가 2명', { timeout: 15000 });
    await g.ctx.close();
    const a = await openAs(browser, 'artist');
    const ws = await openArtistExhibition(a.page, exId);
    await expect(ws.locator('input[value="임시저장작품"]').first(), `${i + 1}번째 다시 옴 — 임시저장한 작품`).toBeVisible({ timeout: 15000 });
    await a.ctx.close();
  }
  await api.dispose();
});
