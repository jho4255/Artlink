import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import {
  openAs, tokenFor, ownedGalleryId, createExhibition, applyToExhibition, closeRecruitment, statePath,
  openOperation, workspace, workspaceTab, taskButton,
} from '../lib/helpers';

/**
 * 비회원 작가 (2026-11-23, CLAUDE.md 규칙 91) — 공모 운영자가 가입하지 않은 작가를 넣고 출품 자료·판매·정산을 직접 채운다.
 * **눌러서 무슨 일이 나는가**를 본다.
 *
 *  A. (PC) [출품 자료] 맨 아래 [비회원 작가 추가] → 이름 → 그 작가의 입력 칸이 열린다 · '비회원' · '입력함' ·
 *     [지원자]·정원(수락 1/3)엔 없다 · 안내 보내기는 회원만(받는 사람에 없다) · 이름 바꾸기 · 빼기
 *  B. 참여 작가가 아무도 없을 때 — 빈 화면에서 바로 추가
 *  C. (휴대폰) 비회원만 있는 공모의 정산 — 확인 요청 없이 [정산 완료] · 머리 '확인 요청 없음' · 확인창이 한 줄로 말한다 · 요약에 홈페이지 링크 없음
 */
const API = 'http://localhost:4000/api';
const auth = (role: Parameters<typeof tokenFor>[0]) => ({ Authorization: `Bearer ${tokenFor(role)}` });
const stamp = () => String(Date.now()).slice(-6);

const FULL = (work: string, name: string) => ({
  artworkList: [{ title: work, size: '53x45.5', medium: '캔버스에 유채', year: '2026', price: '1200000', image: '' }],
  cv: { nameKo: name, solo: [{ year: '2025', content: '개인전' }] },
  note: { statement: 'E2E 작가노트', sections: [] },
  representativeIndex: 0,
});

async function addGuestApi(api: APIRequestContext, exId: number, name: string) {
  const r = await api.post(`${API}/operations/${exId}/guest-artists`, { headers: auth('gallery'), data: { name } });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()).user.id as number;
}

test.describe('A. [출품 자료]에서 비회원 작가를 넣는다 (PC)', () => {
  test('★ 추가 → 입력 칸 → 비회원 · 입력함 · 지원자·정원엔 없다 · 안내는 회원만 · 이름 바꾸기 · 빼기', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = `E2E비회원 A ${stamp()}`;
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 3 });
    const app = await applyToExhibition(api, exId, tokenFor('artist'));
    expect(app.status()).toBe(201);
    await closeRecruitment(api, exId);
    const appId = (await app.json()).id;
    expect((await api.patch(`${API}/exhibitions/${exId}/applications/${appId}`, { headers: auth('gallery'), data: { status: 'ACCEPTED' } })).status()).toBe(200);

    const ctx = await browser.newContext({ storageState: statePath('gallery'), viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openOperation(page, exId, '출품 자료');
    const ws = workspace(page);
    const name = `한지우${stamp()}`;

    // 표 맨 아래 [비회원 작가 추가] → 창 → 이름
    await ws.locator('[data-add-guest]').click();
    const dialog = page.getByRole('dialog', { name: '비회원 작가 추가' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '추가하고 자료 입력' }).click();
    await expect(dialog).toContainText('작가 이름을 적어 주세요.');   // 빈 이름은 보내지 않는다
    await dialog.getByLabel('작가 이름').fill(name);
    await dialog.getByRole('button', { name: '추가하고 자료 입력' }).click();
    await expect(dialog).toBeHidden();

    // 그 작가 줄 · '비회원' · 입력 칸이 바로 열려 있다(홈페이지에서 불러오기는 없다)
    const row = ws.locator('[data-submission-artist]').filter({ hasText: name });
    await expect(row).toContainText('비회원');
    await expect(row).toContainText('갤러리가 입력');
    await expect(row.getByRole('heading', { name: `${name} 출품 자료` })).toBeVisible();
    await expect(row.getByRole('button', { name: '홈페이지에서 불러오기' })).toHaveCount(0);

    // 자료를 채우면 '입력함'
    const list = await (await api.get(`${API}/operations/${exId}/submissions`, { headers: auth('gallery') })).json();
    const guestId = list.find((r: any) => r.user.name === name).user.id as number;
    expect((await api.put(`${API}/operations/${exId}/submissions/${guestId}`, { headers: auth('gallery'), data: FULL('봄의 문턱', name) })).status()).toBe(200);
    await page.reload();
    await expect(workspace(page)).toBeVisible({ timeout: 15000 });
    await workspaceTab(page, '출품 자료').click();
    await expect(ws.locator('[data-submission-artist]').filter({ hasText: name })).toContainText('입력함');
    // 진행 띠: 출품 자료 1/2(비회원 포함)
    await expect(ws).toContainText('출품 자료 1/2');

    // 할 일 — 안내 보내기는 회원 1명만, 받는 사람에 비회원이 없다
    await expect(page.locator('[data-task-bar]')).toContainText('출품 자료를 아직 내지 않은 작가가 1명 있어요');
    await taskButton(page, '1명에게 안내 보내기').click();
    const remind = page.getByRole('dialog', { name: '출품 자료 제출 안내' });
    await expect(remind).toBeVisible();
    await expect(remind).not.toContainText(name);
    await page.keyboard.press('Escape');

    // [지원자]엔 없다 · 정원은 회원만(수락 1/3) — 안 보는 탭도 숨겨 둘 뿐 떼지 않으므로 [지원자] 칸만 본다
    await workspaceTab(page, '지원자').click();
    const applicantsPanel = ws.locator('[role="tabpanel"]:not([hidden])');
    await expect(applicantsPanel).toContainText('수락 1/3');
    await expect(applicantsPanel).toContainText('Artist 1');
    await expect(applicantsPanel).not.toContainText(name);

    // 이름 바꾸기
    await workspaceTab(page, '출품 자료').click();
    const guestRow = ws.locator('[data-submission-artist]').filter({ hasText: name });
    await guestRow.getByRole('button', { name: /펼치기|접기/ }).first().click();
    const renamed = `${name}B`;
    await guestRow.getByRole('button', { name: '이름 바꾸기' }).click();
    const rn = page.getByRole('dialog', { name: '이름 바꾸기' });
    await rn.getByLabel('작가 이름').fill(renamed);
    await rn.getByRole('button', { name: '저장' }).click();
    await expect(ws.locator('[data-submission-artist]').filter({ hasText: renamed })).toBeVisible();

    // 빼기 — 확인창을 거쳐 사라진다
    const row2 = ws.locator('[data-submission-artist]').filter({ hasText: renamed });
    if (!(await row2.getByRole('button', { name: '이 작가 빼기' }).isVisible())) await row2.getByRole('button', { name: /펼치기/ }).first().click();
    await row2.getByRole('button', { name: '이 작가 빼기' }).click();
    const confirm = page.getByRole('dialog', { name: `${renamed} 작가를 뺄까요?` });
    await expect(confirm).toContainText('넣어 둔 출품 자료도 함께 지워져요.');
    await confirm.getByRole('button', { name: '빼기' }).click();
    await expect(ws.locator('[data-submission-artist]').filter({ hasText: renamed })).toHaveCount(0);
    expect(errors).toEqual([]);
    await ctx.close();
  });
});

test.describe('B. 참여 작가가 아무도 없을 때', () => {
  test('빈 화면에서 바로 추가 → 그 작가의 입력 칸', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = `E2E비회원 B ${stamp()}`;
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 2 });
    await closeRecruitment(api, exId);
    const { page, ctx } = await openAs(browser, 'gallery');   // 휴대폰
    await openOperation(page, exId, '출품 자료');
    const empty = workspace(page).locator('[data-submissions-empty]');
    await expect(empty).toContainText('아직 참여 작가가 없어요');
    await empty.locator('[data-add-guest]').click();
    const dialog = page.getByRole('dialog', { name: '비회원 작가 추가' });
    const name = `빈화면${stamp()}`;
    await dialog.getByLabel('작가 이름').fill(name);
    await dialog.getByRole('button', { name: '추가하고 자료 입력' }).click();
    const row = workspace(page).locator('[data-submission-artist]').filter({ hasText: name });
    await expect(row.getByRole('heading', { name: `${name} 출품 자료` })).toBeVisible({ timeout: 15000 });
    // '선정한 작가가 없어요' 라고 하지 않는다
    await expect(page.locator('[data-task-bar], [data-workspace-bar]').first()).not.toContainText('선정한 작가가 없어요');
    await ctx.close();
  });
});

test.describe('C. 비회원만 있는 공모의 정산 (휴대폰)', () => {
  test('★ 확인 요청 없이 [정산 완료] · 머리 "확인 요청 없음" · 확인창 한 줄 · 요약에 홈페이지 링크 없음', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = `E2E비회원 C ${stamp()}`;
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 2 });
    await closeRecruitment(api, exId);
    const name = `정산작가${stamp()}`;
    const gid = await addGuestApi(api, exId, name);
    expect((await api.put(`${API}/operations/${exId}/submissions/${gid}`, { headers: auth('gallery'), data: FULL('밤의 창', name) })).status()).toBe(200);
    for (const data of [{ confirmed: true }, { ended: true }]) {
      const r = await api.patch(`${API}/operations/${exId}/lifecycle`, { headers: auth('gallery'), data });
      expect(r.status(), await r.text()).toBe(200);
    }
    const put = await api.put(`${API}/operations/${exId}/settlement`, {
      headers: auth('gallery'),
      data: { sales: [{ artistUserId: gid, artworkIndex: 0, title: '밤의 창', soldPrice: 1700000, paymentMethod: 'CASH' }], ratios: [{ artistUserId: gid, galleryRatio: 30 }], cardFeeRate: 0 },
    });
    expect(put.status(), await put.text()).toBe(200);

    const { page, ctx } = await openAs(browser, 'gallery');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openOperation(page, exId, '정산');
    const head = page.locator('[data-settle-artist]').filter({ hasText: name });
    await expect(head).toContainText('비회원');
    await expect(head).toContainText('확인 요청 없음');
    // 확인 요청 없이 바로 [정산 완료](휴대폰은 아래 고정 줄 — 문장 대신 금액이 적힌다)
    await expect(taskButton(page, '정산 완료')).toBeVisible();
    await expect(page.getByRole('button', { name: /에게 확인 요청/ })).toHaveCount(0);

    await taskButton(page, '정산 완료').click();
    const confirm = page.getByRole('dialog', { name: '정산을 완료할까요?' });
    await expect(confirm).toContainText(`비회원 작가 1명(${name})은 확인 요청 없이 끝나요.`);
    await confirm.getByRole('button', { name: '정산 완료' }).click();
    await expect(workspaceTab(page, '요약')).toBeVisible({ timeout: 15000 });
    await workspaceTab(page, '요약').click();
    const sumRow = workspace(page).locator('li').filter({ hasText: name });
    await expect(sumRow).toContainText('비회원');
    await expect(sumRow.getByRole('link', { name: /홈페이지/ })).toHaveCount(0);
    expect(errors).toEqual([]);
    await ctx.close();
  });
});
