/**
 * 비회원 작가 (2026-11-23, CLAUDE.md 규칙 91) — 공모 운영자가 가입하지 않은 작가를 넣고 출품 자료·판매·정산을 직접 채운다.
 *
 * 서버 `backend/src/lib/guestArtists.ts` 의 거울. 화면에서는 출품 자료 목록·정산 표의 줄에 `guest: true` 가 붙어 온다.
 *  · 지원이 아니다 — [지원자] 탭·정원(수락 N/정원)에 안 든다.
 *  · 출품 자료 안내·정산 확인 요청은 회원 작가에게만 간다(비회원은 받을 수 없다) — 할 일 줄의 숫자도 회원만 센다.
 */

/** 이름 글자 수 — 서버 `GUEST_NAME_MAX` 와 같아야 한다(테스트가 서버 소스와 대조) */
export const GUEST_NAME_MAX = 40;

/** 출품 자료 상태 이름 — 비회원은 갤러리가 채우므로 '제출'이 아니라 '입력' */
export const GUEST_SUBMISSION_STATE_LABEL = { complete: '입력함', partial: '입력 중', none: '시작 전' } as const;

/** 이름 — 앞뒤 공백을 떼고 가운데 공백은 하나로(서버 `cleanGuestName` 과 같은 규칙). 비었거나 너무 길면 이유를 돌려준다 */
export function guestNameProblem(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) return '작가 이름을 적어 주세요.';
  if ([...name].length > GUEST_NAME_MAX) return `작가 이름은 ${GUEST_NAME_MAX}자까지 적을 수 있어요.`;
  return null;
}

/** 줄 목록을 회원 / 비회원으로 나눈 수 — 할 일 줄은 안내를 받을 수 있는 회원만 센다 */
export function splitGuests<T extends { guest?: boolean }>(rows: T[]): { members: T[]; guests: T[] } {
  return { members: rows.filter((r) => !r.guest), guests: rows.filter((r) => !!r.guest) };
}
