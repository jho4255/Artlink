import { test, expect, request as pwRequest, type Page } from '@playwright/test';
import { openAs, tokenFor, userIds, settle } from '../lib/helpers';

/**
 * 작가 홈페이지 (공개 페이지 + 편집) — 2026-08-27~28 개편분.
 *
 *  · 메뉴 [홈페이지] → 공개 작가 페이지. 편집은 그 페이지의 [수정](주인만).
 *  · [수정]을 누르면 **바로 편집 모드** (읽기 화면을 거쳐 또 누르게 하지 않는다).
 *  · 저장하면 **공개 페이지로 돌아간다** (편집 전용 화면에 갇히지 않게).
 *  · 편집 중 우측에 **공개 페이지와 같은 컴포넌트**로 실시간 미리보기.
 *  · 저장/취소는 하단 고정 저장바의 **우측 하단**.
 *  · 긴 무공백 글이 들어가도 페이지가 가로로 밀리지 않는다.
 */
const API = 'http://localhost:4000/api';
const DESKTOP = { width: 1440, height: 900 };

/** 가로 스크롤이 생겼는가 — 생겼다면 어떤 요소가 밀어냈는지도 알려준다 */
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const over = doc.scrollWidth - doc.clientWidth;
    if (over <= 1) return { over, culprit: null as string | null };
    let worst = '';
    let worstRight = doc.clientWidth;
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.right > worstRight) {
        worstRight = r.right;
        worst = `${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 60)} right=${Math.round(r.right)}`;
      }
    }
    return { over, culprit: worst };
  });
}

test.describe('공개 페이지', () => {
  test('★ 제목은 HomePage (Page 가 빨강), 이름 아래는 한 줄 소개 → 인스타 순', async ({ page }) => {
    const ids = userIds();
    await page.goto(`/portfolio/${ids.artist}`);
    const head = page.getByRole('heading', { name: 'HomePage' });
    await expect(head).toBeVisible({ timeout: 15000 });
    const color = await head.locator('span').first().evaluate(el => getComputedStyle(el).color);
    expect(color.replace(/\s/g, '')).toBe('rgb(220,53,69)');

    // 예전에 자리만 차지하던 문구
    await expect(page.locator('body')).not.toContainText('아티스트 포트폴리오');
  });

  test('★ [수정]은 주인에게만 보인다 (역할만 보면 남의 페이지에서도 뜬다)', async ({ browser }) => {
    const ids = userIds();

    const owner = await openAs(browser, 'artist');
    await owner.page.goto(`/portfolio/${ids.artist}`);
    await expect(owner.page.getByRole('link', { name: '수정' })).toBeVisible({ timeout: 15000 });
    await owner.ctx.close();

    const other = await openAs(browser, 'artist2');
    await other.page.goto(`/portfolio/${ids.artist}`);
    await expect(other.page.getByRole('heading', { name: 'HomePage' })).toBeVisible({ timeout: 15000 });
    await expect(other.page.getByRole('link', { name: '수정' })).toHaveCount(0);
    await other.ctx.close();
  });

  test('남의 페이지에는 [메시지]가 있다 (갠톡 길목)', async ({ browser }) => {
    const ids = userIds();
    const { page, ctx } = await openAs(browser, 'artist2');
    await page.goto(`/portfolio/${ids.artist}`);
    await expect(page.getByRole('button', { name: '메시지' })).toBeVisible({ timeout: 15000 });
    await ctx.close();
  });
});

test.describe('편집', () => {
  test('★ [수정] 한 번으로 바로 편집 모드에 들어간다', async ({ browser }) => {
    const ids = userIds();
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto(`/portfolio/${ids.artist}`);
    await page.getByRole('link', { name: '수정' }).click();
    await page.waitForURL(/tab=homepage-edit/, { timeout: 10000 });

    // 입력 폼이 이미 열려 있어야 한다 — [수정]을 또 누르게 하지 않는다
    await expect(page.getByRole('button', { name: '저장' })).toBeVisible({ timeout: 15000 });
    await ctx.close();
  });

  test('★ 편집 중 우측에 실시간 미리보기가 있고 입력이 바로 반영된다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage?tab=homepage-edit');
    await expect(page.getByRole('button', { name: '저장' })).toBeVisible({ timeout: 15000 });

    // 미리보기는 공개 페이지와 같은 컴포넌트 → HomePage 제목이 화면 안에 있다
    await expect(page.getByRole('heading', { name: 'HomePage' })).toBeVisible({ timeout: 10000 });

    const marker = `미리보기확인${Date.now()}`;
    const tagline = page.getByPlaceholder(/동심의 이면|한 줄 소개/).first();
    await tagline.fill(marker);
    await expect(page.locator('body')).toContainText(marker, { timeout: 5000 });

    await ctx.close();
  });

  test('★ 저장/취소는 우측 하단 고정 저장바에 있다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage?tab=homepage-edit');
    const save = page.getByRole('button', { name: '저장' });
    await expect(save).toBeVisible({ timeout: 15000 });

    const geom = await save.evaluate((el) => {
      const r = el.getBoundingClientRect();
      let n: HTMLElement | null = el as HTMLElement;
      let sticky = false;
      while (n) { if (getComputedStyle(n).position === 'sticky') { sticky = true; break; } n = n.parentElement; }
      return { right: r.right, vw: window.innerWidth, sticky };
    });
    expect(geom.sticky, '저장바가 sticky 가 아니다 — 길게 쓰면 저장이 화면 밖으로 나간다').toBe(true);
    expect(geom.right).toBeGreaterThan(geom.vw * 0.5);   // 우측
  });

  test('★ 아래 작품 사진 관리까지 스크롤해도 저장바가 살아 있다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage?tab=homepage-edit');
    await expect(page.getByRole('button', { name: '저장' })).toBeVisible({ timeout: 15000 });

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await settle(page, 800);
    const box = await page.getByRole('button', { name: '저장' }).boundingBox();
    expect(box, '스크롤을 내렸더니 저장바가 사라졌다 — 저장 안 된 변경을 안은 채로').not.toBeNull();
    expect(box!.y).toBeGreaterThan(0);
    expect(box!.y).toBeLessThan(900);
    await ctx.close();
  });

  test('★ 저장하면 공개 홈페이지로 돌아간다 (편집 화면에 갇히지 않게)', async ({ browser }) => {
    const ids = userIds();
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage?tab=homepage-edit');
    await expect(page.getByRole('button', { name: '저장' })).toBeVisible({ timeout: 15000 });

    const marker = `저장확인${Date.now()}`;
    await page.getByPlaceholder(/동심의 이면|한 줄 소개/).first().fill(marker);
    await page.getByRole('button', { name: '저장' }).click();

    await page.waitForURL(new RegExp(`/portfolio/${ids.artist}`), { timeout: 15000 });
    // 방금 저장한 내용이 보여야 한다 (옛 캐시가 뜨면 안 된다)
    await expect(page.locator('body')).toContainText(marker, { timeout: 10000 });
    await ctx.close();
  });
});

test.describe('긴 글이 레이아웃을 깨지 않는다', () => {
  test('★ 공백 없는 한글 400자 작가노트를 넣어도 가로로 밀리지 않는다', async ({ browser }) => {
    const ids = userIds();
    const api = await pwRequest.newContext();
    const tok = tokenFor('artist');

    const cur = await (await api.get(`${API}/portfolio`, { headers: { Authorization: `Bearer ${tok}` } })).json();
    const longNote = '작가노트가공백없이쭉이어집니다'.repeat(30);   // 400자 이상, 공백 0
    await api.put(`${API}/portfolio`, {
      headers: { Authorization: `Bearer ${tok}` },
      data: { ...cur, statement: longNote },
    });
    await api.dispose();

    for (const vw of [375, 768, 1440]) {
      const { page, ctx } = await openAs(browser, 'artist');
      await page.setViewportSize({ width: vw, height: 900 });
      await page.goto(`/portfolio/${ids.artist}`);
      await expect(page.getByRole('heading', { name: 'HomePage' })).toBeVisible({ timeout: 15000 });
      await settle(page, 800);

      const r = await horizontalOverflow(page);
      expect(r.over, `${vw}px 에서 ${r.over}px 밀렸다 (${r.culprit}) — break-keep 만으로는 부족하다, [overflow-wrap:anywhere] 필요`).toBeLessThanOrEqual(1);
      await ctx.close();
    }
  });

  test('★ 편집 화면 미리보기도 같이 견딘다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto('/mypage?tab=homepage-edit');
    await expect(page.getByRole('button', { name: '저장' })).toBeVisible({ timeout: 15000 });
    await settle(page, 1000);
    const r = await horizontalOverflow(page);
    expect(r.over, `편집 화면이 ${r.over}px 밀렸다 (${r.culprit})`).toBeLessThanOrEqual(1);
    await ctx.close();
  });
});

test.describe('경력 배치', () => {
  test('★ 항목 이름이 그 아래 내용보다 크다 (섹션 구분이 읽혀야 한다)', async ({ browser }) => {
    const ids = userIds();
    const api = await pwRequest.newContext();
    const tok = tokenFor('artist');
    const cur = await (await api.get(`${API}/portfolio`, { headers: { Authorization: `Bearer ${tok}` } })).json();
    await api.put(`${API}/portfolio`, {
      headers: { Authorization: `Bearer ${tok}` },
      data: {
        ...cur,
        career: {
          solo: [{ year: '2025', content: '개인전 하나' }],
          group: Array.from({ length: 12 }, (_, i) => ({ year: '2024', content: `단체전 ${i + 1}` })),
          award: [{ year: '2023', content: '수상 하나' }],
        },
      },
    });
    await api.dispose();

    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto(`/portfolio/${ids.artist}`);
    await expect(page.locator('body')).toContainText('단체전', { timeout: 15000 });

    const sizes = await page.evaluate(() => {
      // 항목 이름은 <p> 안에 아이콘(svg)과 함께 있다 — 'children 이 없는 요소' 로 찾으면 못 찾는다
      const label = Array.from(document.querySelectorAll('p'))
        .find(e => e.textContent?.trim() === '개인전') as HTMLElement | undefined;
      const line = Array.from(document.querySelectorAll('li'))
        .find(e => e.textContent?.includes('개인전 하나')) as HTMLElement | undefined;
      if (!label || !line) return null;
      return {
        label: parseFloat(getComputedStyle(label).fontSize),
        line: parseFloat(getComputedStyle(line).fontSize),
        weight: getComputedStyle(label).fontWeight,
      };
    });
    expect(sizes, '경력 항목 이름을 화면에서 못 찾았다').not.toBeNull();
    expect(sizes!.label, '항목 이름이 내용보다 작다 — 어디서 개인전이 끝나는지 안 읽힌다').toBeGreaterThan(sizes!.line);
    await ctx.close();
  });

  test('★ 수상 및 선정이 긴 단체전 아래로 밀려 내려가지 않는다', async ({ browser }) => {
    const ids = userIds();
    const { page, ctx } = await openAs(browser, 'artist');
    await page.setViewportSize(DESKTOP);
    await page.goto(`/portfolio/${ids.artist}`);
    await expect(page.locator('body')).toContainText('수상', { timeout: 15000 });

    const gap = await page.evaluate(() => {
      const ps = Array.from(document.querySelectorAll('p')) as HTMLElement[];
      const solo = ps.find(e => e.textContent?.trim() === '개인전');
      const award = ps.find(e => /^수상/.test(e.textContent?.trim() || ''));
      if (!solo || !award) return null;
      return award.getBoundingClientRect().top - solo.getBoundingClientRect().bottom;
    });
    expect(gap, '경력 항목을 못 찾았다').not.toBeNull();
    expect(gap!, `개인전과 수상이 ${Math.round(gap!)}px 떨어져 있다 — 무게 기반 배치가 안 걸렸다`).toBeLessThan(400);
    await ctx.close();
  });
});
