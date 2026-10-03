import sanitizeHtml from 'sanitize-html';
import { AppError } from '../middleware/errorHandler';

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
 *
 * 2026-10-03 — **공모 소개(`Exhibition.description`)·전시 소개(`Show.description`)** 도 같은 편집기·같은 규칙(사용자 요청).
 * 저장하는 곳은 전부 `richField()` 를 거친다(등록 · 아트링크 주최 등록 · 소개 수정 · 전시 등록/수정 · 수정 요청).
 * ⚠️ 이 값을 **글자로만** 쓰는 곳(검색엔진 설명 `seoMeta.ts` 등)은 `richTextPlain()` 으로 태그를 벗겨 쓸 것 — 안 그러면 `<p>` 가 그대로 찍힌다.
 */
export const RICH_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a', 'hr'];

/** 저장값이 서식 있는 글(HTML)인가 — 편집기는 늘 블록 태그로 시작하는 HTML 을 만든다 */
export function isRichHtml(value: string | null | undefined): boolean {
  return !!value && /^\s*<(p|h2|h3|ul|ol|blockquote|hr)[\s>/]/i.test(value);
}

/**
 * 텍스트만 뽑는다 — 빈 글 판정·글자 수·검색엔진 설명.
 * 문단·제목·목록·줄바꿈 경계에 띄어쓰기를 넣고 벗긴다 — 그냥 벗기면 '모집 요강</h2><p>회화' 가 '모집 요강회화' 로 붙는다(2026-10-03).
 */
export function richTextPlain(value: string): string {
  if (!isRichHtml(value)) return value;
  const spaced = value.replace(/<\/(p|h2|h3|li|blockquote)>|<br\s*\/?>|<hr\s*\/?>/gi, (m) => `${m} `);
  return sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
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

/**
 * 서식 있는 소개 칸 하나를 **저장할 값으로** — 걸러서(허용 목록) 보이는 글자 수를 센다(2026-10-03, 공모·전시 소개).
 *  - 형식이 틀리거나(문자열 아님) 너무 길면 400
 *  - 비었으면 `required` 일 때 400(`emptyMessage`), 아니면 null
 * HTML 자체 길이는 태그 몫을 넉넉히 준다(글자 한도의 4배 + 1만) — 한도는 **보이는 글자**로 본다.
 */
export function richField(input: unknown, opts: { label: string; maxText: number; required?: boolean; emptyMessage?: string }): string | null {
  const empty = () => {
    if (opts.required) throw new AppError(opts.emptyMessage ?? `${opts.label}을(를) 입력해주세요.`, 400);
    return null;
  };
  if (input == null || input === '') return empty();
  if (typeof input !== 'string') throw new AppError(`${opts.label} 형식이 올바르지 않습니다.`, 400);
  if (input.length > opts.maxText * 4 + 10000) throw new AppError(`${opts.label}이(가) 너무 깁니다.`, 400);
  const clean = sanitizeRichText(input);
  if (!clean) return empty();
  if (richTextPlain(clean).length > opts.maxText) throw new AppError(`${opts.label}은(는) ${opts.maxText.toLocaleString()}자까지 쓸 수 있습니다.`, 400);
  return clean;
}
