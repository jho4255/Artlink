/**
 * @멘션 입력 보조 — **커서 앞의 `@…` 를 찾아 검색어로 준다.**
 *
 * ⚠️ **`\w` 로 잡지 말 것.** 예전 구현이 `/@(\w*)$/` 였는데 `\w` 는 `[A-Za-z0-9_]` 라
 *    **한글이 아예 안 걸린다** — 한국어 서비스에서 자동완성이 한 번도 안 떴다.
 *    이름에 공백이 있는 계정('Artist 1', 갤러리 상호)도 앞 토막만 잘려 안 맞았다.
 * ⚠️ **글 끝(`$`)만 보지 말 것.** 가운데를 고칠 때는 커서가 끝이 아니다.
 *
 * 그래서 정규식을 쓰지 않는다 — **커서 바로 앞의 `@` 를 찾아 그 뒤를 통째로 검색어**로 넘기고,
 * 누구와 맞는지는 서버가 판정한다(`backend/src/lib/mention.ts` 가 이름 목록에서 최장일치).
 * 공백·한글·대소문자가 자연스럽게 먹고, 클라이언트가 규칙을 따로 들고 있지 않아 어긋날 일이 없다.
 */

/** `@` 뒤 검색어의 최대 길이 — 이보다 길면 멘션을 쓰는 게 아니라 그냥 글이다. */
const MAX_QUERY = 20;

export interface MentionSpan {
  /** `@` 의 위치 */
  start: number;
  /** `@` 와 커서 사이의 글자 = 검색어 */
  query: string;
}

/** 커서 앞에 열려 있는 `@…` 가 있으면 그 구간을. 없으면 null. */
export function mentionQueryAt(text: string, cursor: number): MentionSpan | null {
  const upto = text.slice(0, cursor);
  const at = upto.lastIndexOf('@');
  if (at < 0) return null;

  // 이메일처럼 앞에 글자가 붙어 있으면 멘션이 아니다 (a@b)
  const before = at > 0 ? upto[at - 1] : '';
  if (before && !/\s/.test(before)) return null;

  const query = upto.slice(at + 1);
  if (query.length > MAX_QUERY) return null;   // 멘션을 쓰다 만 게 아니라 평범한 글
  if (/[\n@]/.test(query)) return null;        // 줄이 바뀌었거나 다음 @ 가 시작됐다
  return { start: at, query };
}

/** 고른 사람을 그 구간에 끼워 넣은 새 글과 커서 위치. */
export function applyMention(
  text: string,
  span: MentionSpan,
  cursor: number,
  label: string,
): { text: string; cursor: number } {
  const inserted = `@${label} `;
  return {
    text: text.slice(0, span.start) + inserted + text.slice(cursor),
    cursor: span.start + inserted.length,
  };
}
