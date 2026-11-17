/**
 * 휴대폰·앱 홈의 탭 (2026-11-14 사용자 결정) — 배너 아래 칸들을 한 줄 탭으로 바꿔 한 번에 한 칸만 보인다.
 * 지금 휴대폰 홈은 칸이 세로로 이어져 3,225px(화면 3.8장)이었다. PC 홈은 그대로다.
 *
 * - 순서는 사용자가 정했다: **ArtWorks · ArtStory · 인기글 · 마감임박 공모**.
 * - **진행중인 전시·주목할 갤러리는 '일단' 탭에서 뺐다**(사용자 결정) — PC 홈에는 그대로 있다.
 * - 칸 제목이 곧 탭 이름이다. 칸 안의 제목 줄은 빼고, 제목 옆 단추만 칸 맨 위 오른쪽에 남긴다(`HomeTabHead`).
 * - ArtStory 칸은 카드 **두 줄**(위→아래→다음 칸 순, 옆으로 함께 민다) — 한 줄이면 아래가 허했다(사용자 지적).
 * - 빈 칸은 탭도 없다. 늘 있는 칸(작품·소식·인기글)은 비었다고 알려 오기 전까지 보이고,
 *   빌 수 있는 칸(마감임박 공모)은 **내용이 있다고 알려 온 뒤에만** 보인다 — 나타났다 사라지는 탭이 없게.
 */
export type HomeTabId = 'works' | 'story' | 'popular' | 'closing';

export interface HomeTab {
  id: HomeTabId;
  label: string;
  /** 비어 있을 수 있는 칸 — 내용이 있다고 확인된 뒤에만 탭이 생긴다 */
  optional: boolean;
}

export const HOME_TABS: readonly HomeTab[] = [
  { id: 'works', label: 'ArtWorks', optional: false },
  { id: 'story', label: 'ArtStory', optional: false },
  { id: 'popular', label: '인기글', optional: false },
  { id: 'closing', label: '마감임박 공모', optional: true },
];

/** 칸마다 비었는가 — 아직 답이 안 온 칸은 없다(undefined) */
export type HomeTabEmpty = Partial<Record<HomeTabId, boolean>>;

/** 이 폭 아래(휴대폰·앱)에서만 탭으로 본다 — Tailwind `md`(768px)와 같은 경계 */
export const HOME_TABS_MEDIA = '(max-width: 767px)';

/** 탭 줄에 놓을 탭 */
export function visibleHomeTabs(empty: HomeTabEmpty): HomeTab[] {
  return HOME_TABS.filter((t) => (t.optional ? empty[t.id] === false : empty[t.id] !== true));
}

/**
 * 열어 둘 탭 — 고른(뒤로 와서 되살린) 탭이 탭 줄에 있으면 그 탭, 아니면 첫 탭.
 * 고른 탭은 주소가 아니라 그 기록의 state(`homeTab`)에 둔다 — 다른 화면에 갔다가 뒤로 오면 보던 탭이 열리고,
 * 홈을 새로 열면(로고·하단 [홈]) 첫 탭부터다. 주소가 그대로라 공유 주소·비회원 통계(경로 + `?tab=`)가 갈라지지 않는다.
 */
export function resolveHomeTab(requested: unknown, tabs: readonly HomeTab[]): HomeTabId {
  if (typeof requested === 'string' && tabs.some((t) => t.id === requested)) return requested as HomeTabId;
  return tabs[0]?.id ?? 'works';
}

/** 기록 state 에서 고른 탭을 읽는다 — 다른 값이 함께 들어 있어도 된다 */
export function homeTabFromState(state: unknown): unknown {
  return state && typeof state === 'object' ? (state as { homeTab?: unknown }).homeTab : undefined;
}
