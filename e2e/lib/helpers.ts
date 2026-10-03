import { Browser, BrowserContext, Page, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import zlib from 'zlib';

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
      artworkImages: ['/uploads/e2e-artwork.jpg'],
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
  const card = exhibitionCard(page, exhibitionTitle);
  await cardToggle(card, 'applicants').click();
  // 패널 머리의 정원 줄('수락 N/M명')이 뜨면 목록까지 받은 것이다
  await expect(card.getByText(/수락 \d+/).first()).toBeVisible({ timeout: 15000 });
  return card;
}

/** 갤러리 [내 공모]의 공모 카드 — 제목으로 특정한다 */
export function exhibitionCard(page: Page, exhibitionTitle: string) {
  return page.locator('article').filter({ hasText: exhibitionTitle }).first();
}

/**
 * 지원자 한 줄 — 체크박스 이름(`<이름> 선택`)으로 특정한다.
 * ⚠️ 줄 버튼 이름으로 찾지 말 것 — 'Artist 1' 이 'Artist 10…19' 에도 걸린다.
 */
export function applicantRow(scope: import('@playwright/test').Locator | Page, name: string) {
  // 줄은 체크박스('<이름> 선택') 또는 펼침 버튼(이름으로 시작)으로 찾는다 — 수락·거절한 줄엔 체크박스가 없다(2026-09-29).
  // 닉네임이 있으면 '이름 (닉네임)' 이 된다. 'Artist 1' 이 'Artist 10' 에 걸리지 않게 뒤를 막는다.
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 이름 칸은 칩과 붙어 있어("Artist 1검토 대기") 줄 전체 글자로는 끝을 못 막는다 — 이름만 든 요소를 찾는다
  const who = new RegExp(`^${esc}(?: \\([^)]*\\))?$`);
  // ⚠️ filter({ has }) 의 안쪽 로케이터는 **페이지 기준**이어야 한다 — 카드 로케이터로 만들면 '행 안에서 카드를' 찾아 늘 빈다
  const root: Page = typeof (scope as { page?: unknown }).page === 'function' ? (scope as import('@playwright/test').Locator).page() : (scope as Page);
  return scope.locator('li').filter({ has: root.getByText(who) }).first();
}

/**
 * 지원자 수락 — 줄을 펼쳐 [수락하기] → 확인창 [수락하기] (2026-09-29, 예전엔 줄의 `<select>`).
 * 펼친 줄이 아니면 [수락하기] 가 없다.
 */
export async function acceptApplicant(page: Page, scope: import('@playwright/test').Locator | Page, name: string) {
  const row = applicantRow(scope, name);
  const accept = row.getByRole('button', { name: '수락하기', exact: true });
  if (!(await accept.isVisible().catch(() => false))) {
    await row.locator('button[aria-expanded]').first().click();
  }
  await accept.click();
  await page.getByRole('dialog').getByRole('button', { name: '수락하기', exact: true }).click();
  await expect(row).toContainText('수락됨', { timeout: 10000 });
}

/**
 * 운영 화면의 접힌 구역(운영 공지 · 출품 자료 · 정산)을 펼친다 — 이미 펼쳐져 있으면 그대로 둔다.
 * ⚠️ 무작정 누르면 기본으로 펼쳐져 있던 구역(현재 단계의 것)이 **접힌다**.
 */
export function sectionToggle(scope: import('@playwright/test').Locator | Page, title: string) {
  // ⚠️ 이름만으로 찾지 말 것 — '지금 할 일' 줄("출품 자료를 제출해 주세요")·할 일 버튼("정산하기")도 같은 글자로 시작한다.
  //    접힌 구역의 머리 버튼만 aria-controls + aria-expanded 를 함께 갖는다(메뉴 버튼은 aria-controls 가 없다).
  return scope.locator('button[aria-controls][aria-expanded]').filter({ hasText: new RegExp(`^${title}`) }).first();
}

export async function openSection(scope: import('@playwright/test').Locator | Page, title: string) {
  const toggle = sectionToggle(scope, title);
  await expect(toggle).toBeVisible({ timeout: 15000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  return toggle;
}

/**
 * 갤러리 운영 페이지(`/exhibitions/:id/operation/new`)에서 [출품 자료] 구역을 연다.
 * (옛 `/operation` 은 이 주소로 리다이렉트된다 — 작가는 마이페이지로)
 */
export async function openGallerySubmissions(page: Page, exhibitionId: number) {
  await page.goto(`/exhibitions/${exhibitionId}/operation/new`);
  await expect(page.getByText('진행 단계').first()).toBeVisible({ timeout: 15000 });
  await openSection(page, '출품 자료');
}

/**
 * 작가 [내 전시]에서 그 전시 카드를 펼친다 — 알림이 쓰는 딥링크(`?tab=applications&ex=<id>`)로 간다.
 * 카드 안에 운영 공지 · 출품 자료 · 정산 확인이 들어 있다(작가는 운영 페이지로 가지 않는다).
 */
export async function openArtistExhibition(page: Page, exhibitionId: number) {
  await page.goto(`/mypage?tab=applications&ex=${exhibitionId}`);
  // 카드 id 는 지원(Application) id 라 공모 id 로는 못 집는다 — 딥링크가 펼쳐 둔 카드 = [닫기] 가 있는 카드
  const expanded = page.locator('article').filter({ has: page.getByRole('button', { name: '닫기', exact: true }) }).first();
  await expect(expanded).toBeVisible({ timeout: 15000 });
  return expanded;
}

/**
 * 카드 아래 줄의 [지원자 N] / [운영] 토글(2026-09-29 — 예전 [지원자 관리]/[상세 운영] 버튼).
 * ⚠️ 이름을 `/^지원자/` 로 찾지 말 것 — 카드의 '지금 할 일' 줄("지원자 3명이 검토를…")도 지원자로 시작하는 버튼이다.
 */
export function cardToggle(card: import('@playwright/test').Locator, tab: 'applicants' | 'operation') {
  return tab === 'applicants'
    ? card.getByRole('button', { name: /^지원자 \d+$/ })
    : card.getByRole('button', { name: '운영', exact: true });
}

/* ─────────────────────────────────────────────────────────────
   작가 홈페이지 편집 화면 (2026-10-02 개편) — 묶음 [작품 · 소개 · 약력 · 파일 · 꾸미기]
   ───────────────────────────────────────────────────────────── */
export type EditSection = '작품' | '소개' | '약력' | '파일' | '꾸미기';
const EDIT_SECTION_ID: Record<EditSection, string> = { '작품': 'works', '소개': 'intro', '약력': 'cv', '파일': 'file', '꾸미기': 'style' };

/**
 * 편집 화면의 묶음 탭.
 * ⚠️ `page.getByRole('tab', { name: '작품' })` 로 집지 말 것 — 오른쪽 **미리보기에도 같은 이름의 탭**(홈페이지 메뉴)이 있다.
 *    반드시 tablist 이름('홈페이지 편집')으로 좁힌다. 미리보기 쪽은 `previewTab()`.
 */
export const editSectionTab = (page: Page, section: EditSection) =>
  page.getByRole('tablist', { name: '홈페이지 편집' }).getByRole('tab', { name: new RegExp(`^${section}`) });
/** 미리보기(공개 페이지와 같은 컴포넌트)의 탭 — 넓은 화면에서만 옆에 있다 */
export const previewTab = (page: Page, name: string | RegExp) =>
  page.getByRole('tablist', { name: '홈페이지 메뉴' }).getByRole('tab', { name });

/**
 * 작가 홈페이지 편집 화면을 그 묶음까지 연 채로 연다.
 * ⚠️ 준비됐는지를 **[저장] 버튼으로 기다리지 말 것** — 고친 게 없으면 저장 버튼이 없다(그 자리에 [내 홈페이지 보기]).
 *    묶음 탭이 선택된 것으로 기다린다.
 */
export async function openHomepageEditor(page: Page, section: EditSection = '작품') {
  await page.goto(`/mypage?tab=homepage-edit${section === '작품' ? '' : `&section=${EDIT_SECTION_ID[section]}`}`);
  await expect(editSectionTab(page, section)).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
}
export async function openEditSection(page: Page, section: EditSection) {
  await editSectionTab(page, section).click();
  await expect(editSectionTab(page, section)).toHaveAttribute('aria-selected', 'true');
}
/** 저장 바의 [저장] — 글·꾸미기를 고쳐야 나타난다. 작품 정보 창에도 [저장]이 있어 바 안으로 좁힌다 */
export const editorSave = (page: Page) => page.locator('[data-save-bar]').getByRole('button', { name: '저장', exact: true });
/** 저장한 뒤 도착하는 공개 홈페이지 주소 — 주소(@)가 있으면 `/@handle`, 없으면 `/portfolio/:id` */
export const PUBLIC_HOMEPAGE_URL = /\/(portfolio\/\d+|@[a-z0-9._]+)(\?|$)/;

/* ─────────────────────────────────────────────────────────────
   포트폴리오 PDF 만들기 화면 (2026-10-03 개편) — 미리보기 + 아래 바 [꾸미기 · 작품 고르기 · PDF 저장]
   넓은 화면은 편집 패널이 **연 채로** 시작하고, 좁은 화면은 아래 바 위에 편집 탭 줄이 늘 있다(누르면 시트).
   ───────────────────────────────────────────────────────────── */
export type CustomizeTabLabel = '표지' | '작품' | '약력' | '색·글꼴' | '이름·연락처';

/** 만들기 화면을 열고 미리보기 첫 쪽이 그려질 때까지 기다린다 */
export async function openPortfolioMaker(page: Page) {
  await page.goto('/mypage?tab=portfolio');
  await expect(page.getByTestId('portfolio-maker')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-book-preview] [data-page-index="0"]')).toBeVisible({ timeout: 20000 });
}
/** 아래 바 — [꾸미기]·[작품 고르기]·[PDF 저장]. 같은 이름의 버튼이 크게 보기·저장 창에도 있어 바 안으로 좁힌다 */
export const makerBar = (page: Page) => page.locator('[data-maker-bar]');
/** 미리보기의 n 번째 쪽(0부터) */
export const previewPage = (page: Page, index: number) => page.locator(`[data-book-preview] [data-page-index="${index}"]`);
/** 미리보기에서 그 성격의 쪽 — cover · works · cv · contact … */
export const previewPageOfKind = (page: Page, kind: string) => page.locator(`[data-book-preview] [data-page-kind="${kind}"]`);
/**
 * 꾸미기의 묶음 탭.
 * ⚠️ 탭 이름으로만 집지 말 것 — 공개 홈페이지·편집 화면에도 '표지'·'작품' 같은 탭이 있다. tablist 이름('꾸미기')으로 좁힌다.
 */
export const customizeTab = (page: Page, label: CustomizeTabLabel) =>
  page.getByRole('tablist', { name: '꾸미기' }).getByRole('tab', { name: label, exact: true });
/**
 * 편집을 열고 그 묶음으로 간다. 넓은 화면은 오른쪽 패널(처음부터 열려 있다), 좁은 화면은 아래 시트 — 어느 쪽이든 `[data-customize]`.
 * 좁은 화면은 아래 바의 탭 줄(`group` '편집')로 연다 — 거기에는 [꾸미기] 단추가 없다.
 */
export async function openCustomize(page: Page, label: CustomizeTabLabel) {
  if (!(await page.locator('[data-customize]').count())) {
    const row = makerBar(page).getByRole('group', { name: '편집' });
    if (await row.isVisible()) await row.getByRole('button', { name: label, exact: true }).click();
    else await makerBar(page).getByRole('button', { name: '꾸미기' }).click();
  }
  await customizeTab(page, label).click();
  await expect(customizeTab(page, label)).toHaveAttribute('aria-selected', 'true');
}
export const customizePanel = (page: Page) => page.locator('[data-customize]');
export const saveDialog = (page: Page) => page.getByRole('dialog', { name: 'PDF 저장' });
/** 맨 위의 용지 고르기 — 세로 A4 · 가로 A4 · 와이드 16:9 */
export const paperRadio = (page: Page, label: '세로 A4' | '가로 A4' | '와이드 16:9') =>
  page.getByRole('radiogroup', { name: '용지' }).getByRole('radio', { name: label, exact: true });

/**
 * 단색 PNG 한 장을 굽는다(의존성 없이) — 파일 선택 창으로 **실제 업로드**를 태울 때 쓴다.
 * `setInputFiles([{ name, mimeType: 'image/png', buffer: solidPng(600, 400, [200, 60, 60]) }])`
 */
export function solidPng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
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
 * ── 부하·동시성 검증용 ──────────────────────────────────────────────
 * 시드 4명(artist/artist2/gallery/admin)으로는 "여러 사람이 동시에" 를 못 만든다.
 * seed.ts 가 만드는 유저는 id 1~23 이므로, 백엔드와 **같은 비밀키로 직접 서명**해
 * 임의 유저의 토큰을 얻는다(global-setup 이 4명에게 하는 것과 같은 방식).
 * ⚠️ 로그인 API 를 20번 때리는 대신 서명하는 이유 — 카카오 OAuth 라 E2E 가 로그인을 못 한다.
 */
function jwtSecret(): string {
  try {
    const env = fs.readFileSync(path.resolve(process.cwd(), '../backend/.env'), 'utf-8');
    const m = env.match(/^JWT_SECRET=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch {}
  return 'artlink-dev-secret';
}

export function tokenForUserId(id: number, role: 'ARTIST' | 'GALLERY' | 'ADMIN' = 'ARTIST'): string {
  return jwt.sign({ userId: id, role }, jwtSecret(), { expiresIn: '7d' });
}

export const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * "여러 사람이 동시에" 를 만들기 위한 **검증용 사용자 무리**.
 *
 * ⚠️ 시드(`seed.ts`)가 만드는 유저는 **4명뿐**이다. 로컬 DB 에 20명 넘게 보이는 건
 *    지난 E2E 가 남긴 것이라 `migrate reset` 뒤에는 사라진다 — 그걸 전제로 쓰면
 *    토큰이 401 로 떨어지고, 부하 테스트가 "카운트 드리프트"로 **오진**한다.
 *    그래서 매 실행마다 직접 만든다(가입 API 를 쓰므로 동의 필수화도 함께 검증된다).
 *
 * 같은 실행 안에서는 캐시해 재사용한다(가입은 bcrypt 라 느리다).
 */
const CROWD_PW = 'CrowdTest1234!';
let crowdCache: { id: number; token: string }[] = [];

export async function crowdUsers(
  api: import('@playwright/test').APIRequestContext,
  n: number,
): Promise<{ id: number; token: string }[]> {
  if (crowdCache.length >= n) return crowdCache.slice(0, n);

  for (let i = crowdCache.length; i < n; i++) {
    const email = `crowd${i}@e2e.test`;
    let r = await api.post(`${API}/auth/signup`, {
      data: {
        name: `무리${i}`, email, password: CROWD_PW, role: 'ARTIST',
        agreeTerms: true, agreePrivacy: true,
      },
    });
    if (r.status() === 409) {
      r = await api.post(`${API}/auth/login`, { data: { email, password: CROWD_PW } });
    }
    if (!r.ok()) throw new Error(`검증용 사용자 ${email} 준비 실패 ${r.status()}: ${await r.text()}`);
    const b = await r.json();
    crowdCache.push({ id: b.user.id as number, token: b.token as string });
  }
  return crowdCache.slice(0, n);
}

/** 같은 요청을 동시에 N개 쏘고 상태코드 분포를 돌려준다 (동시성 검증의 기본 도구) */
export async function fireConcurrently<T>(
  tasks: (() => Promise<T>)[],
): Promise<PromiseSettledResult<T>[]> {
  return Promise.allSettled(tasks.map((t) => t()));
}

/** 밀리초 측정 */
export async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const t0 = Date.now();
  const value = await fn();
  return { ms: Date.now() - t0, value };
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

/**
 * 서식 있는 글 편집기(TipTap)에 글 쓰기 — 공모 소개·전시 소개·갤러리 소개(2026-10-03).
 * 편집기는 `<textarea>` 가 아니라 contenteditable 이라 placeholder 로 못 찾는다 — 역할(textbox) + 이름(placeholder 와 같은 aria-label)으로 찾는다.
 */
export async function typeRich(page: Page, name: string | RegExp, text: string) {
  const editor = page.getByRole('textbox', { name });
  await expect(editor).toBeVisible({ timeout: 15000 });   // 편집기는 필요할 때 받는 청크다
  await editor.click();
  await page.keyboard.type(text);
}
