import { test, expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';
import { openAs, tokenFor, statePath, ownedGalleryId, createExhibition, exhibitionDates } from '../lib/helpers';

/**
 * 아트링크 주최 공모의 제목·소개 고치기 (2026-10-26 사용자 요청 — "admin 주최공모는 admin 이 공모 제목이나 내용 수정 가능하게").
 * **눌러서 무슨 일이 나는가**를 본다.
 *
 *  A. 관리자 [주최 공모] [제목·소개 수정] — 고치면 카드·공고 상세(비회원 화면)에 바로 · 고친 채 닫으면 버릴지 묻는다 (휴대폰·PC)
 *  B. 공고 상세 — 관리자는 제목 옆 [수정] → Enter 로 저장 · 위임 갤러리·갤러리 주최 공모에는 [제목 수정]이 없다(소개 [수정]은 위임 갤러리에도 있다)
 */
const API = 'http://localhost:4000/api';
const auth = (role: Parameters<typeof tokenFor>[0]) => ({ Authorization: `Bearer ${tokenFor(role)}` });
const newTitle = (what: string) => `E2E주최수정 ${what} ${Date.now()}`;

async function hosted(api: APIRequestContext, title: string, galleryIds: number[] = []) {
  const r = await api.post(`${API}/exhibitions/hosted`, {
    headers: auth('admin'),
    data: { ...exhibitionDates(), title, type: 'GROUP', capacity: 5, region: 'SEOUL', description: '<p>처음 소개</p>', galleryIds },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()).id as number;
}
const editModal = (page: Page) => page.getByRole('dialog', { name: '공모 제목·소개 수정' });

test('A. [주최 공모] [제목·소개 수정] — 카드·공고 상세에 바로 · 고친 채 닫으면 묻는다 (휴대폰·PC)', async ({ browser }) => {
  const api = await pwRequest.newContext();
  for (const viewport of [null, { width: 1280, height: 900 }]) {
    const title = newTitle(viewport ? 'PC' : '폰');
    const changed = `${title} 고침`;
    const exId = await hosted(api, title);
    const ctx = viewport
      ? await browser.newContext({ storageState: statePath('admin'), viewport })
      : await browser.newContext({ storageState: statePath('admin') });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/mypage?tab=hosted-exhibitions');
    const card = page.locator('article').filter({ hasText: title });
    await card.getByRole('button', { name: '제목·소개 수정' }).click();
    const modal = editModal(page);
    await expect(modal).toBeVisible();
    const titleBox = modal.getByRole('textbox', { name: /공모 제목/ });
    await expect(titleBox).toHaveValue(title);

    // 고친 채 [취소] → 버릴지 묻는다 → [계속 고치기] 면 창이 그대로 · [버리고 닫기] 면 아무것도 안 바뀐다
    await titleBox.fill(`${title} 버릴 것`);
    await modal.getByRole('button', { name: '취소', exact: true }).click();
    const ask = page.getByRole('dialog', { name: '고친 내용을 버릴까요?' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: '계속 고치기' }).click();
    await expect(modal).toBeVisible();
    await expect(titleBox).toHaveValue(`${title} 버릴 것`);
    await page.keyboard.press('Escape');
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: '버리고 닫기' }).click();
    await expect(modal).toBeHidden();
    await expect(card.locator('h4')).toHaveText(title);

    // 제목·소개를 고쳐 저장 → 카드에 바로(새로고침 없이) · 서버도 같은 답
    await card.getByRole('button', { name: '제목·소개 수정' }).click();
    await titleBox.fill(changed);
    const editor = modal.getByRole('textbox', { name: '공모 소개' });
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('바뀐 소개 문장');
    await modal.getByRole('button', { name: '저장', exact: true }).click();
    await expect(modal).toBeHidden();
    const changedCard = page.locator('article').filter({ hasText: changed });
    await expect(changedCard.locator('h4')).toHaveText(changed);
    const saved = await (await api.get(`${API}/exhibitions/${exId}`)).json();
    expect(saved.title).toBe(changed);
    expect(saved.description).toContain('바뀐 소개 문장');
    expect(saved.description).not.toContain('처음 소개');

    // 다시 열면 고친 값 · 그대로 [저장] 이면 아무것도 안 보내고 닫힌다
    await changedCard.getByRole('button', { name: '제목·소개 수정' }).click();
    await expect(titleBox).toHaveValue(changed);
    let sent = 0;
    page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes(`/exhibitions/${exId}/`)) sent++; });
    await modal.getByRole('button', { name: '저장', exact: true }).click();
    await expect(modal).toBeHidden();
    expect(sent).toBe(0);

    // 비회원이 보는 공고 상세
    const guest = await browser.newContext(viewport ? { viewport } : {});
    const gp = await guest.newPage();
    await gp.goto(`/exhibitions/${exId}`);
    await expect(gp.getByRole('heading', { level: 1 })).toHaveText(changed);
    await expect(gp.getByText('바뀐 소개 문장')).toBeVisible();
    await expect(gp.getByRole('button', { name: '제목 수정' })).toHaveCount(0);
    await guest.close();
    expect(errors).toEqual([]);
    await ctx.close();
  }
  await api.dispose();
});

test('B. 공고 상세 — 관리자는 제목 옆 [수정] → Enter · 위임 갤러리·갤러리 주최 공모에는 [제목 수정]이 없다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const galleryId = await ownedGalleryId(api);
  const title = newTitle('상세');
  const exId = await hosted(api, title, [galleryId]);

  const admin = await openAs(browser, 'admin');
  await admin.page.goto(`/exhibitions/${exId}`);
  const h1 = admin.page.getByRole('heading', { level: 1 });
  await expect(h1).toHaveText(title);
  await admin.page.getByRole('button', { name: '제목 수정' }).click();
  const box = admin.page.getByRole('textbox', { name: '공모 제목' });
  await expect(box).toHaveValue(title);
  // Esc 는 취소
  await box.fill('취소될 제목');
  await box.press('Escape');
  await expect(h1).toHaveText(title);
  await admin.page.getByRole('button', { name: '제목 수정' }).click();
  await box.fill(`${title} 상세에서`);
  await box.press('Enter');
  await expect(h1).toHaveText(`${title} 상세에서`);
  expect((await (await api.get(`${API}/exhibitions/${exId}`)).json()).title).toBe(`${title} 상세에서`);
  await admin.ctx.close();

  // 위임 갤러리 — 운영(소개 [수정])은 되지만 제목은 아트링크가 정한다
  const g = await openAs(browser, 'gallery');
  await g.page.goto(`/exhibitions/${exId}`);
  await expect(g.page.getByRole('heading', { level: 1 })).toHaveText(`${title} 상세에서`);
  await expect(g.page.getByRole('button', { name: '수정', exact: true })).toHaveCount(1);
  await expect(g.page.getByRole('button', { name: '제목 수정' })).toHaveCount(0);
  await g.ctx.close();

  // 갤러리가 올린 공모는 관리자에게도 [제목 수정]이 없다(수정 요청 → 승인 길)
  const galleryTitle = newTitle('갤러리공모');
  const galleryEx = await createExhibition(api, { title: galleryTitle, galleryId });
  const admin2 = await openAs(browser, 'admin');
  await admin2.page.goto(`/exhibitions/${galleryEx}`);
  await expect(admin2.page.getByRole('heading', { level: 1 })).toHaveText(galleryTitle);
  await expect(admin2.page.getByRole('button', { name: '제목 수정' })).toHaveCount(0);
  await admin2.ctx.close();
  await api.dispose();
});
