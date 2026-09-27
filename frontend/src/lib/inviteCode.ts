/**
 * 공모 초대 코드 (2026-09-27) — `backend/src/lib/inviteCode.ts` 와 **같은 규칙의 거울**(바꾸면 둘 다).
 *
 * 8자리, 헷갈리는 글자(0·O·1·I·L)를 뺀 31자. 입력은 대소문자·하이픈·공백을 무시하고, 화면은 `XXXX-XXXX` 로 보여 준다.
 * 판정(유효한 코드인가·들어갈 수 있는가)은 서버가 한다 — 여기선 형식만 본다(엉뚱한 글자로 서버를 두드리지 않게).
 */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 8;

export function normalizeInviteCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== INVITE_CODE_LENGTH) return null;
  for (const ch of s) if (!INVITE_CODE_ALPHABET.includes(ch)) return null;
  return s;
}

export function formatInviteCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** 참여 링크 — 갤러리가 단톡방에 붙여 넣는 주소. 받은 작가는 누르기만 하면 된다 */
export function joinPath(code: string): string {
  return `/join/${code}`;
}
