import { test, expect, request as pwRequest, type Page } from '@playwright/test';
import { openAs, tokenFor, userIds, settle, ensurePublicArtworks } from '../lib/helpers';

/**
 * 작가 홈페이지 탭 + 포트폴리오 PDF 펼쳐 보기 (2026-09-25).
 *
 *  · 이름 아래 [작품 · 작가노트 · 약력 · 포트폴리오 · 방명록] 탭 — 주소 `?tab=` 와 함께 간다(첫 탭은 쿼리 없음)
 *  · [포트폴리오] 탭은 첨부 PDF 를 **내려받지 않고 페이지 안에서** 한 쪽씩 그린다(pdf.js). HWP 등은 내려받기 카드
 *  · 방명록 알림은 `?tab=guestbook` 으로 온다 — 쿼리가 없으면 [작품] 탭이 열려 글이 안 보인다
 *
 * ⚠️ "탭이 보이는가"가 아니라 **눌러서 무엇이 바뀌는가**를 본다(50번 스펙이 '보이는지만' 봐서 고장을 못 잡았다).
 */
const API = 'http://localhost:4000/api';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function putPortfolio(patch: Record<string, unknown>) {
  const api = await pwRequest.newContext();
  const cur = await (await api.get(`${API}/portfolio`, { headers: auth(tokenFor('artist')) })).json();
  const r = await api.put(`${API}/portfolio`, { headers: auth(tokenFor('artist')), data: { ...cur, ...patch } });
  expect(r.ok(), `PUT /portfolio ${r.status()}`).toBe(true);
  await api.dispose();
}

/** 파일을 실제 업로드 라우트로 올려 주소를 받는다(확장자·MIME 검사를 그대로 탄다) */
async function uploadFile(name: string, mimeType: string, buffer: Buffer): Promise<string> {
  const api = await pwRequest.newContext();
  const r = await api.post(`${API}/upload/file`, { headers: auth(tokenFor('artist')), multipart: { file: { name, mimeType, buffer } } });
  expect(r.ok(), `upload ${r.status()} ${await r.text()}`).toBe(true);
  const { url } = await r.json();
  await api.dispose();
  return url;
}

const selectedTab = (page: Page) => page.locator('[role=tab][aria-selected=true]');

test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  await ensurePublicArtworks(api, tokenFor('artist'), 2);
  await api.dispose();
  await putPortfolio({
    statement: 'E2E 작가노트 — 탭으로 나뉜 홈페이지',
    biography: 'E2E 약력 줄글',
    career: { solo: [{ year: '2025', content: 'E2E 개인전' }] },
  });
});

test('★ 탭을 누르면 내용과 주소가 바뀌고, 새로고침해도 그 탭이다', async ({ page }) => {
  await page.goto(`/portfolio/${userIds().artist}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
  await expect(selectedTab(page)).toContainText('작품');
  // 약력은 [작품] 탭에 없다 — 탭으로 나뉘었다
  await expect(page.getByText('E2E 약력 줄글')).toHaveCount(0);

  await page.getByRole('tab', { name: /약력/ }).click();
  await expect(page).toHaveURL(/[?&]tab=cv/);
  await expect(page.getByText('E2E 약력 줄글')).toBeVisible();
  await expect(page.getByText('E2E 개인전')).toBeVisible();

  await page.reload();
  await expect(selectedTab(page)).toContainText('약력', { timeout: 15000 });
  await expect(page.getByText('E2E 약력 줄글')).toBeVisible();

  // 첫 탭으로 돌아오면 쿼리를 지운다(공유 주소를 깔끔하게)
  await page.getByRole('tab', { name: /작품/ }).click();
  await expect(page).not.toHaveURL(/tab=/);
});

test('★ 모르는·없는 탭 주소는 첫 탭으로 — 빈 화면이 아니다', async ({ page }) => {
  await putPortfolio({ portfolioFileUrl: null });
  await page.goto(`/portfolio/${userIds().artist}?tab=file`);   // 파일을 지운 뒤에도 옛 링크가 돈다
  await expect(selectedTab(page)).toContainText('작품', { timeout: 15000 });
  await page.goto(`/portfolio/${userIds().artist}?tab=%3Cscript%3E`);
  await expect(selectedTab(page)).toContainText('작품', { timeout: 15000 });
});

test('★ 첨부한 PDF 포트폴리오는 내려받지 않고 페이지 안에서 한 쪽씩 펼쳐진다', async ({ browser }) => {
  // 2쪽짜리 진짜 PDF 를 만든다(한글 포함) — 바이너리 픽스처를 저장소에 두지 않는다
  const maker = await browser.newPage();
  // (높이를 100vh 로 주면 인쇄 여백 때문에 첫 쪽이 넘쳐 3쪽이 된다 — 높이는 주지 않는다)
  await maker.setContent('<div style="font:40px sans-serif">첫 쪽 E2E</div><div style="break-before:page;font:40px sans-serif">둘째 쪽</div>');
  const pdf = await maker.pdf({ format: 'A4' });
  await maker.close();
  const url = await uploadFile('e2e-portfolio.pdf', 'application/pdf', pdf);
  expect(url).toMatch(/\.pdf$/);
  await putPortfolio({ portfolioFileUrl: url });

  const { page, ctx } = await openAs(browser, 'artist2');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/portfolio/${userIds().artist}`);
  await page.getByRole('tab', { name: /포트폴리오/ }).click({ timeout: 15000 });
  await expect(page).toHaveURL(/[?&]tab=file/);

  // 쪽 수만큼 자리가 생기고, 첫 쪽 캔버스에 실제로 그려진다
  await expect(page.locator('[data-pdf-page]')).toHaveCount(2, { timeout: 30000 });
  await expect(page.getByText(/PDF · 2쪽/)).toBeVisible();
  await expect.poll(() => page.locator('[data-pdf-page="1"] canvas').evaluate((c: HTMLCanvasElement) => c.width), { timeout: 30000 }).toBeGreaterThan(0);
  // 흰 판이 아니다 — 글자 픽셀(어두운 점)이 있다
  const inked = await page.locator('[data-pdf-page="1"] canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, Math.min(c.height, 400)).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! < 100 && d[i + 1]! < 100 && d[i + 2]! < 100) dark++;
    return dark;
  });
  expect(inked, 'PDF 쪽이 흰 판으로 그려졌다').toBeGreaterThan(50);
  // 원본은 새 창에서도 열 수 있다
  await expect(page.getByRole('link', { name: /새 창에서 열기/ })).toHaveAttribute('href', url);
  expect(errors).toEqual([]);

  // 모바일 폭에서 가로로 밀리지 않는다(쪽 테두리 2px 까지)
  await page.setViewportSize({ width: 375, height: 800 });
  await settle(page, 600);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `375px 에서 ${over}px 밀렸다`).toBeLessThanOrEqual(1);
  await ctx.close();
});

test('★ HWP 는 펼칠 수 없어 내려받기 카드로 나온다', async ({ page }) => {
  const url = await uploadFile('e2e-portfolio.hwp', 'application/octet-stream', Buffer.from('HWP e2e'));
  await putPortfolio({ portfolioFileUrl: url });
  await page.goto(`/portfolio/${userIds().artist}?tab=file`);
  await expect(page.getByText(/한글\(HWP\) 문서/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('link', { name: /내려받기/ })).toHaveAttribute('href', url);
  await expect(page.locator('[data-pdf-page]')).toHaveCount(0);
  await putPortfolio({ portfolioFileUrl: null });
});

test('★ 방명록 알림을 누르면 방명록 탭이 열린다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const body = `탭 알림 ${Date.now()}`;
  const w = await api.post(`${API}/guestbook/${userIds().artist}`, { headers: auth(tokenFor('artist2')), data: { body } });
  expect(w.ok()).toBe(true);
  const notis = await (await api.get(`${API}/notifications`, { headers: auth(tokenFor('artist')) })).json();
  const list = Array.isArray(notis) ? notis : (notis.notifications ?? notis.items ?? []);
  const n = list.find((x: { type: string }) => x.type === 'GUESTBOOK_NEW');
  expect(n, '방명록 알림이 없다').toBeTruthy();
  expect(n.linkUrl).toContain('?tab=guestbook');
  await api.dispose();

  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto(n.linkUrl);
  await expect(selectedTab(page)).toContainText('방명록', { timeout: 15000 });
  await expect(page.locator('#guestbook')).toContainText(body);
  await ctx.close();
});

test('★ 머리말에 [방명록] 버튼을 따로 두지 않는다 — 바로 아래 탭에 있다', async ({ page }) => {
  await page.goto(`/portfolio/${userIds().artist}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('tab', { name: /방명록/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '방명록' })).toHaveCount(0);
});

test('★ 편집 화면 미리보기는 지금 손대는 칸의 탭을 따라 연다', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/mypage?tab=homepage-edit');
  await expect(page.getByRole('button', { name: '저장' })).toBeVisible({ timeout: 15000 });
  await expect(selectedTab(page)).toContainText('작품');

  await page.getByPlaceholder(/나의 작업은 시간의 흐름/).click();
  await expect(selectedTab(page)).toContainText('작가노트');
  await page.getByPlaceholder('작가 소개·약력을 입력하세요.').click();
  await expect(selectedTab(page)).toContainText('약력');
  // 미리보기 안에서 탭을 직접 눌러도 된다
  await page.getByRole('tab', { name: /작품/ }).click();
  await expect(selectedTab(page)).toContainText('작품');
  await ctx.close();
});
