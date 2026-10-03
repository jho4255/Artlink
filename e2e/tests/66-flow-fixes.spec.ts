import { test, expect, request as pwRequest, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import {
  openAs, tokenFor, userIds, statePath, ownedGalleryId, createExhibition, applyToExhibition, ensurePublicArtworks,
  openApplicantManager, applicantRow, acceptApplicant, exhibitionCard, cardToggle, openArtistExhibition, solidPng,
} from '../lib/helpers';

/**
 * 공모 흐름 점검 후속 (2026-10-03, `scratchpad/flow-audit-2026-10-03.md`) — **눌러서 무슨 일이 나는가**를 본다.
 *
 *  A. 화면을 옮기면 맨 위에서 — 공모 상세 아래까지 내려 [지원하기] → 지원서가 맨 위에서 열린다
 *  B. 따라오는 [지원하기] — 휴대폰 첫 화면에서 그 자리를 누르면 그 버튼이 잡힌다(하단 탭바가 아니다)
 *  C. 지원서 경력 5항목 — 학력·수상이 갤러리 화면까지 간다
 *  D. 정산 입력을 적다 카드를 접으면 묻는다 — [취소]면 입력이 남는다
 *  E. 판매가 있으면 [이전 단계로] 가 없다(서버도 400)
 *  F. 삭제 요청 → 관리자 승인 → 지원 작가에게 알림
 *  G. 정원이 차면 갤러리 할 일이 '모집 마감', [모집 인원 변경] 으로 늘려 수락
 *  H. 전시가 끝나면 수락·거절이 잠긴다(서버도 400) · 초대 코드 줄도 감춘다
 *  I. 정산을 확인한 작가에게 '확인 필요' 가 남지 않는다
 *  K. 공모 시작 전 — 날짜만 보이고 지원은 막힌다(서버도 400)
 */
const API = 'http://localhost:4000/api';
const auth = (role: Parameters<typeof tokenFor>[0]) => ({ Authorization: `Bearer ${tokenFor(role)}` });
const newTitle = (what: string) => `E2E점검 ${what} ${Date.now()}`;
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

async function apply(api: APIRequestContext, exId: number, role: 'artist' | 'artist2') {
  const r = await applyToExhibition(api, exId, tokenFor(role));
  expect(r.status(), `${role} 지원 실패: ${await r.text()}`).toBe(201);
  return (await r.json()).id as number;
}
async function acceptVia(api: APIRequestContext, exId: number, role: 'artist' | 'artist2') {
  const appId = await apply(api, exId, role);
  const p = await api.patch(`${API}/exhibitions/${exId}/applications/${appId}`, { headers: auth('gallery'), data: { status: 'ACCEPTED' } });
  expect(p.status(), await p.text()).toBe(200);
  return appId;
}
/** 작가 한 명이 작품 한 점을 낸 채로 전시가 끝난 공모 */
async function endedWithSubmission(api: APIRequestContext, title: string, opts: { pendingArtist2?: boolean } = {}) {
  const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 5 });
  await acceptVia(api, exId, 'artist');
  const pending = opts.pendingArtist2 ? await apply(api, exId, 'artist2') : null;
  const sub = await api.put(`${API}/operations/${exId}/me`, {
    headers: auth('artist'),
    data: { artworkList: [{ title: '작품A', size: '50x50', medium: 'oil', year: '2025', price: '1000000', image: '' }], cv: null, note: null },
  });
  expect(sub.status(), await sub.text()).toBe(200);
  const lc = await api.patch(`${API}/operations/${exId}/lifecycle`, { headers: auth('gallery'), data: { recruitmentClosed: true, confirmed: true, ended: true } });
  expect(lc.status(), await lc.text()).toBe(200);
  return { exId, pending };
}
async function mobileAs(browser: Browser, role: 'artist2' | null) {
  const ctx = await browser.newContext({
    ...(role ? { storageState: statePath(role) } : {}),
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  });
  return { ctx, page: await ctx.newPage() };
}
/** 그 버튼의 가운데를 누르면 무엇이 잡히는가 — 덮고 있는 게 있으면 다른 글자가 나온다 */
async function hitText(page: Page, locator: ReturnType<Page['locator']>) {
  const box = await locator.boundingBox();
  expect(box, '버튼이 화면에 없다').not.toBeNull();
  return page.evaluate(([x, y]) => (document.elementFromPoint(x, y)?.closest('button,a') as HTMLElement | null)?.innerText ?? '', [box!.x + box!.width / 2, box!.y + box!.height / 2]);
}

test.describe('A·B. 공모 상세의 [지원하기]', () => {
  test('★ A. 상세 아래까지 내려 [지원하기] → 지원서가 맨 위에서 열린다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const exId = await createExhibition(api, { title: newTitle('맨위'), galleryId: await ownedGalleryId(api) });
    await api.dispose();

    const { page, ctx } = await openAs(browser, 'artist2');
    await page.goto(`/exhibitions/${exId}`);
    const bar = page.locator('[data-apply-bar]');
    await expect(bar).toBeVisible({ timeout: 15000 });
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' as ScrollBehavior }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);

    await bar.getByRole('button', { name: '지원하기' }).click();
    await page.waitForURL(new RegExp(`/exhibitions/${exId}/apply$`), { timeout: 10000 });
    // ⚠️ 주소는 바로 바뀌어도 화면은 조금 뒤에 바뀐다(전환 중엔 앞 화면이 남아 있다) — 지원서에만 있는 것을 기다린다.
    //    h1 으로 기다리면 공모 상세의 h1 이 잡힌다(실제로 그랬다)
    await expect(page.getByRole('heading', { level: 2, name: /작가 약력/ })).toBeVisible({ timeout: 10000 });
    // 예전엔 앞 화면의 스크롤(PC 1151px)을 그대로 들고 와 지원서가 경력 중간부터 열렸다
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await ctx.close();
  });

  test('★ B. 휴대폰 첫 화면 — 따라오는 [지원하기]·[로그인하고 지원하기] 를 누르면 그 버튼이 잡힌다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const exId = await createExhibition(api, { title: newTitle('따라오는'), galleryId: await ownedGalleryId(api) });
    await api.dispose();

    const artist = await mobileAs(browser, 'artist2');
    await artist.page.goto(`/exhibitions/${exId}`);
    const btn = artist.page.locator('[data-apply-bar]').getByRole('button', { name: '지원하기' });
    await expect(btn).toBeInViewport({ timeout: 15000 });
    expect(await artist.page.evaluate(() => window.scrollY), '첫 화면 그대로').toBe(0);
    expect(await hitText(artist.page, btn)).toContain('지원하기');
    // 본문에 같은 버튼이 또 있으면 어느 쪽을 눌러야 하는지 헷갈린다 — 하나뿐
    await expect(artist.page.getByRole('button', { name: '지원하기' })).toHaveCount(1);
    await artist.ctx.close();

    const guest = await mobileAs(browser, null);
    await guest.page.goto(`/exhibitions/${exId}`);
    const login = guest.page.locator('[data-apply-bar]').getByRole('button', { name: '로그인하고 지원하기' });
    await expect(login).toBeInViewport({ timeout: 15000 });
    expect(await hitText(guest.page, login)).toContain('로그인하고 지원하기');
    await login.click();
    await guest.page.waitForURL(/\/login/, { timeout: 10000 });
    await guest.ctx.close();
  });

  test('★ K. 공모 시작 전 — 날짜만 보이고 지원은 막힌다(지원서 주소도, 서버도)', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const exId = await createExhibition(api, { title: newTitle('시작전'), galleryId: await ownedGalleryId(api), dates: { deadlineStart: day(5) } });
    const r = await applyToExhibition(api, exId, tokenFor('artist2'));
    expect(r.status()).toBe(400);
    expect(await r.text()).toContain('부터 지원을 받아요');
    await api.dispose();

    const { page, ctx } = await openAs(browser, 'artist2');
    await page.goto(`/exhibitions/${exId}`);
    const bar = page.locator('[data-apply-bar]');
    await expect(bar).toContainText('부터 지원을 받아요', { timeout: 15000 });
    await expect(page.getByRole('button', { name: '지원하기' })).toHaveCount(0);
    await page.goto(`/exhibitions/${exId}/apply`);
    await page.waitForURL(new RegExp(`/exhibitions/${exId}$`), { timeout: 10000 });
    await ctx.close();
  });
});

test.describe('C. 지원서 경력 5항목', () => {
  test('★ 학력·수상을 적어 지원하면 갤러리 지원자 화면에 그대로 보인다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    await ensurePublicArtworks(api, tokenFor('artist'), 1);
    const title = newTitle('경력5');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api) });

    const { page, ctx } = await openAs(browser, 'artist');
    await page.goto(`/exhibitions/${exId}/apply`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    await page.getByPlaceholder('작가 소개·약력을 입력하세요.').fill('E2E 점검 약력');
    await page.getByPlaceholder(/○○대학교 서양화과 졸업/).fill('2001 E2E대학교 회화과 졸업');
    await page.getByPlaceholder(/○○미술대전 우수상/).fill('2020 E2E미술상 대상');
    if (await page.locator('#apply-images img').count() === 0) {
      await page.locator('#apply-images input[type="file"]').first().setInputFiles({ name: 'art.png', mimeType: 'image/png', buffer: solidPng(40, 40, [120, 90, 60]) });
      await expect(page.locator('#apply-images img').first()).toBeVisible({ timeout: 12000 });
    }
    await page.locator('label', { hasText: '위 약관에 동의합니다' }).getByRole('checkbox').check();
    await page.getByRole('button', { name: '지원하기' }).click();
    await page.waitForURL(new RegExp(`/exhibitions/${exId}$`), { timeout: 15000 });
    await ctx.close();

    // 서버에 다섯 항목이 그대로 — 예전엔 셋만 보내 학력·수상이 빠졌다
    const apps = await (await api.get(`${API}/exhibitions/${exId}/applications`, { headers: auth('gallery') })).json();
    const mine = (apps.applications ?? apps).find((a: any) => a.userId === userIds().artist);
    const career = typeof mine.career === 'string' ? JSON.parse(mine.career) : mine.career;
    expect(career.education.map((e: any) => e.content)).toContain('2001 E2E대학교 회화과 졸업');
    expect(career.award.map((e: any) => e.content)).toContain('2020 E2E미술상 대상');

    const g = await openAs(browser, 'gallery');
    const card = await openApplicantManager(g.page, title);
    const row = applicantRow(card, 'Artist 1');
    await row.locator('button[aria-expanded]').first().click();
    await expect(row).toContainText('2001 E2E대학교 회화과 졸업', { timeout: 10000 });
    await expect(row).toContainText('2020 E2E미술상 대상');
    await api.dispose();
    await g.ctx.close();
  });
});

test.describe('D·E. 정산 입력', () => {
  test('★ D. 판매가를 적다 카드를 접으면 묻는다 — [취소]면 입력이 남고, [확인]이면 닫힌다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('정산접기');
    await endedWithSubmission(api, title);
    await api.dispose();

    const { page, ctx } = await openAs(browser, 'gallery');
    await page.goto('/mypage?tab=my-exhibitions');
    const card = exhibitionCard(page, title);
    await cardToggle(card, 'operation').click();
    const sold = card.getByLabel('작품A 판매됨');
    await expect(sold).toBeVisible({ timeout: 15000 });
    await sold.check();
    await card.getByLabel('판매가').fill('500000');

    // [접기] → 확인창 → 취소: 입력이 그대로 남는다
    // ⚠️ 확인창은 처리기를 **먼저** 걸어 둘 것 — confirm 이 떠 있는 동안 click() 이 끝나지 않아, 클릭 뒤에 받으면 서로 기다린다
    const seen: string[] = [];
    page.once('dialog', (d) => { seen.push(d.message()); void d.dismiss(); });
    await card.getByRole('button', { name: /^접기/ }).click();
    await expect.poll(() => seen.length).toBe(1);
    expect(seen[0]).toContain('저장하지 않은');
    await expect(card.getByLabel('판매가')).toHaveValue('500,000');   // 칸이 쉼표를 넣어 보여 준다

    // 다시 [접기] → 확인 → 패널이 닫힌다
    page.once('dialog', (d) => { seen.push(d.message()); void d.accept(); });
    await card.getByRole('button', { name: /^접기/ }).click();
    await expect.poll(() => seen.length).toBe(2);
    await expect(card.getByLabel('판매가')).toHaveCount(0);
    await ctx.close();
  });

  test('★ D2. 작가 [내 전시] — 출품 자료를 적다 [닫기]를 누르면 묻는다(계획 중 추가로 찾은 같은 문제)', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const exId = await createExhibition(api, { title: newTitle('작가닫기'), galleryId: await ownedGalleryId(api) });
    await acceptVia(api, exId, 'artist');
    await api.dispose();

    const { page, ctx } = await openAs(browser, 'artist');
    const card = await openArtistExhibition(page, exId);
    await card.getByRole('button', { name: '작품 추가' }).click();
    const name = card.locator('[id$="-art-0"]').locator('label').filter({ hasText: '작품명' }).locator('input').first();
    await name.fill('닫기 전 작품');

    const seen: string[] = [];
    page.once('dialog', (d) => { seen.push(d.message()); void d.dismiss(); });
    await card.getByRole('button', { name: '닫기', exact: true }).click();
    await expect.poll(() => seen.length).toBe(1);
    expect(seen[0]).toContain('저장하지 않은');
    await expect(name).toHaveValue('닫기 전 작품');
    await ctx.close();
  });

  test('★ E. 판매가 있으면 전시 종료를 되돌리지 못한다 — [이전 단계로] 대신 이유 한 줄, 서버도 400', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const { exId } = await endedWithSubmission(api, newTitle('되돌리기'));
    const s = await api.put(`${API}/operations/${exId}/settlement`, {
      headers: auth('gallery'),
      data: { sales: [{ artistUserId: userIds().artist, artworkIndex: 0, title: '작품A', soldPrice: 700000 }], ratios: [{ artistUserId: userIds().artist, galleryRatio: 30 }] },
    });
    expect(s.status(), await s.text()).toBe(200);
    // 판매가 0원·없는 작품 번호는 저장되지 않는다(예전엔 0원으로 확인 요청이 나갔다)
    const zero = await api.put(`${API}/operations/${exId}/settlement`, {
      headers: auth('gallery'), data: { sales: [{ artistUserId: userIds().artist, artworkIndex: 0, title: '작품A', soldPrice: 0 }] },
    });
    expect(zero.status()).toBe(400);
    const ghost = await api.put(`${API}/operations/${exId}/settlement`, {
      headers: auth('gallery'), data: { sales: [{ artistUserId: userIds().artist, artworkIndex: 99, title: '없는 작품', soldPrice: 1000 }] },
    });
    expect(ghost.status()).toBe(400);

    const back = await api.patch(`${API}/operations/${exId}/lifecycle`, { headers: auth('gallery'), data: { ended: false } });
    expect(back.status()).toBe(400);
    expect(await back.text()).toContain('되돌릴 수 없습니다');
    await api.dispose();

    const { page, ctx } = await openAs(browser, 'gallery');
    await page.goto(`/exhibitions/${exId}/operation/new`);
    await expect(page.locator('[data-undo-blocked]')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /이전 단계로/ })).toHaveCount(0);
    // 운영 화면에 <main> 이 하나(Layout 의 것)뿐
    await expect(page.locator('main')).toHaveCount(1);
    await ctx.close();
  });
});

test.describe('F. 삭제 요청', () => {
  test('★ 수락한 작가가 있는 공모 → 삭제 요청 → 관리자 승인 → 지원한 작가에게 알림', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('삭제요청');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api) });
    await acceptVia(api, exId, 'artist2');
    // 갤러리가 직접 지우면 400 — 무엇 때문인지 + 삭제 요청 안내
    const direct = await api.delete(`${API}/exhibitions/${exId}`, { headers: auth('gallery') });
    expect(direct.status()).toBe(400);
    expect(await direct.text()).toContain('삭제 요청');

    const g = await openAs(browser, 'gallery');
    await g.page.goto('/mypage?tab=my-exhibitions');
    const card = exhibitionCard(g.page, title);
    await card.getByRole('button', { name: '공모 삭제' }).click();
    const dlg = g.page.getByRole('dialog', { name: '관리자에게 삭제 요청' });
    await expect(dlg).toContainText('수락한 작가가 1명', { timeout: 10000 });
    await expect(dlg.getByRole('button', { name: '삭제 요청 보내기' })).toBeDisabled();
    await dlg.getByRole('textbox').fill('전시가 취소되어 공고를 내려야 해요.');
    await dlg.getByRole('button', { name: '삭제 요청 보내기' }).click();
    await expect(card.locator('[data-delete-request="pending"]')).toBeVisible({ timeout: 10000 });
    await expect(card.getByRole('button', { name: '공모 삭제' })).toHaveCount(0);
    await g.ctx.close();

    const a = await openAs(browser, 'admin');
    await a.page.goto('/mypage?tab=approvals');
    const item = a.page.locator('div.rounded-xl').filter({ has: a.page.getByRole('heading', { level: 4, name: title }) }).last();
    await expect(item).toContainText('공모 삭제 요청', { timeout: 15000 });
    await expect(item).toContainText('전시가 취소되어');
    await item.getByRole('button', { name: '삭제 승인' }).click();
    const confirm = a.page.getByRole('dialog', { name: '공모를 삭제할까요?' });
    await confirm.getByRole('button', { name: '삭제 승인' }).click();
    await expect.poll(async () => (await api.get(`${API}/exhibitions/${exId}`, { headers: auth('admin') })).status(), { timeout: 10000 }).toBe(404);
    await a.ctx.close();

    const notes = await (await api.get(`${API}/notifications`, { headers: auth('artist2') })).json();
    const list = notes.notifications ?? notes;
    expect(list.some((n: any) => n.type === 'EXHIBITION_DELETED' && String(n.message).includes(title))).toBe(true);
    await api.dispose();
  });
});

test.describe('G·H. 지원자 관리', () => {
  test('★ G. 정원이 차면 할 일이 모집 마감 — [모집 인원 변경]으로 늘려 수락한다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('정원');
    const exId = await createExhibition(api, { title, galleryId: await ownedGalleryId(api), capacity: 1 });
    await acceptVia(api, exId, 'artist');
    await apply(api, exId, 'artist2');

    const { page, ctx } = await openAs(browser, 'gallery');
    await page.goto('/mypage?tab=my-exhibitions');
    const card = exhibitionCard(page, title);
    // 예전엔 수락 1/1 인데도 '지원자 1명이 검토를 기다리고 있어요' — 눌러 보고 나서야 정원 안내를 받았다
    await expect(card).toContainText('정원(1명)이 찼어요', { timeout: 15000 });
    await cardToggle(card, 'applicants').click();
    await expect(card.getByText('정원이 찼어요').first()).toBeVisible({ timeout: 10000 });

    await card.getByRole('button', { name: '모집 인원 변경' }).click();
    const editor = card.locator('[data-capacity-editor]');
    await editor.locator('input').fill('2');
    await editor.getByRole('button', { name: '저장' }).click();
    await expect(page.locator('body')).toContainText('모집 인원을 2명으로 바꿨어요', { timeout: 10000 });
    await expect(card.getByText(/수락 1\/2/).first()).toBeVisible({ timeout: 10000 });
    await acceptApplicant(page, card, 'Artist 2');

    // 수락한 수보다 적게·0 은 서버가 막는다
    expect((await api.patch(`${API}/exhibitions/${exId}/capacity`, { headers: auth('gallery'), data: { capacity: 1 } })).status()).toBe(400);
    expect((await api.patch(`${API}/exhibitions/${exId}/capacity`, { headers: auth('gallery'), data: { capacity: 0 } })).status()).toBe(400);
    await api.dispose();
    await ctx.close();
  });

  test('★ H. 전시가 끝나면 수락·거절이 잠긴다 — 체크박스·버튼 없음, 서버도 400, 초대 코드 줄도 없다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const title = newTitle('종료잠금');
    const { exId, pending } = await endedWithSubmission(api, title, { pendingArtist2: true });
    const r = await api.patch(`${API}/exhibitions/${exId}/applications/${pending}`, { headers: auth('gallery'), data: { status: 'ACCEPTED' } });
    expect(r.status()).toBe(400);
    expect(await r.text()).toContain('전시가 종료된 공모는');
    await api.dispose();

    const { page, ctx } = await openAs(browser, 'gallery');
    const card = await openApplicantManager(page, title);
    await expect(card.locator('[data-decisions-locked]')).toBeVisible();
    await expect(card.locator('li input[type="checkbox"]')).toHaveCount(0);
    const row = applicantRow(card, 'Artist 2');
    await row.locator('button[aria-expanded]').first().click();
    await expect(row).toContainText('결정하지 않은 채 전시가 끝났어요');
    await expect(row.getByRole('button', { name: '수락하기' })).toHaveCount(0);
    await expect(card.getByText('이미 선정한 작가를 초대 코드로 데려오기')).toHaveCount(0);
    await ctx.close();
  });
});

test.describe('I. 작가 [내 전시] — 정산에 답한 뒤', () => {
  test('★ 정산을 확인하면 카드에 \'확인 필요\'·\'정산 확인을 요청했어요\' 가 남지 않는다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const { exId } = await endedWithSubmission(api, newTitle('정산답'));
    await api.put(`${API}/operations/${exId}/settlement`, {
      headers: auth('gallery'),
      data: { sales: [{ artistUserId: userIds().artist, artworkIndex: 0, title: '작품A', soldPrice: 700000 }], ratios: [{ artistUserId: userIds().artist, galleryRatio: 30 }] },
    });
    expect((await api.post(`${API}/operations/${exId}/settlement/request`, { headers: auth('gallery') })).status()).toBe(200);

    const { page, ctx } = await openAs(browser, 'artist');
    let card = await openArtistExhibition(page, exId);
    await expect(card).toContainText('정산 확인을 요청했어요', { timeout: 15000 });

    const ok = await api.post(`${API}/operations/${exId}/settlement/respond`, { headers: auth('artist'), data: { approve: true } });
    expect(ok.status(), await ok.text()).toBe(200);
    card = await openArtistExhibition(page, exId);
    await expect(card).toContainText('확인했어요', { timeout: 15000 });
    await expect(card).not.toContainText('정산 확인을 요청했어요');
    await expect(card).not.toContainText('확인 필요');
    await api.dispose();
    await ctx.close();
  });
});
