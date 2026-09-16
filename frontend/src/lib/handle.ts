/**
 * 작가 홈페이지 주소 `/@handle` — 화면 쪽 규칙 (2026-09-16).
 *
 * ⚠️ 서버 `backend/src/lib/handle.ts` 와 **같은 규칙**이어야 한다. 화면이 통과시키고 서버가 막으면 함정이고,
 *    반대면 규칙이 조용히 무너진다. 바꾸면 둘 다 바꿀 것.
 */
import { instagramHandle } from './utils';

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 30;
const HANDLE_RE = /^[a-z0-9._]+$/;
const RESERVED = new Set([
  'admin', 'artlink', 'artist', 'artists', 'gallery', 'galleries', 'exhibition', 'exhibitions', 'show', 'shows',
  'login', 'logout', 'signup', 'register', 'auth', 'mypage', 'api', 'uploads', 'explore', 'portfolio',
  'community', 'feed', 'messages', 'support', 'benefits', 'me', 'help', 'about', 'terms', 'privacy',
  'null', 'undefined', 'www', 'static', 'assets', 'artlook', 'artstory', 'arttalk',
]);

export function normalizeHandle(raw: string): string {
  return String(raw ?? '').trim().replace(/^@+/, '').toLowerCase();
}

/** 유효하면 null, 아니면 이유 */
export function validateHandle(handle: string): string | null {
  if (handle.length < HANDLE_MIN || handle.length > HANDLE_MAX) return `주소는 ${HANDLE_MIN}~${HANDLE_MAX}자여야 합니다.`;
  if (!HANDLE_RE.test(handle)) return '영문 소문자·숫자·마침표·밑줄만 쓸 수 있습니다.';
  if (handle.startsWith('.') || handle.endsWith('.') || handle.includes('..')) return '마침표는 처음·끝에 오거나 연달아 올 수 없습니다.';
  if (RESERVED.has(handle)) return '쓸 수 없는 주소입니다.';
  return null;
}

/** 인스타 아이디에서 제안 — 규칙에 맞을 때만 */
export function suggestHandle(instagramUrl?: string | null): string | null {
  const id = instagramHandle(instagramUrl);
  if (!id) return null;
  const h = normalizeHandle(id);
  return validateHandle(h) ? null : h;
}

/** 작가 페이지 경로 — 핸들이 있으면 `/@handle`, 없으면 숫자 주소. 링크·공유·QR 이 전부 이걸 쓴다 */
export function artistPath(user: { id: number; handle?: string | null }): string {
  return user.handle ? `/@${user.handle}` : `/portfolio/${user.id}`;
}

/**
 * 갤러리 페이지 경로 (2026-09-16). 작가와 **같은 이름 공간**이라 `/@handle` 하나로 둘 다 간다 —
 * 어느 쪽인지는 `HandleRoute` 가 서버에 물어 정한다.
 */
export function galleryPath(gallery: { id: number; handle?: string | null }): string {
  return gallery.handle ? `/@${gallery.handle}` : `/galleries/${gallery.id}`;
}

/** 공유용 절대 주소. `work` 를 주면 그 작품이 미리보기의 주인공이 된다(서버 SEO 메타와 짝) */
export function artistUrl(user: { id: number; handle?: string | null }, work?: number | null, origin?: string): string {
  const base = (origin ?? (typeof window !== 'undefined' ? window.location.origin : 'https://artlink.cc')) + artistPath(user);
  return work ? `${base}?work=${work}` : base;
}
