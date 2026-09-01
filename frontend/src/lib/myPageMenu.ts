/**
 * 마이페이지 메뉴 정의 — **여기가 유일한 출처다.**
 *
 * 쓰는 곳이 셋이라 한 군데 모아둔다. 예전처럼 MyPage 안에만 두면 다른 두 곳이 조용히 어긋난다.
 *   1) `components/layout/MyPageSideMenu.tsx` — lg↑ 전 페이지 우측 세로 사이드바
 *   2) `components/layout/Navbar.tsx`        — lg↓ 우측 상단 [메뉴] 버튼 안의 목록
 *   3) `pages/MyPage.tsx`                    — lg↓ 본문 위 가로 탭바 + 탭별 콘텐츠 분기
 *
 * ⚠️ 항목을 추가하면 `MyPage.tsx` 의 콘텐츠 분기(`currentTab === '...'`)에도 넣을 것.
 *    여기에만 넣으면 메뉴는 뜨는데 눌러도 **빈 화면**이 된다(역할 폴백에 걸려 프로필로 튄다).
 */
import {
  Camera, FileText, Heart, Star, Ticket, Building2, Bookmark, Home,
  Check, Eye, AlertTriangle, Search, ClipboardList, ListChecks, Wrench, Frame, Megaphone,
  type LucideIcon,
} from 'lucide-react';

export interface MyPageTab {
  id: string;
  label: string;
  icon: LucideIcon;
  /**
   * 마이페이지 탭이 아니라 **바깥으로 나가는 항목**.
   * 지금은 [홈페이지] 하나뿐 — 공개 작가 페이지로 보낸다.
   * 이런 항목엔 MyPage 콘텐츠 분기가 없어야 한다(`resolveTab` 이 절대 돌려주지 않는다).
   */
  linkTo?: (userId: number) => string;
  /**
   * ArtLink 로고처럼 **앞은 검정 · 뒤는 빨강**으로 찍을 이름. `['Art','Look']` → Art**Look**.
   * 브랜드 이름인 항목에만 준다(그냥 기능 이름에 색을 넣으면 로고 규칙이 헐거워진다).
   * 글씨체도 로고와 맞춘다 — `font-bold tracking-tight font-serif` (렌더 쪽에서 처리).
   */
  brand?: [string, string];
  /** 이름만으로 뭔지 모를 때 옆에 작게 붙이는 설명 (예: ArtLook → '액자 걸기') */
  note?: string;
}

export type MyPageRole = 'ARTIST' | 'GALLERY' | 'ADMIN' | string;

const ARTIST_TABS: MyPageTab[] = [
  { id: 'profile', label: '프로필', icon: Camera },
  // 작가에게 이 페이지는 '내 포트폴리오 관리 화면'이 아니라 **남에게 보여줄 홈페이지**다.
  // 그래서 메뉴에서는 편집 화면이 아니라 공개 페이지로 바로 보낸다 — 고치기 전에 남에게
  // 어떻게 보이는지 반드시 한 번 보게 된다. 편집은 그 페이지의 [수정] 버튼(주인만)으로.
  { id: 'homepage', label: '홈페이지', icon: Home, linkTo: (userId) => `/portfolio/${userId}` },
  // PDF로 뽑는 포맷 4종. 예전엔 편집 화면 맨 아래에 붙어 있어 있는 줄도 몰랐다.
  { id: 'portfolio', label: '포트폴리오', icon: FileText },
  // [받은 초대] 탭은 없앴다 — 초대도 결국 '내 전시'의 한 단계라 [내 전시] 첫 탭(초대받은 전시)으로 합쳤다.
  // 좋아요한 작품은 [찜 목록] 안의 '작품' 필터로 들어갔다(둘 다 '모아둔 것'이라 탭을 나눌 이유가 없었다).
  { id: 'favorites', label: '찜 목록', icon: Heart },
  // '내 리뷰' 탭은 없앴다 — 리뷰 수정·삭제는 갤러리 상세에서 본인에게 그대로 열려 있다.
  { id: 'applications', label: '내 전시', icon: Ticket },
  // 작품을 액자·전시 공간에 얹어 SNS 홍보 이미지를 만드는 도구.
  // 예전엔 홈페이지 편집 화면 안 버튼이라 '수정'에 들어가야만 보였다 — 편집과 무관한 기능인데.
  // 이름이 ArtLink 와 비슷해 헷갈리므로 옆에 무엇인지 작게 적는다.
  { id: 'artlook', label: 'ArtLook', brand: ['Art', 'Look'], note: '액자 걸기', icon: Frame },
];

/**
 * 메뉴에는 없지만 살아 있는 마이페이지 탭 — 다른 화면의 버튼으로만 들어간다.
 * `homepage-edit`: 공개 작가 페이지의 [수정](주인만)에서 온다.
 */
const HIDDEN_TABS: Record<string, string[]> = {
  ARTIST: ['homepage-edit'],
};

const GALLERY_TABS: MyPageTab[] = [
  { id: 'profile', label: '프로필', icon: Camera },
  { id: 'my-galleries', label: '내 갤러리', icon: Building2 },
  { id: 'my-exhibitions', label: '내 공모', icon: FileText },
  { id: 'my-shows', label: '내 전시', icon: Ticket },
  { id: 'scraps', label: '관심 작품', icon: Bookmark },
];

const ADMIN_TABS: MyPageTab[] = [
  { id: 'profile', label: '프로필', icon: Camera },
  { id: 'approvals', label: '승인 관리', icon: Check },
  { id: 'hosted-exhibitions', label: '주최 공모', icon: FileText },
  { id: 'hero-manage', label: '히어로 관리', icon: Eye },
  { id: 'benefit-manage', label: '혜택 관리', icon: FileText },
  { id: 'gotm-manage', label: '이달의 갤러리', icon: Star },
  { id: 'ad-manage', label: '광고 관리', icon: Megaphone },
  { id: 'report-manage', label: '신고 관리', icon: AlertTriangle },
  { id: 'user-manage', label: '사용자 관리', icon: Search },
  { id: 'oversight', label: '운영 조회', icon: ClipboardList },
  { id: 'todo', label: '할 일 보드', icon: ListChecks },
  { id: 'dev-tools', label: '개발자 도구', icon: Wrench },
];

export function myPageTabs(role?: MyPageRole | null): MyPageTab[] {
  if (role === 'ARTIST') return ARTIST_TABS;
  if (role === 'GALLERY') return GALLERY_TABS;
  if (role === 'ADMIN') return ADMIN_TABS;
  return [];
}

/** 메뉴에는 없지만 그 역할에서 유효한 탭 (다른 화면의 버튼으로만 들어온다) */
export const hiddenTabs = (role?: MyPageRole | null): string[] => HIDDEN_TABS[String(role)] ?? [];

/** 그 역할이 실제로 **열 수 있는** 마이페이지 탭인가. 바깥 링크 항목(linkTo)은 탭이 아니다. */
export function isMyPageTab(role: MyPageRole | null | undefined, tab?: string | null): boolean {
  if (!tab) return false;
  return myPageTabs(role).some(t => t.id === tab && !t.linkTo) || hiddenTabs(role).includes(tab);
}

/**
 * 역할과 맞지 않는 `?tab=` 값으로 들어오면 빈 화면이 되므로 첫 유효 탭으로 폴백한다.
 * 사이드바(어느 페이지에서든 뜬다)와 MyPage 본문이 **같은 규칙**을 써야 강조와 내용이 어긋나지 않는다.
 */
export function resolveTab(role: MyPageRole | null | undefined, tab?: string | null): string {
  if (isMyPageTab(role, tab)) return tab as string;
  return myPageTabs(role).find(t => !t.linkTo)?.id ?? 'profile';
}

/** 마이페이지 탭 주소. 프로필은 기본 탭이라 쿼리를 붙이지 않는다(주소가 깔끔하고 딥링크도 같다). */
export const myPageHref = (tabId: string): string =>
  tabId === 'profile' ? '/mypage' : `/mypage?tab=${tabId}`;

/**
 * 메뉴 항목이 실제로 가리키는 주소.
 * `linkTo` 가 있으면 바깥 페이지로(홈페이지 → 공개 작가 페이지), 없으면 마이페이지 탭으로.
 * userId 를 모르면(비로그인 등) 바깥 링크를 만들 수 없으므로 마이페이지로 떨어뜨린다.
 */
export function tabHref(tab: MyPageTab, userId?: number | null): string {
  if (tab.linkTo) return userId != null ? tab.linkTo(userId) : '/mypage';
  return myPageHref(tab.id);
}

/** 공개 작가 페이지의 [수정] 이 가는 곳 — 홈페이지 편집 화면 */
export const HOMEPAGE_EDIT_HREF = '/mypage?tab=homepage-edit';

/**
 * 사이드바 **맨 아래**(로그아웃 바로 위)에 붙는 항목.
 * 역할과 무관하고 자주 쓰지 않는 것들이라 역할별 메뉴와 섞지 않는다.
 * ⚠️ Navbar 가운데 메뉴에서 [고객센터]를 뺐으므로 **로그인 사용자의 유일한 문의 경로**다.
 */
export interface FooterLink {
  label: string;
  to: string;
  /** ArtLink 로고처럼 앞 검정 · 뒤 빨강 (`['Art','Story']` → Art**Story**). 브랜드 항목만. */
  brand?: [string, string];
  /** 이름 옆 작은 설명 (예: ArtStory → '소식 공유') */
  note?: string;
  icon?: LucideIcon;
}
/**
 * 역할 메뉴 **바로 아래, 구분선 위**에 붙는 링크 — 자주 쓰는 기능이라 footer(구분선 아래)와 분리한다.
 * ArtStory(소식)는 SNS 피드라 '나가기/문의' 묶음보다 위에 있어야 한다.
 */
export const MYPAGE_PRIMARY_LINKS: FooterLink[] = [
  // 소식(스토리 피드) = ArtStory. 픽토그램은 카메라(작업 사진을 올리는 곳).
  { label: '소식', to: '/feed', brand: ['Art', 'Story'], note: '소식 공유', icon: Camera },
];

/** 구분선 **아래**(로그아웃 위)에 붙는 항목 — 자주 쓰지 않는 것. */
export const MYPAGE_FOOTER_LINKS: FooterLink[] = [
  { label: '1:1 문의', to: '/support' },
];

/** 메뉴 항목의 표시 이름 조각 — 브랜드 이름이면 [앞, 뒤]로, 아니면 [라벨, ''] */
export function tabNameParts(tab: MyPageTab): [string, string] {
  return tab.brand ?? [tab.label, ''];
}
