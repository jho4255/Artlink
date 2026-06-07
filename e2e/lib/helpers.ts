import { Browser, BrowserContext, Page, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export type Role = 'artist' | 'artist2' | 'gallery' | 'admin';

const AUTH_DIR = path.resolve(process.cwd(), '.auth');
export const statePath = (role: Role) => path.join(AUTH_DIR, `${role}.json`);

/** global-setup이 저장한 역할별 유저 id */
export function userIds(): Record<Role, number> {
  return JSON.parse(fs.readFileSync(path.join(AUTH_DIR, 'ids.json'), 'utf-8'));
}

/** global-setup이 저장한 역할별 JWT 토큰 (dev-login 재호출 없이 API 셋업에 재사용) */
export function tokenFor(role: Role): string {
  return JSON.parse(fs.readFileSync(path.join(AUTH_DIR, 'tokens.json'), 'utf-8'))[role];
}

/** 특정 역할로 로그인된 새 브라우저 컨텍스트+페이지 (멀티유저 동시 테스트용) */
export async function openAs(browser: Browser, role: Role): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ storageState: statePath(role) });
  const page = await ctx.newPage();
  return { ctx, page };
}

/** react-hot-toast 메시지가 뜰 때까지 대기 (텍스트 일부 매칭) */
export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator('body')).toContainText(text, { timeout: 8000 });
}

/** 잠깐 대기 (폴링/애니메이션 안정화용) */
export const settle = (page: Page, ms = 600) => page.waitForTimeout(ms);

const API = 'http://localhost:4000/api';

/**
 * 공모 지원 (고정 양식: 작가약력 필수 + 작품사진 1장 이상 필수).
 * E2E 셋업용 — APIRequestContext와 작가 토큰으로 유효 지원 1건 생성.
 */
export async function applyToExhibition(
  api: import('@playwright/test').APIRequestContext,
  exId: number,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  return api.post(`${API}/exhibitions/${exId}/apply`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      biography: 'E2E 작가 약력',
      career: { artFair: [{ year: '2025', content: 'E2E 아트페어' }], solo: [], group: [] },
      artworkImages: ['https://example.com/e2e-artwork.jpg'],
      portfolioFileUrl: null,
      ...overrides,
    },
  });
}
