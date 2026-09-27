/**
 * 갤러리 홈페이지 탭 (2026-09-27, 사용자 요청 "작가 홈페이지처럼") — 소개·모집 중·함께한 작가·지난 전시·리뷰.
 *
 * 작가 홈페이지 탭(`lib/homepageTabs.ts`, CLAUDE.md 56)과 **같은 규칙**이다.
 * - **비어 있는 탭은 만들지 않는다** — 눌렀는데 아무것도 없으면 고장처럼 보인다.
 *   예외 둘: ①리뷰(작가가 글을 쓰러 오는 곳 — 방명록과 같다) ②주인에겐 채울 자리가 있는 탭(소개·지난 전시)을 보여 준다.
 * - 주소는 `?tab=<id>`, 첫 탭은 쿼리를 안 붙인다. 모르는 값·지금 없는 탭이면 첫 탭(옛 링크가 빈 화면이 되지 않게).
 * - 함께한 작가 수는 **방문자에게 보이는 수**다. 숨긴 작가만 남은 갤러리도 주인에겐 탭이 있어야 **다시 보이게** 할 수 있다
 *   (2026-09-27 신고 — 숨긴 뒤 되돌리는 자리를 못 찾았다).
 */
export type GalleryTabId = 'about' | 'calls' | 'artists' | 'history' | 'reviews';

export interface GalleryTabDef {
  id: GalleryTabId;
  label: string;
  count?: number;
}

export const GALLERY_TAB_LABELS: Record<GalleryTabId, string> = {
  about: '소개',
  calls: '모집 중',
  artists: '함께한 작가',
  history: '지난 전시',
  reviews: '리뷰',
};

export function galleryTabs(c: {
  hasAbout: boolean;
  openCallCount: number;
  /** 방문자에게 보이는 작가 수(숨긴 작가 제외) */
  visibleArtistCount: number;
  /** 숨긴 작가 수 — 관리자(주인·Admin)에게만 의미가 있다 */
  hiddenArtistCount?: number;
  historyCount: number;
  reviewCount: number;
  /** 주인 — 소개·지난 전시는 비어 있어도 채우러 들어갈 탭이 필요하다 */
  isOwner: boolean;
  /** 주인 또는 Admin — 숨긴 작가를 되돌릴 수 있는 사람 */
  canManageArtists?: boolean;
}): GalleryTabDef[] {
  const tabs: GalleryTabDef[] = [];
  const count = (n: number) => (n > 0 ? { count: n } : {});
  if (c.hasAbout || c.isOwner) tabs.push({ id: 'about', label: GALLERY_TAB_LABELS.about });
  if (c.openCallCount > 0) tabs.push({ id: 'calls', label: GALLERY_TAB_LABELS.calls, count: c.openCallCount });
  if (c.visibleArtistCount > 0 || (c.canManageArtists && (c.hiddenArtistCount ?? 0) > 0)) {
    tabs.push({ id: 'artists', label: GALLERY_TAB_LABELS.artists, ...count(c.visibleArtistCount) });
  }
  if (c.historyCount > 0 || c.isOwner) tabs.push({ id: 'history', label: GALLERY_TAB_LABELS.history, ...count(c.historyCount) });
  tabs.push({ id: 'reviews', label: GALLERY_TAB_LABELS.reviews, ...count(c.reviewCount) });
  return tabs;
}

/** 요청한 탭이 지금 있으면 그것, 아니면 첫 탭 */
export function resolveGalleryTab(requested: string | null | undefined, tabs: GalleryTabDef[]): GalleryTabId {
  const hit = tabs.find((t) => t.id === requested);
  return (hit ?? tabs[0]!).id;
}

/** 주소에 실을 값 — 첫 탭이면 null(쿼리를 지운다) */
export function galleryTabParam(id: GalleryTabId, tabs: GalleryTabDef[]): string | null {
  return tabs[0]?.id === id ? null : id;
}
