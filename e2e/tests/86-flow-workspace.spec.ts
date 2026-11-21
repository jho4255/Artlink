import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import {
  openAs, tokenFor, userIds, ownedGalleryId, createExhibition, applyToExhibition, exhibitionCard, workspace, workspaceTab, taskButton, openApplicantManager, applicantRow, openArtistExhibition, openOperation, closeRecruitment, acceptApplicant, closeApplicantSheet,
  pickSchedule, kstDay,
} from '../lib/helpers';

/**
 * 공모 흐름 개편 (2026-11-20, CLAUDE.md 규칙 88) — **눌러서 무슨 일이 나는가**를 본다.
 *
 *  A. 목록의 할 일 버튼 → 그 공모 화면 + 확인창(도착해서 묻는다) → 확정하면 작가에게 '전시 확정' 알림 · 다 모이면 갤러리에 '출품 자료' 알림
 *  B. 모집 마감·선정 마감일(규칙 90) — 접수 중엔 읽기만 → 확인창(되돌릴 수 없어요 · 이제 선정) → [수락하기]만(거절 없음) → [선정 마감일 변경] →
 *     선정 마감일이 지나면 남은 검토 대기 미선정(알림 없음) · 되돌릴 수 없다
 *  B2. [선정 마치기] — 목록 줄에서 눌러 오면 도착해서 묻는다 · 아무도 안 뽑았으면 빨간 [아무도 뽑지 않고 마치기] · [⋯] 메뉴엔 없다
 *  C. 지원자 심사 — 휴대폰은 한 장씩 창, 결정하면 다음 검토 대기로 넘어가고 없으면 닫힌다
 *  D. 정산 이의와 그 처리 — 작가 이의(창) → 갤러리 할 일 줄·작가 머리의 이의 글 → 고쳐 다시 요청 → 작가 확인 → '정산 확인' 알림 →
 *     [정산 완료] → [요약] 탭 · 작가에게 [갤러리 리뷰 쓰기](D6)
 *  E. 휴대폰 — 주 버튼은 하단 고정 줄(탭바 위)에서 눌린다
 */
const API = 'http://localhost:4000/api';
const auth = (role: Parameters<typeof tokenFor>[0]) => ({ Authorization: `Bearer ${tokenFor(role)}` });
const newTitle = (what: string) => `E2E공모화면 ${what} ${Date.now()}`;
/** 데모·테스트 DB 의 날짜를 옮긴다(선정 마감일을 지난 날로) — 접속정보는 DATABASE_URL 로만(38·56·88 스펙과 같은 규칙) */
async function sql(query: string) {
  const dbUrl = process.env.DATABASE_URL;
  expect(dbUrl, 'DATABASE_URL 을 명시해 돌릴 것').toBeTruthy();
  const { execFileSync } = await import('child_process');
  execFileSync('psql', [dbUrl!, '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf-8' });
}

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
}
/** 출품 자료 셋(작품·약력·작가노트)을 다 낸다 */
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
async function notes(api: APIRequestContext, role: Parameters<typeof tokenFor>[0]) {
  const list = await (await api.get(`${API}/notifications`, { headers: auth(role) })).json();
  return (list.notifications ?? list) as { type: string; message: string; linkUrl?: string }[];
}
async function statusOf(api: APIRequestContext, exId: number, userId: number) {
  const apps = await (await api.get(`${API}/exhibitions/${exId}/applications`, { headers: auth('gallery') })).json();
  return (apps.applications ?? apps).find((a: any) => a.userId === userId)?.status as string | undefined;
}

test.describe('A. 목록 → 공모 화면', () => {
  test('★ 할 일 버튼이 그 공모 화면으로 데려가 확인창을 연다 — 확정하면 작가에게 전시 확정 알림 · 하단 줄은 탭바 위에서 눌린다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('확정');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    await acceptVia(api, exId, 'artist');
    expect((await api.patch(`${API}/operations/${exId}/lifecycle`, { headers: auth('gallery'), data: { recruitmentClosed: true } })).status()).toBe(200);
    await submitFull(api, exId, 'artist');
    // 다 모인 순간 갤러리에 '출품 자료' 알림(공모마다 한 줄)
    const g0 = await notes(api, 'gallery');
    expect(g0.find((n) => n.type === 'SUBMISSION_RECEIVED' && n.message.includes(title))?.message).toContain('모두 모였어요');

    const { page, ctx } = await openAs(browser, 'gallery');   // 휴대폰 화면(기본)
    await page.goto('/mypage?tab=my-exhibitions');
    const row = exhibitionCard(page, title);
    await expect(row).toContainText('출품 자료가 모두 모였어요', { timeout: 15000 });
    // '지금 할 일' 묶음 안에 있다
    await expect(page.getByRole('heading', { level: 2, name: /^지금 할 일/ })).toBeVisible();

    await row.getByRole('button', { name: /전시 확정/ }).click();
    await expect(page).toHaveURL(new RegExp(`/mypage\\?tab=my-exhibitions&ex=${exId}`));
    const dialog = page.getByRole('dialog', { name: '전시를 확정할까요?' });
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await dialog.getByRole('button', { name: '취소' }).click();
    await expect(dialog).toHaveCount(0);

    // 휴대폰 주 버튼 자리 — 하단 탭바 위의 고정 줄. 그 자리를 누르면 그 줄이 잡힌다(탭바가 아니다)
    const bar = page.locator('[data-workspace-bar]');
    await expect(bar).toBeVisible();
    const hit = await bar.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { inside: !!top && el.contains(top), bottom: Math.round(r.bottom), vh: window.innerHeight };
    });
    expect(hit.inside, '하단 줄이 다른 것에 가려졌다').toBe(true);
    expect(hit.bottom).toBeLessThan(hit.vh);

    await taskButton(page, '전시 확정').click();
    await page.getByRole('dialog', { name: '전시를 확정할까요?' }).getByRole('button', { name: '전시 확정' }).click();
    await expect.poll(async () => (await (await api.get(`${API}/operations/${exId}/access`, { headers: auth('gallery') })).json()).confirmed, { timeout: 10000 }).toBe(true);
    await expect.poll(async () => (await notes(api, 'artist')).some((n) => n.type === 'EXHIBITION_CONFIRMED' && n.message.includes(title)), { timeout: 10000 }).toBe(true);
    const confirmed = (await notes(api, 'artist')).find((n) => n.type === 'EXHIBITION_CONFIRMED' && n.message.includes(title))!;
    expect(confirmed.linkUrl).toBe(`/mypage?tab=applications&ex=${exId}`);
    await api.dispose();
    await ctx.close();
  });
});

test.describe('B. 모집 마감 · 선정 마감일 — 되돌릴 수 없다 · [수락하기]만 · 선정 마감일이 지나면 남은 검토 대기는 미선정(알림 없음, 규칙 90)', () => {
  test('★ 접수 중엔 읽기만 → [모집 마감] 확인창 → [수락하기]만 → [선정 마감일 변경] → 그날이 지나면 미선정 · 다시 수락할 수 없다', async ({ browser }) => {
    test.setTimeout(150_000);
    const api = await pwRequest.newContext();
    const title = newTitle('마감');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    const app1 = await apply(api, exId, 'artist');
    await apply(api, exId, 'artist2');

    const { page, ctx } = await openAs(browser, 'gallery');
    await openOperation(page, exId);
    // 접수 중 — 지원이 들어와도 지금 할 일이 아니다(기다리는 중), 결정 줄은 이유 한 줄뿐
    await expect(page.locator('[data-task-bar]')).toContainText('지원을 받고 있어요 · 지원 2명', { timeout: 15000 });
    await workspaceTab(page, '지원자').click();
    const manager = page.locator('[data-applicant-manager]');
    await expect(manager.locator('li input[type="checkbox"]'), '접수 중엔 일괄 선택도 없다').toHaveCount(0);
    await applicantRow(manager, 'Artist 1').getByRole('button').first().click();
    await expect(page.locator('[data-decision-bar]').first()).toContainText('접수가 끝난 뒤에 수락할 수 있어요.');
    await expect(page.locator('[data-decision-bar]').first().getByRole('button', { name: '수락하기' })).toHaveCount(0);
    await closeApplicantSheet(page);
    const early = await api.patch(`${API}/exhibitions/${exId}/applications/${app1}`, { headers: auth('gallery'), data: { status: 'ACCEPTED' } });
    expect(early.status()).toBe(400);

    await taskButton(page, '모집 마감').click();
    const dialog = page.getByRole('dialog', { name: '모집을 마감할까요?' });
    await expect(dialog.locator('[data-confirm-warning]')).toHaveText('모집 마감은 되돌릴 수 없어요.');
    await expect(dialog).toContainText('작가는 낸 지원서를 더 고치거나 취소할 수 없어요.');
    await expect(dialog).toContainText('이제 지원자 2명 가운데 수락할 작가를 고를 수 있어요.');
    await expect(dialog).toContainText('이 지나면 수락하지 않은 지원자는 미선정이 돼요.');
    await expect(dialog.getByRole('checkbox'), '예전 D2 체크는 없다').toHaveCount(0);
    await expect(dialog, '작가 알림 이야기는 갤러리에게 하지 않는다').not.toContainText('알림');
    await dialog.getByRole('button', { name: '모집 마감', exact: true }).click();
    await expect(page.locator('body')).toContainText('모집을 마감했어요.', { timeout: 10000 });
    expect(await statusOf(api, exId, userIds().artist)).toBe('SUBMITTED');
    expect(await statusOf(api, exId, userIds().artist2)).toBe('SUBMITTED');

    // [⋯] 더 보기에 '모집 마감' 되돌리기도, [선정 마치기]도 없다 — 되돌리기는 서버도 400 · [선정 마치기]는 할 일 줄의 버튼이다(규칙 90)
    await workspace(page).getByRole('button', { name: '더 보기' }).first().click();
    await expect(page.getByRole('menuitem', { name: /모집 마감/ })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: /선정 마치기/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    const reopen = await api.patch(`${API}/operations/${exId}/lifecycle`, { headers: auth('gallery'), data: { recruitmentClosed: false } });
    expect(reopen.status()).toBe(400);

    // 이제 선정 — 선정 마감일까지. 버튼은 [수락하기]뿐(거절은 없다 — 서버도 400)
    await expect(page.locator('[data-task-bar]')).toContainText(/까지 선정하세요 · 검토 대기 2명/, { timeout: 15000 });
    await expect(page.locator('[data-task-bar]')).toContainText('그날이 지나면 수락하지 않은 지원자는 미선정이 돼요');
    // 다 골랐으면 그날을 기다리지 않고 끝낼 수 있다 — 할 일 줄의 [선정 마치기](선정 마감일이 있어도, 2026-11-21 사용자 결정)
    // (휴대폰은 할 일 줄 대신 아래 고정 줄에 버튼이 있다 — taskButton 이 둘 다 본다)
    await expect(taskButton(page, '선정 마치기')).toBeVisible();
    const noReject = await api.patch(`${API}/exhibitions/${exId}/applications/${app1}`, { headers: auth('gallery'), data: { status: 'REJECTED' } });
    expect(noReject.status()).toBe(400);
    await applicantRow(manager, 'Artist 1').getByRole('button').first().click();
    await expect(page.locator('[data-decision-bar]').first().getByRole('button', { name: '거절', exact: true })).toHaveCount(0);
    await closeApplicantSheet(page);
    await acceptApplicant(page, manager, 'Artist 2');
    await expect(page.locator('[data-task-bar]')).toContainText(/까지 선정하세요 · 검토 대기 1명/, { timeout: 15000 });

    // [선정 마감일 변경] — 지나기 전까지 고친다(휴대폰은 [관리] 메뉴 안)
    await manager.getByRole('button', { name: '관리' }).click();
    await page.getByRole('menuitem', { name: '선정 마감일 변경' }).click();
    const editor = page.locator('[data-selection-deadline-editor]');
    await expect(editor).toBeVisible();
    await pickSchedule(page, `#selection-deadline-${exId}`, [kstDay(37)]);
    await editor.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.locator('body')).toContainText('선정 마감일을', { timeout: 10000 });
    const detail = await (await api.get(`${API}/exhibitions/${exId}`, { headers: auth('gallery') })).json();
    expect(String(detail.selectionDeadline).slice(0, 10)).toBe(kstDay(37));

    // 선정 마감일이 지나면 — 남은 검토 대기(Artist 1)는 알림 없이 미선정, 그 뒤로는 수락할 수 없다
    await sql(`UPDATE "Exhibition" SET "selectionDeadline" = now() - interval '2 days' WHERE id = ${exId};`);
    await page.reload();
    await workspaceTab(page, '지원자').click();
    const row = applicantRow(manager, 'Artist 1');
    await expect(row).toContainText('미선정', { timeout: 15000 });
    await row.getByRole('button').first().click();
    await expect(page.locator('[data-closed-out]')).toContainText('까지 수락하지 않아 미선정이 됐어요.');
    await expect(page.locator('[data-decision-bar]').first()).toContainText('미선정 — 선정 마감일이 지나 바꿀 수 없어요.');
    await expect(page.locator('[data-decision-bar]').first().getByRole('button', { name: '수락하기' })).toHaveCount(0);
    await closeApplicantSheet(page);
    expect(await statusOf(api, exId, userIds().artist)).toBe('REJECTED');
    const again = await api.patch(`${API}/exhibitions/${exId}/applications/${app1}`, { headers: auth('gallery'), data: { status: 'ACCEPTED' } });
    expect(again.status(), '선정이 끝나면 되돌릴 수 없다').toBe(400);
    const n = (await notes(api, 'artist')).find((x) => x.type === 'APPLICATION_STATUS' && x.message.includes(title));
    expect(n, '미선정은 알리지 않는다(사용자 결정)').toBeUndefined();
    await api.dispose();
    await ctx.close();
  });
});

test.describe('B2. [선정 마치기] — 할 일 줄 · 목록 줄(규칙 90)', () => {
  test('★ 아무도 안 뽑았으면 빨간 [아무도 뽑지 않고 마치기] — 목록 줄에서 눌러 오면 도착해서 묻는다 · 끝내면 남은 지원자는 미선정(알림 없음)', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('마치기');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    await apply(api, exId, 'artist');
    await apply(api, exId, 'artist2');
    await closeRecruitment(api, exId);

    const { page, ctx } = await openAs(browser, 'gallery');
    await page.goto('/mypage?tab=my-exhibitions');
    const row = exhibitionCard(page, title);
    await expect(row).toContainText(/까지 선정하세요 · 검토 대기 2명/, { timeout: 15000 });
    // 목록 줄의 [선정 마치기] — 그 공모 화면으로 가서 확인창을 연다(도착해서 묻는다)
    await row.getByRole('button', { name: '선정 마치기' }).click();
    const dialog = page.getByRole('dialog', { name: '선정을 마칠까요?' });
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await expect(workspace(page)).toBeVisible();
    await expect(dialog.locator('[data-confirm-warning]')).toContainText('아직 아무도 수락하지 않았어요.');
    await expect(dialog).toContainText('지원자 2명이 모두 미선정이 돼요.');
    await expect(dialog).toContainText(/선정 마감일\(.+\)을 기다리지 않고 지금 끝내요\./);
    await dialog.getByRole('button', { name: '아무도 뽑지 않고 마치기' }).click();
    await expect(page.locator('body')).toContainText('선정을 마쳤어요. 검토 대기 2명은 미선정이 됐어요.', { timeout: 10000 });
    expect(await statusOf(api, exId, userIds().artist)).toBe('REJECTED');
    expect(await statusOf(api, exId, userIds().artist2)).toBe('REJECTED');
    // 미선정에는 알림이 없다
    for (const role of ['artist', 'artist2'] as const) {
      expect((await notes(api, role)).filter((n) => n.type === 'APPLICATION_STATUS' && n.message.includes(title))).toHaveLength(0);
    }
    // [⋯] 메뉴에는 없다 — 할 일 줄의 버튼이다
    await workspace(page).getByRole('button', { name: '더 보기' }).first().click();
    await expect(page.getByRole('menuitem', { name: /선정 마치기/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await api.dispose();
    await ctx.close();
  });
});

test.describe('C. 지원자 심사', () => {
  test('★ 휴대폰은 한 장씩 — 수락하면 다음 검토 대기로 넘어가고, 마지막을 수락하면 창이 닫힌다(거절 버튼은 없다)', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('심사');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 5 });
    await apply(api, exId, 'artist');
    await apply(api, exId, 'artist2');
    await closeRecruitment(api, exId);   // 심사는 모집을 마감한 뒤에(규칙 90)

    const { page, ctx } = await openAs(browser, 'gallery');
    const manager = await openApplicantManager(page, title);
    await applicantRow(manager, 'Artist 1').getByRole('button').first().click();
    const sheet1 = page.getByRole('dialog', { name: 'Artist 1 지원서' });
    await expect(sheet1).toBeVisible();
    await expect(sheet1).toContainText('검토 대기');
    await sheet1.locator('[data-decision-bar]').getByRole('button', { name: '수락하기', exact: true }).click();
    await page.getByRole('dialog', { name: /Artist 1 님을 수락할까요/ }).getByRole('button', { name: '수락하기', exact: true }).click();

    // 다음 검토 대기(Artist 2)로 넘어간다 — 접고 → 찾고 → 다시 펼치지 않는다
    const sheet2 = page.getByRole('dialog', { name: 'Artist 2 지원서' });
    await expect(sheet2).toBeVisible({ timeout: 10000 });
    await expect(sheet2.locator('[data-decision-bar]').getByRole('button', { name: '거절', exact: true })).toHaveCount(0);
    await sheet2.locator('[data-decision-bar]').getByRole('button', { name: '수락하기', exact: true }).click();
    await page.getByRole('dialog', { name: /Artist 2 님을 수락할까요/ }).getByRole('button', { name: '수락하기', exact: true }).click();
    // 남은 검토 대기가 없으면 창이 닫힌다
    await expect(page.getByRole('dialog', { name: /지원서$/ })).toHaveCount(0, { timeout: 10000 });
    await expect(applicantRow(manager, 'Artist 1')).toContainText('수락됨');
    await expect(applicantRow(manager, 'Artist 2')).toContainText('수락됨');

    expect(await statusOf(api, exId, userIds().artist)).toBe('ACCEPTED');
    expect(await statusOf(api, exId, userIds().artist2)).toBe('ACCEPTED');
    await api.dispose();
    await ctx.close();
  });
});

test.describe('D. 정산 — 이의와 그 처리', () => {
  test('★ 작가 이의 → 갤러리가 보고 고쳐 다시 요청 → 작가 확인 → [정산 완료] → 요약 · 리뷰 쓰기', async ({ browser }) => {
    test.setTimeout(120_000);
    const api = await pwRequest.newContext();
    const title = newTitle('정산');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    await acceptVia(api, exId, 'artist');
    await submitFull(api, exId, 'artist', '작품A');
    expect((await api.patch(`${API}/operations/${exId}/lifecycle`, { headers: auth('gallery'), data: { recruitmentClosed: true, confirmed: true, ended: true } })).status()).toBe(200);
    expect((await api.put(`${API}/operations/${exId}/settlement`, {
      headers: auth('gallery'),
      data: { sales: [{ artistUserId: userIds().artist, artworkIndex: 0, title: '작품A', soldPrice: 1200000 }], ratios: [{ artistUserId: userIds().artist, galleryRatio: 40 }] },
    })).status()).toBe(200);
    expect((await api.post(`${API}/operations/${exId}/settlement/request`, { headers: auth('gallery') })).status()).toBe(200);

    // 작가 — 정산 탭(내 정산액이 맨 위) → [이의 제기] → 창에 적어 [이의 보내기]
    const a = await openAs(browser, 'artist');
    let aws = await openArtistExhibition(a.page, exId);
    await expect(aws.locator('[data-my-settlement]')).toContainText('720,000', { timeout: 15000 });
    await aws.locator('[data-settle-bar]').getByRole('button', { name: '이의 제기' }).click();
    const issueDialog = a.page.getByRole('dialog', { name: '어떤 점이 다른가요?' });
    await issueDialog.getByRole('textbox').fill('작품A 판매가가 다릅니다. 150만 원에 팔렸어요.');
    await issueDialog.getByRole('button', { name: '이의 보내기' }).click();
    await expect(a.page.locator('body')).toContainText('이의를 갤러리에 보냈어요', { timeout: 10000 });
    await expect(aws.locator('[data-settle-status]')).toContainText('이의를 보냈어요');
    // 다시 보낼 땐 지난 글이 채워져 있다
    await aws.locator('[data-settle-bar]').getByRole('button', { name: '이의 다시 보내기' }).click();
    await expect(a.page.getByRole('dialog', { name: '어떤 점이 다른가요?' }).getByRole('textbox')).toHaveValue(/150만 원/);
    await a.page.keyboard.press('Escape');

    // 갤러리 — '정산 이의' 알림 → 정산 탭: 할 일 줄 · 작가 머리의 이의 글 → 금액을 고치면 [저장하고 … 다시 요청]
    const issueNote = (await notes(api, 'gallery')).find((n) => n.type === 'SETTLEMENT_ISSUE' && n.message.includes(title));
    expect(issueNote?.linkUrl).toBe(`/exhibitions/${exId}/operation/new?view=settlement`);
    const g = await openAs(browser, 'gallery');
    await g.page.goto(issueNote!.linkUrl!);
    await expect(workspaceTab(g.page, '정산')).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
    await expect(g.page.locator('[data-task-bar]')).toContainText('Artist 1 님이 정산에 이의를 남겼어요');
    await expect(g.page.locator('[data-settle-issue]')).toContainText('150만 원에 팔렸어요');
    await g.page.getByLabel('작품A 판매가', { exact: true }).fill('1500000');
    await taskButton(g.page, '저장하고 Artist 1 님에게 다시 요청').click();
    await expect.poll(async () => {
      const s = await (await api.get(`${API}/operations/${exId}/settlement`, { headers: auth('gallery') })).json();
      return s.artists.find((x: any) => x.user.id === userIds().artist)?.approval?.status;
    }, { timeout: 10000 }).toBe('PENDING');

    // 작가 — 다시 요청이 왔다 → [정산 확인]
    aws = await openArtistExhibition(a.page, exId);
    await expect(aws.locator('[data-my-settlement]')).toContainText('900,000', { timeout: 15000 });   // 150만 × 60%
    await aws.locator('[data-settle-bar]').getByRole('button', { name: '정산 확인', exact: true }).click();
    await expect(a.page.locator('body')).toContainText('정산을 확인했어요', { timeout: 10000 });

    // 갤러리 — '정산 확인' 알림(모두 확인) → [정산 완료] → 요약 탭
    await expect.poll(async () => (await notes(api, 'gallery')).some((n) => n.type === 'SETTLEMENT_ALL_APPROVED' && n.message.includes(title)), { timeout: 10000 }).toBe(true);
    await g.page.reload();
    await expect(g.page.locator('[data-task-bar]')).toContainText('모두 정산을 확인했어요', { timeout: 15000 });
    await taskButton(g.page, '정산 완료').click();
    await g.page.getByRole('dialog', { name: '정산을 완료할까요?' }).getByRole('button', { name: '정산 완료' }).click();
    await expect(workspaceTab(g.page, '요약')).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
    await expect(g.page.locator('[data-workspace-summary]')).toContainText('작가 지급');
    await expect(g.page.locator('[data-workspace-summary]')).toContainText('900,000원');
    await g.ctx.close();

    // 작가 — 정산 완료 뒤 [갤러리 리뷰 쓰기](D6)
    aws = await openArtistExhibition(a.page, exId);
    await expect(aws.locator('[data-settle-status]')).toContainText('정산이 끝났어요', { timeout: 15000 });
    await expect(aws.getByRole('link', { name: '갤러리 리뷰 쓰기' })).toHaveAttribute('href', /\/galleries\/\d+\?tab=reviews$/);
    await a.ctx.close();
    await api.dispose();
  });
});
