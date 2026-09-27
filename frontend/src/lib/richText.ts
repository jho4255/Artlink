import DOMPurify from 'dompurify';

/**
 * 서식 있는 글 (2026-09-28) — 갤러리 소개·지난 활동 기록 본문. 서버 `backend/src/lib/richText.ts` 의 **거울**이다.
 *
 * - 편집기(`components/shared/RichTextEditor`, TipTap)는 HTML 을 만든다. 서버가 허용 목록으로 걸러 저장하고,
 *   화면은 그릴 때 **한 번 더** 거른다(`sanitizeRich`) — 이 기능 전에 평범한 글로 저장된 값이 우연히 `<p` 로
 *   시작하면 그때부터 HTML 로 읽히기 때문이다(그 값은 서버를 거치지 않았다).
 * - 평범한 글(옛 값)은 HTML 로 바꾸지 않고 그대로 줄바꿈을 살려 그린다(`isRichHtml` false).
 * ⚠️ `RICH_TAGS` 를 바꾸면 서버 목록도 함께 — `__tests__/richText.test.ts` 가 서버 소스와 대조한다.
 */
export const RICH_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a', 'hr'];

export function isRichHtml(value: string | null | undefined): boolean {
  return !!value && /^\s*<(p|h2|h3|ul|ol|blockquote|hr)[\s>/]/i.test(value);
}

let hooked = false;
function ensureLinkHook() {
  if (hooked) return;
  hooked = true;
  // 링크는 늘 새 창 + rel — 서버가 붙이지만 옛 값·우회 값에도 똑같이
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  });
}

/** 화면에 그리기 전 — 허용 목록만, 링크는 http·https·mailto 만 */
export function sanitizeRich(html: string): string {
  ensureLinkHook();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: RICH_TAGS,
    ALLOWED_ATTR: ['href', 'target', 'rel'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  });
}

/** 옛 평범한 글 → 편집기에 넣을 HTML. 빈 줄은 문단, 한 줄바꿈은 <br> — 예전 화면(pre-wrap)과 같은 모양이 되게 */
export function plainToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((para) => `<p>${esc(para).split('\n').join('<br>')}</p>`)
    .join('');
}

/** 편집기에 넣을 값 — 이미 HTML 이면 그대로, 옛 평범한 글이면 문단으로 */
export function toEditorHtml(value: string | null | undefined): string {
  if (!value) return '';
  return isRichHtml(value) ? value : plainToHtml(value);
}

/** 보이는 글자 수 — 한도 안내용(서버도 태그를 빼고 센다) */
export function richTextLength(value: string | null | undefined): number {
  if (!value) return 0;
  if (!isRichHtml(value)) return value.length;
  const doc = new DOMParser().parseFromString(sanitizeRich(value), 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim().length;
}
