import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor, ownedGalleryId, createExhibition } from '../lib/helpers';

/**
 * 공모 소개 · 전시 소개 = 서식 있는 글 (2026-10-03, 사용자 요청 "갤러리 소개처럼 워드 기능")
 * 갤러리 소개(58번 스펙)와 같은 편집기 — **눌러서 서식을 넣고, 방문자에게 그 서식이 요소로 보이는가**를 본다.
 * 그리고 API 로 직접 넣은 위험한 HTML 이 저장에서 걸러지고 화면에서도 실행되지 않는가.
 */
const API = 'http://localhost:4000/api';
const DESKTOP = { width: 1280, height: 900 };
const auth = (role: Parameters<typeof tokenFor>[0]) => ({ Authorization: `Bearer ${tokenFor(role)}` });

/**
 * 상세의 소개 구역 — 제목 줄(h2/h3 + [수정])의 **부모**. 제목 줄만 잡으면 본문·편집기·[저장]이 밖에 있다.
 * 구조: <div>  <div class="flex …"><h2>공모 소개</h2><button>수정</button></div>  {본문 또는 편집기}  </div>
 */
const section = (page: import('@playwright/test').Page, heading: string) =>
  page.locator(`div:has(> div > :is(h2, h3):text-is("${heading}"))`).first();

test('★ 공모 상세 [수정] — 도구 막대로 제목·굵게를 넣고 저장하면 방문자에게 그 서식이 보인다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const exId = await createExhibition(api, { title: `서식 공모 ${Date.now()}`, galleryId: await ownedGalleryId(api), description: '옛 평범한 소개' });

  const { page, ctx } = await openAs(browser, 'gallery');
  await page.setViewportSize(DESKTOP);
  await page.goto(`/exhibitions/${exId}`);
  const sec = section(page, '공모 소개');
  await expect(sec).toContainText('옛 평범한 소개', { timeout: 15000 });
  await sec.getByRole('button', { name: '수정' }).click();

  const editor = page.getByRole('textbox', { name: '공모 소개' });
  await expect(editor).toBeVisible({ timeout: 30000 });       // 편집기는 [수정]을 누를 때 받는다(lazy)
  await expect(editor).toContainText('옛 평범한 소개');           // 옛 평범한 글은 문단으로 들어온다
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  const bar = page.getByRole('toolbar', { name: '서식' });
  await bar.getByRole('button', { name: '제목', exact: true }).click();
  await page.keyboard.type('E2E 모집 요강');
  await page.keyboard.press('Enter');
  await page.keyboard.type('회화 ');
  await bar.getByRole('button', { name: '굵게' }).click();
  await page.keyboard.type('신진');
  await bar.getByRole('button', { name: '굵게' }).click();
  await page.keyboard.type(' 작가를 모집합니다.');
  await sec.getByRole('button', { name: '저장' }).click();
  await expect(page.locator('body')).toContainText('공모 소개가 수정되었습니다', { timeout: 10000 });

  const saved = (await (await api.get(`${API}/exhibitions/${exId}`, { headers: auth('gallery') })).json()).description as string;
  expect(saved).toContain('<h2>E2E 모집 요강</h2>');
  expect(saved).toContain('<strong>신진</strong>');
  await ctx.close();

  // 방문자(비로그인) — 같은 서식이 요소로
  const anon = await browser.newPage({ viewport: DESKTOP });
  await anon.goto(`/exhibitions/${exId}`);
  const pub = section(anon, '공모 소개');
  await expect(pub.locator('h2', { hasText: 'E2E 모집 요강' })).toBeVisible({ timeout: 15000 });
  await expect(pub.locator('strong', { hasText: '신진' })).toBeVisible();
  await anon.close();
  await api.dispose();
});

test('★ API 로 넣은 위험한 HTML 은 저장에서 걸러지고, 화면에서도 실행되지 않는다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const exId = await createExhibition(api, { title: `서식 위험 ${Date.now()}`, galleryId: await ownedGalleryId(api) });
  const evil = '<p>안녕하세요<img src=x onerror="window.__xss=1"></p><script>window.__xss=2</script><p><a href="javascript:window.__xss=3">눌러 보세요</a></p>';
  const r = await api.patch(`${API}/exhibitions/${exId}/description`, { headers: auth('gallery'), data: { description: evil } });
  expect(r.status()).toBe(200);
  const saved = (await r.json()).description as string;
  expect(saved).not.toMatch(/<script|onerror|javascript:|<img/i);

  const anon = await browser.newPage({ viewport: DESKTOP });
  await anon.goto(`/exhibitions/${exId}`);
  const pub = section(anon, '공모 소개');
  await expect(pub).toContainText('안녕하세요', { timeout: 15000 });
  await expect(pub.locator('.rich-text img, .rich-text script')).toHaveCount(0);
  const link = pub.getByText('눌러 보세요');
  if (await link.count()) await link.click();
  expect(await anon.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await anon.close();
  await api.dispose();
});

test('★ 전시 상세 [수정] — 굵게를 넣고 저장하면 방문자에게 보인다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const galleryId = await ownedGalleryId(api);
  const start = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
  const show = await (await api.post(`${API}/shows`, {
    headers: auth('gallery'),
    data: { title: `서식 전시 ${Date.now()}`, description: '처음 소개', startDate: start, endDate: end, openingHours: '10:00-18:00', admissionFee: '무료', location: '1관', region: 'SEOUL', posterImage: '/uploads/poster.png', galleryId },
  })).json();
  expect(show.id, '전시 생성').toBeTruthy();
  await api.patch(`${API}/approvals/show/${show.id}`, { headers: auth('admin'), data: { status: 'APPROVED' } });

  const { page, ctx } = await openAs(browser, 'gallery');
  await page.setViewportSize(DESKTOP);
  await page.goto(`/shows/${show.id}`);
  const sec = section(page, '소개');
  await expect(sec).toContainText('처음 소개', { timeout: 15000 });
  await sec.getByRole('button', { name: '수정' }).click();
  const editor = page.getByRole('textbox', { name: '전시 소개' });
  await expect(editor).toBeVisible({ timeout: 30000 });
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type('빛과 ');
  const bar = page.getByRole('toolbar', { name: '서식' });
  await bar.getByRole('button', { name: '굵게' }).click();
  await page.keyboard.type('그림자');
  await sec.getByRole('button', { name: '저장' }).click();
  await expect(page.locator('body')).toContainText('소개가 수정되었습니다', { timeout: 10000 });
  await ctx.close();

  const anon = await browser.newPage({ viewport: DESKTOP });
  await anon.goto(`/shows/${show.id}`);
  await expect(section(anon, '소개').locator('strong', { hasText: '그림자' })).toBeVisible({ timeout: 15000 });
  await anon.close();
  await api.dispose();
});
