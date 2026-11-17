import { Extension, Mark, Node, mergeAttributes, type Editor } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import FigureView from './nodes/FigureView';
import GalleryView from './nodes/GalleryView';
import YoutubeView from './nodes/YoutubeView';
import VideoView from './nodes/VideoView';
import PollView from './nodes/PollView';
import { safeLinkHref } from '@/lib/postDoc';

/**
 * 커뮤니티 글 편집기의 스키마 (2026-11-13) — 노드·마크 이름과 속성은 `lib/postDoc.ts`(= 서버 허용 목록)와 같다.
 * 여기에 노드·마크를 더하면 서버 `backend/src/lib/postDoc.ts` 와 화면 `lib/postDoc.ts`·`components/post/PostBody.tsx` 도 함께.
 */

/** 사진 칸 안의 입력칸·단추 — ProseMirror 가 그 키·클릭을 가로채지 않게 */
const stopInsideControls = ({ event }: { event: Event }) => {
  const t = event.target as HTMLElement | null;
  if (!t?.closest) return false;
  return !!t.closest('input, textarea, button, select, [data-nv-control]');
};

/** 원자 노드(사진·모음·영상) — 안의 변화는 문서가 아니다 */
const atomViewOptions = (cls: (node: PMNode) => string) => ({
  stopEvent: stopInsideControls,
  ignoreMutation: () => true,
  attrs: ({ node }: { node: PMNode }) => ({ class: cls(node), 'data-size': String(node.attrs.size ?? 'text') }),
});

/** JSON 으로 속성을 실어 나르는 붙여넣기용 HTML — 같은 편집기 안의 복사·붙여넣기에서 속성이 살아남게 */
function attrsFromEl(el: HTMLElement): Record<string, unknown> {
  try { return JSON.parse(el.getAttribute('data-attrs') || '{}'); } catch { return {}; }
}

export const Figure = Node.create({
  name: 'figure',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      src: { default: null },
      width: { default: null },
      height: { default: null },
      alt: { default: '' },
      caption: { default: '' },
      size: { default: 'text' },
      large: { default: false },
      // 화면 전용 — 올리는 중(또는 바꾸는 중)인 사진. 저장할 때 뺀다(lib/postDoc.ts savableDoc)
      uploadId: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'figure[data-post-figure]', getAttrs: (el) => attrsFromEl(el as HTMLElement) }];
  },
  renderHTML({ node }) {
    return ['figure', { 'data-post-figure': '', 'data-attrs': JSON.stringify(node.attrs) },
      ['img', { src: node.attrs.src ?? '', alt: node.attrs.alt ?? '' }],
      ['figcaption', {}, node.attrs.caption ?? '']];
  },
  addNodeView() {
    return ReactNodeViewRenderer(FigureView, atomViewOptions((n) => `post-block post-figure size-${n.attrs.size ?? 'text'}`));
  },
});

export const Gallery = Node.create({
  name: 'gallery',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      layout: { default: 'row' },
      items: { default: [] },
      caption: { default: '' },
      size: { default: 'text' },
    };
  },
  parseHTML() {
    return [{ tag: 'figure[data-post-gallery]', getAttrs: (el) => attrsFromEl(el as HTMLElement) }];
  },
  renderHTML({ node }) {
    const items = (node.attrs.items as { src?: string | null }[]) ?? [];
    return ['figure', { 'data-post-gallery': '', 'data-attrs': JSON.stringify(node.attrs) },
      ...items.filter((i) => i.src).map((i) => ['img', { src: i.src }] as [string, Record<string, string>]),
      ['figcaption', {}, node.attrs.caption ?? '']];
  },
  addNodeView() {
    return ReactNodeViewRenderer(GalleryView, atomViewOptions((n) => `post-block post-gallery size-${n.attrs.size ?? 'text'}`));
  },
});

export const Youtube = Node.create({
  name: 'youtube',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { videoId: { default: null }, caption: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'figure[data-post-youtube]', getAttrs: (el) => attrsFromEl(el as HTMLElement) }];
  },
  renderHTML({ node }) {
    return ['figure', { 'data-post-youtube': '', 'data-attrs': JSON.stringify(node.attrs) },
      ['a', { href: `https://www.youtube.com/watch?v=${node.attrs.videoId}` }, 'YouTube'],
      ['figcaption', {}, node.attrs.caption ?? '']];
  },
  addNodeView() {
    return ReactNodeViewRenderer(YoutubeView, atomViewOptions(() => 'post-block post-youtube size-text'));
  },
});

/** 동영상(파일, 2026-11-13) — 유튜브 대신 직접 올린 동영상. 올리는 동안은 uploadId 만 */
export const Video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { src: { default: null }, width: { default: null }, height: { default: null }, caption: { default: '' }, uploadId: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'figure[data-post-video]', getAttrs: (el) => attrsFromEl(el as HTMLElement) }];
  },
  renderHTML({ node }) {
    return ['figure', { 'data-post-video': '', 'data-attrs': JSON.stringify(node.attrs) },
      ['video', { src: node.attrs.src ?? '' }],
      ['figcaption', {}, node.attrs.caption ?? '']];
  },
  addNodeView() {
    return ReactNodeViewRenderer(VideoView, atomViewOptions(() => 'post-block post-video size-text'));
  },
});

/** 투표 창을 여는 일 — 편집기 화면(PostEditor)이 채운다(표가 모인 투표의 잠금 판정도 그쪽이 한다) */
export interface PollStorage { onEdit: ((pos: number) => void) | null }
export const pollStorage = (editor: Editor): PollStorage => (editor.storage as unknown as { poll: PollStorage }).poll;

/** 투표(2026-11-13) — 한 글에 하나. 정의는 속성에, 표는 서버(PostPollVote) */
export const Poll = Node.create({
  name: 'poll',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addStorage() {
    return { onEdit: null } as PollStorage;
  },
  addAttributes() {
    return { question: { default: '' }, options: { default: [] }, multiple: { default: false }, endsAt: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'div[data-post-poll]', getAttrs: (el) => attrsFromEl(el as HTMLElement) }];
  },
  renderHTML({ node }) {
    return ['div', { 'data-post-poll': '', 'data-attrs': JSON.stringify(node.attrs) }, ['p', {}, String(node.attrs.question ?? '')]];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PollView, atomViewOptions(() => 'post-block post-poll size-text'));
  },
});

/** 팁 상자 — 문단·목록을 담는 테두리 상자(색 배경 없음, DESIGN.md) */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: '(paragraph | bulletList | orderedList)+',
  defining: true,
  addAttributes() {
    return { tone: { default: 'tip', parseHTML: (el) => el.getAttribute('data-callout') || 'tip', renderHTML: (a) => ({ 'data-callout': a.tone }) } };
  },
  parseHTML() {
    return [{ tag: 'aside[data-callout]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['aside', mergeAttributes(HTMLAttributes, { class: 'post-block post-callout' }), 0];
  },
});

/** 형광펜 — 글자 아래 절반만 옅은 빨강(DESIGN.md: 색 배경 금지, 포인트 빨강 하나) */
export const Highlight = Mark.create({
  name: 'highlight',
  parseHTML() {
    return [{ tag: 'mark' }];
  },
  renderHTML() {
    return ['mark', 0];
  },
  addKeyboardShortcuts() {
    return { 'Mod-Shift-h': () => this.editor.commands.toggleMark(this.name) };
  },
});

/** 가운데 맞춤(문단·제목) · 크게 뽑은 인용(blockquote) — 기존 노드에 속성만 얹는다 */
export const BlockAttrs = Extension.create({
  name: 'postBlockAttrs',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (el) => (el.style.textAlign === 'center' ? 'center' : null),
            renderHTML: (a) => (a.textAlign === 'center' ? { style: 'text-align: center' } : {}),
          },
        },
      },
      {
        types: ['blockquote'],
        attributes: {
          variant: {
            default: 'line',
            parseHTML: (el) => (el.getAttribute('data-variant') === 'pull' ? 'pull' : 'line'),
            renderHTML: (a) => (a.variant === 'pull' ? { 'data-variant': 'pull' } : {}),
          },
        },
      },
    ];
  },
  addKeyboardShortcuts() {
    return {
      'Alt-ArrowUp': () => moveBlock(this.editor, -1),
      'Alt-ArrowDown': () => moveBlock(this.editor, 1),
      'Mod-e': () => toggleCenter(this.editor),
    };
  },
});

/** 첫 빈 문단에만 안내 글자 */
const PostPlaceholder = Placeholder.configure({
  placeholder: ({ editor, node }) => (node.type.name === 'paragraph' && editor.state.doc.childCount <= 1 ? '내용을 입력하세요. 사진은 [사진] 단추로 넣어요.' : ''),
  showOnlyCurrent: true,
  includeChildren: false,
});

export function postEditorExtensions(placeholder?: string) {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      code: false,
      codeBlock: false,
      dropcursor: { color: '#111827', width: 2 },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' },
        isAllowedUri: (url) => safeLinkHref(url) !== null,
      },
    }),
    placeholder
      ? Placeholder.configure({ placeholder, showOnlyCurrent: true, includeChildren: false })
      : PostPlaceholder,
    BlockAttrs,
    Highlight,
    Callout,
    Figure,
    Gallery,
    Youtube,
    Video,
    Poll,
  ];
}

/* ───────────── 명령 ───────────── */

/** 지금 선택이 걸친 최상위 블록 번호(사진 등 노드 선택이면 그 노드) */
export function topBlockIndex(editor: Editor): number {
  const { selection } = editor.state;
  return selection.$from.index(0);
}

/** 최상위 블록 하나를 위·아래로 — 사진은 그대로 선택해 둔다(연달아 옮길 수 있게) */
export function moveBlock(editor: Editor, dir: -1 | 1): boolean {
  const { state, view } = editor;
  const doc = state.doc;
  const i = topBlockIndex(editor);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= doc.childCount) return false;
  const posOf = (k: number) => { let p = 0; for (let n = 0; n < k; n++) p += doc.child(n).nodeSize; return p; };
  const a = Math.min(i, j);
  const first = doc.child(a);
  const second = doc.child(a + 1);
  const start = posOf(a);
  const end = start + first.nodeSize + second.nodeSize;
  const wasNode = state.selection instanceof NodeSelection;
  const offsetInBlock = state.selection.from - posOf(i);
  let tr = state.tr.replaceWith(start, end, [second, first]);
  const newStart = dir === -1 ? start : start + second.nodeSize;
  if (wasNode) tr = tr.setSelection(NodeSelection.create(tr.doc, newStart));
  else tr = tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size, newStart + Math.max(1, offsetInBlock)))));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** 문단·제목 가운데 맞춤 켜고 끄기 */
export function toggleCenter(editor: Editor): boolean {
  const center = editor.isActive({ textAlign: 'center' });
  const value = center ? null : 'center';
  return editor.chain().focus().updateAttributes('paragraph', { textAlign: value }).updateAttributes('heading', { textAlign: value }).run();
}

/** 팁 상자로 감싸기·풀기 */
export function toggleCallout(editor: Editor): boolean {
  if (editor.isActive('callout')) return editor.chain().focus().lift('callout').run();
  return editor.chain().focus().wrapIn('callout').run();
}

/** 인용구 → 강조 문장 ↔ 인용구 (2026-11-13 — '크게 인용'이 무슨 뜻인지 안 읽혀 이름을 바꿨다. 노드 값은 그대로 line·pull) */
export function togglePullQuote(editor: Editor): boolean {
  if (!editor.isActive('blockquote')) return editor.chain().focus().setBlockquote().updateAttributes('blockquote', { variant: 'pull' }).run();
  const pull = editor.isActive('blockquote', { variant: 'pull' });
  return editor.chain().focus().updateAttributes('blockquote', { variant: pull ? 'line' : 'pull' }).run();
}

/** 블록 노드들을 지금 자리에 넣고, 그 뒤 문단에 커서를 둔다(없으면 만든다).
 * 사진이 선택돼 있으면 그 사진을 **바꾸지 않고** 뒤에 넣는다(노드 선택 위에 넣으면 선택한 것이 지워진다). */
export function insertBlocks(editor: Editor, nodes: Record<string, unknown>[], at?: number): void {
  if (nodes.length === 0) return;
  const sel = editor.state.selection;
  const range = at !== undefined ? at : sel instanceof NodeSelection ? sel.to : { from: sel.from, to: sel.to };
  editor.chain().focus().insertContentAt(range, nodes).run();
  const { state } = editor;
  const idx = state.selection.$to.index(0);
  const doc = state.doc;
  let p = 0;
  for (let n = 0; n < Math.min(idx, doc.childCount); n++) p += doc.child(n).nodeSize;
  const next = doc.maybeChild(idx);
  if (next && next.isTextblock) editor.chain().setTextSelection(p + 1).scrollIntoView().run();
  else editor.chain().insertContentAt(p, { type: 'paragraph' }).setTextSelection(p + 1).scrollIntoView().run();
}
