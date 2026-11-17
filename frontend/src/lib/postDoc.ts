/**
 * 커뮤니티 글 문서 (2026-11-13, 블로그형 편집기) — 서버 `backend/src/lib/postDoc.ts` 의 **거울**.
 *
 * - 편집기(TipTap, components/post-editor)가 만드는 JSON 과 읽는 화면(components/post/PostBody)이 그리는 JSON 이 같은 모양이다.
 * - ⚠️ 노드·마크·속성 값 목록은 서버와 **같아야 한다** — `__tests__/postDoc.test.ts` 가 서버 소스를 읽어 대조한다.
 *   한쪽에만 더하면 편집기가 만든 노드가 등록에서 400 이 되거나, 저장은 되는데 화면에서 사라진다.
 * - 옛 글(본문 + 맨 아래 사진)은 `legacyToPostDoc` 으로 같은 문서가 되어 같은 화면이 그린다.
 */

export const POST_BLOCK_NODES = [
  'paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'horizontalRule',
  'figure', 'gallery', 'callout', 'youtube', 'video', 'poll',
] as const;
export const POST_LIST_CHILD_NODES = ['paragraph', 'bulletList', 'orderedList'] as const;
export const POST_QUOTE_CHILD_NODES = ['paragraph', 'bulletList', 'orderedList'] as const;
export const POST_INLINE_NODES = ['text', 'hardBreak'] as const;
export const POST_MARKS = ['bold', 'italic', 'underline', 'strike', 'highlight', 'link'] as const;

export const FIGURE_SIZES = ['text', 'wide', 'full'] as const;
export const GALLERY_LAYOUTS = ['row', 'grid', 'slide'] as const;
export const QUOTE_VARIANTS = ['line', 'pull'] as const;
export const CALLOUT_TONES = ['tip', 'note'] as const;

export type FigureSize = (typeof FIGURE_SIZES)[number];
export type GalleryLayout = (typeof GALLERY_LAYOUTS)[number];

/** 서버 POST_DOC_LIMITS 의 화면 쪽 — 안내·막기용(진짜 판정은 서버) */
export const POST_DOC_LIMITS = {
  textChars: 30_000,
  images: 100,
  galleryItems: 12,
  titleChars: 120,
  captionChars: 300,
  altChars: 300,
  videos: 10,
  pollOptionsMin: 2,
  pollOptionsMax: 10,
  pollQuestionChars: 120,
  pollOptionChars: 60,
  pollMaxDays: 365,
} as const;

/** 동영상 파일 한 개 상한(서버 업로드 상한과 같다 — CHAT_VIDEO_MAX_BYTES) */
export const POST_VIDEO_MAX_BYTES = 25 * 1024 * 1024;

export interface PostMark { type: string; attrs?: { href?: string } & Record<string, unknown> }
export interface PostNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PostNode[];
  text?: string;
  marks?: PostMark[];
}
export interface PostDoc { type: 'doc'; content: PostNode[] }

export interface PostImageAttrs {
  src: string | null;
  width: number | null;
  height: number | null;
  alt?: string;
  large?: boolean;
  /** 편집 중에만 — 올리는 중인 사진(저장·보관에는 싣지 않는다) */
  uploadId?: string | null;
}
export interface FigureAttrs extends PostImageAttrs { caption?: string; size?: FigureSize }
export interface GalleryAttrs { layout?: GalleryLayout; items?: PostImageAttrs[]; caption?: string; size?: FigureSize }
/** 동영상(파일) — 치수는 화면이 재서 싣는다(자리 예약). 편집 중에만 uploadId */
export interface VideoAttrs { src: string | null; width: number | null; height: number | null; caption?: string; uploadId?: string | null }
/** 투표 — 서버 PollDef 와 같은 모양. 보기 id 는 화면이 만든 무작위 값(글자를 고쳐도 표가 따라간다) */
export interface PollAttrs { question: string; options: { id: string; text: string }[]; multiple: boolean; endsAt: string | null }

export const emptyPostDoc = (): PostDoc => ({ type: 'doc', content: [{ type: 'paragraph' }] });

/** 옛 글 → 문서(서버 legacyToPostDoc 과 같은 규칙). 빈 줄은 문단, 한 줄바꿈은 hardBreak, 사진은 맨 아래 본문 폭 */
export function legacyToPostDoc(body: string, images: string[]): PostDoc {
  const content: PostNode[] = [];
  for (const para of (body ?? '').replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const inline: PostNode[] = [];
    para.split('\n').forEach((line, i) => {
      if (i > 0) inline.push({ type: 'hardBreak' });
      if (line) inline.push({ type: 'text', text: line });
    });
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

/** 문서의 글 — 블록 사이 빈 줄. 사진 설명은 넣지 않는다(서버 postDocText 와 같다) */
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
        if (q) blocks.push(q);
      } else if (n.content && n.type !== 'figure' && n.type !== 'gallery') {
        walk(n.content);
      }
    }
  };
  walk(doc?.content);
  return blocks.join('\n\n');
}

/** 문서 속 사진(순서대로, 중복 없이) — 올리는 중인 것(src 없음)은 빼고 */
export function postDocImages(doc: { content?: PostNode[] } | null | undefined): PostImageAttrs[] {
  const out: PostImageAttrs[] = [];
  const seen = new Set<string>();
  const add = (a: PostImageAttrs | undefined) => {
    if (!a?.src || seen.has(a.src)) return;
    seen.add(a.src);
    out.push(a);
  };
  const walk = (nodes: PostNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === 'figure') add(n.attrs as unknown as PostImageAttrs);
      else if (n.type === 'gallery') for (const it of ((n.attrs as GalleryAttrs | undefined)?.items ?? [])) add(it);
      else if (n.content) walk(n.content);
    }
  };
  walk(doc?.content);
  return out;
}

/** 사진·영상 수 */
export function postDocMediaCount(doc: { content?: PostNode[] } | null | undefined): number {
  let n = 0;
  const walk = (nodes: PostNode[] | undefined) => {
    for (const x of nodes ?? []) {
      if (x.type === 'figure' || x.type === 'youtube' || x.type === 'video') n++;
      else if (x.type === 'gallery') n += ((x.attrs as GalleryAttrs | undefined)?.items ?? []).length;
      else if (x.content) walk(x.content);
    }
  };
  walk(doc?.content);
  return n;
}

/** 읽는 시간(분) — 서버와 같은 규칙(한글 분당 500자 + 사진·영상 10초, 최소 1) */
export function readingMinutes(textLength: number, mediaCount: number): number {
  return Math.max(1, Math.round(textLength / 500 + (mediaCount * 10) / 60));
}

/** 글도 사진도 영상도 투표도 없는가 */
export function isEmptyPostDoc(doc: { content?: PostNode[] } | null | undefined): boolean {
  return !postDocText(doc).trim() && postDocMediaCount(doc) === 0 && !(doc?.content ?? []).some((n) => n.type === 'poll');
}

/** 문서 속 투표(첫 번째) — 한 글에 하나 */
export function postDocPoll(doc: { content?: PostNode[] } | null | undefined): PollAttrs | null {
  const n = (doc?.content ?? []).find((x) => x.type === 'poll');
  return n ? (n.attrs as unknown as PollAttrs) : null;
}

/** 문서 속 동영상 수(올리는 중 포함) */
export function postDocVideoCount(doc: { content?: PostNode[] } | null | undefined): number {
  return (doc?.content ?? []).filter((x) => x.type === 'video').length;
}

/**
 * 저장할 문서 — 올리는 중·실패한 사진(src 없음)을 뺀다. 모음은 남은 사진만, 다 빠지면 모음째.
 * 화면 전용 속성(uploadId)은 싣지 않는다.
 */
export function savableDoc(doc: PostDoc): PostDoc {
  const clean = (nodes: PostNode[] | undefined): PostNode[] => {
    const out: PostNode[] = [];
    for (const n of nodes ?? []) {
      if (n.type === 'figure') {
        const a = (n.attrs ?? {}) as unknown as FigureAttrs;
        if (!a.src) continue;
        const rest: Record<string, unknown> = { ...a };
        delete rest.uploadId;   // 올리는 중 표시 — 저장할 값이 아니다
        out.push({ ...n, attrs: rest });
      } else if (n.type === 'gallery') {
        const a = (n.attrs ?? {}) as unknown as GalleryAttrs;
        const items = (a.items ?? []).filter((it) => it.src).map((it) => { const c: Record<string, unknown> = { ...it }; delete c.uploadId; return c; });
        if (items.length === 0) continue;
        out.push({ ...n, attrs: { ...a, items } as Record<string, unknown> });
      } else if (n.type === 'video') {
        const a = (n.attrs ?? {}) as unknown as VideoAttrs;
        if (!a.src) continue;   // 올리는 중·실패한 동영상은 싣지 않는다
        const rest: Record<string, unknown> = { ...a };
        delete rest.uploadId;
        out.push({ ...n, attrs: rest });
      } else if (n.content) {
        out.push({ ...n, content: clean(n.content) });
      } else {
        out.push(n);
      }
    }
    return out;
  };
  const content = clean(doc.content);
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

/** 올리는 중이거나 실패한 사진·동영상 수(src 없는 것) */
export function pendingImageCount(doc: { content?: PostNode[] } | null | undefined): number {
  let n = 0;
  const walk = (nodes: PostNode[] | undefined) => {
    for (const x of nodes ?? []) {
      if ((x.type === 'figure' || x.type === 'video') && !(x.attrs as FigureAttrs | undefined)?.src) n++;
      else if (x.type === 'gallery') n += ((x.attrs as GalleryAttrs | undefined)?.items ?? []).filter((it) => !it.src).length;
      else if (x.content) walk(x.content);
    }
  };
  walk(doc?.content);
  return n;
}

/**
 * 유튜브 주소 → 영상 id(11자). watch?v= · youtu.be/ · shorts/ · embed/ · live/ 를 받는다. 아니면 null.
 * 서버는 id 만 저장한다(주소를 저장하지 않는다 — iframe 주소는 화면이 id 로 만든다).
 */
export function parseYoutubeId(raw: string): string | null {
  const t = (raw ?? '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(t)) return t;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, '').toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
      id = m ? m[1]! : null;
    }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

/** 글의 링크 — 같은 사이트 경로·http(s)·mailto 만(서버 safeLinkHref 와 같은 규칙) */
export function safeLinkHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t || t.length > 2000) return null;
  if (t.startsWith('/')) return t.startsWith('//') || t.startsWith('/\\') ? null : t;
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:' ? t : null;
  } catch {
    return null;
  }
}

/** 링크 입력값 → 저장할 주소. 스킴 없이 친 주소는 https:// 를 붙인다(mailto·같은 사이트 경로는 그대로) */
export function normalizeLinkInput(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (t.startsWith('/') || /^(https?:|mailto:)/i.test(t)) return safeLinkHref(t);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return safeLinkHref(`mailto:${t}`);
  return safeLinkHref(`https://${t}`);
}

/** 글 안 사진 하나 — 크게 보기 목록 */
export interface PostImageRef { src: string; caption: string }

/** 글 안 사진(순서대로, 중복 없이) — 크게 보기. 사진 모음의 설명은 모음의 각 사진에 붙인다 */
export function collectPostImages(doc: PostDoc | null | undefined): PostImageRef[] {
  const out: PostImageRef[] = [];
  const seen = new Set<string>();
  const walk = (nodes: PostNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === 'figure') {
        const f = (n.attrs ?? {}) as unknown as FigureAttrs;
        if (f.src && !seen.has(f.src)) { seen.add(f.src); out.push({ src: f.src, caption: f.caption ?? '' }); }
      } else if (n.type === 'gallery') {
        const g = (n.attrs ?? {}) as unknown as GalleryAttrs;
        for (const it of g.items ?? []) if (it.src && !seen.has(it.src)) { seen.add(it.src); out.push({ src: it.src, caption: g.caption ?? '' }); }
      } else if (n.content) walk(n.content);
    }
  };
  walk(doc?.content);
  return out;
}
