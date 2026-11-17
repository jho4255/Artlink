import { ownFileUrl } from './safeUrl';
import { AppError } from '../middleware/errorHandler';

/**
 * 커뮤니티 글 **문서** (2026-11-13, 블로그형 편집기) — TipTap(ProseMirror) JSON 을 허용 목록으로 걸러 저장한다.
 *
 * ## 왜 HTML 이 아니라 JSON 인가
 * 글 중간에 사진·모아 놓기·영상·팁 상자가 들어가면 HTML 로는 ①`<img src>` 를 우리 저장소로만 묶고 ②크기·배치를 class·data-* 로
 * 실어야 하고 ③읽는 화면이 srcset·치수 예약·크게 보기를 붙이려고 HTML 을 다시 파싱해야 한다. JSON 이면
 * - 여기서 **노드·마크·속성 단위로** 검증한다(모르는 노드는 등록에서 400, 사진 주소는 `ownFileUrl`, 링크는 http·https·mailto·같은 사이트).
 * - 화면(`components/post/PostBody.tsx`)이 React 요소로 직접 그린다 — `dangerouslySetInnerHTML` 이 없다(저장형 XSS 표면이 사라진다).
 * - 글자·사진 목록·발췌를 서버가 뽑는다(`Post.body`·`Post.images` — 목록·멘션·검색엔진 설명이 예전 그대로 돈다).
 *
 * ⚠️ 노드·마크 목록은 화면 `frontend/src/lib/postDoc.ts` 와 **같아야 한다**(프론트 테스트가 이 파일을 읽어 대조한다).
 *    한쪽에만 더하면 편집기가 만든 노드가 등록에서 400 이 되거나(서버가 모름), 저장은 되는데 화면에서 사라진다(화면이 모름).
 *
 * 두 모드:
 * - `draft`(자동 저장) — 느슨하다. 모르는 노드·잘못된 사진은 **조용히 버린다**(쓰는 사람의 저장이 막히면 안 된다 — 화면의 기기 보관이 원본을 들고 있다).
 * - `publish`(등록·수정) — 엄격하다. 모르는 노드·바깥 사진·올리는 중인 사진이면 **400** — 말없이 빠진 채 올라가면 안 된다.
 */

export const POST_DOC_VERSION = 1;

/** 최상위·블록 안에 올 수 있는 노드 */
export const POST_BLOCK_NODES = [
  'paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'horizontalRule',
  'figure', 'gallery', 'callout', 'youtube', 'video', 'poll',
] as const;
/** 목록 항목 안 */
export const POST_LIST_CHILD_NODES = ['paragraph', 'bulletList', 'orderedList'] as const;
/** 인용·팁 상자 안 */
export const POST_QUOTE_CHILD_NODES = ['paragraph', 'bulletList', 'orderedList'] as const;
/** 글 안 */
export const POST_INLINE_NODES = ['text', 'hardBreak'] as const;
export const POST_MARKS = ['bold', 'italic', 'underline', 'strike', 'highlight', 'link'] as const;

export const FIGURE_SIZES = ['text', 'wide', 'full'] as const;
export const GALLERY_LAYOUTS = ['row', 'grid', 'slide'] as const;
export const QUOTE_VARIANTS = ['line', 'pull'] as const;
export const CALLOUT_TONES = ['tip', 'note'] as const;

export const POST_DOC_LIMITS = {
  /** 받은 JSON 그대로의 크기(바이트 근사) — 이 위는 읽지도 않는다 */
  jsonChars: 600_000,
  /** 보이는 글자(제목 제외) */
  textChars: 30_000,
  images: 100,
  galleryItems: 12,
  depth: 12,
  blocks: 1_500,
  captionChars: 300,
  altChars: 300,
  titleChars: 120,
  hrefChars: 2_000,
  /** 동영상(파일) — 한 글에. 한 개 25MB(업로드 상한) */
  videos: 10,
  /** 투표 — 한 글에 하나, 보기 2~10개 */
  pollOptionsMin: 2,
  pollOptionsMax: 10,
  pollQuestionChars: 120,
  pollOptionChars: 60,
  /** 마감은 1년 안 */
  pollMaxDays: 365,
} as const;

/** 투표 정의(문서의 poll 블록 = Post.poll) — 보기 id 는 화면이 만든 무작위 값이라 글자를 고쳐도 표가 따라간다 */
export interface PollDef { question: string; options: { id: string; text: string }[]; multiple: boolean; endsAt: string | null }

export type PostDocMode = 'draft' | 'publish';

export interface PostMark { type: string; attrs?: { href: string } }
export interface PostNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PostNode[];
  text?: string;
  marks?: PostMark[];
}
export interface PostDoc { type: 'doc'; content: PostNode[] }

export interface GalleryItem { src: string; width: number | null; height: number | null; alt: string; large?: boolean }

export interface SanitizedPostDoc {
  doc: PostDoc;
  /** 문서 속 사진 주소, 나온 순서대로(중복 없이) */
  images: string[];
  /** 문서 속 동영상 주소, 나온 순서대로(중복 없이) */
  videos: string[];
  /** 투표(없으면 null) — 한 글에 하나 */
  poll: PollDef | null;
  /** 문서에서 뽑은 글 — 블록 사이는 빈 줄(`\n\n`), 줄바꿈은 `\n` */
  text: string;
  /** 사진·영상 수 — 읽는 시간 계산용 */
  mediaCount: number;
}

type Ctx = { mode: PostDocMode; blocks: number; images: string[]; videos: string[]; poll: PollDef | null; media: number; problems: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
// 보이지 않는 제어 문자(줄바꿈은 글 노드에 오지 않는다 — hardBreak 로 온다)
// eslint-disable-next-line no-control-regex
const CTRL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u200B\\u2028\\u2029\\uFEFF]', 'g');
const cleanStr = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(CTRL, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const clampInt = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= lo && r <= hi ? r : null;
};
const oneOf = <T extends readonly string[]>(v: unknown, list: T, def: T[number]): T[number] =>
  (typeof v === 'string' && (list as readonly string[]).includes(v) ? v : def) as T[number];

/** 글의 링크 주소 — http·https·mailto, 또는 같은 사이트 경로(`/exhibitions/3`). 아니면 null */
export function safeLinkHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t || t.length > POST_DOC_LIMITS.hrefChars) return null;
  if (t.startsWith('/')) return t.startsWith('//') || t.startsWith('/\\') ? null : t;
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:' ? t : null;
  } catch {
    return null;
  }
}

/** 유튜브 영상 id — 11자 [A-Za-z0-9_-] */
export function isYoutubeId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{11}$/.test(v);
}

function fail(ctx: Ctx, message: string): void {
  // 등록은 이유를 모아 400 으로, 작업본은 조용히 버린다
  if (ctx.mode === 'publish') ctx.problems.push(message);
}

function sanitizeMarks(raw: unknown): PostMark[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: PostMark[] = [];
  const seen = new Set<string>();
  for (const m of raw.slice(0, 10)) {
    if (!isObj(m) || typeof m.type !== 'string' || seen.has(m.type)) continue;
    if (!(POST_MARKS as readonly string[]).includes(m.type)) continue;
    if (m.type === 'link') {
      const href = safeLinkHref(isObj(m.attrs) ? m.attrs.href : null);
      if (!href) continue;   // 위험한 주소의 링크는 글자만 남긴다
      out.push({ type: 'link', attrs: { href } });
    } else {
      out.push({ type: m.type });
    }
    seen.add(m.type);
  }
  return out.length ? out : undefined;
}

function sanitizeInline(raw: unknown, ctx: Ctx): PostNode[] {
  if (!Array.isArray(raw)) return [];
  const out: PostNode[] = [];
  for (const n of raw) {
    if (!isObj(n)) continue;
    if (n.type === 'text') {
      const text = typeof n.text === 'string' ? n.text.replace(CTRL, '').replace(/[\r\n\t]+/g, ' ') : '';
      if (!text) continue;   // 빈 글 노드는 ProseMirror 가 거부한다
      const marks = sanitizeMarks(n.marks);
      out.push(marks ? { type: 'text', text, marks } : { type: 'text', text });
    } else if (n.type === 'hardBreak') {
      out.push({ type: 'hardBreak' });
    } else {
      fail(ctx, '지원하지 않는 글 서식이 있어요.');
    }
  }
  return out;
}

function imageSrc(raw: unknown, ctx: Ctx): string | null {
  const s = ownFileUrl(raw);
  if (s) return s;
  if (typeof raw !== 'string' || !raw.trim()) fail(ctx, '아직 올라가는 중인 사진이 있어요. 다 올라간 뒤 다시 눌러 주세요.');
  else fail(ctx, '다른 사이트의 사진은 넣을 수 없어요. 사진은 직접 올려 주세요.');
  return null;
}

function pushImage(ctx: Ctx, src: string): void {
  if (!ctx.images.includes(src)) ctx.images.push(src);
}

function sanitizeFigure(n: Record<string, unknown>, ctx: Ctx): PostNode | null {
  const a = isObj(n.attrs) ? n.attrs : {};
  const src = imageSrc(a.src, ctx);
  if (!src) return null;
  pushImage(ctx, src);
  ctx.media++;
  return {
    type: 'figure',
    attrs: {
      src,
      width: clampInt(a.width, 1, 30000),
      height: clampInt(a.height, 1, 30000),
      alt: cleanStr(a.alt, POST_DOC_LIMITS.altChars),
      caption: cleanStr(a.caption, POST_DOC_LIMITS.captionChars),
      size: oneOf(a.size, FIGURE_SIZES, 'text'),
      // large(t1280 있음)는 서버가 사진 기록을 보고 다시 정한다(applyAssetInfo) — 받은 값은 믿지 않는다
      large: false,
    },
  };
}

function sanitizeGallery(n: Record<string, unknown>, ctx: Ctx): PostNode | null {
  const a = isObj(n.attrs) ? n.attrs : {};
  const rawItems = Array.isArray(a.items) ? a.items : [];
  if (rawItems.length > POST_DOC_LIMITS.galleryItems) fail(ctx, `사진 모음에는 ${POST_DOC_LIMITS.galleryItems}장까지 넣을 수 있어요.`);
  const items: GalleryItem[] = [];
  for (const it of rawItems.slice(0, POST_DOC_LIMITS.galleryItems)) {
    if (!isObj(it)) continue;
    const src = imageSrc(it.src, ctx);
    if (!src) continue;
    pushImage(ctx, src);
    items.push({
      src,
      width: clampInt(it.width, 1, 30000),
      height: clampInt(it.height, 1, 30000),
      alt: cleanStr(it.alt, POST_DOC_LIMITS.altChars),
      large: false,
    });
  }
  if (items.length === 0) return null;
  ctx.media += items.length;
  const caption = cleanStr(a.caption, POST_DOC_LIMITS.captionChars);
  const size = oneOf(a.size, FIGURE_SIZES, 'text');
  // 한 장만 남은 모음은 그냥 사진이다(편집 중에 빼다 보면 생긴다) — 말없이 바꿔도 잃는 게 없다
  if (items.length === 1) {
    const it = items[0]!;
    return { type: 'figure', attrs: { src: it.src, width: it.width, height: it.height, alt: it.alt, caption, size, large: false } };
  }
  return { type: 'gallery', attrs: { layout: oneOf(a.layout, GALLERY_LAYOUTS, 'row'), items, caption, size } };
}

/** 동영상 파일 — 우리 저장소 + 동영상 확장자만(사진 주소를 동영상 칸에 넣지 못하게) */
const VIDEO_EXT = /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i;
function sanitizeVideo(n: Record<string, unknown>, ctx: Ctx): PostNode | null {
  const a = isObj(n.attrs) ? n.attrs : {};
  const src = ownFileUrl(a.src);
  if (!src || !VIDEO_EXT.test(src)) {
    fail(ctx, typeof a.src === 'string' && a.src.trim() ? '다른 곳의 동영상은 넣을 수 없어요. 동영상은 직접 올려 주세요.' : '아직 올라가는 중인 동영상이 있어요. 다 올라간 뒤 다시 눌러 주세요.');
    return null;
  }
  if (ctx.videos.length >= POST_DOC_LIMITS.videos && !ctx.videos.includes(src)) {
    fail(ctx, `동영상은 한 글에 ${POST_DOC_LIMITS.videos}개까지 넣을 수 있어요.`);
    return null;
  }
  if (!ctx.videos.includes(src)) ctx.videos.push(src);
  ctx.media++;
  return {
    type: 'video',
    attrs: { src, width: clampInt(a.width, 1, 30000), height: clampInt(a.height, 1, 30000), caption: cleanStr(a.caption, POST_DOC_LIMITS.captionChars) },
  };
}

const OPTION_ID = /^[A-Za-z0-9]{4,24}$/;
/** 투표 — 한 글에 하나. 등록 때는 질문과 보기 둘 이상이 있어야 한다 */
function sanitizePoll(n: Record<string, unknown>, ctx: Ctx): PostNode | null {
  if (ctx.poll) { fail(ctx, '투표는 한 글에 하나만 넣을 수 있어요.'); return null; }
  const a = isObj(n.attrs) ? n.attrs : {};
  const question = cleanStr(a.question, POST_DOC_LIMITS.pollQuestionChars);
  const seen = new Set<string>();
  const options: { id: string; text: string }[] = [];
  const rawOptions = Array.isArray(a.options) ? a.options.slice(0, POST_DOC_LIMITS.pollOptionsMax) : [];
  rawOptions.forEach((o, i) => {
    if (!isObj(o)) return;
    let id = typeof o.id === 'string' && OPTION_ID.test(o.id) ? o.id : `o${i + 1}`;
    while (seen.has(id)) id = `${id}x`;
    seen.add(id);
    const text = cleanStr(o.text, POST_DOC_LIMITS.pollOptionChars);
    if (ctx.mode === 'publish' && !text) return;   // 빈 보기는 올릴 때 뺀다
    options.push({ id, text });
  });
  if (Array.isArray(a.options) && a.options.length > POST_DOC_LIMITS.pollOptionsMax) fail(ctx, `투표 보기는 ${POST_DOC_LIMITS.pollOptionsMax}개까지예요.`);
  let endsAt: string | null = null;
  if (typeof a.endsAt === 'string' && a.endsAt) {
    const t = Date.parse(a.endsAt);
    if (Number.isFinite(t)) {
      if (t > Date.now() + POST_DOC_LIMITS.pollMaxDays * 86_400_000) fail(ctx, '투표 마감은 1년 안으로 정해 주세요.');
      else endsAt = new Date(t).toISOString();
    }
  }
  if (ctx.mode === 'publish') {
    if (!question) fail(ctx, '투표 질문을 써 주세요.');
    if (options.length < POST_DOC_LIMITS.pollOptionsMin) fail(ctx, `투표 보기를 ${POST_DOC_LIMITS.pollOptionsMin}개 이상 써 주세요.`);
  }
  const def: PollDef = { question, options, multiple: a.multiple === true, endsAt };
  ctx.poll = def;
  return { type: 'poll', attrs: { ...def } };
}

function sanitizeChildren(raw: unknown, allowed: readonly string[], ctx: Ctx, depth: number): PostNode[] {
  if (!Array.isArray(raw)) return [];
  const out: PostNode[] = [];
  for (const n of raw) {
    const c = sanitizeBlock(n, allowed, ctx, depth + 1);
    if (c) out.push(c);
  }
  return out;
}

function sanitizeListItem(raw: unknown, ctx: Ctx, depth: number): PostNode | null {
  if (!isObj(raw) || raw.type !== 'listItem') {
    fail(ctx, '목록 모양이 올바르지 않아요.');
    return null;
  }
  const content = sanitizeChildren(raw.content, POST_LIST_CHILD_NODES, ctx, depth);
  // 목록 항목은 문단으로 시작해야 한다(ProseMirror 규칙 'paragraph block*')
  if (content[0]?.type !== 'paragraph') content.unshift({ type: 'paragraph' });
  return { type: 'listItem', content };
}

function sanitizeBlock(raw: unknown, allowed: readonly string[], ctx: Ctx, depth: number): PostNode | null {
  if (!isObj(raw) || typeof raw.type !== 'string') return null;
  if (depth > POST_DOC_LIMITS.depth) {
    fail(ctx, '목록·인용이 너무 깊게 겹쳐 있어요.');
    return null;
  }
  if (!allowed.includes(raw.type)) {
    fail(ctx, '지원하지 않는 내용이 있어요.');
    return null;
  }
  ctx.blocks++;
  if (ctx.blocks > POST_DOC_LIMITS.blocks) throw new AppError('글이 너무 길어요. 나눠서 올려 주세요.', 413);
  const a = isObj(raw.attrs) ? raw.attrs : {};
  switch (raw.type) {
    case 'paragraph': {
      const content = sanitizeInline(raw.content, ctx);
      const node: PostNode = { type: 'paragraph' };
      if (a.textAlign === 'center') node.attrs = { textAlign: 'center' };
      if (content.length) node.content = content;
      return node;
    }
    case 'heading': {
      const content = sanitizeInline(raw.content, ctx);
      const level = a.level === 3 ? 3 : 2;
      const node: PostNode = { type: 'heading', attrs: { level, ...(a.textAlign === 'center' ? { textAlign: 'center' } : {}) } };
      if (content.length) node.content = content;
      return node;
    }
    case 'bulletList':
    case 'orderedList': {
      const items = (Array.isArray(raw.content) ? raw.content : [])
        .map((li) => sanitizeListItem(li, ctx, depth + 1))
        .filter((x): x is PostNode => !!x);
      if (items.length === 0) return null;
      const node: PostNode = { type: raw.type, content: items };
      if (raw.type === 'orderedList') {
        const start = clampInt(a.start, 1, 10000);
        if (start && start !== 1) node.attrs = { start };
      }
      return node;
    }
    case 'blockquote': {
      const content = sanitizeChildren(raw.content, POST_QUOTE_CHILD_NODES, ctx, depth);
      if (content.length === 0) content.push({ type: 'paragraph' });
      const variant = oneOf(a.variant, QUOTE_VARIANTS, 'line');
      return { type: 'blockquote', ...(variant !== 'line' ? { attrs: { variant } } : {}), content };
    }
    case 'callout': {
      const content = sanitizeChildren(raw.content, POST_QUOTE_CHILD_NODES, ctx, depth);
      if (content.length === 0) content.push({ type: 'paragraph' });
      return { type: 'callout', attrs: { tone: oneOf(a.tone, CALLOUT_TONES, 'tip') }, content };
    }
    case 'horizontalRule':
      return { type: 'horizontalRule' };
    case 'figure':
      return sanitizeFigure(raw, ctx);
    case 'gallery':
      return sanitizeGallery(raw, ctx);
    case 'video':
      return sanitizeVideo(raw, ctx);
    case 'poll':
      return sanitizePoll(raw, ctx);
    case 'youtube': {
      if (!isYoutubeId(a.videoId)) {
        fail(ctx, '영상 주소가 올바르지 않아요.');
        return null;
      }
      ctx.media++;
      return { type: 'youtube', attrs: { videoId: a.videoId, caption: cleanStr(a.caption, POST_DOC_LIMITS.captionChars) } };
    }
    default:
      return null;
  }
}

/** 문서에서 글만 — 블록 사이는 빈 줄, hardBreak 는 줄바꿈. 사진 설명·대체 글은 넣지 않는다(본문이 아니다) */
export function postDocText(doc: { content?: PostNode[] } | null | undefined): string {
  const blocks: string[] = [];
  const inline = (nodes: PostNode[] | undefined): string =>
    (nodes ?? []).map((n) => (n.type === 'text' ? n.text ?? '' : n.type === 'hardBreak' ? '\n' : '')).join('');
  const walk = (nodes: PostNode[] | undefined): void => {
    for (const n of nodes ?? []) {
      if (n.type === 'paragraph' || n.type === 'heading') {
        const t = inline(n.content).trim();
        if (t) blocks.push(t);
      } else if (n.type === 'poll') {
        const q = typeof n.attrs?.question === 'string' ? n.attrs.question.trim() : '';
        if (q) blocks.push(q);   // 투표 질문은 글이다(검색·요약) — 보기는 아니다
      } else if (n.content && n.type !== 'figure' && n.type !== 'gallery') {
        walk(n.content);
      }
    }
  };
  walk(doc?.content);
  return blocks.join('\n\n');
}

/**
 * 받은 문서를 허용 목록으로 걸러 새 객체로 돌려준다. 받은 값은 건드리지 않는다.
 * - `publish` 에서 문제가 있으면 첫 이유로 400
 * - 너무 크면 모드와 상관없이 413
 */
export function sanitizePostDoc(raw: unknown, mode: PostDocMode): SanitizedPostDoc {
  if (!isObj(raw) || raw.type !== 'doc') {
    if (mode === 'publish') throw new AppError('글 형식이 올바르지 않아요.', 400);
    return { doc: { type: 'doc', content: [{ type: 'paragraph' }] }, images: [], videos: [], poll: null, text: '', mediaCount: 0 };
  }
  let size = 0;
  try { size = JSON.stringify(raw).length; } catch { throw new AppError('글 형식이 올바르지 않아요.', 400); }
  if (size > POST_DOC_LIMITS.jsonChars) throw new AppError('글이 너무 길어요. 나눠서 올려 주세요.', 413);

  const ctx: Ctx = { mode, blocks: 0, images: [], videos: [], poll: null, media: 0, problems: [] };
  const content = sanitizeChildren(raw.content, POST_BLOCK_NODES, ctx, 0);
  if (content.length === 0) content.push({ type: 'paragraph' });
  const doc: PostDoc = { type: 'doc', content };
  const text = postDocText(doc);

  if (ctx.images.length > POST_DOC_LIMITS.images) throw new AppError(`사진은 한 글에 ${POST_DOC_LIMITS.images}장까지 넣을 수 있어요.`, 400);
  if (text.length > POST_DOC_LIMITS.textChars) throw new AppError(`글은 ${POST_DOC_LIMITS.textChars.toLocaleString()}자까지 쓸 수 있어요.`, 400);
  if (mode === 'publish') {
    if (ctx.problems.length) throw new AppError(ctx.problems[0]!, 400);
    if (!text.trim() && ctx.media === 0 && !ctx.poll) throw new AppError('내용을 입력해주세요.', 400);
  }
  return { doc, images: ctx.images, videos: ctx.videos, poll: ctx.poll, text, mediaCount: ctx.media };
}

/**
 * 사진 기록(PostAsset)으로 치수·큰 썸네일(t1280) 여부를 **서버 값으로** 덮어쓴다 — 화면이 보낸 치수는 기록이 없을 때만 쓴다.
 * 기록이 있는 사진 = 글쓰기 화면이 `/api/upload/post-image` 로 올린 것 = t1280 을 만들었다.
 */
export function applyAssetInfo(doc: PostDoc, assets: Map<string, { width: number | null; height: number | null }>): PostDoc {
  const fix = (o: Record<string, unknown>) => {
    const info = typeof o.src === 'string' ? assets.get(o.src) : undefined;
    if (!info) return { ...o, large: false };
    return { ...o, width: info.width ?? o.width ?? null, height: info.height ?? o.height ?? null, large: true };
  };
  const walk = (nodes: PostNode[] | undefined): PostNode[] | undefined => nodes?.map((n) => {
    if (n.type === 'figure' && n.attrs) return { ...n, attrs: fix(n.attrs) };
    if (n.type === 'gallery' && n.attrs && Array.isArray(n.attrs.items)) {
      return { ...n, attrs: { ...n.attrs, items: (n.attrs.items as Record<string, unknown>[]).map(fix) } };
    }
    return n.content ? { ...n, content: walk(n.content) } : n;
  });
  return { type: 'doc', content: walk(doc.content) ?? [] };
}

/** 문서 속 사진 주소(이미 걸렀다고 보고 그대로 뽑는다) — 작업본 저장 전 사진 기록을 찾을 때 */
export function postDocImageSrcs(doc: PostDoc): string[] {
  const out: string[] = [];
  const walk = (nodes: PostNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === 'figure' && typeof n.attrs?.src === 'string') out.push(n.attrs.src);
      else if (n.type === 'gallery' && Array.isArray(n.attrs?.items)) {
        for (const it of n.attrs!.items as GalleryItem[]) if (typeof it?.src === 'string') out.push(it.src);
      } else if (n.content) walk(n.content);
    }
  };
  walk(doc.content);
  return [...new Set(out)];
}

/**
 * 옛 글(본문 + 맨 아래 사진) → 문서. 고치기 화면이 옛 글을 열 때(서버가 작업본을 만들며) 쓴다.
 * 빈 줄은 문단, 한 줄바꿈은 hardBreak — 예전 화면(pre-wrap)과 같은 모양. 사진은 본문 폭으로 맨 아래에(치수 모름).
 */
export function legacyToPostDoc(body: string, images: string[]): PostDoc {
  const content: PostNode[] = [];
  const paras = (body ?? '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const para of paras) {
    const lines = para.split('\n');
    const inline: PostNode[] = [];
    lines.forEach((line, i) => {
      const t = line.replace(CTRL, '');
      if (i > 0) inline.push({ type: 'hardBreak' });
      if (t) inline.push({ type: 'text', text: t });
    });
    // 앞뒤 hardBreak 만 남은 문단은 비운다
    while (inline[0]?.type === 'hardBreak') inline.shift();
    while (inline[inline.length - 1]?.type === 'hardBreak') inline.pop();
    if (inline.length) content.push({ type: 'paragraph', content: inline });
  }
  for (const src of images ?? []) {
    content.push({ type: 'figure', attrs: { src, width: null, height: null, alt: '', caption: '', size: 'text', large: false } });
  }
  if (content.length === 0) content.push({ type: 'paragraph' });
  return { type: 'doc', content };
}

/** 읽는 시간(분) — 한글 기준 분당 500자 + 사진·영상 한 개 10초. 최소 1분 */
export function readingMinutes(textLength: number, mediaCount: number): number {
  return Math.max(1, Math.round(textLength / 500 + (mediaCount * 10) / 60));
}

/** 목록 발췌 — 글을 한 줄로 이어 140자 */
export function postExcerpt(body: string, max = 140): string {
  const flat = (body ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * 목록 요약(리드) — 글 맨 바깥의 **문단만** 앞에서부터 이어 붙인다(소제목·목록·인용·팁 상자는 건너뛴다).
 * `body`(문서의 글 전체)를 그대로 줄이면 소제목과 목록 항목이 문장 사이에 끼어 "생겼어요. 무엇이 달라졌나요 글 중간에 사진을…" 처럼
 * 이어진 한 덩어리가 된다(2026-11-13 데모에서 실제로 그랬다). 문단이 하나도 없으면(목록만 있는 글) 글 전체로 돌아간다.
 * 등록·수정 때 한 번 만들어 `Post.excerpt` 에 둔다 — 목록이 글마다 문서 전체(JSON)를 읽지 않게.
 */
export function postDocLede(doc: { content?: PostNode[] } | null | undefined, max = 140): string {
  const paras: string[] = [];
  let len = 0;
  for (const n of doc?.content ?? []) {
    if (n.type !== 'paragraph') continue;
    const t = (n.content ?? []).map((x) => (x.type === 'text' ? x.text ?? '' : ' ')).join('').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    paras.push(t);
    len += t.length + 1;
    if (len > max) break;
  }
  return postExcerpt(paras.length ? paras.join(' ') : postDocText(doc), max);
}
