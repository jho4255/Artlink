import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import {
  openAs, statePath, tokenFor, ownedGalleryId, createExhibition, applyToExhibition, openArtistExhibition, applicantRow, openOperation, workspaceTab,
} from '../lib/helpers';

/**
 * 작가의 지원서 고치기 · 지원 취소 + 마감된 공고(2026-11-21 사용자 요청, CLAUDE.md 규칙 90).
 *  A 고치기 — [내 전시]의 그 공모 → [지원서 수정] → '고침'·'고친 곳 N' → [수정 저장] → 갤러리 줄 '수정됨'(알림 없음)
 *  B 취소 — 확인창(빨간 [지원 취소]) → 공고 상세로 · '지원을 취소했어요' · [지원하기]가 돌아온다 · 운영자 알림 한 통 · 다시 지원
 *  C 마감된 공고 — 심사 중인 채 버튼이 없고, 주소로 고치기 화면을 열어도 [내 전시]로 돌아간다 · 서버도 400
 */
const API = 'http://localhost:4000/api';
const auth = (role: Parameters<typeof tokenFor>[0]) => ({ Authorization: `Bearer ${tokenFor(role)}` });
const newTitle = (what: string) => `E2E 지원서 ${what} ${Date.now()}`;

async function applyAs(api: APIRequestContext, exId: number, role: 'artist' | 'artist2') {
  const r = await applyToExhibition(api, exId, tokenFor(role));
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()).id as number;
}
async function notesOf(api: APIRequestContext, role: Parameters<typeof tokenFor>[0], type: string, title: string) {
  const list = await (await api.get(`${API}/notifications`, { headers: auth(role) })).json();
  return ((list.notifications ?? list) as { type: string; message: string; linkUrl: string }[]).filter((n) => n.type === type && n.message.includes(title));
}

test('★ A 지원서 고치기(PC) — 고친 칸 표시 · 저장하면 [내 전시]로 · 갤러리 지원자 줄에 \'수정됨\' · 알림 없음', async ({ browser }) => {
  test.setTimeout(120_000);
  const api = await pwRequest.newContext();
  const title = newTitle('고치기');
  const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
  await applyAs(api, exId, 'artist');

  const ctx = await browser.newContext({ storageState: statePath('artist'), viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const ws = await openArtistExhibition(page, exId);
  const actions = ws.locator('[data-application-actions]');
  await expect(actions).toContainText('접수 마감');
  await actions.getByRole('link', { name: '지원서 수정' }).click();
  await expect(page).toHaveURL(new RegExp(`/exhibitions/${exId}/apply/edit`));
  const bio = page.locator('#apply-bio textarea');
  await expect(bio).toHaveValue('E2E 작가 약력');   // 낸 내용으로 채워 연다
  const bar = page.locator('[data-edit-bar]');
  await expect(bar).toContainText('고친 곳이 없어요');
  await expect(bar.getByRole('button', { name: '수정 저장' })).toBeDisabled();
  await bio.fill('고친 작가 약력');
  await expect(page.locator('#apply-bio')).toContainText('고침');
  await expect(bar).toContainText('고친 곳 1');
  await expect(bar).toContainText('작가 약력');
  // 되돌려 같아지면 고친 게 아니다
  await bio.fill('E2E 작가 약력');
  await expect(bar).toContainText('고친 곳이 없어요');
  await bio.fill('고친 작가 약력');
  await bar.getByRole('button', { name: '수정 저장' }).click();
  await expect(page).toHaveURL(new RegExp(`tab=applications&ex=${exId}`), { timeout: 10000 });
  await expect(page.locator('body')).toContainText('지원서를 고쳤어요.');
  await expect(page.locator(`[data-artist-workspace="${exId}"]`)).toContainText('고친 작가 약력');
  await expect(page.locator(`[data-artist-workspace="${exId}"]`)).toContainText(/제출 · .+ 수정/);
  expect(errors).toEqual([]);
  await ctx.close();

  // 갤러리 — 지원자 줄의 '수정됨', 고쳐도 알림은 없다
  expect(await notesOf(api, 'gallery', 'APPLICATION_CANCELED', title)).toHaveLength(0);
  const g = await openAs(browser, 'gallery');
  await openOperation(g.page, exId);
  await workspaceTab(g.page, '지원자').click();
  await expect(applicantRow(g.page.locator('[data-applicant-manager]'), 'Artist 1')).toContainText('수정됨', { timeout: 15000 });
  await g.ctx.close();
  await api.dispose();
});

test('★ B 지원 취소(휴대폰) — 확인창 → 공고 상세 · [지원하기]가 돌아온다 · 운영자 알림 한 통 · 다시 지원할 수 있다', async ({ browser }) => {
  test.setTimeout(120_000);
  const api = await pwRequest.newContext();
  const title = newTitle('취소');
  const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
  await applyAs(api, exId, 'artist2');

  const { page, ctx } = await openAs(browser, 'artist2');
  const ws = await openArtistExhibition(page, exId);
  await ws.locator('[data-application-actions]').getByRole('button', { name: '지원 취소' }).click();
  const dlg = page.getByRole('dialog', { name: '지원을 취소할까요?' });
  await expect(dlg).toContainText('갤러리 지원자 목록에서 빠지고, 낸 지원서는 지워져요.');
  // 그대로 두기 → 아무 일 없음
  await dlg.getByRole('button', { name: '그대로 두기' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await ws.locator('[data-application-actions]').getByRole('button', { name: '지원 취소' }).click();
  await page.getByRole('dialog', { name: '지원을 취소할까요?' }).getByRole('button', { name: '지원 취소' }).click();
  await expect(page).toHaveURL(new RegExp(`/exhibitions/${exId}$`), { timeout: 10000 });
  await expect(page.locator('body')).toContainText('지원을 취소했어요.');
  await expect(page.locator('[data-apply-bar]').getByRole('button', { name: /지원하기/ }).or(page.locator('[data-apply-bar]').getByRole('link', { name: /지원하기/ })).first()).toBeVisible({ timeout: 10000 });

  const cancelNotes = await notesOf(api, 'gallery', 'APPLICATION_CANCELED', title);
  expect(cancelNotes).toHaveLength(1);
  expect(cancelNotes[0]!.message).toBe(`"${title}"에서 Artist 2님이 지원을 취소했어요.`);
  expect(cancelNotes[0]!.linkUrl).toContain(String(exId));
  // 접수 마감 전이면 다시 지원
  await applyAs(api, exId, 'artist2');
  await ctx.close();
  await api.dispose();
});

test('C 마감된 공고 — 고치기·취소 버튼이 없고 고치기 주소는 [내 전시]로 · 서버도 400', async ({ browser }) => {
  test.setTimeout(120_000);
  const api = await pwRequest.newContext();
  const title = newTitle('마감');
  const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
  await applyAs(api, exId, 'artist');
  expect((await api.patch(`${API}/operations/${exId}/lifecycle`, { headers: auth('gallery'), data: { recruitmentClosed: true } })).status()).toBe(200);

  const { page, ctx } = await openAs(browser, 'artist');
  const ws = await openArtistExhibition(page, exId);
  // 마감은 아무도 미선정으로 바꾸지 않는다 — 갤러리가 선정할 차례라 '심사 중'이고, 지원서는 더 고칠 수 없다(규칙 90)
  await expect(ws).toContainText('모집이 마감되어 갤러리가 선정하고 있어요.');
  await expect(ws).toContainText(/까지 선정 결과가 나와요/);
  await expect(ws.locator('[data-application-actions]')).toHaveCount(0);
  await page.goto(`/exhibitions/${exId}/apply/edit`);
  await expect(page).toHaveURL(new RegExp(`tab=applications&ex=${exId}`), { timeout: 10000 });
  const put = await api.put(`${API}/exhibitions/${exId}/my-application`, { headers: auth('artist'), data: { biography: 'x', artworkImages: ['/uploads/e2e-artwork.jpg'] } });
  expect(put.status()).toBe(400);
  expect((await api.delete(`${API}/exhibitions/${exId}/my-application`, { headers: auth('artist') })).status()).toBe(400);
  // 마감했다고 결과 알림이 가지 않는다(결과는 갤러리가 정한 뒤에)
  expect(await notesOf(api, 'artist', 'APPLICATION_STATUS', title)).toHaveLength(0);
  await ctx.close();
  await api.dispose();
});
