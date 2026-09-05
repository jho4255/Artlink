import { test, expect, request as pwRequest, type Page } from '@playwright/test';
import { openAs, settle, tokenFor, ensurePublicArtworks } from '../lib/helpers';

const API = 'http://localhost:4000/api';

/**
 * 랜덤 재정렬을 확인하려면 **섞일 만큼의 작품**이 있어야 한다.
 * 시드에는 공개 작품이 한두 점뿐이라 몇 번을 새로고침해도 순서가 같을 수밖에 없고,
 * 그러면 "랜덤이 안 걸린다"고 잘못 판정한다(2026-08-28 실제로 그렇게 실패했다).
 */
test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  // 두 작가에게 8장씩 — 섞일 재료가 있어야 "랜덤"을 확인할 수 있다
  for (const role of ['artist', 'artist2'] as const) {
    await ensurePublicArtworks(api, tokenFor(role), 8);
  }
  await api.dispose();
});

/**
 * 서버가 내려준 작품 순서(id 배열)를 **네트워크에서** 읽는다.
 *
 * ⚠️ DOM 의 `<img>` 를 세면 안 된다 — 격자는 `SkeletonImage` 라 이미지가 404 면 `<img>` 를 아예
 *    렌더하지 않는다. 테스트용 더미 주소는 대부분 404 라, DOM 으로 재면 **매번 빈 배열**이 나오고
 *    "순서가 그대로다"라는 엉뚱한 실패가 난다(2026-08-28 실제로 그랬다).
 */
function watchHighlight(page: Page) {
  const seen: string[] = [];
  page.on('response', async (res) => {
    if (!res.url().includes('/api/explore/highlight')) return;
    try {
      const body = await res.json();
      seen.push(JSON.stringify((body.images ?? []).map((i: any) => i.id)));
    } catch { /* 실패한 응답은 무시 */ }
  });
  return seen;
}

test.describe('홈 구성', () => {
  /**
   * 순서는 [배너] → [ArtWorks] → [나머지] 다 (2026-09-05 에 앞의 둘을 맞바꿨다).
   * ⚠️ 배너는 슬라이드가 하나도 없어도 스켈레톤으로 자리를 지키므로 **항상** 잴 수 있다.
   */
  test('★ 맨 위가 배너, 그 아래가 ArtWorks', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ArtWorks' })).toBeVisible({ timeout: 15000 });

    const order = await page.evaluate(() => {
      const y = (sel: string) => {
        const el = Array.from(document.querySelectorAll('h2')).find(h => h.textContent?.trim().startsWith(sel));
        return el ? el.getBoundingClientRect().top + window.scrollY : Number.POSITIVE_INFINITY;
      };
      const hero = document.querySelector('[data-testid="home-hero"]');
      return {
        hero: hero ? hero.getBoundingClientRect().top + window.scrollY : Number.POSITIVE_INFINITY,
        artworks: y('ArtWorks'),
        gotm: y('Gallery of the Month'),
      };
    });
    expect(order.hero).toBeLessThan(order.artworks);
    expect(order.artworks).toBeLessThan(order.gotm);
  });

  test('부제를 두지 않는다 (제목만)', async ({ page }) => {
    await page.goto('/');
    const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'ArtWorks' }) }).last();
    await expect(section).toBeVisible({ timeout: 15000 });
    await expect(section.locator('h2 + p')).toHaveCount(0);
  });

  test('★ 퀵 내비게이션(QuickActionCards)이 사라졌다 — Navbar 와 중복이었다', async ({ page }) => {
    await page.goto('/');
    await settle(page, 1500);
    const body = await page.locator('body').innerText();
    // 예전 카드 4장의 문구
    for (const gone of ['갤러리 찾기', '전시 보기', '모집공고 확인']) {
      expect(body).not.toContain(gone);
    }
  });
});

test.describe('ArtWorks 컨트롤', () => {
  test('★ [작품 새로고침]은 우측 상단, [모두 모아보기]는 우측 하단', async ({ page }) => {
    await page.goto('/');
    const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'ArtWorks' }) }).last();
    await expect(section).toBeVisible({ timeout: 15000 });

    const rBox = await section.getByRole('button', { name: '작품 새로고침' }).boundingBox();
    const aBox = await section.getByRole('button', { name: '모두 모아보기' }).boundingBox();
    const gBox = await section.locator('.grid').first().boundingBox();
    expect(rBox!.y).toBeLessThan(gBox!.y);      // 격자 위
    expect(aBox!.y).toBeGreaterThan(gBox!.y);   // 격자 아래
  });

  test('★ 컨트롤이 읽힐 만큼 진하다 (gray-300/400 은 흰 배경에서 사실상 배경이다)', async ({ page }) => {
    await page.goto('/');
    const btn = page.getByRole('button', { name: '작품 새로고침' });
    await expect(btn).toBeVisible({ timeout: 15000 });

    const ratio = await btn.evaluate((el) => {
      const toRgb = (c: string) => {
        const cv = document.createElement('canvas').getContext('2d')!;
        cv.fillStyle = c;
        const m = cv.fillStyle.match(/^#(..)(..)(..)$/);
        return m ? [1, 2, 3].map(i => parseInt(m[i], 16)) : [0, 0, 0];
      };
      const lum = (rgb: number[]) => {
        const a = rgb.map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
        return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
      };
      const fg = lum(toRgb(getComputedStyle(el).color));
      const bg = lum([255, 255, 255]);
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    });
    expect(ratio, 'WCAG AA(4.5:1) 미만이면 "안 보인다"는 얘기가 나온다').toBeGreaterThanOrEqual(4.5);
  });

  test('★ [작품 새로고침]을 누르면 다른 작품이 온다', async ({ page }) => {
    const seen = watchHighlight(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ArtWorks' })).toBeVisible({ timeout: 15000 });
    await settle(page, 1500);

    for (let i = 0; i < 6; i++) {
      await page.getByRole('button', { name: '작품 새로고침' }).click();
      await settle(page, 900);
    }
    expect(seen.length, '새로고침을 눌렀는데 서버를 다시 부르지 않았다').toBeGreaterThan(1);
    expect(new Set(seen).size, '여섯 번 눌러도 서버가 같은 순서만 준다 — 시드가 안 바뀐다').toBeGreaterThan(1);
  });

  test('★ 새로고침 중에도 섹션이 사라지지 않는다 (홈이 위로 튀지 않게)', async ({ page }) => {
    await page.goto('/');
    const head = page.getByRole('heading', { name: 'ArtWorks' });
    await expect(head).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: '작품 새로고침' }).click();
    // 재조회 중에도 계속 보여야 한다
    for (let i = 0; i < 5; i++) {
      await expect(head).toBeVisible();
      await page.waitForTimeout(150);
    }
  });

  test('[모두 모아보기] → 둘러보기로 간다', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '모두 모아보기' }).click();
    await page.waitForURL(/\/explore/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'ArtWorks' })).toBeVisible({ timeout: 10000 });
  });

  test('★ 새로 들어올 때마다 랜덤 — 네 번 들어와 한 번이라도 달라진다', async ({ page }) => {
    const seen = watchHighlight(page);
    for (let i = 0; i < 4; i++) {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'ArtWorks' })).toBeVisible({ timeout: 15000 });
      await settle(page, 1000);
    }
    expect(seen.length, '홈에 들어왔는데 하이라이트를 안 불렀다').toBeGreaterThanOrEqual(4);
    expect(new Set(seen).size, '네 번 들어왔는데 늘 같은 얼굴이다 — 첫 진입 랜덤이 안 걸렸다').toBeGreaterThan(1);
  });
});

test.describe('둘러보기(/explore) — 홈과 같은 이름·같은 컨트롤', () => {
  test('★ 제목이 ArtWorks 고 설명 문구는 없다', async ({ page }) => {
    await page.goto('/explore');
    await expect(page.getByRole('heading', { name: 'ArtWorks' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('body')).not.toContainText('둘러보기');
  });

  test('★ 알약 [랜덤]/[좋아요순] 대신 [작품 새로고침] + [좋아요순]', async ({ page }) => {
    await page.goto('/explore');
    await expect(page.getByRole('button', { name: '작품 새로고침' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /^랜덤$/ })).toHaveCount(0);
  });
});

test.describe('Navbar 와 비활성화된 메뉴', () => {
  test('★ 가운데 메뉴에 둘러보기·혜택이 없다', async ({ page }) => {
    // 가운데 메뉴는 lg↑ 에서만 펼쳐진다 (모바일은 햄버거 안)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const nav = page.locator('header nav, nav').first();
    await expect(nav).toBeVisible({ timeout: 10000 });
    const text = await nav.innerText();
    expect(text).not.toContain('둘러보기');
    expect(text).not.toContain('혜택');
    // 있어야 하는 것들
    for (const need of ['홈', '갤러리', '전시', '모집공고']) expect(text).toContain(need);
  });

  test('★ 비로그인 Navbar 우측은 [로그인] 하나뿐 (마이페이지 버튼 없음)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: '로그인' }).or(page.getByRole('link', { name: '로그인' })).first())
      .toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: '마이페이지' })).toHaveCount(0);
  });

  test('★ /benefits 는 404 가 아니라 홈으로 (기존 링크·북마크가 죽지 않게)', async ({ page }) => {
    await page.goto('/benefits');
    await page.waitForURL(/localhost:5173\/$/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'ArtWorks' })).toBeVisible({ timeout: 15000 });
  });

  test('로그인 시 우측 그룹은 [대화][알림] · 이름(역할) 순이고 로그아웃은 없다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const nav = page.locator('nav').first();
    await expect(nav).toBeVisible({ timeout: 10000 });
    await expect(nav.getByRole('button', { name: '로그아웃' })).toHaveCount(0);
    await ctx.close();
  });
});
