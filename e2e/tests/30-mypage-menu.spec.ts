import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, userIds, tokenFor, ensurePublicArtworks } from '../lib/helpers';

/**
 * 마이페이지 메뉴 배치 (2026-08-27~28 개편) — artspoon.io 참고, 그쪽은 좌측 / 우리는 우측.
 *
 * 지켜야 하는 것:
 *  · lg↑ 는 **전 페이지** 우측 세로 사이드바 (홈에서도 각 탭으로 바로 들어간다)
 *  · lg↓ 는 Navbar 우측 상단 [메뉴] 안에 같은 목록 (햄버거가 둘이면 안 된다)
 *  · 로그아웃은 사이드바 **맨 아래** 하나뿐 (예전엔 네비바 + 마이페이지 본문 둘)
 *  · 강조는 /mypage 에 있을 때만 (홈에서 '프로필'이 눌린 듯 보이면 현재 위치를 잘못 알려준다)
 *  · 브랜드 이름(HomePage·PortFolio·MyPicks·ArtLook)은 **화면 좌측 상단**, 메뉴 라벨은 한글
 */
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 375, height: 812 };

test.describe('lg↑ 전 페이지 우측 사이드바', () => {
  test('★ 홈에서도 사이드바가 보이고 마이페이지 탭으로 바로 간다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto('/');

    const side = page.locator('aside nav');
    await expect(side).toBeVisible({ timeout: 10000 });
    await expect(side).toContainText('My Page');

    await side.getByRole('link', { name: /내 전시/ }).click();
    await page.waitForURL(/\/mypage\?tab=applications/, { timeout: 10000 });
    await ctx.close();
  });

  test('★ 홈에서는 아무 항목도 강조되지 않는다 (현재 위치를 잘못 알려주지 않게)', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto('/');
    await expect(page.locator('aside nav [aria-current="page"]')).toHaveCount(0);

    await page.goto('/mypage');
    await expect(page.locator('aside nav [aria-current="page"]')).toHaveCount(1);
    await ctx.close();
  });

  test('작가 메뉴 구성과 순서', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage');
    const labels = await page.locator('aside nav a').allInnerTexts();
    const cleaned = labels.map(t => t.replace(/\s+/g, ' ').trim());
    expect(cleaned).toEqual([
      '프로필', '홈페이지', '포트폴리오', '찜 목록', '내 전시', 'ArtLook액자 걸기',
      'ArtStory소식 공유', '1:1 문의',
    ]);
    await ctx.close();
  });

  test('★ 없앤 메뉴가 되살아나지 않았다 (받은 초대·좋아요한 작품·내 리뷰·고객센터)', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage');
    const side = page.locator('aside nav');
    for (const gone of ['받은 초대', '좋아요한 작품', '내 리뷰', '고객센터']) {
      await expect(side, `${gone} 가 아직 메뉴에 있다`).not.toContainText(gone);
    }
    await ctx.close();
  });

  test('★ [홈페이지]는 마이페이지 탭이 아니라 공개 작가 페이지로 나간다', async ({ browser }) => {
    const ids = userIds();
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage');
    await page.locator('aside nav').getByRole('link', { name: '홈페이지' }).click();
    await page.waitForURL(new RegExp(`/portfolio/${ids.artist}`), { timeout: 10000 });
    await ctx.close();
  });

  test('★ 로그아웃은 사이드바 맨 아래 하나뿐 — 마이페이지 본문에는 없다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage');

    const all = page.getByRole('button', { name: '로그아웃' });
    await expect(all, '한 화면에 로그아웃이 둘 이상 보인다').toHaveCount(1);
    await expect(page.locator('aside nav').getByRole('button', { name: '로그아웃' })).toBeVisible();

    // 메뉴의 마지막 요소여야 한다
    const isLast = await page.evaluate(() => {
      const nav = document.querySelector('aside nav')!;
      const btn = Array.from(nav.querySelectorAll('button')).find(b => b.textContent?.includes('로그아웃'))!;
      return nav.lastElementChild!.contains(btn);
    });
    expect(isLast).toBe(true);
    await ctx.close();
  });

  test('비로그인에게는 사이드바를 띄우지 않는다', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize(DESKTOP);
    await page.goto('/');
    await expect(page.locator('aside nav')).toHaveCount(0);
    await ctx.close();
  });
});

test.describe('lg↓ Navbar [메뉴] 안', () => {
  test('★ 우측 상단 햄버거는 하나뿐이고, 그 안에 마이페이지 목록이 들어 있다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(MOBILE);
    await page.goto('/');

    // 사이드바는 CSS(hidden lg:block)로 감춰진다 — DOM 에는 남으므로 '보이는가'로 따진다
    await expect(page.locator('aside nav')).toBeHidden();

    const toggles = page.locator('nav button[aria-label*="메뉴"], nav button:has-text("메뉴")');
    const visible = await toggles.evaluateAll(els => els.filter(e => (e as HTMLElement).offsetParent !== null).length);
    expect(visible, '우측 상단에 햄버거가 둘이면 뭐가 뭔지 알 수 없다').toBeLessThanOrEqual(1);

    await ctx.close();
  });

  test('모바일 메뉴에 마이페이지 항목과 로그아웃이 있다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(MOBILE);
    await page.goto('/');
    const toggle = page.locator('nav button').filter({ has: page.locator('svg') }).last();
    await toggle.click();
    const body = page.locator('body');
    await expect(body).toContainText('내 전시', { timeout: 5000 });
    await expect(body).toContainText('로그아웃');
    await ctx.close();
  });
});

test.describe('탭 이동 — ?tab= 이 없어질 때도 되돌아온다', () => {
  test('★ [내 전시] → [프로필] 왕복 (주소만 바뀌고 화면이 안 바뀌던 버그)', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'gallery');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage');

    const side = page.locator('aside nav');
    await side.getByRole('link', { name: '내 갤러리' }).click();
    await page.waitForURL(/tab=my-galleries/);
    await expect(page.locator('main')).toContainText('갤러리', { timeout: 10000 });

    // 프로필은 기본 탭이라 주소에 쿼리가 안 붙는다 — 그래도 화면이 프로필로 돌아와야 한다
    await side.getByRole('link', { name: '프로필' }).click();
    await page.waitForURL(/\/mypage$/);
    await expect(page.locator('aside nav [aria-current="page"]')).toContainText('프로필');
    await expect(page.locator('main')).toContainText(/닉네임|이메일|프로필/, { timeout: 10000 });
    await ctx.close();
  });

  test('역할에 없는 ?tab= 으로 들어가면 프로필로 폴백한다 (빈 화면 방지)', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage?tab=approvals');   // Admin 탭
    await expect(page.locator('aside nav [aria-current="page"]')).toContainText('프로필', { timeout: 10000 });
    await ctx.close();
  });

  test('★ 메뉴의 모든 탭이 실제로 내용을 그린다 (빈 화면인 탭이 없다)', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage');
    const hrefs = await page.locator('aside nav a').evaluateAll(as =>
      as.map(a => (a as HTMLAnchorElement).getAttribute('href')!).filter(h => h.startsWith('/mypage')));

    for (const href of hrefs) {
      await page.goto(href);
      // 마이페이지는 지연 로딩(React.lazy)이라 첫 프레임의 main 은 비어 있다
      await expect(page.locator('aside nav [aria-current="page"]')).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(800);
      const text = (await page.locator('main').innerText()).trim();
      expect(text.length, `${href} 가 빈 화면이다`).toBeGreaterThan(20);
    }
    await ctx.close();
  });
});

test.describe('화면 이름은 좌측 상단, 로고 색 규칙', () => {
  // MyPicks 는 우측 상단 두 줄로 옮겨 34-picks-and-scrap 이 위치·색을 따로 검증한다
  const CASES: { href: string; role: 'artist'; head: string; red: string }[] = [
    { href: '/mypage?tab=portfolio', role: 'artist', head: 'PortFolio', red: 'Folio' },
    { href: '/mypage?tab=artlook', role: 'artist', head: 'ArtLook', red: 'Look' },
    { href: '/messages', role: 'artist', head: 'ArtTalk', red: 'Talk' },
  ];

  for (const c of CASES) {
    test(`${c.head} — 좌측 상단 제목이고 뒤 조각이 빨강`, async ({ browser }) => {
      const { page, ctx } = await openAs(browser, c.role);
      await page.setViewportSize(DESKTOP);
      await page.goto(c.href);

      const head = page.getByRole('heading', { name: c.head }).first();
      await expect(head).toBeVisible({ timeout: 12000 });

      const color = await head.locator('span').first().evaluate(el => getComputedStyle(el).color);
      expect(color.replace(/\s/g, '')).toBe('rgb(220,53,69)');

      await ctx.close();
    });
  }

  test('★ 홈 ArtWorks 도 같은 규칙 (Art 검정 + Works 빨강)', async ({ browser }) => {
    // ArtWorks 는 공개 작품이 없으면 렌더되지 않는다(null) — 이 테스트만 돌 때를 위해 한 점 확보
    const api = await pwRequest.newContext();
    await ensurePublicArtworks(api, tokenFor('artist'), 1);
    await api.dispose();

    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto('/');
    const head = page.getByRole('heading', { name: 'ArtWorks' }).first();
    await expect(head).toBeVisible({ timeout: 12000 });
    const color = await head.locator('span').first().evaluate(el => getComputedStyle(el).color);
    expect(color.replace(/\s/g, '')).toBe('rgb(220,53,69)');
    await ctx.close();
  });
});
