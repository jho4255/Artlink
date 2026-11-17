/**
 * ArtStory — 소식의 모양과 화면 규칙 (2026-11-14, CLAUDE.md 규칙 81).
 *
 * 전체공개 소식은 **홈 맨 위 카드 줄**에서 누구나 본다(블라인드 스토리 방식). 누르면 화면 가득 열리고 저절로 넘어간다.
 * ⚠️ 서버 `backend/src/lib/storyRules.ts` 의 값(바탕색 이름·신고 사유·하루 상한·줄 상한)을 **거울로** 든다 —
 *    `__tests__/story.test.ts` 가 서버 파일을 읽어 대조한다. 한쪽만 바꾸면 깨진다.
 */

export interface StoryAuthor {
  id: number;
  name: string;
  avatar: string | null;
  role: string;
  /** [홈페이지] 단추가 갈 곳 — 작가·갤러리만, 일반 회원은 null */
  homepage: string | null;
}

/**
 * 사진 위 글 (2026-11-14) — 사진 원본은 그대로 두고 글을 따로 얹는다(작품 사진에 글을 구워 넣지 않는다).
 * `x`·`y` 는 **사진 안**에서 글 가운데 자리(0~1). 글자 크기는 사진 폭에 비례 — 카드에서도 보기 화면에서도 같은 자리·같은 비율.
 */
export interface StoryOverlay {
  i: number;
  text: string;
  x: number;
  y: number;
  size: 's' | 'm' | 'l';
  style: 'plain' | 'dark' | 'light';
}

export interface Story {
  id: number;
  caption: string;
  images: string[];
  /** 사진 위 글 — 사진 하나에 하나(옛 소식·글만 소식은 빈 배열) */
  overlays?: StoryOverlay[];
  /** 글만 있는 소식의 바탕색 이름(STORY_BG_KEYS) — 사진 소식·옛 소식은 null */
  bg: string | null;
  visibility: 'PUBLIC' | 'NEIGHBORS';
  createdAt: string;
  author: StoryAuthor;
  mine: boolean;
  likeCount: number;
  commentCount: number;
  liked: boolean;
  /** 내린 소식인가 — 주인·관리자에게만 온다 */
  hidden?: boolean;
  hiddenReason?: 'ADMIN' | 'REPORTS' | null;
}

export interface StoryComment {
  id: number;
  body: string;
  createdAt: string;
  author: StoryAuthor;
  mine: boolean;
}

export interface StoryPage {
  stories: Story[];
  nextCursor: number | null;
  followingCount?: number;
  canSeeNeighbors?: boolean;
}

/** 글만 소식의 바탕색 — 이름은 서버와 같다. 흰 글자가 4.5:1 넘게 읽히는 짙은 색만 */
export const STORY_BG_KEYS = ['slate', 'earth', 'forest', 'plum', 'ink', 'ochre'] as const;
export type StoryBgKey = (typeof STORY_BG_KEYS)[number];
export const STORY_BGS: Record<StoryBgKey, { hex: string; label: string }> = {
  slate: { hex: '#3f4a5a', label: '청회색' },
  earth: { hex: '#5a4a3f', label: '흙색' },
  forest: { hex: '#3f5a4c', label: '짙은 초록' },
  plum: { hex: '#5a3f4a', label: '자주' },
  ink: { hex: '#2b2b2b', label: '먹색' },
  ochre: { hex: '#6b5d3a', label: '황토' },
};

/** 글만 소식의 바탕색 — 모르는 값·옛 소식은 첫 색 */
export function storyBgHex(bg: string | null | undefined): string {
  return bg && bg in STORY_BGS ? STORY_BGS[bg as StoryBgKey].hex : STORY_BGS.slate.hex;
}

/** 신고 사유 — 이름은 서버와 같다 */
export const STORY_REPORT_REASONS = ['SPAM', 'INAPPROPRIATE', 'ABUSE', 'COPYRIGHT', 'OTHER'] as const;
export type StoryReportReason = (typeof STORY_REPORT_REASONS)[number];
export const STORY_REPORT_LABELS: Record<StoryReportReason, string> = {
  SPAM: '광고·도배',
  INAPPROPRIATE: '보기 불편한 사진',
  ABUSE: '욕설·괴롭힘',
  COPYRIGHT: '남의 작품·저작권 침해',
  OTHER: '그 밖의 이유',
};

export const STORY_DAILY_MAX = 10;
export const STORY_RAIL_MAX = 12;
/** 홈 줄에 소식이 이보다 적으면 맨 앞에 [소식 올리기] 칸을 둔다 */
export const STORY_UPLOAD_TILE_BELOW = 4;
export const STORY_PHOTO_MAX = 10;
export const STORY_TEXT_MAX = 1000;

/** 한 소식이 진행 막대에서 몇 칸인가 — 사진 한 장이 한 칸, 글만이면 한 칸 */
export function storySlides(s: Pick<Story, 'images'>): number {
  return Math.max(1, s.images.length);
}

export const STORY_PHOTO_MS = 5000;
export const STORY_TEXT_MS = 6500;

/**
 * 한 칸을 얼마나 보여 주나(ms). 사진 5초 · 글만 6.5초가 기본이고, **글이 길면 읽을 시간을 더 준다**
 * (1000자짜리 글이 6.5초에 넘어가면 못 읽는다). 사진 소식의 글은 첫 장에서만 더 준다 — 세 장이면 세 번 늘어지지 않게.
 */
export function slideDuration(s: Pick<Story, 'images' | 'caption'>, slide: number): number {
  const len = s.caption.replace(/\s+/g, ' ').trim().length;
  if (s.images.length === 0) return Math.min(15000, STORY_TEXT_MS + Math.max(0, len - 80) * 45);
  if (slide > 0) return STORY_PHOTO_MS;
  return Math.min(10000, STORY_PHOTO_MS + Math.max(0, len - 60) * 30);
}

/** 글만 소식의 글자 크기 — 짧으면 크게, 길면 작게(화면을 넘치지 않게) */
export function textStorySize(caption: string): 'lg' | 'md' | 'sm' {
  const len = caption.trim().length;
  if (len <= 60) return 'lg';
  if (len <= 160) return 'md';
  return 'sm';
}

// ── 이 기기에서 본 소식 ──
// 서버에 '누가 봤다'를 쌓지 않는다 — 이 기기에만 기억해 홈 줄에서 안 본 소식을 앞에 둔다.
const SEEN_KEY = 'artlink-stories-seen';
/** 이 기기에 기억하는 본 소식 수 — 서버가 받는 `?seen=` 상한(`STORY_SEEN_MAX`)과 같다 */
export const STORY_SEEN_MAX = 400;

export function readSeenStories(): Set<number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.filter((n): n is number => typeof n === 'number') : []);
  } catch {
    return new Set();
  }
}

export function markStorySeen(id: number): void {
  try {
    const list = [...readSeenStories()].filter((n) => n !== id);
    list.push(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(-STORY_SEEN_MAX)));
  } catch { /* 저장소가 막혀도 보기는 된다 */ }
}

/**
 * 홈 줄 순서 — 서버가 준 최신순을 지키되 **이 기기에서 본 소식은 뒤로**.
 * 내 소식은 본 것으로 치지 않는다(올린 직후 맨 앞에 있어야 한다).
 * ⚠️ `seen` 은 화면을 열 때 한 번 찍어 둔 것을 넘길 것 — 보는 동안 순서가 바뀌면 닫았을 때 카드 자리가 어긋난다.
 */
export function orderRail<T extends Pick<Story, 'id' | 'mine'>>(stories: T[], seen: Set<number>): T[] {
  const fresh = stories.filter((s) => s.mine || !seen.has(s.id));
  const old = stories.filter((s) => !s.mine && seen.has(s.id));
  return [...fresh, ...old];
}

/**
 * [전체 보기] 무작위 순서의 시드 (2026-11-14 사용자 결정 — 서버 `lib/storyOrder.ts`).
 * 열 때·[새로고침] 때 새로 만든다 → 하루 안 된 내 소식 · 안 본 소식(섞임) · 본 소식(최신순, 뒤) 순서가 다시 정해진다.
 */
export function newStorySeed(): number {
  return Math.floor(Math.random() * 1_000_000_000) + 1;
}

/** 소식 주소 — 알림·공유 링크와 같다(서버 storyLink) */
export function storyPath(id: number, commentId?: number | null): string {
  return `/feed?story=${id}${commentId ? `&comment=${commentId}` : ''}`;
}

/** 다음에 넘어갈 자리 — 칸 → 다음 칸, 마지막 칸이면 다음 소식의 첫 칸, 마지막 소식이면 null(끝) */
export function nextPosition(slidesPerStory: number[], i: number, slide: number): { i: number; slide: number } | null {
  if (slide + 1 < (slidesPerStory[i] ?? 1)) return { i, slide: slide + 1 };
  if (i + 1 < slidesPerStory.length) return { i: i + 1, slide: 0 };
  return null;
}

/** 앞 자리 — 앞 칸, 첫 칸이면 앞 소식의 첫 칸, 맨 처음이면 그대로 */
export function prevPosition(i: number, slide: number): { i: number; slide: number } {
  if (slide > 0) return { i, slide: slide - 1 };
  if (i > 0) return { i: i - 1, slide: 0 };
  return { i, slide: 0 };
}

/**
 * 손가락 동작을 읽는다 — 옆으로 밀면 다음/앞 소식, 아래로 밀면 닫기, 짧게 누르면 왼쪽 1/3 은 앞 칸·나머지는 다음 칸.
 * 오래 누르고 있다 뗀 건 '멈춰서 보기'라 아무것도 하지 않는다.
 */
export type StoryGesture = 'nextStory' | 'prevStory' | 'close' | 'next' | 'prev' | 'none';
export function readGesture(g: { dx: number; dy: number; ms: number; x: number; width: number }): StoryGesture {
  const ax = Math.abs(g.dx);
  const ay = Math.abs(g.dy);
  if (ax > 50 && ax > ay * 1.2) return g.dx < 0 ? 'nextStory' : 'prevStory';
  if (g.dy > 80 && g.dy > ax * 1.2) return 'close';
  if (ax < 12 && ay < 12 && g.ms < 350) return g.x < g.width / 3 ? 'prev' : 'next';
  return 'none';
}

// ── 사진 위 글 ──
/** 서버(storyRules.ts)와 같은 값 */
export const STORY_OVERLAY_MAX = 80;
export const STORY_OVERLAY_SIZES = ['s', 'm', 'l'] as const;
export const STORY_OVERLAY_STYLES = ['plain', 'dark', 'light'] as const;
export const OVERLAY_SIZE_LABELS: Record<StoryOverlay['size'], string> = { s: '작게', m: '보통', l: '크게' };
export const OVERLAY_STYLE_LABELS: Record<StoryOverlay['style'], string> = { plain: '글자만', dark: '검은 띠', light: '흰 띠' };

/** 글자 크기(px) — 사진 폭에 비례(카드 148px 에서도 읽히는 하한 9px) */
export function overlayFontPx(size: StoryOverlay['size'], boxWidth: number): number {
  const ratio = size === 's' ? 0.052 : size === 'l' ? 0.092 : 0.07;
  return Math.max(9, Math.round(boxWidth * ratio * 10) / 10);
}

/** 그 사진의 글 — 없으면 undefined */
export function overlayFor(s: Pick<Story, 'overlays'>, slide: number): StoryOverlay | undefined {
  return s.overlays?.find((o) => o.i === slide);
}

/** 사진이 `contain` 으로 그려진 자리(상자 안 가운데) — 글은 이 자리 기준으로 얹는다 */
export function containBox(natW: number, natH: number, boxW: number, boxH: number): { left: number; top: number; width: number; height: number } {
  if (!natW || !natH || !boxW || !boxH) return { left: 0, top: 0, width: boxW, height: boxH };
  const scale = Math.min(boxW / natW, boxH / natH);
  const width = natW * scale;
  const height = natH * scale;
  return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height };
}

/** 끌어 옮긴 글 자리 — 사진 안쪽(가장자리 5%)으로 묶는다(서버와 같은 범위) */
export function clampOverlayPos(v: number): number {
  return Math.min(0.95, Math.max(0.05, v));
}

