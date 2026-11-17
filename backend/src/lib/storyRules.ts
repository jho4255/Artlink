/**
 * ArtStory 규칙 (2026-11-14, CLAUDE.md 규칙 81) — 서버가 판정하고, 화면 `frontend/src/lib/story.ts` 가 **같은 값**을 거울로 든다
 * (프론트 테스트가 이 파일을 읽어 대조한다 — 한쪽만 바꾸면 깨진다).
 */

/** 글만 있는 소식의 바탕색 이름 — 색 값은 화면이 정한다(이름으로 저장해야 나중에 색을 다듬어도 옛 소식이 안 깨진다) */
export const STORY_BG_KEYS = ['slate', 'earth', 'forest', 'plum', 'ink', 'ochre'] as const;
export type StoryBg = (typeof STORY_BG_KEYS)[number];

/** 신고 사유 */
export const STORY_REPORT_REASONS = ['SPAM', 'INAPPROPRIATE', 'ABUSE', 'COPYRIGHT', 'OTHER'] as const;

/** 서로 다른 몇 명이 신고하면 저절로 내리나 — 관리자가 되살린 뒤에 들어온 신고만 센다 */
export const STORY_REPORT_HIDE_AT = 3;

/** 한 사람이 24시간에 올릴 수 있는 소식 수 (홈에 걸리니 도배를 막는다) */
export const STORY_DAILY_MAX = 10;

/** 홈 줄 — 한 사람당 가장 새 소식 하나씩, 최대 몇 장 */
export const STORY_RAIL_MAX = 12;

/** 전체 보기 격자 한 번에 받는 수 */
export const STORY_PAGE_SIZE = 24;

/**
 * 공개 목록(홈 줄·[전체 보기])은 **최근 며칠 안 소식만** — 너무 오래된 소식이 뜨지 않게(2026-11-14 사용자 결정).
 * [이웃] 탭·[내 소식]·하이라이트·알림/공유 링크(`GET /:id`)는 기간과 무관하다.
 */
export const STORY_PUBLIC_DAYS = 30;

/** [전체 보기] 무작위 순서(`?seed=`)를 매길 때 보는 최대 소식 수(최근 것부터) — 요청 하나의 일을 묶는다 */
export const STORY_SHUFFLE_MAX = 1000;

/** 화면이 보내는 '이 기기에서 본 소식' 수 상한(화면이 기억하는 수와 같다) */
export const STORY_SEEN_MAX = 400;

/** 올린 지 이만큼 안 된 내 소식은 [전체 보기] 맨 앞 — 올리고 돌아왔는데 무작위 순서에 묻혀 안 보이면 안 된다 */
export const STORY_MINE_FRONT_MS = 24 * 60 * 60 * 1000;

/** 사진 위 글 — 사진 하나에 하나, 이만큼까지(짧은 말이라야 사진이 보인다) */
export const STORY_OVERLAY_MAX = 80;
export const STORY_OVERLAY_SIZES = ['s', 'm', 'l'] as const;
export const STORY_OVERLAY_STYLES = ['plain', 'dark', 'light'] as const;
