import { test, expect, request as pwRequest, type Page } from '@playwright/test';
import { createExhibition, crowdUsers, ensurePublicArtworks, ownedGalleryId, settle, tokenFor } from '../lib/helpers';

/**
 * 휴대폰·앱 홈의 탭 (2026-11-14 사용자 결정, `frontend/src/lib/homeTabs.ts`) — 눌러서 무슨 일이 나는가.
 *  A 배너 아래 탭 줄: ArtWorks · ArtStory · 인기글 · 마감임박 공모 — 진행중인 전시·주목할 갤러리는 없다(있어도) · 처음은 ArtWorks 칸만
 *  B 탭을 누르면 그 칸만 보인다 · 칸 제목 줄은 없고 [전체 보기]가 그 목록으로 간다 · ArtStory 칸은 카드 두 줄(위→아래→다음 칸)
 *  C 내리면 탭 줄이 상단바 아래 붙고, 내린 채로 탭을 바꾸면 새 칸은 탭 줄 바로 아래부터
 *  D 다른 화면에 갔다가 뒤로 오면 보던 탭 · 하단 [홈]으로 새로 열면 첫 탭 · 주소는 그대로(/)
 *  E 빈 칸은 탭도 없다(모집 중 공고가 없을 때) — 나타났다 사라지지도 않는다
 *  F PC 홈은 그대로 — 탭 없이 칸이 늘어서고 진행중인 전시·주목할 갤러리도 있다 · 소식은 한 줄
 *  G 좁은 PC 창(마우스)에서도 소식 두 줄을 화살표로 넘긴다 — 손가락 화면엔 화살표가 없다(밀면 된다)
 *  H [전체 보기] — 열 때마다 안 본 소식은 섞이고, 본 소식은 새로 불러오면 뒤로(?seed=·?seen=)
 * 기본 화면은 휴대폰(Pixel 7).
 */
const tabsBar = (page: Page) => page.getByRole('tablist', { name: '홈' });
const panel = (page: Page, id: string) => page.getByTestId(`home-panel-${id}`);
const isGotm = (u: URL) => u.pathname === '/api/gallery-of-month';
const isOpenCalls = (u: URL) => u.pathname === '/api/exhibitions' && u.searchParams.get('scope') === 'open';
const isOngoing = (u: URL) => u.pathname === '/api/shows' && u.searchParams.get('showStatus') === 'ongoing';

/** 주목할 갤러리 한 곳 — E2E 시드에 없을 수 있어 응답을 넣어 준다(있어도 휴대폰 탭엔 없고 PC 에만 있다) */
const GOTM = [{ id: 9001, galleryId: 1, expiresAt: '2099-12-31T00:00:00.000Z', gallery: { id: 1, name: '탭 확인 갤러리', mainImage: '', address: '서울 종로구', reviewCount: 0 } }];

test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  await ensurePublicArtworks(api, tokenFor('artist'), 4);                       // ArtWorks 칸이 비지 않게
  // 소식 칸에 둘 이상(한 사람당 하나라 두 사람) — 작가 계정은 다른 스펙이 하루 한도(10)를 쓰므로 갤러리·관리자로
  for (const role of ['gallery', 'admin'] as const) {
    const r = await api.post('http://localhost:4000/api/stories', { headers: { Authorization: `Bearer ${tokenFor(role)}` }, data: { caption: `홈 탭 소식 ${role} ${Date.now()}` } });
    expect(r.status(), await r.text()).toBe(201);
  }
  // 홈 줄은 한 사람당 하나 — 좁은 창에서 줄이 넘치게(화살표가 생기게) 올린 사람을 여럿 둔다. 하루 한도에 걸린 사람은 그냥 넘어간다
  for (const u of await crowdUsers(api, 8)) {
    await api.post('http://localhost:4000/api/stories', { headers: { Authorization: `Bearer ${u.token}` }, data: { caption: `홈 탭 무리 ${u.id}` } });
  }
  await createExhibition(api, { title: `홈 탭 공모 ${Date.now()}`, galleryId: await ownedGalleryId(api) }); // 마감임박 공모 칸이 있게
  await api.dispose();
});

test.describe('휴대폰 홈 탭', () => {
  test('A ★ 배너 아래 탭 줄 — 순서 · 진행중인 전시·주목할 갤러리 없음 · 처음은 ArtWorks 칸만', async ({ page }) => {
    await page.route(isGotm, (r) => r.fulfill({ json: GOTM }));   // 주목할 갤러리가 있어도
    await page.goto('/');
    await expect(tabsBar(page).getByRole('tab')).toHaveText(['ArtWorks', 'ArtStory', '인기글', '마감임박 공모']);
    await expect(page.getByRole('tab', { name: 'ArtWorks' })).toHaveAttribute('aria-selected', 'true');
    await expect(panel(page, 'works').getByRole('button', { name: '작품 새로고침' })).toBeVisible();
    for (const id of ['story', 'popular', 'closing']) await expect(panel(page, id)).toBeHidden();
    // 진행중인 전시·주목할 갤러리는 휴대폰 홈에 없다(PC 에만)
    await expect(page.getByText('진행중인 전시')).toHaveCount(0);
    await expect(page.getByText('주목할 갤러리')).toHaveCount(0);
    await expect(page.getByText('탭 확인 갤러리')).toHaveCount(0);
    // 칸 제목 줄은 없다 — 제목은 탭이 대신한다
    await expect(page.getByRole('heading', { name: 'ArtWorks' })).toHaveCount(0);
    const y = await page.evaluate(() => ({
      hero: document.querySelector('[data-testid="home-hero"]')!.getBoundingClientRect().top,
      tabs: document.querySelector('[role="tablist"][aria-label="홈"]')!.getBoundingClientRect().top,
    }));
    expect(y.hero).toBeLessThan(y.tabs);
  });

  test('B ★ 탭을 누르면 그 칸만 — [전체 보기]는 그 목록으로 · 소식은 두 줄', async ({ page }) => {
    await page.goto('/');
    const cases: [string, string, string][] = [
      ['ArtStory', 'story', '/feed'],
      ['인기글', 'popular', '/community'],
      ['마감임박 공모', 'closing', '/exhibitions'],
    ];
    for (const [label, id, href] of cases) {
      await page.getByRole('tab', { name: label }).click();
      await expect(page.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
      await expect(panel(page, id)).toBeVisible();
      await expect(page.locator('[data-testid^="home-panel-"]:visible')).toHaveCount(1);
      await expect(panel(page, id).getByRole('link', { name: '전체 보기' })).toHaveAttribute('href', href);
    }
    // 고른 탭(마지막 탭)이 줄 안에 다 보인다
    const fit = await page.evaluate(() => {
      const t = document.getElementById('home-tab-closing')!.getBoundingClientRect();
      const l = document.querySelector('[role="tablist"][aria-label="홈"]')!.getBoundingClientRect();
      return t.left >= l.left - 1 && t.right <= l.right + 1;
    });
    expect(fit, '고른 탭이 줄 밖에 걸쳐 있다').toBe(true);
    // ArtStory 칸은 카드 두 줄 — 위→아래→다음 칸(1 아래 2), 두 줄이 함께 옆으로 밀린다.
    // 소식이 넷보다 적으면 맨 앞이 [소식 올리기] 칸이라 그 칸까지 함께 센다
    await page.getByRole('tab', { name: 'ArtStory' }).click();
    const items = panel(page, 'story').locator('.story-rail > *');
    await expect(panel(page, 'story').locator('[data-story-card]').first()).toBeVisible();
    const boxes = await items.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top) }; }));
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    expect(new Set(boxes.map((b) => b.t)).size, '카드가 두 줄이 아니다').toBe(2);
    expect(boxes[1].l, '둘째 칸이 첫 칸 아래가 아니다').toBe(boxes[0].l);
    expect(boxes[1].t).toBeGreaterThan(boxes[0].t);
    // [전체 보기]를 눌러 보면 그 목록으로 간다
    await page.getByRole('tab', { name: '인기글' }).click();
    await panel(page, 'popular').getByRole('link', { name: '전체 보기' }).click();
    await page.waitForURL(/\/community$/);
  });

  test('C ★ 내리면 탭 줄이 상단바 아래 붙고, 내린 채로 바꾸면 새 칸은 탭 줄 바로 아래부터', async ({ page }) => {
    await page.goto('/');
    await expect(panel(page, 'works').locator('.grid').first()).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 700, behavior: 'instant' as ScrollBehavior }));
    const top = () => tabsBar(page).evaluate((e) => Math.round(e.getBoundingClientRect().top));
    await expect.poll(top).toBe(64);
    await page.getByRole('tab', { name: '인기글' }).click();
    await expect(panel(page, 'popular')).toBeVisible();
    const pos = await page.evaluate(() => ({
      barBottom: document.querySelector('[role="tablist"][aria-label="홈"]')!.parentElement!.getBoundingClientRect().bottom,
      panel: document.querySelector('[data-testid="home-panel-popular"]')!.getBoundingClientRect().top,
    }));
    expect(await top(), '탭 줄이 상단바 아래에서 떨어졌다').toBe(64);
    expect(pos.panel - pos.barBottom, '새 칸이 중간부터 보이거나 탭 줄 밑에 깔렸다').toBeGreaterThanOrEqual(0);
    expect(pos.panel - pos.barBottom).toBeLessThanOrEqual(6);
    // 짧은 칸으로 바꿔도 화면이 위로 끌려 올라가지 않는다(칸 높이는 최소 탭 줄 아래 보이는 높이)
    await page.getByRole('tab', { name: 'ArtStory' }).click();
    await expect(panel(page, 'story')).toBeVisible();
    expect(await top()).toBe(64);
  });

  test('D ★ 다른 화면에 갔다가 뒤로 오면 보던 탭 — 하단 [홈]으로 새로 열면 첫 탭 · 주소는 그대로', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: '마감임박 공모' }).click();
    await expect(page).toHaveURL(/localhost:5173\/$/);
    await panel(page, 'closing').locator('article').first().click();
    await page.waitForURL(/\/exhibitions\/\d+/);
    await page.goBack();
    await expect(page.getByRole('tab', { name: '마감임박 공모' })).toHaveAttribute('aria-selected', 'true');
    await expect(panel(page, 'closing')).toBeVisible();
    await page.getByRole('navigation', { name: '하단 내비게이션' }).getByRole('link', { name: '홈' }).click();
    await expect(page.getByRole('tab', { name: 'ArtWorks' })).toHaveAttribute('aria-selected', 'true');
    await expect(panel(page, 'works')).toBeVisible();
  });

  test('E ★ 빈 칸은 탭도 없다 — 모집 중 공고가 없으면', async ({ page }) => {
    await page.route(isOpenCalls, (r) => r.fulfill({ json: [] }));
    await page.goto('/');
    await expect(tabsBar(page).getByRole('tab')).toHaveText(['ArtWorks', 'ArtStory', '인기글']);
    await settle(page, 800);
    await expect(page.getByRole('tab', { name: '마감임박 공모' })).toHaveCount(0);
  });

  test('F PC 홈은 그대로 — 탭 없이 칸이 늘어서고 진행중인 전시·주목할 갤러리도 있다 · 소식은 한 줄', async ({ page }) => {
    await page.route(isGotm, (r) => r.fulfill({ json: GOTM }));
    const start = new Date(Date.now() - 3 * 864e5).toISOString();
    const end = new Date(Date.now() + 20 * 864e5).toISOString();
    await page.route(isOngoing, (r) => r.fulfill({ json: [{ id: 9101, title: '탭 확인 전시', startDate: start, endDate: end, posterImage: '', region: 'SEOUL', location: '서울', gallery: { id: 1, name: '탭 확인 갤러리' } }] }));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ArtWorks' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('home-widgets')).toBeVisible();
    for (const h of ['ArtStory', '인기글', '진행중인 전시', '주목할 갤러리']) await expect(page.getByRole('heading', { name: h })).toBeVisible();
    await expect(tabsBar(page)).toHaveCount(0);
    await expect(page.getByTestId('home-artstory').locator('.story-rail')).toHaveAttribute('data-rows', '1');
  });

  test('G ★ 좁은 PC 창(마우스)에서도 소식 두 줄을 화살표로 넘긴다 — 손가락 화면엔 화살표가 없다', async ({ browser, page }) => {
    const ctx = await browser.newContext({ viewport: { width: 600, height: 900 }, isMobile: false, hasTouch: false });
    const p = await ctx.newPage();
    await p.goto('/');
    await p.getByRole('tab', { name: 'ArtStory' }).click();
    const next = panel(p, 'story').getByRole('button', { name: '다음 소식 보기' });
    await expect(next).toBeVisible();
    const rail = panel(p, 'story').locator('.story-rail');
    const x0 = await rail.evaluate((e) => e.scrollLeft);
    await next.click();
    await expect.poll(() => rail.evaluate((e) => e.scrollLeft)).toBeGreaterThan(x0 + 100);
    await expect(panel(p, 'story').getByRole('button', { name: '앞 소식 보기' })).toBeVisible();
    await ctx.close();
    // 휴대폰(Pixel 7) — 손가락으로 민다, 화살표는 없다
    await page.goto('/');
    await page.getByRole('tab', { name: 'ArtStory' }).click();
    await expect(panel(page, 'story').locator('[data-story-card]').first()).toBeVisible();
    await expect(panel(page, 'story').getByRole('button', { name: '다음 소식 보기' })).toBeHidden();
  });

  test('H ★ [전체 보기] — 열 때마다 안 본 소식은 섞이고, 본 소식은 새로 불러오면 뒤로', async ({ page }) => {
    const reqs: string[] = [];
    page.on('request', (r) => { if (r.url().includes('/api/stories/public') && !r.url().includes('rail=1')) reqs.push(r.url()); });
    await page.goto('/feed');
    const cards = page.locator('[data-story-card]');
    await expect(cards.nth(2)).toBeVisible();
    expect(new URL(reqs[reqs.length - 1]!).searchParams.get('seed'), '시드 없이 불렀다').toBeTruthy();
    const first = (await cards.first().getAttribute('data-story-card'))!;
    await cards.first().click();
    await expect(page.locator('[data-story-viewer]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-story-viewer]')).toBeHidden();
    // 보는 동안엔 자리가 그대로다
    await expect(cards.first()).toHaveAttribute('data-story-card', first);
    // 새로 불러오면 본 소식을 함께 보내고, 그 소식은 안 본 소식 뒤(첫 쪽 마지막이거나 다음 쪽)
    await page.reload();
    await expect(cards.nth(2)).toBeVisible();
    expect(new URL(reqs[reqs.length - 1]!).searchParams.get('seen')?.split(',')).toContain(first);
    const ids = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-story-card')));
    const at = ids.indexOf(first);
    expect(at === -1 || at === ids.length - 1, `본 소식 자리 ${at} / ${ids.length}`).toBe(true);
  });
});
