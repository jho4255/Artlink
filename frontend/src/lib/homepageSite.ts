/**
 * 작가·갤러리 홈페이지 개편 (2026-11-14, CLAUDE.md 규칙 82) — 화면이 쓰는 순수 판단.
 *
 * 컴포넌트(`components/homepage/`)는 여기서 "무엇을 그리는가 · 어디로 보내는가"를 받아 그리기만 한다 — 단위 테스트가 이 파일을 본다.
 * 서버와 값이 같아야 하는 상수(글자 수·한도)는 `homepageSite.test.ts` 가 서버 소스와 대조한다.
 */
import { galleryPath } from './handle';
import type { NowShowing } from '@/types';

/* ───── 서버와 같은 값 ───── */
/** 관람 시간 칸 — 서버 `routes/gallery.ts GALLERY_OPEN_HOURS_MAX` */
export const GALLERY_OPEN_HOURS_MAX = 80;
/** 비회원 문의 — 서버 `lib/homepageInquiry.ts` */
export const INQUIRY_NAME_MAX = 40;
export const INQUIRY_CONTACT_MAX = 100;
export const INQUIRY_MESSAGE_MAX = 1000;

/** 서버 `isContactLike` 와 같은 규칙 — 보내기 전에 막아 헛된 요청을 줄인다(최종 판정은 서버) */
export function isContactLike(raw: string): boolean {
  const s = raw.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return true;
  if (/^[+(\d][\d\s()\-.]*$/.test(s) && (s.match(/\d/g) ?? []).length >= 8) return true;
  return false;
}

/* ───── 첫 화면(표지) ───── */
/**
 * 표지 두 칸의 비율 — 대표작 모양으로 가른다. 가로 그림은 그림 칸을 넓게(5:7), 세로 그림은 글 칸을 넓게(7:5), 그 사이는 반반.
 * 비율을 모르면 정사각으로 본다. Tailwind 가 읽을 수 있게 **완성된 클래스 문자열**을 돌려준다(조립하면 빌드에서 빠진다).
 */
export type CoverShape = 'landscape' | 'square' | 'portrait';
export function coverShape(width?: number | null, height?: number | null): CoverShape {
  if (!width || !height) return 'square';
  const a = width / height;
  if (a >= 1.2) return 'landscape';
  if (a <= 0.8) return 'portrait';
  return 'square';
}
export const COVER_GRID: Record<CoverShape, string> = {
  landscape: 'md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]',
  square: 'md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]',
  portrait: 'md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]',
};

/* ───── '전시 중' 띠 ───── */
export type { NowShowing } from '@/types';

/** KST 달력의 'M월 D일' — 전시 날짜는 UTC 자정(=KST 09:00)으로 저장돼 있다(규칙 14) */
export function monthDayKst(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).formatToParts(d);
  const m = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return m && day ? `${m}월 ${day}일` : '';
}

/** 띠의 글자 — [상태, 제목, 갤러리·날짜]. 상태 글자만 강조색이다(규칙 47 — 빨강은 상태에만) */
export function nowShowingParts(now: NowShowing): { label: string; title: string; detail: string } {
  const when = now.state === 'ongoing'
    ? (now.endDate ? `${monthDayKst(now.endDate)}까지` : '')
    : (now.startDate ? `${monthDayKst(now.startDate)}부터` : '');
  return {
    label: now.state === 'ongoing' ? '전시 중' : '전시 예정',
    title: now.title,
    detail: [now.gallery?.name, when].filter(Boolean).join(' · '),
  };
}

/** 띠를 누르면 — 갤러리 홈페이지(핸들 우선). 갤러리 없이 연 아트링크 공모면 그 공모 */
export function nowShowingHref(now: NowShowing): string {
  return now.gallery ? galleryPath(now.gallery) : `/exhibitions/${now.exhibitionId}`;
}

/* ───── 갤러리 방문 정보 ───── */
/** 주소 → 카카오맵 검색(새 창). 주소를 그대로 검색어로 넘긴다 */
export function mapHref(address: string): string {
  return `https://map.kakao.com/link/search/${encodeURIComponent(address.trim())}`;
}

/** 인스타 주소 → 링크. 'instagram.com/…'·'@아이디'·'아이디' 모두 받는다(갤러리가 적은 그대로 저장돼 있다) */
export function instagramHref(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  return v.startsWith('http') ? v : `https://instagram.com/${v.replace(/^@+/, '').replace(/^(www\.)?instagram\.com\//, '')}`;
}

/** 전화 걸기 링크 — 숫자·+ 만 남긴다 */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/* ───── 문의 ───── */
/** 작품 문의의 첫 글 — 회원이 ArtTalk 으로 보낼 때 칸에 미리 채운다(고칠 수 있다) */
export function inquiryDraft(work?: { title?: string | null } | null): string {
  if (!work) return '';
  const t = work.title?.trim();
  return t ? `〈${t}〉 작품 문의드립니다.` : '작품 문의드립니다.';
}

/* ───── 주인에게 한 번 — '홈페이지 모양이 새로워졌어요' ───── */
const NOTICE_KEY = 'artlink-homepage-v3-notice';
export function siteNoticeSeen(userId: number): boolean {
  try { return (localStorage.getItem(NOTICE_KEY) ?? '').split(',').includes(String(userId)); } catch { return true; }
}
export function markSiteNoticeSeen(userId: number): void {
  try {
    const seen = new Set((localStorage.getItem(NOTICE_KEY) ?? '').split(',').filter(Boolean));
    seen.add(String(userId));
    localStorage.setItem(NOTICE_KEY, [...seen].slice(-20).join(','));
  } catch { /* 저장소가 막혔으면 이번 화면에서만 닫힌다 */ }
}
