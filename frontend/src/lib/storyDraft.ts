/**
 * 쓰던 소식 — 이 기기에만 (2026-11-14). 올리기 화면을 실수로 떠나도(뒤로가기·새로고침) 이어 쓴다.
 * 올라간 사진 주소·글·바탕색·공개 범위만 남긴다(아직 안 올라간 사진 파일은 남길 수 없다). 7일이 지나면 버린다.
 * 계정마다 따로 — 같은 기기의 다음 사람에게 앞사람 글이 뜨면 안 된다.
 */
import { STORY_BG_KEYS, STORY_OVERLAY_MAX, STORY_OVERLAY_SIZES, STORY_OVERLAY_STYLES, clampOverlayPos, type StoryBgKey, type StoryOverlay } from '@/lib/story';

export interface StoryDraft {
  mode: 'photo' | 'text';
  urls: string[];
  /** 사진 위 글 — `i` 는 urls 의 번호 */
  overlays?: StoryOverlay[];
  text: string;
  bg: StoryBgKey;
  visibility: 'PUBLIC' | 'NEIGHBORS';
}

function readOverlays(raw: unknown, count: number): StoryOverlay[] {
  if (!Array.isArray(raw)) return [];
  const out: StoryOverlay[] = [];
  for (const o of raw) {
    if (!o || typeof o !== 'object') continue;
    const { i, text, x, y, size, style } = o as Record<string, unknown>;
    if (typeof i !== 'number' || i < 0 || i >= count || typeof text !== 'string' || !text.trim()) continue;
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    if (out.some((v) => v.i === i)) continue;
    out.push({
      i, text: text.slice(0, STORY_OVERLAY_MAX), x: clampOverlayPos(x), y: clampOverlayPos(y),
      size: (STORY_OVERLAY_SIZES as readonly unknown[]).includes(size) ? (size as StoryOverlay['size']) : 'm',
      style: (STORY_OVERLAY_STYLES as readonly unknown[]).includes(style) ? (style as StoryOverlay['style']) : 'plain',
    });
  }
  return out;
}

const KEY = (userId: number) => `artlink-story-draft:${userId}`;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export function readStoryDraft(userId: number, now = Date.now()): StoryDraft | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(userId)) || 'null');
    if (!raw || typeof raw !== 'object' || typeof raw.at !== 'number' || now - raw.at > MAX_AGE) return null;
    const urls = Array.isArray(raw.urls) ? raw.urls.filter((u: unknown): u is string => typeof u === 'string' && /^(\/(?!\/)|https:\/\/)/.test(u)).slice(0, 10) : [];
    const text = typeof raw.text === 'string' ? raw.text.slice(0, 1000) : '';
    if (!urls.length && !text.trim()) return null;
    return {
      mode: urls.length ? 'photo' : 'text',
      urls,
      overlays: readOverlays(raw.overlays, urls.length),
      text,
      bg: (STORY_BG_KEYS as readonly string[]).includes(raw.bg) ? raw.bg : 'slate',
      visibility: raw.visibility === 'NEIGHBORS' ? 'NEIGHBORS' : 'PUBLIC',
    };
  } catch {
    return null;
  }
}

export function saveStoryDraft(userId: number, d: StoryDraft, now = Date.now()): void {
  try { localStorage.setItem(KEY(userId), JSON.stringify({ ...d, at: now })); } catch { /* 저장소가 막혀도 쓰기는 된다 */ }
}

export function clearStoryDraft(userId: number): void {
  try { localStorage.removeItem(KEY(userId)); } catch { /* 무시 */ }
}
