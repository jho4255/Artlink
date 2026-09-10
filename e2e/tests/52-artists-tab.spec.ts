import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor, ensurePublicArtworks, settle } from '../lib/helpers';

/**
 * [작가] 탭 · `/artists` (2026-09-10)
 *
 * 좌 작가 목록 / 우 작품 격자. 작가 이름을 누르면 그 작가의 공개 홈페이지로 간다.
 *
 * ⚠️ **"칸이 보이는가" 가 아니라 "눌러서 무슨 일이 나는가" 를 본다** — 이 저장소에서 반복된 실패가
 *    화면은 멀쩡한데 뒤가 안 이어져 있던 것이다(CLAUDE.md 32번, 하이라이트 onClick 누락).
 */
const API = 'http://localhost:4000/api';

test.beforeAll(async () => {
  // 작가 목록이 나오려면 **공개 작품**이 있어야 한다(그게 목록의 조건이다)
  const api = await pwRequest.newContext();
  for (const role of ['artist', 'artist2'] as const) {
    await ensurePublicArtworks(api, tokenFor(role), 4);
  }
  await api.dispose();
});

test('★ Navbar 에 [작가] 탭이 홈과 갤러리 **사이**에 있다', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await settle(page, 800);

  const labels = await page.locator('nav a').evaluateAll((els) =>
    els.map((e) => e.textContent?.trim()).filter(Boolean),
  );
  const i = (t: string) => labels.indexOf(t);
  expect(i('작가'), '[작가] 탭이 없다').toBeGreaterThan(-1);
  expect(i('작가')).toBe(i('홈') + 1);
  expect(i('갤러리')).toBe(i('작가') + 1);
  await ctx.close();
});

test('★ [작가] 탭을 누르면 /artists 로 간다 (홈 앵커가 아니다)', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('nav a').filter({ hasText: '작가' }).first().click();
  await page.waitForURL(/\/artists$/, { timeout: 10000 });
  await expect(page.getByRole('heading', { name: 'ArtWorks' })).toBeVisible({ timeout: 10000 });
  await ctx.close();
});

test('★ 작가 이름을 누르면 그 작가의 공개 홈페이지로 간다', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/artists');
  await settle(page, 1200);

  const first = page.locator('aside li a').first();
  await expect(first).toBeVisible({ timeout: 10000 });
  const name = (await first.textContent())!.trim();

  await first.click();
  await page.waitForURL(/\/portfolio\/\d+$/, { timeout: 10000 });
  // 그 작가의 페이지가 맞는가 — 주소만 바뀌고 아무나 나오면 안 된다
  await expect(page.locator('body')).toContainText(name, { timeout: 10000 });
  await ctx.close();
});

test('★ 작가 목록에 작품 수를 적지 않는다 (2026-09-10 사용자 요청)', async ({ browser }) => {
  // ⚠️ "숫자가 없는가" 로 보면 안 된다 — 작가 이름에 숫자가 들어갈 수 있다(시드의 'Artist 2').
  //    **이름과 정확히 같은가**로 본다. 뒤에 개수를 붙이면 그때 걸린다.
  const api = await pwRequest.newContext();
  const artists = await (await api.get(`${API}/explore/artists`)).json();
  await api.dispose();

  const { page, ctx } = await openAs(browser, 'artist');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/artists');
  await settle(page, 1200);

  const texts = await page.locator('aside li a').allTextContents();
  expect(texts.length).toBeGreaterThan(0);
  const known = new Set<string>(artists.map((a: any) => a.name));
  for (const t of texts) {
    expect(known, `작가 항목 "${t.trim()}" 이 이름과 다르다 — 뒤에 뭔가 붙었다`).toContain(t.trim());
  }
  await ctx.close();
});

/**
 * ⚠️ 새로고침이 **두 축**이다 — 한 버튼으로 합치면 작가를 훑던 중에 작품까지 통째로 바뀌어
 *    보던 자리를 잃는다. 서로 간섭하지 않는지 실제로 눌러 본다.
 */
test('★ [순서 바꾸기]는 작가만, [작품 새로고침]은 작품만 바꾼다', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/artists');
  await settle(page, 1200);

  const artistList = () => page.locator('aside li a').allTextContents();
  const gridSrc = () => page.locator('section img').evaluateAll((els) => els.slice(0, 4).map((e) => e.getAttribute('src')));

  const a1 = await artistList();
  const g1 = await gridSrc();
  test.skip(a1.length < 2, '작가가 2명 미만이면 순서를 확인할 수 없다');

  await page.getByRole('button', { name: /순서 바꾸기/ }).click();
  await settle(page, 1200);
  const a2 = await artistList();
  const g2 = await gridSrc();
  // 구성원은 그대로 (섞다가 사람이 빠지면 안 된다)
  expect([...a2].sort()).toEqual([...a1].sort());
  // 작품은 건드리지 않는다
  expect(g2, '작가 순서를 바꿨는데 작품까지 바뀌었다').toEqual(g1);

  await page.getByRole('button', { name: /작품 새로고침/ }).click();
  await settle(page, 1200);
  // 작가 목록은 건드리지 않는다
  expect(await artistList(), '작품을 새로고침했는데 작가 순서까지 바뀌었다').toEqual(a2);
  await ctx.close();
});

test('작품을 공개한 작가만 목록에 들어간다 (API)', async () => {
  const api = await pwRequest.newContext();
  const artists = await (await api.get(`${API}/explore/artists`)).json();
  expect(Array.isArray(artists)).toBe(true);
  for (const a of artists) {
    expect(a.workCount, `${a.name} 이 공개 작품 없이 목록에 있다`).toBeGreaterThan(0);
    expect(a.id).toBeGreaterThan(0);
  }
  await api.dispose();
});
