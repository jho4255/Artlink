import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor, ownedGalleryId } from '../lib/helpers';

/**
 * 갤러리 소개·지난 활동 기록 — 서식 있는 글 (2026-09-28 사용자 요청 "기본적인 워드 형태는 갖춰야")
 *  - 도구 막대로 제목·굵게·목록·링크를 넣으면 **쓰는 모양 그대로** 공개 화면에 나온다
 *  - 서버·화면이 모두 거른다 — 스크립트·이벤트 속성이 공개 화면에 살아남지 않는다(저장형 XSS)
 *  - 이 기능 전의 평범한 글은 예전처럼 줄바꿈을 살려 나온다
 * 보이는지가 아니라 **실제로 어떤 요소가 그려졌는지·서버에 무엇이 저장됐는지**를 본다.
 */
const API = 'http://localhost:4000/api';
const DESKTOP = { width: 1280, height: 900 };
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let gid = 0;
test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  gid = await ownedGalleryId(api);
  await api.dispose();
});

test('★ 도구 막대로 제목·굵게·목록·링크를 넣고 저장하면, 방문자에게 그 서식 그대로 보인다', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'gallery');
  await page.setViewportSize(DESKTOP);
  await page.goto(`/galleries/${gid}?tab=about`);
  await page.getByRole('tabpanel').getByRole('button', { name: '수정' }).click();

  const editor = page.getByRole('textbox', { name: /공간의 성격/ });
  await expect(editor).toBeVisible({ timeout: 30000 });   // 편집기는 [수정]을 누를 때 받는다(lazy)
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');

  const bar = page.getByRole('toolbar', { name: '서식' });
  await bar.getByRole('button', { name: '제목', exact: true }).click();
  await page.keyboard.type('E2E 공간 소개');
  await page.keyboard.press('Enter');
  await page.keyboard.type('우리는 ');
  await bar.getByRole('button', { name: '굵게' }).click();
  await page.keyboard.type('회화');
  await bar.getByRole('button', { name: '굵게' }).click();
  await page.keyboard.type('를 다룹니다.');
  await page.keyboard.press('Enter');
  await bar.getByRole('button', { name: '글머리 목록' }).click();
  await page.keyboard.type('기획전');
  await page.keyboard.press('Enter');
  await page.keyboard.type('공모');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await bar.getByRole('button', { name: '링크' }).click();
  await page.getByRole('textbox', { name: '링크 주소' }).fill('artlink.cc');
  await page.getByRole('button', { name: '적용' }).click();
  await page.getByRole('tabpanel').getByRole('button', { name: '저장' }).click();

  // 서버에 서식이 저장됐고(허용 목록), 끝의 빈 문단은 없다
  const api = await pwRequest.newContext();
  await expect.poll(async () => (await (await api.get(`${API}/galleries/${gid}`)).json()).detailDesc as string, { timeout: 10000 })
    .toContain('<h2>E2E 공간 소개</h2>');
  const saved = (await (await api.get(`${API}/galleries/${gid}`)).json()).detailDesc as string;
  expect(saved).toContain('<strong>회화</strong>');
  expect(saved).toMatch(/<ul><li><p>기획전<\/p><\/li><li><p>공모<\/p><\/li><\/ul>/);
  expect(saved).toContain('href="https://artlink.cc"');
  expect(saved).not.toMatch(/<p><\/p>$/);
  await ctx.close();

  // 방문자 — 같은 서식이 요소로 그려진다
  const anon = await browser.newPage({ viewport: DESKTOP });
  await anon.goto(`/galleries/${gid}?tab=about`);
  const panel = anon.getByRole('tabpanel');
  await expect(panel.locator('h2', { hasText: 'E2E 공간 소개' })).toBeVisible({ timeout: 15000 });
  await expect(panel.locator('strong', { hasText: '회화' })).toBeVisible();
  await expect(panel.locator('ul > li')).toHaveCount(2);
  const link = panel.locator('a', { hasText: 'artlink.cc' });
  await expect(link).toHaveAttribute('href', 'https://artlink.cc');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  await anon.close();
  await api.dispose();
});

test('★ API 로 스크립트를 넣어도 공개 화면에서 실행되지 않는다 · 옛 평범한 글은 줄바꿈 그대로', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const bad = '<p>안전<img src=x onerror="window.__xss=1"><script>window.__xss=2</script><a href="javascript:window.__xss=3">x</a></p>';
  const r = await api.patch(`${API}/galleries/${gid}/detail`, { headers: auth(tokenFor('gallery')), data: { detailDesc: bad } });
  expect(r.status()).toBe(200);

  const anon = await browser.newPage({ viewport: DESKTOP });
  await anon.goto(`/galleries/${gid}?tab=about`);
  const panel = anon.getByRole('tabpanel');
  await expect(panel).toContainText('안전', { timeout: 15000 });
  await anon.waitForTimeout(500);
  expect(await anon.evaluate(() => (window as unknown as { __xss?: number }).__xss), '스크립트가 실행됐다').toBeUndefined();
  expect(await panel.locator('img, script, [onerror]').count()).toBe(0);
  const href = await panel.locator('a', { hasText: 'x' }).getAttribute('href').catch(() => null);
  expect(href ?? '').not.toMatch(/javascript:/i);

  // 옛 평범한 글 — HTML 로 읽지 않고 줄바꿈을 살린다(꺾쇠는 글자 그대로)
  await api.patch(`${API}/galleries/${gid}/detail`, { headers: auth(tokenFor('gallery')), data: { detailDesc: '첫 줄 <b>굵게 아님</b>\n둘째 줄' } });
  await anon.reload();
  await expect(panel).toContainText('<b>굵게 아님</b>', { timeout: 15000 });
  expect(await panel.locator('b').count()).toBe(0);
  const text = await panel.innerText();
  expect(text).toMatch(/첫 줄.*\n.*둘째 줄/);
  await anon.close();
  await api.dispose();
});

test('★ 지난 활동 기록 본문도 서식 있는 글 — 굵게·목록이 기록 줄에 그대로', async ({ browser }) => {
  const title = `E2E 서식 기록 ${Date.now()}`;
  const { page, ctx } = await openAs(browser, 'gallery');
  await page.setViewportSize(DESKTOP);
  await page.goto(`/galleries/${gid}?tab=history`);
  await page.getByRole('button', { name: /기록 추가/ }).click({ timeout: 15000 });
  await page.getByPlaceholder('전시·행사 이름 *').fill(title);

  const editor = page.getByRole('textbox', { name: /어떤 전시였는지/ });
  await expect(editor).toBeVisible({ timeout: 30000 });
  await editor.click();
  const bar = page.getByRole('toolbar', { name: '서식' });
  await bar.getByRole('button', { name: '굵게' }).click();
  await page.keyboard.type('관람객 1,200명');
  await bar.getByRole('button', { name: '굵게' }).click();
  await page.keyboard.press('Enter');
  await bar.getByRole('button', { name: '번호 목록' }).click();
  await page.keyboard.type('설치');
  await page.keyboard.press('Enter');
  await page.keyboard.type('오프닝');
  await page.getByRole('button', { name: '저장', exact: true }).click();

  const row = page.locator('div.border-b', { hasText: title });
  await expect(row.locator('strong', { hasText: '관람객 1,200명' })).toBeVisible({ timeout: 10000 });
  await expect(row.locator('ol > li')).toHaveCount(2);
  await ctx.close();
});
