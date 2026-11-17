import type { PostDoc } from '@/lib/postDoc';

/**
 * 이 기기 보관(localStorage) — 서버에 아직 못 보낸 글의 안전망 (2026-11-13).
 * - 글마다 한 칸: 새 글은 작업본이 생기기 전 'new' → 생기면 `d<작업본 id>` 로 옮긴다. 고치는 글은 `p<글 id>`.
 * - 서버가 같은 내용을 받았다고 답하면 지운다. 다시 열었을 때 이 칸이 서버 것보다 새것이면 [이어서 쓰기]를 묻는다.
 * - 저장소가 막힌 브라우저(사생활 보호·용량)에서는 던지지 않는다 — 이 화면 안에서만 기억한다.
 */
export interface PostBackup {
  title: string;
  doc: PostDoc;
  categoryId: number | null;
  anonymous: boolean;
  /** 이 기기에서 마지막으로 고친 시각 */
  savedAt: number;
}

const PREFIX = 'artlink-post-backup:';
const memory = new Map<string, string>();

export function backupKey(o: { postId?: number | null; draftId?: number | null }): string {
  if (o.postId) return `p${o.postId}`;
  if (o.draftId) return `d${o.draftId}`;
  return 'new';
}

export function readBackup(key: string): PostBackup | null {
  let raw: string | null = null;
  try { raw = localStorage.getItem(PREFIX + key); } catch { raw = memory.get(key) ?? null; }
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as PostBackup;
    return b && typeof b === 'object' && b.doc && typeof b.savedAt === 'number' ? b : null;
  } catch {
    return null;
  }
}

export function writeBackup(key: string, b: PostBackup): void {
  const raw = JSON.stringify(b);
  memory.set(key, raw);
  try { localStorage.setItem(PREFIX + key, raw); } catch { /* 용량·막힘 — 이 화면 안에서만 기억 */ }
}

export function clearBackup(key: string): void {
  memory.delete(key);
  try { localStorage.removeItem(PREFIX + key); } catch { /* 막힘 */ }
}

export function moveBackup(from: string, to: string): void {
  if (from === to) return;
  const b = readBackup(from);
  if (b) writeBackup(to, b);
  clearBackup(from);
}

/** 보관본과 서버본을 견줄 서명 — 저장 서명과 같은 모양 */
export function contentSig(c: { title: string; doc: PostDoc; categoryId: number | null; anonymous: boolean }): string {
  return JSON.stringify([c.title.replace(/\s+/g, ' ').trim(), c.doc, c.categoryId ?? null, !!c.anonymous]);
}
