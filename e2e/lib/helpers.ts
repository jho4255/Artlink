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
 * 백엔드가 요구하는 작가 지원 약관 버전을 소스에서 직접 읽는다.
 * (버전이 올라가도 테스트가 조용히 400으로 깨지지 않도록 하드코딩하지 않는다)
 */
export function applyTermsVersion(): string {
  const src = fs.readFileSync(path.resolve(process.cwd(), '../backend/src/lib/terms.ts'), 'utf-8');
  const m = src.match(/ARTIST_APPLY_TERMS_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error('ARTIST_APPLY_TERMS_VERSION을 backend/src/lib/terms.ts에서 찾지 못했습니다.');
  return m[1];
}

/**
 * 공모 지원 (고정 양식: 작가약력 필수 + 작품사진 1장 이상 필수 + 약관 동의 필수).
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
      termsAgreed: true,
      termsVersion: applyTermsVersion(),
      ...overrides,
    },
  });
}

/**
 * 갤러리 지원자 관리 열기.
 * 지원자 관리는 공모 상세가 아니라 **마이페이지 '내 공모'의 인라인 패널**로 옮겨졌다
 * (공모 상세에는 '내 공모로 이동' 버튼만 있음). 제목으로 해당 카드를 특정해 펼친다.
 */
export async function openApplicantManager(page: Page, exhibitionTitle: string) {
  await page.goto('/mypage?tab=my-exhibitions');
  await expect(page.locator('body')).toContainText(exhibitionTitle, { timeout: 15000 });
  const card = page.locator('div')
    .filter({ hasText: exhibitionTitle })
    .filter({ has: page.getByRole('button', { name: '지원자 관리' }) })
    .last();
  await card.getByRole('button', { name: '지원자 관리' }).click();
}

/** 백엔드 uploads 폴더에 실제 존재하는 이미지 URL (404 이미지는 SkeletonImage가 <img>를 렌더하지 않는다) */
export function realUploadUrl(): string {
  const dir = path.resolve(process.cwd(), '../backend/uploads');
  const f = fs.readdirSync(dir).find(n => /\.(png|jpe?g|webp)$/i.test(n));
  if (!f) throw new Error('backend/uploads 에 이미지 파일이 없습니다.');
  return `/uploads/${f}`;
}

/** 갤러리 계정이 **소유한** 승인 갤러리 id. 목록에서 아무거나 집으면 다른 계정 소유일 수 있어 403이 난다. */
export async function ownedGalleryId(api: import('@playwright/test').APIRequestContext, token = tokenFor('gallery')): Promise<number> {
  const r = await api.get(`${API}/galleries?owned=true`, { headers: { Authorization: `Bearer ${token}` } });
  const list = await r.json();
  const arr = Array.isArray(list) ? list : (list.galleries || []);
  const g = arr.find((x: any) => x.status === 'APPROVED');
  if (!g) throw new Error('승인된 소유 갤러리가 없습니다.');
  return g.id;
}
