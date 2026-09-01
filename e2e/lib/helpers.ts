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

/**
 * 마이페이지 탭 열기 — **화면 폭에 상관없이** 동작한다.
 *
 * ⚠️ `page.getByText('내 갤러리').first().click()` 로 하면 안 된다(2026-08-28에 이걸로 20곳이 깨졌다).
 *    같은 라벨이 이제 세 곳에 있다 — Navbar 의 [메뉴] 목록 · 본문 가로 탭바(lg↓) · 우측 사이드바(lg↑).
 *    `.first()` 는 **보이는지 따지지 않으므로** 모바일 뷰포트에서 `hidden lg:block` 인 사이드바를 집어
 *    "element is not visible" 로 15초를 기다리다 죽는다.
 *
 * 탭 이동 자체가 검증 대상이 아니라면 주소로 바로 가는 게 가장 튼튼하다.
 * (탭 전환 UI 를 검증하는 테스트는 `30-mypage-menu.spec.ts` 가 폭까지 지정해 따로 본다)
 */
/**
 * 라벨 → 탭 id. **역할마다 다른 라벨이 있다** — '내 전시' 는
 * 작가에게는 지원/참여 목록(`applications`), 갤러리에게는 전시 등록(`my-shows`) 이다.
 * 그래서 역할을 함께 받는다(빠뜨리면 갤러리 화면에서 작가 탭으로 가 엉뚱한 걸 찾게 된다).
 */
const TAB_ID_BY_ROLE: Record<string, Record<string, string>> = {
  artist: {
    '프로필': 'profile', '홈페이지': 'homepage', '포트폴리오': 'portfolio',
    '찜 목록': 'favorites', '내 전시': 'applications', 'ArtLook': 'artlook',
  },
  gallery: {
    '프로필': 'profile', '내 갤러리': 'my-galleries', '내 공모': 'my-exhibitions',
    '내 전시': 'my-shows', '관심 작품': 'scraps',
  },
  admin: {
    '프로필': 'profile', '승인 관리': 'approvals', '주최 공모': 'hosted-exhibitions',
    '히어로 관리': 'hero-manage', '혜택 관리': 'benefit-manage', '이달의 갤러리': 'gotm-manage',
    '신고 관리': 'report-manage', '사용자 관리': 'user-manage', '운영 조회': 'oversight',
    '할 일 보드': 'todo', '개발자 도구': 'dev-tools',
  },
};

export async function openMyPageTab(page: Page, label: string, role: Role = 'artist') {
  const map = TAB_ID_BY_ROLE[role === 'artist2' ? 'artist' : role];
  const id = map?.[label];
  if (!id) throw new Error(`알 수 없는 마이페이지 탭: ${role} / ${label} (lib/helpers.ts TAB_ID_BY_ROLE 에 추가하세요)`);
  await page.goto(id === 'profile' ? '/mypage' : `/mypage?tab=${id}`);
}

/**
 * 그 역할의 마이페이지에 이 메뉴가 있는가 — 보이는 것만 센다.
 * 사이드바/탭바/Navbar 메뉴 중 **어디에든 하나 보이면** 있는 것으로 본다.
 */
export async function myPageMenuVisible(page: Page, label: string): Promise<boolean> {
  await page.goto('/mypage');
  return page.evaluate((t) => {
    const seen = (el: Element) => !!(el as HTMLElement).offsetParent || getComputedStyle(el).position === 'fixed';
    return Array.from(document.querySelectorAll('a, button, span'))
      .some(el => el.textContent?.trim() === t && seen(el));
  }, label);
}

/**
 * 공모 등록에 쓸 **서로 어긋나지 않는 날짜 한 벌**.
 *
 * ⚠️ 2026-08-19 에 `submissionDeadline`(자료제출 마감일)이 **필수**가 됐고,
 *    지원마감 < 자료제출마감 < 전시시작 순서까지 서버가 검사한다(`assertSubmissionDeadline`).
 *    예전 테스트들은 이 필드를 안 보내 400 을 받았고, 공모가 안 만들어지니
 *    그 뒤의 지원·수락·운영·정산이 **전부 줄줄이 실패**했다(2026-08-28: 30여 개).
 *    새 필수 필드가 생기면 여기 한 곳만 고치면 된다.
 */
export function exhibitionDates(now = Date.now()) {
  const day = (n: number) => new Date(now + n * 864e5).toISOString().slice(0, 10);
  return {
    deadlineStart: day(0),        // 접수 시작
    deadline: day(30),            // 지원 마감
    submissionDeadline: day(40),  // 자료 제출 마감 (지원마감 < 여기 < 전시시작)
    exhibitStartDate: day(50),    // 전시 시작
    exhibitDate: day(60),         // 전시 종료
  };
}

/**
 * 승인된 공모 하나 만들기 (등록 → Admin 승인).
 * @returns 공모 id
 */
export async function createExhibition(
  api: import('@playwright/test').APIRequestContext,
  opts: {
    title: string;
    galleryId: number;
    capacity?: number;
    type?: 'SOLO' | 'GROUP' | 'ART_FAIR';
    region?: string;
    description?: string;
    approve?: boolean;
    dates?: Partial<ReturnType<typeof exhibitionDates>>;
    extra?: Record<string, unknown>;
    token?: string;
  },
): Promise<number> {
  const gTok = opts.token ?? tokenFor('gallery');
  const res = await api.post(`${API}/exhibitions`, {
    headers: { Authorization: `Bearer ${gTok}` },
    data: {
      ...exhibitionDates(),
      ...opts.dates,
      title: opts.title,
      type: opts.type ?? 'SOLO',
      capacity: opts.capacity ?? 5,
      region: opts.region ?? 'SEOUL',
      description: opts.description ?? 'E2E 공모',
      galleryId: opts.galleryId,
      ...opts.extra,
    },
  });
  if (!res.ok()) throw new Error(`공모 등록 실패 ${res.status()}: ${await res.text()}`);
  const id = (await res.json()).id as number;

  if (opts.approve !== false) {
    const ap = await api.patch(`${API}/approvals/exhibition/${id}`, {
      headers: { Authorization: `Bearer ${tokenFor('admin')}` },
      data: { status: 'APPROVED' },
    });
    if (!ap.ok()) throw new Error(`공모 승인 실패 ${ap.status()}: ${await ap.text()}`);
  }
  return id;
}

/**
 * 그 작가의 포트폴리오에 **둘러보기 공개** 작품을 want 장 이상 확보한다.
 *
 * ⚠️ 공개 여부 필드는 `isPublic` 이 아니라 **`showInExplore`** 이고,
 *    켜는 것도 본문이 아니라 전용 토글 `PATCH /portfolio/images/:id/explore` 다.
 *    잘못 쓰면 작품은 생기는데 **둘러보기·홈에는 하나도 안 뜬다**(에러도 안 난다).
 */
export async function ensurePublicArtworks(
  api: import('@playwright/test').APIRequestContext,
  token: string,
  want = 3,
) {
  const h = { Authorization: `Bearer ${token}` };
  let pf = await (await api.get(`${API}/portfolio`, { headers: h })).json();
  let images = pf.images || [];
  for (let i = images.length; i < want; i++) {
    await api.post(`${API}/portfolio/images`, { headers: h, data: { url: `/uploads/art${(i % 3) + 1}.png` } });
  }
  pf = await (await api.get(`${API}/portfolio`, { headers: h })).json();
  for (const img of pf.images || []) {
    if (!img.showInExplore) await api.patch(`${API}/portfolio/images/${img.id}/explore`, { headers: h });
  }
  pf = await (await api.get(`${API}/portfolio`, { headers: h })).json();
  return (pf.images || []) as { id: number; url: string; showInExplore?: boolean }[];
}

/**
 * 갤러리가 **새로** 만든 공개 작품 하나에 하트를 눌러 둔다 → 갤러리 my-likes 에 확실히 1건 남긴다.
 *
 * ⚠️ `POST /explore/:id/like` 는 **토글**이라, 여러 테스트가 같은 이미지를 좋아요하면 서로 취소된다.
 *    그래서 매번 **고유한 새 작품**을 만들어 첫 좋아요(항상 ON)를 보장한다.
 * @returns 좋아요된 이미지 { id, url, artistId }
 */
export async function seedGalleryLike(
  api: import('@playwright/test').APIRequestContext,
  artistRole: 'artist' | 'artist2' = 'artist',
) {
  const aH = { Authorization: `Bearer ${tokenFor(artistRole)}` };
  const gH = { Authorization: `Bearer ${tokenFor('gallery')}` };
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const created = await api.post(`${API}/portfolio/images`, {
    headers: aH, data: { url: `/uploads/like-${stamp}.png` },
  });
  if (!created.ok()) throw new Error(`작품 생성 실패 ${created.status()}: ${await created.text()}`);
  const img = await created.json();
  await api.patch(`${API}/portfolio/images/${img.id}/explore`, { headers: aH });   // 둘러보기 공개
  const liked = await api.post(`${API}/explore/${img.id}/like`, { headers: gH });   // 신규라 항상 ON
  if (!liked.ok()) throw new Error(`좋아요 실패 ${liked.status()}: ${await liked.text()}`);
  return { id: img.id as number, url: img.url as string, artistId: userIds()[artistRole] };
}

/**
 * 로컬 파일시스템 경로 — Playwright `setInputFiles`/filechooser 로 실제 업로드할 때 쓴다.
 * (`realUploadUrl` 은 서버 URL 을 주지만, 파일 첨부 UI 테스트는 진짜 파일이 필요하다)
 */
export function realUploadPath(kind: 'image' | 'pdf' = 'image'): string {
  const dir = path.resolve(process.cwd(), '../backend/uploads');
  const rx = kind === 'pdf' ? /\.pdf$/i : /\.(png|jpe?g|webp)$/i;
  const f = fs.readdirSync(dir).find(n => rx.test(n));
  if (!f) throw new Error(`backend/uploads 에 ${kind} 파일이 없습니다.`);
  return path.join(dir, f);
}
