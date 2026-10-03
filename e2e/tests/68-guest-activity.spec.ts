import { test, expect, request as pwRequest, type Page, type Browser } from '@playwright/test';
import { openAs, tokenFor } from '../lib/helpers';

/**
 * 비회원 둘러보기 (2026-10-03, Admin [통계] 탭) — 실제 브라우저가 보내는 기록과, **그것 때문에 화면이 망가지지 않는지**.
 *
 *  A 비회원이 둘러본 화면·시간이 통계에 남고, 떠나면 바로 '나감'(pagehide 떠남 신호). 주소에서 검색어·꼬리표를 떼는 건
 *    양쪽 단위 테스트가 본다(frontend guestActivity.test · backend guest-activity.test — 여기선 본문을 못 본다)
 *  B 로그인한 사람은 하나도 안 보낸다
 *  C 둘러보다 로그인하면 그 방문은 '로그인'으로 닫히고, 그 뒤 화면은 안 보낸다
 *  D 기록 서버가 500·끊김이어도, 저장소(sessionStorage)가 막혀도 화면은 멀쩡하다(통계 때문에 사이트가 죽으면 안 된다)
 *  E 화면을 빠르게 넘겨도 요청이 늘지 않는다(0.7초 미만 화면은 안 남기고, 5초에 한 번까지만 보낸다)
 *
 * ⚠️ 통계는 같은 기간을 1분 동안 저장해 둔 답으로 준다(`GUEST_STATS_CACHE_MS`) — 테스트마다 **다른 기간(days)** 으로 물어 새로 세게 한다.
 * ⚠️ Playwright 는 sendBeacon 요청을 `ping` 으로 보여 주고 **본문을 주지 않는다**(postData null) — 그래서 브라우저 쪽은 요청 **수**만 세고,
 *    무엇이 기록됐는지는 서버(통계 API)로 확인한다. 떠남 신호가 왔는지도 통계의 `ongoing:false` 로 본다.
 */
const API = 'http://localhost:4000/api';

async function guestStats(days: number) {
  const api = await pwRequest.newContext();
  const r = await api.get(`${API}/admin/stats/guests?days=${days}`, { headers: { Authorization: `Bearer ${tokenFor('admin')}` } });
  expect(r.status()).toBe(200);
  const body = await r.json();
  await api.dispose();
  return body as {
    summary: { visits: number };
    recent: { outcome: string | null; ongoing: boolean; views: number; steps: { label: string; seconds: number; tab: string | null }[] }[];
  };
}

/** 페이지가 보낸 기록 요청 수(본문은 못 본다 — 위 ⚠️) */
function beacons(page: Page) {
  const sent = { count: 0 };
  page.on('request', (r) => { if (r.url().endsWith('/api/guest-activity') && r.method() === 'POST') sent.count++; });
  return sent;
}

/** 메뉴로 옮긴다(SPA 이동 — 새로 불러오지 않는다). PC 는 위쪽 메뉴, 휴대폰은 아래 탭바 — 보이는 쪽을 누른다 */
async function nav(page: Page, label: string) {
  await page.locator('a:visible').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first().click();
  await page.waitForLoadState('domcontentloaded');
}

/** 페이지 오류(던진 예외)를 모은다 */
function pageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

async function guestPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });   // 로그인 안 한 새 기기
  return { ctx, page: await ctx.newPage() };
}

test('A ★ 비회원이 둘러본 화면·머문 시간이 통계에 남고, 떠나면 바로 \'나감\'', async ({ browser }) => {
  const { ctx, page } = await guestPage(browser);
  const sent = beacons(page);
  await page.goto('/exhibitions?region=SEOUL&utm_source=instagram');
  await page.waitForTimeout(3500);
  await nav(page, '작가');
  await page.waitForTimeout(2500);
  await nav(page, '갤러리');
  await page.waitForTimeout(2000);
  await page.goto('about:blank');   // 다른 곳으로 떠난다 → pagehide
  await page.waitForTimeout(800);
  expect(sent.count, '보낸 요청이 있어야 한다').toBeGreaterThan(0);
  expect(sent.count, '화면 셋에 요청이 몇 개 안 된다').toBeLessThanOrEqual(8);

  const s = await guestStats(90);
  const v = s.recent.find((r) => r.steps.map((x) => x.label).join('>') === '모집공고>작가>갤러리');
  expect(v, JSON.stringify(s.recent.slice(0, 3))).toBeTruthy();
  expect(v!.ongoing, '떠남 신호가 왔으니 30분을 기다리지 않고 나감').toBe(false);
  expect(v!.outcome).toBeNull();
  expect(v!.steps[0].seconds).toBeGreaterThanOrEqual(3);
  await ctx.close();
});

test('B 로그인한 사람은 하나도 보내지 않는다', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist2');
  const sent = beacons(page);
  await page.goto('/');
  await page.waitForTimeout(3500);
  await nav(page, '작가');
  await page.waitForTimeout(1500);
  await page.goto('about:blank');
  await page.waitForTimeout(800);
  expect(sent.count).toBe(0);
  await ctx.close();
});

test('C 둘러보다 로그인하면 그 방문은 \'로그인\'으로 닫히고, 그 뒤 화면은 보내지 않는다', async ({ browser }) => {
  const { ctx, page } = await guestPage(browser);
  const sent = beacons(page);
  await page.goto('/exhibitions');
  await page.waitForTimeout(2500);
  await page.goto('/login');
  await page.waitForTimeout(1500);
  // '일반' 계정으로 — 작가로 로그인하면 홈페이지가 덜 찬 경우 '홈페이지 완성' 팝업이 메뉴를 덮는다(다른 스펙이 그 작가에게 작품을 남기면 뜬다)
  await page.getByRole('button', { name: /다른 계정으로 로그인/ }).click();
  await page.getByPlaceholder('이름 또는 이메일로 검색').fill('visitor@artlink.com');
  await page.getByRole('button', { name: /일반/ }).first().click();
  await page.waitForURL((u) => u.pathname !== '/login', { timeout: 15_000 });
  await page.waitForTimeout(1000);   // 로그인으로 닫는 요청이 나갈 틈
  const n = sent.count;
  await nav(page, '갤러리');
  await page.waitForTimeout(4000);
  await page.goto('about:blank');
  await page.waitForTimeout(800);
  expect(sent.count, '로그인한 뒤에는 보내지 않는다').toBe(n);

  const s = await guestStats(89);
  const v = s.recent.find((r) => r.outcome === 'LOGIN' && r.steps.map((x) => x.label).join('>') === '모집공고>로그인');
  expect(v, JSON.stringify(s.recent.slice(0, 3))).toBeTruthy();
  await ctx.close();
});

test('D ★ 기록 서버가 500·끊김이어도, 저장소가 막혀도 화면은 멀쩡하다', async ({ browser }) => {
  for (const mode of ['500', 'abort', 'storage'] as const) {
    const { ctx, page } = await guestPage(browser);
    if (mode === '500') await page.route('**/api/guest-activity', (r) => r.fulfill({ status: 500, body: 'boom' }));
    if (mode === 'abort') await page.route('**/api/guest-activity', (r) => r.abort());
    if (mode === 'storage') {
      // 사생활 보호 모드처럼 sessionStorage 자체가 던진다 — 방문은 메모리로 버틴다
      await ctx.addInitScript(() => {
        Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });
      });
    }
    const errors = pageErrors(page);
    const sent = beacons(page);
    await page.goto('/');
    await page.waitForTimeout(3500);
    await nav(page, '작가');
    await expect(page).toHaveURL(/\/artists$/);
    await page.waitForTimeout(1500);
    await nav(page, '모집공고');
    await expect(page).toHaveURL(/\/exhibitions$/);
    await page.waitForTimeout(1500);
    // 화면 전체가 죽으면 ErrorBoundary 의 복구 화면이 뜬다
    await expect(page.getByText('앱이 업데이트되었을 수 있어요')).toHaveCount(0);
    await expect(page.locator('main')).toBeVisible();
    const guestErrors = errors.filter((e) => /guest|beacon|sessionStorage/i.test(e));
    expect(guestErrors, `${mode}: ${errors.join(' | ')}`).toEqual([]);
    if (mode === 'storage') expect(sent.count, '저장소가 막혀도 기록은 보낸다(메모리)').toBeGreaterThan(0);
    await ctx.close();
  }
});

test('E 화면을 빠르게 넘겨도 요청이 늘지 않는다', async ({ browser }) => {
  const { ctx, page } = await guestPage(browser);
  await page.goto('/');
  await page.waitForTimeout(1000);
  const sent = beacons(page);
  // 0.3초마다 메뉴 20번 — 0.7초 미만 화면은 남기지 않으므로 거의 보낼 게 없다
  const labels = ['작가', '갤러리', '전시', '모집공고'];
  for (let i = 0; i < 20; i++) { await nav(page, labels[i % labels.length]); await page.waitForTimeout(300); }
  // 0.7초를 넘긴 화면만 남고, 그것도 5초에 한 번 묶어 보낸다 — 20번 이동(약 10초)에 많아야 4번
  expect(sent.count, `20번 이동에 보낸 요청 ${sent.count}개`).toBeLessThanOrEqual(4);
  await ctx.close();
});
