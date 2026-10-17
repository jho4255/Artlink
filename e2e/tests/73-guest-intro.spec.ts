import { test, expect, request as pwRequest, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createExhibition, openAs, ownedGalleryId, type Role } from '../lib/helpers';

/**
 * 소개 팝업 'Welcome to ArtLink' (2026-10-18, 규칙 73 · lib/guestIntro.ts · components/shared/GuestIntro.tsx)
 *
 * 기능
 *  A. 로그인 안 함 — 어느 화면으로 들어와도(홈·공모 상세) 뜬다 · 작가 쪽 네 칸 · 그림 여덟 장 · [무료로 시작하기] → 아티스트를 골라 둔 가입(공모 상세면 가입 뒤 그 공모로)
 *  B. [갤러리] 로 바꾸면 네 칸 · 2027년 6월까지 무료 · [무료로 시작하기] → 갤러리를 골라 둔 가입
 *  C. 방문(탭)마다 한 번 — 닫으면 그 탭에선 새로고침·다른 화면에도 안 뜨고, 새 탭엔 다시 뜬다 · 닫지 않고 새로고침하면 다시 뜬다 · 닫는 길 넷(✕·둘러보기·ESC·바깥)
 *  D. 띄우지 않는 곳 — 로그인·가입·지원서·초대 코드·약관 · 자동화(navigator.webdriver) 브라우저
 *  E. 회원(작가) — 하루 한 번 · [다시 보지 않기] 면 다음 날에도, 로그아웃해도 그 브라우저에선 안 뜬다
 *  F. 갤러리 회원은 갤러리 쪽부터 · 관리자에겐 안 뜬다
 *  G. 홈페이지를 덜 채운 작가 — 홈페이지 완성 팝업(규칙 51)만 뜨고, 그걸 닫아도 그날은 소개 팝업이 뒤따르지 않는다
 *  H. 미리보기 ?intro=1 — 관리자에게도 뜨고, 닫으면 주소에서 빠지며 아무것도 적지 않는다(미리보기를 본 브라우저에도 진짜 한 번이 남는다)
 * 신뢰성
 *  R1 빠르게 화면을 옮겨도 하나만 · R2 그림을 못 받아도 뜬다 · R3 그림이 느리면 최대 2초만 더 기다린다 · R4 저장소가 막혀도 화면이 죽지 않는다
 *  R5 닫으면 배경 스크롤 잠금이 풀린다 · R6 탭 셋에 각각 · R7 새 탭 열고 닫기 10번 · R8 다른 창이 떠 있으면 기다렸다가 뜬다
 *  모든 테스트에서 페이지 오류(pageerror)가 0 이어야 한다.
 *
 * ⚠️ 팝업은 자동화 브라우저(navigator.webdriver)에 안 뜬다 — 그래야 다른 스펙이 막히지 않는다. 여기서는 그 값을 false 로 바꿔 사람처럼 연다.
 */
const API = 'http://localhost:4000/api';
const HUMAN = () => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); };
const intro = (page: Page) => page.getByTestId('guest-intro');
const shows = (page: Page, timeout = 6000) => intro(page).waitFor({ timeout }).then(() => true, () => false);
const absent = async (page: Page, ms = 2500) => { await page.waitForTimeout(ms); return (await intro(page).count()) === 0; };

/** 사람처럼 여는 새 창 — 페이지 오류를 모아 둔다 */
async function human(browser: Browser, role?: Role): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = role ? (await openAs(browser, role)).ctx : await browser.newContext();
  await ctx.addInitScript(HUMAN);
  const errors: string[] = [];
  ctx.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
  const page = ctx.pages()[0] ?? await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}

let exhibitionId = 0;
test.beforeAll(async () => {
  // 광고가 보내는 공모 상세 — 갤러리 시드 계정의 갤러리로 모집 중인 공모 하나를 만든다(초기화 직후엔 공모가 없다)
  const api = await pwRequest.newContext();
  exhibitionId = await createExhibition(api, { title: `E2E 소개 팝업 ${Date.now()}`, galleryId: await ownedGalleryId(api) });
  expect(exhibitionId).toBeTruthy();
  await api.dispose();
});

test.describe('기능', () => {
  test('A. 로그인 안 함 — 어느 화면으로 들어와도 뜨고, [무료로 시작하기] 는 아티스트를 골라 둔 가입으로(공모 상세면 가입 뒤 그 공모로)', async ({ browser }) => {
    const { ctx, page, errors } = await human(browser);
    await page.goto('/');
    expect(await shows(page)).toBe(true);
    await expect(intro(page).getByRole('heading')).toHaveText('Welcome to ArtLink');
    await expect(intro(page)).toHaveAttribute('data-side', 'artist');
    await expect(intro(page).locator('li')).toHaveCount(4);
    for (const t of ['ArtLook', '포트폴리오 PDF', '작가 홈페이지', '공모 간편지원']) await expect(intro(page)).toContainText(t);
    await expect(intro(page)).toContainText('작가 회원은 아트링크의 모든 서비스를 무료로 이용해요.');
    // 칸 그림이 다 받아졌다
    await expect.poll(() => intro(page).locator('img').evaluateAll((ims) => ims.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0))).toBe(true);

    // 공모 상세로 들어와도 뜬다 — 새 탭(새 방문)
    const p2 = await ctx.newPage();
    await p2.goto(`/exhibitions/${exhibitionId}`);
    expect(await shows(p2)).toBe(true);
    await intro(p2).getByRole('button', { name: '무료로 시작하기' }).click();
    await expect(p2).toHaveURL(/\/signup\?role=ARTIST$/);
    await expect(p2.getByRole('radio', { name: /아티스트/ })).toHaveAttribute('aria-checked', 'true');
    expect(await p2.evaluate(() => sessionStorage.getItem('post_login_redirect'))).toBe(`/exhibitions/${exhibitionId}`);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('B. [갤러리] 로 바꾸면 네 칸 · 2027년 6월까지 무료 · [무료로 시작하기] 는 갤러리를 골라 둔 가입으로', async ({ browser }) => {
    const { ctx, page, errors } = await human(browser);
    await page.goto('/galleries');
    expect(await shows(page)).toBe(true);
    await intro(page).getByRole('tab', { name: '갤러리' }).click();
    await expect(intro(page)).toHaveAttribute('data-side', 'gallery');
    await expect(intro(page).getByRole('tab', { name: '갤러리' })).toHaveAttribute('aria-selected', 'true');
    await expect(intro(page).locator('li')).toHaveCount(4);
    for (const t of ['공모 운영 자동화', '지원 접수부터 출품 자료·정산까지, 클릭 한번으로.', '갤러리 홈페이지를 꾸미고 소개해주세요.', '진행중인 전시를 홍보해보세요.'])
      await expect(intro(page)).toContainText(t);
    await expect(intro(page)).toContainText('갤러리 회원은 2027년 6월까지 아트링크의 모든 서비스를 무료로 이용할 수 있어요.');
    await expect.poll(() => intro(page).locator('img').evaluateAll((ims) => ims.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
    // 다시 작가로
    await intro(page).getByRole('tab', { name: '작가' }).click();
    await expect(intro(page)).toHaveAttribute('data-side', 'artist');
    await intro(page).getByRole('tab', { name: '갤러리' }).click();
    await intro(page).getByRole('button', { name: '무료로 시작하기' }).click();
    await expect(page).toHaveURL(/\/signup\?role=GALLERY$/);
    await expect(page.getByRole('radio', { name: /갤러리/ })).toHaveAttribute('aria-checked', 'true');
    // 갤러리 쪽에서 가입하러 가면 공모로 돌아올 자리를 적지 않는다
    expect(await page.evaluate(() => sessionStorage.getItem('post_login_redirect'))).toBeNull();
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('C. 방문(탭)마다 한 번 — 닫으면 그 탭에선 안 뜨고 새 탭엔 다시 · 닫지 않고 새로고침하면 다시 · 닫는 길 넷', async ({ browser }) => {
    const { ctx, page, errors } = await human(browser);
    await page.goto('/');
    expect(await shows(page)).toBe(true);
    await page.reload();
    expect(await shows(page), '닫지 않고 새로고침하면 다시 뜬다').toBe(true);

    const closers: [string, (p: Page) => Promise<void>][] = [
      ['✕', (p) => intro(p).getByRole('button', { name: '닫기' }).first().click()],
      ['먼저 둘러볼게요', (p) => intro(p).getByRole('button', { name: '먼저 둘러볼게요' }).click()],
      ['ESC', async (p) => { await p.waitForTimeout(300); await p.keyboard.press('Escape'); }],
      ['바깥', (p) => p.mouse.click(8, 60)],
    ];
    for (const [name, close] of closers) {
      const p = await ctx.newPage();
      await p.goto('/artists');
      expect(await shows(p), `${name} — 새 탭엔 뜬다`).toBe(true);
      await close(p);
      await expect(intro(p), `${name} 로 닫힌다`).toHaveCount(0);
      await p.reload();
      expect(await absent(p), `${name} — 닫은 탭은 새로고침해도 안 뜬다`).toBe(true);
      await p.goto('/exhibitions');
      expect(await absent(p), `${name} — 닫은 탭은 다른 화면에도 안 뜬다`).toBe(true);
      await p.close();
    }
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('D. 띄우지 않는 곳 — 로그인·가입·지원서·초대 코드·약관 · 자동화 브라우저', async ({ browser }) => {
    const { ctx, page, errors } = await human(browser);
    for (const path of ['/login', '/signup', '/signup/email', '/join/ABCD2345', '/terms', '/privacy']) {
      await page.goto(path);
      expect(await absent(page, 2200), path).toBe(true);
    }
    // 지원서는 로그인으로 보낸다 — 거기서도 안 뜬다
    await page.goto(`/exhibitions/${exhibitionId}/apply`);
    expect(await absent(page, 2200), '지원서(→ 로그인)').toBe(true);
    expect(errors).toEqual([]);
    await ctx.close();

    // 자동화 브라우저(webdriver 그대로) — 다른 스펙·점검 하니스가 막히지 않는다
    const bot = await browser.newContext();
    const bp = await bot.newPage();
    await bp.goto('/');
    expect(await absent(bp, 3000), '자동화 브라우저').toBe(true);
    await bot.close();
  });

  test('E. 회원(작가) — 하루 한 번 · [다시 보지 않기] 면 다음 날에도, 로그아웃해도 그 브라우저에선 안 뜬다', async ({ browser }) => {
    const { ctx, page, errors } = await human(browser, 'artist');
    await page.goto('/');
    expect(await shows(page)).toBe(true);
    await expect(intro(page)).toHaveAttribute('data-side', 'artist');
    await expect(intro(page).getByRole('button', { name: '다시 보지 않기' })).toBeVisible();
    await expect(intro(page).getByRole('button', { name: '무료로 시작하기' })).toHaveCount(0);
    await intro(page).getByRole('button', { name: '닫기', exact: true }).last().click();
    await expect(intro(page)).toHaveCount(0);
    const p2 = await ctx.newPage();
    await p2.goto('/exhibitions');
    expect(await absent(p2), '닫으면 그날은 새 탭에도 안 뜬다').toBe(true);
    // 다음 날
    await p2.evaluate(() => localStorage.removeItem('artlink-intro-member-day'));
    await p2.goto('/galleries');
    expect(await shows(p2), '다음 날엔 다시').toBe(true);
    await intro(p2).getByRole('button', { name: '다시 보지 않기' }).click();
    await p2.evaluate(() => localStorage.removeItem('artlink-intro-member-day'));
    await p2.goto('/');
    expect(await absent(p2), '[다시 보지 않기] — 다음 날에도 안 뜬다').toBe(true);
    // 로그아웃해도 그 브라우저에선 안 뜬다(로그아웃한 회원 브라우저엔 원래 비회원 화면이 뜬다)
    await p2.evaluate(() => localStorage.removeItem('artlink-auth'));
    const p3 = await ctx.newPage();
    await p3.goto('/');
    expect(await absent(p3), '로그아웃해도 그 브라우저에선 안 뜬다').toBe(true);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('E2. 로그인한 적 있는 브라우저(로그아웃 상태)에는 비회원 화면이 뜬다', async ({ browser }) => {
    const { ctx, page, errors } = await human(browser);
    await page.addInitScript(() => localStorage.setItem('artlink-member-device', '1'));
    await page.goto('/');
    expect(await shows(page)).toBe(true);
    await expect(intro(page).getByRole('link', { name: '이미 회원이에요' })).toBeVisible();
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('F. 갤러리 회원은 갤러리 쪽부터 · 관리자에겐 안 뜬다', async ({ browser }) => {
    const g = await human(browser, 'gallery');
    await g.page.goto('/');
    expect(await shows(g.page)).toBe(true);
    await expect(intro(g.page)).toHaveAttribute('data-side', 'gallery');
    expect(g.errors).toEqual([]);
    await g.ctx.close();
    const a = await human(browser, 'admin');
    await a.page.goto('/');
    expect(await absent(a.page, 3000), '관리자').toBe(true);
    await a.ctx.close();
  });

  test('G. 홈페이지를 덜 채운 작가 — 홈페이지 완성 팝업만 뜨고, 닫아도 그날은 소개 팝업이 뒤따르지 않는다', async ({ browser }) => {
    const api = await pwRequest.newContext();
    const stamp = Date.now();
    const r = await api.post(`${API}/auth/signup`, {
      data: { name: `소개${String(stamp).slice(-6)}`, email: `intro-${stamp}@e2e.test`, password: 'IntroTest1!', role: 'ARTIST', agreeTerms: true, agreePrivacy: true },
    });
    expect(r.ok(), await r.text()).toBe(true);
    const { token, user } = await r.json();
    await api.get(`${API}/portfolio`, { headers: { Authorization: `Bearer ${token}` } });
    await api.post(`${API}/portfolio/images`, { headers: { Authorization: `Bearer ${token}` }, data: { url: '/uploads/art1.png' } });
    await api.dispose();

    const ctx = await browser.newContext();
    await ctx.addInitScript(HUMAN);
    await ctx.addInitScript(([t, u]) => {
      if (!localStorage.getItem('artlink-auth')) localStorage.setItem('artlink-auth', JSON.stringify({ state: { token: t, user: u, isAuthenticated: true }, version: 0 }));
    }, [token, user] as const);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    const nudge = page.getByTestId('homepage-nudge');
    await expect(nudge).toBeVisible({ timeout: 10_000 });
    expect(await absent(page, 2500), '완성 팝업이 떠 있는 동안 소개 팝업은 안 겹친다').toBe(true);
    await nudge.getByRole('button', { name: '나중에' }).click();
    expect(await absent(page, 3500), '완성 팝업을 닫아도 그날은 소개 팝업이 뒤따르지 않는다').toBe(true);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('H. 미리보기 ?intro=1 — 관리자에게도 뜨고, 닫으면 주소에서 빠지며 아무것도 적지 않는다', async ({ browser }) => {
    const a = await human(browser, 'admin');
    await a.page.goto('/exhibitions?intro=1');
    expect(await shows(a.page)).toBe(true);
    await intro(a.page).getByRole('button', { name: '닫기', exact: true }).last().click();
    await expect(a.page).toHaveURL(/\/exhibitions$/);
    expect(await absent(a.page, 2500), '닫으면 다시 안 뜬다').toBe(true);
    await a.ctx.close();

    // 로그인 안 한 브라우저 — 미리보기로 보고 닫아도 일반 방문에서 진짜 한 번이 그대로 뜬다
    const g = await human(browser);
    await g.page.goto('/?intro=1');
    expect(await shows(g.page)).toBe(true);
    await intro(g.page).getByRole('button', { name: '먼저 둘러볼게요' }).click();
    expect(await g.page.evaluate(() => Object.keys({ ...localStorage, ...sessionStorage }).filter((k) => k.startsWith('artlink-intro')))).toEqual([]);
    await g.page.goto('/');
    expect(await shows(g.page), '미리보기를 닫은 뒤에도 일반 방문에서 뜬다').toBe(true);
    expect(g.errors).toEqual([]);
    await g.ctx.close();
  });
});

test.describe('신뢰성', () => {
  test('R1. 빠르게 화면을 옮겨도 팝업은 하나만 뜬다', async ({ browser }) => {
    const { ctx, page, errors } = await human(browser);
    await page.goto('/');
    // 앱 안에서 주소만 빠르게 바꾼다(링크를 연달아 누른 것과 같다) — 띄우려던 예약이 화면마다 쌓이면 팝업이 여럿 뜬다
    for (const path of ['/artists', '/galleries', '/shows', '/exhibitions', '/community', '/artists']) {
      await page.evaluate((to) => { history.pushState({}, '', to); dispatchEvent(new PopStateEvent('popstate')); }, path);
      await page.waitForTimeout(150);
    }
    await expect(page).toHaveURL(/\/artists$/);
    expect(await shows(page)).toBe(true);
    await page.waitForTimeout(2500);
    await expect(intro(page)).toHaveCount(1);
    expect(await page.locator('[aria-modal="true"]').count()).toBe(1);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('R2. 칸 그림을 못 받아도 뜨고, 화면은 멀쩡하다', async ({ browser }) => {
    const { ctx, page, errors } = await human(browser);
    await ctx.route('**/intro/*.webp', (r) => r.abort());
    const t0 = Date.now();
    await page.goto('/');
    expect(await shows(page, 6000)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(6000);
    await intro(page).getByRole('button', { name: '먼저 둘러볼게요' }).click();
    await expect(page.getByRole('link', { name: '모집공고' }).first()).toBeVisible();
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('R3. 칸 그림이 느리면 최대 2초만 더 기다렸다가 뜬다', async ({ browser }) => {
    const { ctx, page, errors } = await human(browser);
    await ctx.route('**/intro/*.webp', async (r) => { await new Promise((res) => setTimeout(res, 6000)); await r.continue().catch(() => {}); });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    const t0 = Date.now();
    expect(await shows(page, 8000)).toBe(true);
    const waited = Date.now() - t0;
    expect(waited, '그림이 6초 걸려도 0.6초 + 최대 2초 + 여유 안에 뜬다').toBeLessThan(4500);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('R4. 저장소가 막혀도(사파리 비공개 모드 등) 화면이 죽지 않고, 닫으면 그 문서에선 다시 안 뜬다', async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(HUMAN);
    await ctx.addInitScript(() => {
      const boom = () => { throw new DOMException('blocked', 'SecurityError'); };
      for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, { get: boom, configurable: true });
    });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    expect(await shows(page)).toBe(true);
    await intro(page).getByRole('button', { name: '먼저 둘러볼게요' }).click();
    await page.getByRole('link', { name: '갤러리' }).first().click();
    expect(await absent(page), '저장소가 막혀도 같은 문서에선 기억한다').toBe(true);
    await expect(page.getByRole('link', { name: '모집공고' }).first()).toBeVisible();
    expect(errors.filter((m) => !/blocked/.test(m)), '팝업 때문에 생긴 페이지 오류는 없다').toEqual([]);
    await ctx.close();
  });

  test('R5. 닫으면 배경 스크롤 잠금이 풀린다(닫는 길 넷 · 가입으로 떠날 때)', async ({ browser }) => {
    const { ctx, errors } = await human(browser);
    for (const close of ['✕', '둘러보기', 'ESC', '가입'] as const) {
      const p = await ctx.newPage();
      await p.goto('/');
      expect(await shows(p)).toBe(true);
      expect(await p.evaluate(() => document.body.style.overflow)).toBe('hidden');
      if (close === '✕') await intro(p).getByRole('button', { name: '닫기' }).first().click();
      if (close === '둘러보기') await intro(p).getByRole('button', { name: '먼저 둘러볼게요' }).click();
      if (close === 'ESC') { await p.waitForTimeout(300); await p.keyboard.press('Escape'); }
      if (close === '가입') await intro(p).getByRole('button', { name: '무료로 시작하기' }).click();
      await expect(intro(p)).toHaveCount(0);
      await expect.poll(() => p.evaluate(() => document.body.style.overflow), { message: close }).toBe('');
      await p.close();
    }
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('R6. 탭 셋을 동시에 — 탭마다 하나씩, 한 탭에서 닫아도 다른 탭은 그대로', async ({ browser }) => {
    const { ctx, errors } = await human(browser);
    const tabs = await Promise.all([0, 1, 2].map(() => ctx.newPage()));
    await Promise.all(tabs.map((t, i) => t.goto(['/', '/artists', '/exhibitions'][i])));
    for (const t of tabs) expect(await shows(t)).toBe(true);
    await intro(tabs[0]).getByRole('button', { name: '먼저 둘러볼게요' }).click();
    await expect(intro(tabs[0])).toHaveCount(0);
    await expect(intro(tabs[1])).toHaveCount(1);
    await expect(intro(tabs[2])).toHaveCount(1);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('R7. 새 탭을 열고 닫기 10번 — 매번 뜨고 매번 닫힌다', async ({ browser }) => {
    const { ctx, errors } = await human(browser);
    for (let i = 0; i < 10; i++) {
      const p = await ctx.newPage();
      await p.goto(i % 2 ? '/galleries' : '/');
      expect(await shows(p), `${i + 1}번째`).toBe(true);
      await expect(intro(p)).toHaveCount(1);
      if (i % 3 === 0) await intro(p).getByRole('tab', { name: '갤러리' }).click();
      await intro(p).getByRole('button', { name: '먼저 둘러볼게요' }).click();
      await expect(intro(p)).toHaveCount(0);
      await p.close();
    }
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('R8. 다른 창이 떠 있으면 기다렸다가, 그 창이 닫히면 뜬다(팝업이 겹치지 않는다)', async ({ browser }) => {
    const { ctx, page, errors } = await human(browser);
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const d = document.createElement('div');
        d.id = 'other-modal'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
        document.body.appendChild(d);
      });
    });
    await page.goto('/');
    expect(await absent(page, 3500), '다른 창이 떠 있는 동안').toBe(true);
    await page.evaluate(() => document.getElementById('other-modal')?.remove());
    expect(await shows(page, 3000), '그 창이 닫히면').toBe(true);
    expect(errors).toEqual([]);
    await ctx.close();
  });
});
