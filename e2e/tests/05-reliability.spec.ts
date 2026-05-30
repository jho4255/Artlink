import { test, expect } from '@playwright/test';
import { openAs, statePath } from '../lib/helpers';

const FE_ORIGIN = 'http://localhost:5173';

/**
 * Tier2 신뢰성/복원력: 새로고침 상태유지 · 세션 만료(위조토큰) · 네트워크 단절→복구.
 */

test('새로고침해도 로그인 상태·현재 페이지 유지', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');
  await page.goto('/mypage');
  await expect(page.getByText('포트폴리오', { exact: false }).first()).toBeVisible();
  // 새로고침 → 여전히 마이페이지(로그인 페이지로 안 튕김)
  await page.reload();
  await expect(page).toHaveURL(/\/mypage/);
  await expect(page.getByText('포트폴리오', { exact: false }).first()).toBeVisible();
  await ctx.close();
});

test('만료/위조 토큰으로 보호페이지 접근 → 401 처리되어 로그인으로', async ({ browser }) => {
  // isAuthenticated=true 이지만 토큰은 위조 → 보호페이지 렌더 후 API 401 → 자동 로그아웃
  const ctx = await browser.newContext({
    storageState: {
      cookies: [],
      origins: [{
        origin: FE_ORIGIN,
        localStorage: [{
          name: 'artlink-auth',
          value: JSON.stringify({ state: { token: 'forged.invalid.token', user: { id: 1, name: 'Artist 1', email: 'artist1@artlink.com', role: 'ARTIST' }, isAuthenticated: true }, version: 0 }),
        }],
      }],
    },
  });
  const page = await ctx.newPage();
  await page.goto('/mypage');
  // 401 인터셉터가 로그아웃시켜 로그인 페이지로 이동해야 함
  await expect(page).toHaveURL(/\/login/, { timeout: 12000 });
  await ctx.close();
});

test('네트워크 단절 시 목록 에러안내 → 복구 후 다시 시도로 정상 로드', async ({ browser }) => {
  const { page, ctx } = await openAs(browser, 'artist');

  // 갤러리 목록 API를 모두 차단 (네트워크 실패 시뮬레이션, retry까지 전부 실패)
  await ctx.route('**/api/galleries**', route => route.abort());
  await page.goto('/galleries');
  await expect(page.getByText('불러오지 못했습니다', { exact: false })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible();

  // 네트워크 복구 → 다시 시도 → 목록 정상
  await ctx.unroute('**/api/galleries**');
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByText('불러오지 못했습니다', { exact: false })).toHaveCount(0, { timeout: 15000 });
  await expect(page.locator('img').first()).toBeVisible({ timeout: 10000 });
  await ctx.close();
});
