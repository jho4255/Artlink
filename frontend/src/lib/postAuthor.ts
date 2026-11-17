import { roleLabel } from './utils';

/** 커뮤니티 글쓴이 — 익명이면 서버가 이름을 '익명'으로 가려 보낸다(역할도 null) */
export interface PostAuthor { id?: number | null; name: string; role: string | null; anonymous: boolean; mine: boolean }

/** 목록의 글쓴이 줄 — "이름 · 역할", 익명이면 이름('익명')만 */
export const authorLine = (a: PostAuthor) =>
  a.anonymous ? a.name : `${a.name}${roleLabel(a.role) ? ` · ${roleLabel(a.role)}` : ''}`;
