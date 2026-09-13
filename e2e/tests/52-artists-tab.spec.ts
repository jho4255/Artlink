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

/**
 * 초성 칸을 전부 편다. **작가 수에 따라 처음 상태가 갈리므로**(적으면 펼침·많으면 접힘)
 * 이름 링크를 보려는 테스트는 반드시 이걸 먼저 부른다.
 */
async function expandAll(page: import('@playwright/test').Page) {
  const btn = page.getByRole('button', { name: '모두 펼치기' });
  if (await btn.count()) {
    await btn.click();
    await settle(page, 500);
  }
}

/**
 * 한글 이름 작가를 심는다. **시드 작가는 둘 다 'Artist N' 이라 `A–Z` 한 칸에 몰린다** —
 * 그대로 두면 칸이 하나뿐이라 ㄱ/ㄴ/ㄷ 색인을 한 번도 검증하지 못한다.
 */
async function seedKoreanArtists(api: import('@playwright/test').APIRequestContext) {
  for (const [i, name] of ['강민서', '한서아'].entries()) {
    const email = `idx-artist-${i}@e2e.test`;
    const pw = 'IdxArtist1!';
    let r = await api.post(`${API}/auth/signup`, {
      data: { name, email, password: pw, role: 'ARTIST', agreeTerms: true, agreePrivacy: true },
    });
    if (r.status() === 409) r = await api.post(`${API}/auth/login`, { data: { email, password: pw } });
    if (!r.ok()) throw new Error(`색인 검증용 작가 ${name} 준비 실패 ${r.status()}: ${await r.text()}`);
    await ensurePublicArtworks(api, (await r.json()).token, 2);
  }
}

test.beforeAll(async () => {
  // 작가 목록이 나오려면 **공개 작품**이 있어야 한다(그게 목록의 조건이다)
  const api = await pwRequest.newContext();
  for (const role of ['artist', 'artist2'] as const) {
    await ensurePublicArtworks(api, tokenFor(role), 4);
  }
  await seedKoreanArtists(api);
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
  await expandAll(page);

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
  await expandAll(page);

  const texts = await page.locator('aside li a').allTextContents();
  expect(texts.length).toBeGreaterThan(0);
  const known = new Set<string>(artists.map((a: any) => a.name));
  for (const t of texts) {
    expect(known, `작가 항목 "${t.trim()}" 이 이름과 다르다 — 뒤에 뭔가 붙었다`).toContain(t.trim());
  }
  await ctx.close();
});

/**
 * ㄱ/ㄴ/ㄷ 펼쳐보기 (2026-09-13) — 랜덤 정렬과 [순서 바꾸기]를 걷어내고 가나다순 색인으로 되돌렸다.
 *
 * ⚠️ **"칸이 보이는가" 가 아니라 "눌러서 이름이 나오는가" 를 본다.** 접기만 되고 펴지지 않아도
 *    화면은 멀쩡해 보인다(칸 머리말은 그대로 있다).
 */
test('★ 초성 칸을 누르면 그 칸의 작가가 펼쳐진다', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/artists');
  await settle(page, 1200);

  const first = page.locator('aside button[aria-expanded]').first();
  await expect(first).toBeVisible({ timeout: 10000 });
  const label = (await first.locator('span').first().textContent())!.trim();
  const shown = page.locator(`aside ul[id="artists-${label}"] a`);

  // ⚠️ [모두 접기] 버튼에 기대지 말 것 — **칸이 하나뿐이면 그 버튼이 아예 없다**.
  //    머리말 자체를 눌러 접은 상태에서 시작한다(처음 상태는 작가 수에 따라 갈린다).
  if ((await first.getAttribute('aria-expanded')) === 'true') {
    await first.click();
    await settle(page, 400);
  }
  await expect(shown).toHaveCount(0);

  await first.click();
  await settle(page, 400);
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  expect(await shown.count(), `[${label}] 을 눌렀는데 이름이 안 나온다`).toBeGreaterThan(0);

  // 다시 누르면 접힌다
  await first.click();
  await settle(page, 400);
  await expect(shown).toHaveCount(0);
  await ctx.close();
});

test('★ 작가 목록은 가나다순이고, 칸 안의 이름은 서버 순서 그대로다', async ({ browser }) => {
  const api = await pwRequest.newContext();
  const artists = await (await api.get(`${API}/explore/artists`)).json();
  await api.dispose();

  const { page, ctx } = await openAs(browser, 'artist');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/artists');
  await settle(page, 1200);

  await expandAll(page);

  // ⚠️ 화면 순서가 서버 순서와 **정확히 같아야** 한다 — 화면이 따로 정렬하면 칸과 이름이 어긋난다
  const onScreen = (await page.locator('aside li a').allTextContents()).map((t) => t.trim());
  expect(onScreen).toEqual(artists.map((a: any) => a.name));

  // 칸 머리말이 서버가 준 `initial` 과 같고, **한글 칸이 영문 칸보다 앞**이다
  const heads = (await page.locator('aside button[aria-expanded] > span:first-child').allTextContents())
    .map((t) => t.trim());
  expect(heads).toEqual([...new Set<string>(artists.map((a: any) => a.initial))]);
  expect(heads, '한글 이름 작가를 심었는데 칸이 하나뿐이다 — 색인을 검증하지 못한다').toContain('ㄱ');
  expect(heads.indexOf('ㄱ')).toBeLessThan(heads.indexOf('A–Z'));
  await ctx.close();
});

test('★ [순서 바꾸기]는 없앴다 — 작품 새로고침은 작가 목록을 건드리지 않는다', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/artists');
  await settle(page, 1200);

  // 랜덤 정렬 시절의 버튼이 되살아나지 않았는지
  await expect(page.getByRole('button', { name: /순서 바꾸기/ })).toHaveCount(0);

  await expandAll(page);
  const before = await page.locator('aside li a').allTextContents();

  await page.getByRole('button', { name: /작품 새로고침/ }).click();
  await settle(page, 1200);
  expect(await page.locator('aside li a').allTextContents(),
    '작품을 새로고침했는데 작가 목록까지 바뀌었다').toEqual(before);
  await ctx.close();
});

test('작품을 공개한 작가만 목록에 들어간다 (API)', async () => {
  const api = await pwRequest.newContext();
  const artists = await (await api.get(`${API}/explore/artists`)).json();
  expect(Array.isArray(artists)).toBe(true);
  for (const a of artists) {
    expect(a.workCount, `${a.name} 이 공개 작품 없이 목록에 있다`).toBeGreaterThan(0);
    expect(a.id).toBeGreaterThan(0);
    // 화면이 이 값으로 칸을 묶는다 — 없으면 전부 '#' 한 칸으로 쏟아진다
    expect(a.initial, `${a.name} 에 색인 칸(initial)이 없다`).toBeTruthy();
  }
  await api.dispose();
});
