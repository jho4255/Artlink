/**
 * 작가 홈페이지 탭 (2026-09-25) — 작품·작가노트·약력·포트폴리오·방명록을 한 줄 탭으로 나눈다.
 *
 * 예전엔 모두 한 페이지에 세로로 이어져, 작품 30점 아래 약력·경력(단체전 20줄)·파일·방명록까지 내려가면
 * 방명록은 몇 화면을 스크롤해야 나왔다. 탭으로 나누면 이름 바로 아래에서 무엇이 있는지 한눈에 보이고 바로 간다.
 *
 * - **비어 있는 탭은 만들지 않는다** — 눌렀는데 아무것도 없으면 고장처럼 보인다. 방명록만 예외(글을 쓰러 가는 곳이다).
 * - **약력(자유 글)과 경력(학력·개인전…)은 한 탭 [약력]** 이다 — 둘 다 작가의 이력이고, 실제로 약력 칸에 경력을 줄글로
 *   적는 작가가 많다(CLAUDE.md 45b). 나누면 거의 같은 내용이 탭 둘에 갈라진다.
 * - 주소는 `?tab=<id>`. 첫 탭(대개 작품)은 쿼리를 붙이지 않는다 — 공유 주소가 깔끔해야 한다.
 *   모르는 값·지금 없는 탭이 오면 첫 탭으로(404·빈 화면 금지 — 작가가 파일을 지운 뒤에도 옛 링크가 돈다).
 */

export type HomepageTabId = 'works' | 'note' | 'cv' | 'file' | 'guestbook';

export interface HomepageTabDef {
  id: HomepageTabId;
  label: string;
  count?: number;
}

export const HOMEPAGE_TAB_LABELS: Record<HomepageTabId, string> = {
  works: '작품',
  note: '작가노트',
  cv: '약력',
  file: '포트폴리오',
  guestbook: '방명록',
};

export function homepageTabs(c: {
  workCount: number;
  hasNote: boolean;
  hasCv: boolean;
  hasFile: boolean;
  /** 방명록 탭을 붙이는가 — 공개 페이지만(편집 미리보기엔 없다) */
  guestbook?: { count?: number } | null;
}): HomepageTabDef[] {
  const tabs: HomepageTabDef[] = [];
  if (c.workCount > 0) tabs.push({ id: 'works', label: HOMEPAGE_TAB_LABELS.works, count: c.workCount });
  if (c.hasNote) tabs.push({ id: 'note', label: HOMEPAGE_TAB_LABELS.note });
  if (c.hasCv) tabs.push({ id: 'cv', label: HOMEPAGE_TAB_LABELS.cv });
  if (c.hasFile) tabs.push({ id: 'file', label: HOMEPAGE_TAB_LABELS.file });
  if (c.guestbook) {
    const n = c.guestbook.count;
    tabs.push({ id: 'guestbook', label: HOMEPAGE_TAB_LABELS.guestbook, ...(n && n > 0 ? { count: n } : {}) });
  }
  return tabs;
}

/** 요청한 탭이 지금 있으면 그것, 아니면 첫 탭 */
export function resolveHomepageTab(requested: string | null | undefined, tabs: HomepageTabDef[]): HomepageTabId | null {
  if (tabs.length === 0) return null;
  const hit = tabs.find((t) => t.id === requested);
  return (hit ?? tabs[0]!).id;
}

/** 주소에 실을 값 — 첫 탭이면 null(쿼리를 지운다) */
export function tabParamFor(id: HomepageTabId, tabs: HomepageTabDef[]): string | null {
  return tabs[0]?.id === id ? null : id;
}
