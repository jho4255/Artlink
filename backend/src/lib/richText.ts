import sanitizeHtml from 'sanitize-html';

/**
 * 서식 있는 글(2026-09-28, 사용자 요청 "소개 적을 때 기본적인 워드 형태는 갖춰야") — 갤러리 소개·지난 활동 기록 본문.
 *
 * 화면 편집기(TipTap)가 HTML 을 보내면 **허용 목록**으로 걸러 저장한다. 프론트 `lib/richText.ts` 가 렌더할 때 한 번 더
 * 거른다(DOMPurify) — 이 변경 전에 평범한 글로 저장된 값 중 `<p` 로 시작하는 게 있으면 그때부터 HTML 로 읽히므로.
 *
 * ⚠️ 허용 목록을 넓힐 땐 **프론트의 같은 목록도** 함께(`frontend/src/lib/richText.ts` RICH_TAGS) — 한쪽만 넓히면
 *    저장은 되는데 화면에서 사라지거나(프론트가 막음), 화면 편집기가 만든 태그가 저장에서 잘린다(서버가 막음).
 * ⚠️ `style`·`class`·이미지는 받지 않는다 — 워드에서 붙여 넣은 글꼴·색·크기가 갤러리 페이지 디자인을 깨고,
 *    이미지는 외부 주소 주입 통로가 된다(사진은 따로 올린다).
 * 평범한 글(태그가 없는 옛 값·API 로 보낸 글)은 **그대로** 둔다 — 화면이 줄바꿈을 살려 그린다.
 */
export const RICH_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a', 'hr'];

/** 저장값이 서식 있는 글(HTML)인가 — 편집기는 늘 블록 태그로 시작하는 HTML 을 만든다 */
export function isRichHtml(value: string | null | undefined): boolean {
  return !!value && /^\s*<(p|h2|h3|ul|ol|blockquote|hr)[\s>/]/i.test(value);
}

/** 텍스트만 뽑는다 — 빈 글 판정·글자 수 */
export function richTextPlain(value: string): string {
  if (!isRichHtml(value)) return value;
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
}

/**
 * 저장 전 정리. 평범한 글은 그대로(앞뒤 공백만), HTML 은 허용 목록만 남긴다. 내용이 비면 null.
 * 링크는 http·https·mailto 만, 새 창 + rel=noopener noreferrer nofollow 를 서버가 붙인다(작성자가 빼도 붙는다).
 */
export function sanitizeRichText(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;
  if (!isRichHtml(raw)) return raw;
  const clean = sanitizeHtml(raw, {
    allowedTags: RICH_TAGS,
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...(attribs.href ? { href: attribs.href } : {}), target: '_blank', rel: 'noopener noreferrer nofollow' },
      }),
    },
  })
    // 끝에 남은 빈 문단(편집기에서 Enter 를 한 번 더 누른 자리)은 지운다 — 공개 화면 아래에 빈 줄이 붙는다
    .replace(/(?:<p>(?:\s|<br\s*\/?>)*<\/p>\s*)+$/i, '')
    .trim();
  return richTextPlain(clean) ? clean : null;
}
