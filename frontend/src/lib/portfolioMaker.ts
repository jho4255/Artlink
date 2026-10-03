/**
 * 포트폴리오 PDF 만들기 화면의 계산 — 순수 함수만 (2026-10-03, 화면은 `components/portfolio-maker/`).
 *
 * 화면을 다시 짠 이유(2026-10-02 조사, 새 작가 계정으로 밟아 봤다):
 *  - 첫 화면에 결과물도 저장 버튼도 없었다(PC 1280×800 에서 [PDF 저장] y856 · 미리보기 y894, 휴대폰은 미리보기 y1375).
 *  - 설정 묶음을 다 펴면 누를 것이 68개였고, 직접 고른 값이 추천 카드 한 번에 확인 없이 덮였으며 되돌릴 길이 없었다.
 *  - 표지 이름(닉네임 우선)·마지막 장의 연락처(전화번호 포함)가 무엇으로 찍히는지 저장한 뒤에야 알 수 있었다.
 *  - 실서버: 작품 있는 작가 47명 중 디자인을 바꿔 본 사람 1명, 버전 0개.
 *
 * 여기에는 화면이 내리는 판단을 모아 둔다 — 화면(React)에 흩어 두면 테스트할 수 없다.
 */
import type { DesignDirection } from '@/lib/portfolioDirection';
import { careerLineText, normalizeCareer } from '@/lib/artwork';
import {
  contactRows, normalizePdfDesign, portfolioName,
  type ContactKey, type CvShow, type PageKey, type PdfDesign, type PortfolioBookData, type PortfolioPage,
} from '@/lib/portfolioFormats';

// ── 꾸미기 묶음 ────────────────────────────────────────────────────────────
// 예전엔 [작품 배치 · 표지 · 색·글꼴·판형 · 세부] 네 묶음이 안쪽 스크롤 상자(PC 420px · 아이폰 SE 188px)에 접혀 있었고,
// 표지 사진·머리말 같은 것은 미리보기의 표지를 눌러야 나오는 다른 패널에 있었다. 지금은 **무엇을 고치는가**로 나눈다.
//
// ⚠️ 2026-10-03 사용자 결정 — **한 탭의 옵션은 그 쪽만 바꾼다.** [표지] 는 표지만, [작품] 은 작품 쪽(시리즈 소개·작품 설명 포함)만,
//    [약력] 은 작가노트·약력 쪽만. 책 전체에 걸리는 것은 [색·글꼴](한 벌)과 [이름·연락처](이름은 어디서나 같은 이름이다), 그리고 맨 위의 **용지**뿐이다.
//    예전엔 '글 정렬' 하나가 작가노트·시리즈 소개·약력을 함께 바꾸고, '프로필 사진' 하나가 작가노트·마지막 장을 함께 바꿨다 — 둘로 나눴다.
export type CustomizeTab = 'cover' | 'works' | 'cv' | 'style' | 'info';
export const CUSTOMIZE_TABS: { id: CustomizeTab; label: string }[] = [
  { id: 'cover', label: '표지' },
  { id: 'works', label: '작품' },
  { id: 'cv', label: '약력' },
  { id: 'style', label: '색·글꼴' },
  { id: 'info', label: '이름·연락처' },
];
/**
 * 탭마다 맡은 디자인 값 — [처음 상태로] 가 **그 탭의 값만** 되돌린다. 탭에 옵션을 더하면 여기에도 적을 것
 * (`portfolioMaker.test.ts` 가 PdfDesign 의 모든 키가 어느 한 탭에 속하는지 대조한다 — 빠지면 어느 탭도 되돌리지 못한다).
 * 용지(`page`)는 탭이 아니라 맨 위에서 고른다. `auto`·`direction` 은 디자인 줄과 [작품] 탭이 함께 쓴다.
 */
export const TAB_KEYS: Record<CustomizeTab, readonly (keyof PdfDesign)[]> = {
  cover: ['coverLayout', 'coverEyebrow', 'coverEyebrowText', 'coverImageScale', 'coverTextScale', 'coverYear', 'coverNameAccent', 'coverImageIds'],
  works: ['auto', 'worksLayout', 'desc', 'worksCaption', 'captionStyle', 'worksIndex', 'worksProseAlign'],
  cv: ['cvShow', 'cvPosition', 'cvColumns', 'cvEnglish', 'proseAlign', 'artistPhoto'],
  style: ['bg', 'ink', 'accent', 'font'],
  info: ['nameSource', 'contact', 'contactPhoto'],
};
/** 그 탭의 값만 처음 상태로 — 다른 탭·용지는 그대로 */
export function resetTab(design: PdfDesign, tab: CustomizeTab): PdfDesign {
  const base = normalizePdfDesign(null);
  const next: PdfDesign = { ...design };
  for (const k of TAB_KEYS[tab]) (next as unknown as Record<string, unknown>)[k] = base[k];
  return next;
}
export const isCustomizeTab = (v: unknown): v is CustomizeTab => CUSTOMIZE_TABS.some((t) => t.id === v);

/**
 * 묶음을 열면 미리보기를 **그 묶음이 바꾸는 쪽**으로 데려간다 — 고른 결과가 화면에 보여야 한다
 * (예전 휴대폰 화면: 표지를 골라도 화면 안에 미리보기가 한 장도 없었다. 0.8~1.3 화면 아래).
 * 색·글꼴은 모든 쪽이 바뀌므로 보던 자리에 둔다(null).
 */
export function pageIndexForTab(pages: Pick<PortfolioPage, 'kind' | 'works'>[], tab: CustomizeTab): number | null {
  if (tab === 'style') return null;
  if (tab === 'cover') return pages.length > 0 ? 0 : null;
  if (tab === 'works') {
    const i = pages.findIndex((p) => p.kind === 'works');
    if (i >= 0) return i;
    // 작품이 시리즈 여는 장에만 실린 경우(1점짜리 시리즈)
    const j = pages.findIndex((p) => (p.works ?? 0) > 0);
    return j >= 0 ? j : null;
  }
  // 약력 — 작가노트와 약력 중 책에서 먼저 나오는 쪽. 둘 다 껐으면 보던 자리에 둔다
  if (tab === 'cv') {
    const i = pages.findIndex((p) => p.kind === 'cv' || (p as Pick<PortfolioPage, 'part'>).part === 'statement');
    return i >= 0 ? i : null;
  }
  // 이름·연락처 — 마지막 장. 연락처를 전부 꺼서 그 장이 없으면 이름이 찍히는 표지로
  const c = pages.findIndex((p) => p.kind === 'contact');
  return c >= 0 ? c : (pages.length > 0 ? 0 : null);
}

/** 미리보기의 그 쪽을 고치려면 어느 묶음을 여는가 */
export function customizeTabForPage(kind: PortfolioPage['kind'], part?: PortfolioPage['part']): CustomizeTab {
  if (kind === 'cover') return 'cover';
  if (kind === 'contact') return 'info';
  if (kind === 'cv' || part === 'statement') return 'cv';
  return 'works';
}

// ── 용지 ──────────────────────────────────────────────────────────────────
/**
 * 용지 — 화면 맨 위에서 **따로** 고른다(2026-10-03 사용자 결정: "가장 중요하니 처음부터 따로").
 * 예전엔 [색·글꼴] 탭 안에 있었고, 위의 디자인 카드('작품 우선'·'다크 룩북')를 누르면 말없이 가로 A4 로 바뀌었다.
 * 지금은 디자인 카드도 [처음 상태로] 도 용지를 건드리지 않는다(`applyDirection`·`resetTab`).
 */
export const PAPER_OPTIONS: readonly { key: PageKey; label: string }[] = [
  { key: 'a4-portrait', label: '세로 A4' },
  { key: 'a4-landscape', label: '가로 A4' },
  { key: 'wide', label: '와이드 16:9' },
];

// ── 약력 탭 ────────────────────────────────────────────────────────────────
export type CvItemKey = keyof CvShow;
export interface CvItem {
  key: CvItemKey;
  label: string;
  /** 적어 둔 내용이 있는가 — 없으면 켜 둬도 실리지 않는다(화면은 흐리게 두고 쓰러 가는 길을 준다) */
  has: boolean;
  /** 줄 수(경력) 또는 글자 수(작가노트·약력) — 화면에 "3줄" "412자" 로 */
  amount: string;
  enabled: boolean;
}
const CV_ITEM_LABEL: Record<CvItemKey, string> = {
  statement: '작가노트', bio: '약력 글', education: '학력', solo: '개인전', group: '단체전', artFair: '아트페어', award: '수상 및 선정',
};
/** [약력] 탭의 '싣는 항목' — 엔진의 판정(`cvContent`)과 같은 기준으로 '적어 둔 게 있는가'를 센다 */
export function cvItems(data: Pick<PortfolioBookData, 'statement' | 'biography' | 'career'>, design: Pick<PdfDesign, 'cvShow'>): CvItem[] {
  const text = (s: unknown) => String(s ?? '').trim();
  const c = normalizeCareer(data.career);
  // 엔진이 줄을 그릴 때와 같은 함수로 센다(연도만 적고 내용이 빈 줄도 엔진은 연도를 찍는다)
  const lines = (k: 'education' | 'solo' | 'group' | 'artFair' | 'award') => (c[k] ?? []).map(careerLineText).filter(Boolean).length;
  return (Object.keys(CV_ITEM_LABEL) as CvItemKey[]).map((key) => {
    const n = key === 'statement' ? text(data.statement).length
      : key === 'bio' ? text(data.biography).length
      : lines(key);
    const amount = n === 0 ? '' : key === 'statement' || key === 'bio' ? `${n}자` : `${n}줄`;
    return { key, label: CV_ITEM_LABEL[key], has: n > 0, amount, enabled: design.cvShow[key] };
  });
}

// ── 머리 ──────────────────────────────────────────────────────────────────
/** "작품 8점 · 7쪽" — 예전엔 `작품 4점 · 총 7쪽 / 작품 4점 실림 · 글 0쪽 · CV 1쪽` 두 줄이었다(처음 온 사람은 CV 가 뭔지부터 모른다) */
export const statusLine = (works: number, pages: number): string => `작품 ${works}점 · ${pages}쪽`;

/**
 * 미리보기에서 쪽 위에 적는 이름. 엔진은 약력·경력 쪽을 'CV' 라고 부른다(테스트·도록이 그 이름을 쓴다) —
 * 처음 온 작가에게는 'CV' 가 무엇인지부터 설명이 필요하므로 화면에서는 **약력**이라고 적는다.
 */
export const pageLabel = (label: string): string => label.replace(/^CV\b/, '약력');

// ── 이렇게 실립니다 (이름 · 연락처) ─────────────────────────────────────────
export const CONTACT_LABEL: Record<ContactKey, string> = {
  email: '이메일', phone: '전화번호', instagram: '인스타그램', web: '홈페이지 주소·QR',
};
const CONTACT_ORDER: ContactKey[] = ['email', 'phone', 'instagram', 'web'];

export interface PrintedContact {
  key: ContactKey;
  label: string;
  /** 프로필에 적어 둔 값. 빈 문자열이면 적어 둔 게 없다(켜도 실리지 않는다) */
  value: string;
  /** 켜 두었는가(값이 없어도 켜져 있을 수 있다) */
  enabled: boolean;
  /** 실제로 찍히는가 = 값이 있고 켜 둠 */
  printed: boolean;
}
export interface PrintedInfo {
  /** 표지·머리말·CV·마지막 장에 찍히는 이름 */
  name: string;
  realName: string;
  nickname: string;
  /** 실명과 다른 닉네임이 있어 고를 수 있는가 — 없으면 고르는 줄을 그리지 않는다 */
  canChooseName: boolean;
  contacts: PrintedContact[];
  /** 저장 창의 한 줄 — "이메일 · 인스타그램 · 홈페이지 주소·QR" (없으면 빈 문자열) */
  printedText: string;
}

/**
 * 저장하기 **전에** 무엇이 실리는지 — 꾸미기의 [이름·연락처] 와 저장 창이 같이 쓴다.
 * 마지막 장을 그리는 `contactRows` 와 같은 출처라, 화면이 말한 것과 다른 것이 찍히지 않는다.
 */
export function printedInfo(data: Pick<PortfolioBookData, 'user' | 'homepageUrl'>, design: Pick<PdfDesign, 'nameSource' | 'contact'>): PrintedInfo {
  const realName = String(data.user.name ?? '').trim();
  const nickname = String(data.user.nickname ?? '').trim();
  const rows = contactRows(data);
  const contacts = CONTACT_ORDER.map((key) => {
    const value = rows.find((r) => r.key === key)?.value ?? '';
    const enabled = design.contact[key];
    return { key, label: CONTACT_LABEL[key], value, enabled, printed: !!value && enabled };
  });
  return {
    name: portfolioName(data.user, design.nameSource),
    realName,
    nickname,
    canChooseName: !!nickname && !!realName && nickname !== realName,
    contacts,
    printedText: contacts.filter((c) => c.printed).map((c) => c.label).join(' · '),
  };
}

// ── 구성(작품 고르기) ───────────────────────────────────────────────────────
// 서버 모델은 `PortfolioVersion` 그대로다. 화면에서만 '버전' 대신 **구성**이라고 부른다 —
// '버전'은 무엇의 버전인지 설명이 없으면 안 읽혔고(실서버 0개), [+ 버전] 을 누르면 설명도 이름 입력도 없이 '새 버전' 이 생겼다.

/** 전체 작품을 홈페이지 순서 그대로 골랐는가 — 그렇다면 따로 저장할 구성이 아니다(그게 곧 '전체 작품'이다) */
export function isDefaultSelection(allIds: number[], ids: number[]): boolean {
  return ids.length === allIds.length && ids.every((id, i) => id === allIds[i]);
}

/** 새 구성의 이름 — "제출용 1", "제출용 2" … 비어 있는 가장 작은 번호 */
export function nextSelectionName(existing: { name: string }[], base = '제출용'): string {
  const names = new Set(existing.map((v) => v.name.trim()));
  for (let i = 1; i < 200; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  return `${base} ${Date.now()}`;
}

// ── 디자인 줄 ──────────────────────────────────────────────────────────────
/**
 * 지금 디자인이 그 방향 **그대로인가** — 디자인 줄의 ✓.
 * 저장된 `direction` 키만 보면 방향을 고른 뒤 표지·색을 직접 바꿔도 ✓ 가 남아 '도록' 이라 적힌 카드와 화면이 다른 모양이 된다.
 * 방향이 정한 값이 전부 그대로이고 자동 배치가 켜져 있을 때만 맞다고 본다(자동 배치에서는 `worksLayout` 을 엔진이 안 본다).
 */
export function directionMatches(design: PdfDesign, dir: Pick<DesignDirection, 'design'>): boolean {
  if (!design.auto) return false;
  // 용지는 디자인이 아니다 — 맨 위에서 따로 고른다(`applyDirection` 이 그대로 둔다)
  return (Object.keys(dir.design) as (keyof PdfDesign)[])
    .every((k) => k === 'worksLayout' || k === 'page' || design[k] === dir.design[k]);
}

/**
 * 디자인 카드를 누르면 — 색·글꼴·표지·배치를 한 벌로 바꾸되 **용지는 그대로**(2026-10-03).
 * 예전엔 '작품 우선'·'다크 룩북' 을 누르면 고른 세로 A4 가 말없이 가로 A4 로 바뀌었다.
 * 이름·연락처도 '디자인'이 아니므로 방향에 들어 있지 않다(방향 정의에 그 키가 없다).
 */
export function applyDirection(design: PdfDesign, dir: Pick<DesignDirection, 'key' | 'design'>): PdfDesign {
  return { ...design, ...dir.design, page: design.page, direction: dir.key, auto: true };
}

// ── 미리보기 크기 ──────────────────────────────────────────────────────────
/** 세로 판형은 600px, 가로 판형은 840px 까지 — 예전엔 화면 높이에 맞춰 PC 339px · 아이폰 243px 로 줄였다(글이 안 읽혔다) */
export const previewMaxWidth = (pageW: number, pageH: number): number => (pageW >= pageH ? 840 : 600);

/**
 * 미리보기 한 쪽의 배율.
 *  - 평소: 칸 폭에 맞추되 `previewMaxWidth` 까지.
 *  - `fitHeight` 를 주면(꾸미기를 열었을 때) 한 쪽이 **통째로** 그 높이 안에 들어오게 더 줄인다 — 고르는 동안에는 지면 전체가 보여야 한다.
 */
export function previewScale(pageW: number, pageH: number, containerW: number, fitHeight?: number | null): number {
  if (!(containerW > 0)) return 0.2;
  const byW = Math.min(containerW, previewMaxWidth(pageW, pageH)) / pageW;
  const byH = fitHeight && fitHeight > 0 ? fitHeight / pageH : Infinity;
  return Math.max(0.05, Math.min(1, byW, byH));
}

// ── 저장 용량 ──────────────────────────────────────────────────────────────
/**
 * 바로 내려받는 PDF 는 쪽마다 그림 한 장(JPEG)이다. 국내 공모의 파일 한도(대개 10MB) 안에 넣으려고
 * 넘칠 때만 아래 사다리를 내려간다 — `k` 는 기준 해상도(≈240dpi)에 곱하는 값, `quality` 는 JPEG 품질.
 * 마지막 단계(≈134dpi)도 화면·심사용으로는 읽힌다. 그래도 넘치면 작품 수를 줄이라고 안내한다.
 */
export interface ExportStep { k: number; quality: number }
export const EXPORT_LADDER: readonly ExportStep[] = [
  { k: 1, quality: 0.9 },
  { k: 0.88, quality: 0.85 },
  { k: 0.76, quality: 0.82 },
  { k: 0.66, quality: 0.78 },
  { k: 0.56, quality: 0.74 },
];
/** 그 단계의 용량이 0단계의 몇 배쯤인가 — JPEG 용량은 픽셀 수에 비례하고 품질에는 그보다 완만하게 따른다(인쇄 경로의 실측과 같은 식) */
export function stepFactor(i: number): number {
  const s = EXPORT_LADDER[Math.min(Math.max(i, 0), EXPORT_LADDER.length - 1)]!;
  const f = EXPORT_LADDER[0]!;
  return (s.k / f.k) ** 2 * (s.quality / f.quality) ** 1.5;
}
/**
 * 0단계로 구운 용량이 `bytes` 일 때 예산에 들어올 단계. 들어오면 0, 어느 단계로도 안 되면 마지막 단계.
 * 추정 오차 여유로 8% 를 남긴다 — 빠듯하게 고르면 한 번 더 구워야 한다.
 */
export function pickStep(bytes: number, budget: number): number {
  if (!(bytes > budget)) return 0;
  const need = (budget / bytes) * 0.92;
  for (let i = 1; i < EXPORT_LADDER.length; i++) if (stepFactor(i) <= need) return i;
  return EXPORT_LADDER.length - 1;
}

/** "6.2MB" — 0.1 아래는 0.1 로(0.0MB 는 고장처럼 보인다) */
export function formatMB(bytes: number): string {
  return `${Math.max(0.1, bytes / 1048576).toFixed(1)}MB`;
}

// ── 환경 ──────────────────────────────────────────────────────────────────
/**
 * 앱 안에서 열린 브라우저인가 — 카카오톡·인스타그램 같은 앱의 내장 브라우저는 파일 내려받기·인쇄가 막혀 있는 경우가 많다.
 * 맞으면 앱 이름을 돌려준다(저장 창이 "다른 브라우저로 열기"를 미리 알려 준다). 실기기로만 확인되는 영역이라 **막지는 않는다**.
 */
export function inAppBrowserName(userAgent: string | null | undefined): string | null {
  const ua = String(userAgent ?? '');
  if (/KAKAOTALK/i.test(ua)) return '카카오톡';
  if (/Instagram/i.test(ua)) return '인스타그램';
  if (/NAVER\(inapp/i.test(ua)) return '네이버 앱';
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return '페이스북';
  if (/\bLine\//i.test(ua)) return '라인';
  if (/DaumApps/i.test(ua)) return '다음 앱';
  return null;
}

// ── 안내 한 줄(홈페이지 편집 저장 직후) ─────────────────────────────────────
/** 이 작품 수부터 "포트폴리오 PDF 도 만들 수 있어요" 를 알린다 — 홈페이지 완성도의 '작품 3점' 과 같은 선 */
export const PDF_HINT_MIN_WORKS = 3;
const hintKey = (userId: number) => `artlink-pdf-hint:${userId}`;
/** 그 안내를 닫았거나 PDF 를 한 번이라도 저장했는가(이 브라우저) — 그러면 다시 알리지 않는다 */
export function pdfHintDismissed(userId: number): boolean {
  try { return window.localStorage.getItem(hintKey(userId)) === '1'; } catch { return true; }
}
export function dismissPdfHint(userId: number): void {
  try { window.localStorage.setItem(hintKey(userId), '1'); } catch { /* 저장이 막힌 브라우저 — 다음에도 뜰 뿐이다 */ }
}
