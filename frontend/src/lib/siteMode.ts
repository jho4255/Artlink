/**
 * '내 사이트' 모드 (2026-11-14, CLAUDE.md 규칙 82) — 작가·갤러리 홈페이지는 ArtLink 메뉴 대신 **그 주인의 이름**이 머리에 선다.
 *
 * 작가들이 이 주소를 인스타·명함에 '내 홈페이지'로 건다. 위에 ArtLink 상단바, 아래에 하단 탭이 붙어 있으면 남의 서비스 안의
 * 프로필로 읽힌다(사용자 결정: 로그인한 회원에게도 같은 모양 — 주인이 보는 화면 = 방문자가 보는 화면).
 * 이 주소에서 `Layout` 은 Navbar · 하단 탭바 · 마이페이지 사이드바 · 회사 정보 푸터를 그리지 않고, 페이지가 `SiteHeader` ·
 * `SiteFooter` 를 직접 그린다(로딩·없는 주소일 때도 — 머리 높이가 튀지 않게).
 *
 * ⚠️ 판정은 **여기 하나**다 — 소개 팝업(`guestIntro.introAllowedAt`)도 이걸 쓴다. 홈페이지 주소를 새로 만들면 여기만 고친다.
 *    `/galleries/new`(갤러리 등록)는 홈페이지가 아니다.
 * ⚠️ `/:handleSeg` 라우트는 아무 한 조각 주소를 다 받는다 — `@` 로 시작할 때만 홈페이지다.
 */
export function isHomepagePath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (/^\/@[^/]+$/.test(p)) return true;
  if (/^\/portfolio\/[^/]+$/.test(p)) return true;
  const g = p.match(/^\/galleries\/([^/]+)$/);
  return !!g && g[1] !== 'new';
}

/**
 * ArtLook 편집 화면인가 — 마이페이지 [ArtLook] 탭(`/mypage?tab=artlook`). 2026-11-17(PLAN WP4, CLAUDE.md 규칙 85):
 * 창 폭 1024px 미만에서는 이 화면을 **아트링크 상단바 · 하단 탭바 없이** 띄운다(ArtLook 이 제 머리에 [닫기]·[저장]을 둔다).
 * 아이폰 13 에서 상단바 64 + 제목 줄 44 + 하단 탭바 56 이 미리보기를 234px 로 눌러 놓았다.
 * ⚠️ 역할(작가)·폭은 부르는 쪽(`useArtLookBare`)이 본다 — 이 탭은 작가에게만 있다(다른 역할은 프로필로 떨어진다).
 */
export function isArtLookEditor(pathname: string, search: string): boolean {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p !== '/mypage') return false;
  return new URLSearchParams(search).get('tab') === 'artlook';
}

/**
 * 사이트 머리 높이(px) — 휴대폰 56 · lg(1024px)↑ 72. 탭 막대의 sticky 자리 · 탭을 바꿀 때 끌어올리는 자리 ·
 * 시리즈로 내려갈 때의 여백이 전부 이 값을 본다. ⚠️ 클래스(`h-14 lg:h-[72px]`·`top-14`)와 숫자가 함께 바뀌어야 한다.
 */
export const SITE_HEADER_H = { base: 56, lg: 72 } as const;

/** 지금 화면의 머리 높이 — 탭 막대가 붙는 자리 */
export const siteHeaderPx = (): number =>
  (typeof window !== 'undefined' && window.innerWidth >= 1024 ? SITE_HEADER_H.lg : SITE_HEADER_H.base);

/**
 * 탭을 누르면 **그 탭 내용으로 내려간다** — 탭 줄이 사이트 머리 바로 밑에 붙고 그 아래가 고른 탭의 내용이다(2026-11-15 사용자 지적:
 * "탭을 누르면 그 탭 내용으로 화면이동이 안 된다"). 예전엔 탭 줄을 지나 내려가 있을 때만 끌어올려서, 표지를 보던 중(맨 위)에 누르면
 * 화면 아래쪽 내용만 바뀌고 화면은 그대로였다.
 *
 * ⚠️ 부르는 때 — **새 탭 내용을 그린 뒤**(useLayoutEffect). 그리기 전에 옮기면 내용 높이가 바뀌는 순간 브라우저(크롬 scroll anchoring)가
 *    몇 px 을 다시 옮긴다(홈 탭에서 겪었다, CLAUDE.md '홈 레이아웃'). 탭 내용 칸은 최소 '탭 줄 아래 보이는 높이'라 짧은 탭이어도 붙일 수 있다.
 * 작가 홈페이지(`#hp-tabs`, HomepageView)와 갤러리 페이지(`#gallery-tabs`)가 같이 쓴다.
 */
export function liftToHomepageTabs(anchorId = 'hp-tabs'): void {
  const a = typeof document !== 'undefined' ? document.getElementById(anchorId) : null;
  if (!a) return;
  const top = a.getBoundingClientRect().top;
  const stick = siteHeaderPx();
  if (Math.abs(top - stick) <= 1) return;   // 이미 붙어 있다
  window.scrollTo({ top: Math.max(0, Math.round(window.scrollY + top - stick)) });
}

/**
 * 탭 내용 칸의 최소 높이 — 탭 줄을 머리 밑에 붙였을 때 화면 아래까지(사이트 머리 56/72 + 탭 줄 45).
 * 이게 없으면 짧은 탭(작가노트 몇 줄)으로 바꿀 때 문서가 짧아 끝까지 못 내려가 탭 줄이 중간에 떠 있고, 화면이 위로 끌려 올라간다.
 * ⚠️ 완성된 클래스 문자열이어야 한다(Tailwind 가 소스에서 읽는다).
 */
export const HOMEPAGE_PANEL_MIN_H = 'min-h-[calc(100svh-101px)] lg:min-h-[calc(100svh-117px)]';
