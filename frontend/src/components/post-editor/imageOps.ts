import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { enqueueUpload, getUpload, type UploadEntry } from './uploadStore';
import { insertBlocks } from './extensions';
import { POST_DOC_LIMITS, type PostImageAttrs } from '@/lib/postDoc';
import { pmImageSrcs } from './editorUi';

export type InsertMode = 'single' | 'row' | 'slide';

const MEDIA = ['figure', 'gallery', 'youtube', 'video', 'poll'];

/** 지금 고른 사진·모음·영상(노드 선택) */
export function selectedMedia(editor: Editor): { node: PMNode; pos: number } | null {
  const sel = editor.state.selection;
  if (sel instanceof NodeSelection && MEDIA.includes(sel.node.type.name)) return { node: sel.node, pos: sel.from };
  return null;
}

/** 이 글에 더 넣을 수 있는 사진 수 */
export function photoRoom(editor: Editor): number {
  let pending = 0;
  editor.state.doc.descendants((n) => {
    if (n.type.name === 'figure') { if (!n.attrs.src && n.attrs.uploadId) pending++; return false; }
    if (n.type.name === 'gallery') { pending += ((n.attrs.items as PostImageAttrs[]) ?? []).filter((i) => !i.src).length; return false; }
    return true;
  });
  return Math.max(0, POST_DOC_LIMITS.images - new Set(pmImageSrcs(editor.state.doc)).size - pending);
}

const pendingItem = (uploadId: string): PostImageAttrs => ({ src: null, width: null, height: null, alt: '', uploadId });

/** 고른 사진을 지금 자리에 넣는다 — 한 장씩 / 모아 놓기 / 넘겨 보기(모음은 12장씩 나눈다) */
export function insertPhotos(editor: Editor, files: File[], mode: InsertMode, at?: number): void {
  if (files.length === 0) return;
  const ids = files.map((f) => enqueueUpload(f));
  let nodes: Record<string, unknown>[];
  if (mode === 'single' || ids.length === 1) {
    nodes = ids.map((uploadId) => ({ type: 'figure', attrs: { src: null, uploadId, size: 'text' } }));
  } else {
    nodes = [];
    for (let i = 0; i < ids.length; i += POST_DOC_LIMITS.galleryItems) {
      const chunk = ids.slice(i, i + POST_DOC_LIMITS.galleryItems);
      nodes.push(chunk.length === 1
        ? { type: 'figure', attrs: { src: null, uploadId: chunk[0], size: 'text' } }
        : { type: 'gallery', attrs: { layout: mode === 'slide' ? 'slide' : 'row', items: chunk.map(pendingItem), size: 'text' } });
    }
  }
  insertBlocks(editor, nodes, at);
}

/** 이 글에 더 넣을 수 있는 동영상 수 */
export function videoRoom(editor: Editor): number {
  let n = 0;
  editor.state.doc.descendants((x) => { if (x.type.name === 'video') n++; return x.type.name !== 'video'; });
  return Math.max(0, POST_DOC_LIMITS.videos - n);
}

/** 고른 동영상을 지금 자리에 넣는다(한 개씩 — 모음은 없다) */
export function insertVideos(editor: Editor, files: File[], at?: number): void {
  if (files.length === 0) return;
  const nodes = files.map((f) => ({ type: 'video', attrs: { src: null, width: null, height: null, caption: '', uploadId: enqueueUpload(f, 'video') } }));
  insertBlocks(editor, nodes, at);
}

/** 고른 모음에 사진을 더한다 */
export function addToGallery(editor: Editor, pos: number, files: File[]): number {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'gallery') return 0;
  const items = ((node.attrs.items as PostImageAttrs[]) ?? []).slice();
  const room = POST_DOC_LIMITS.galleryItems - items.length;
  const take = files.slice(0, Math.max(0, room));
  for (const f of take) items.push(pendingItem(enqueueUpload(f)));
  editor.chain().command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { ...node.attrs, items }); return true; }).setNodeSelection(pos).run();
  return take.length;
}

/** 사진 바꾸기·자르기 — 옛 사진은 새 사진이 다 올라갈 때까지 그대로 둔다(실패해도 사진이 사라지지 않게) */
export function replaceFigure(editor: Editor, pos: number, file: File): void {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'figure') return;
  const uploadId = enqueueUpload(file);
  editor.chain().command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { ...node.attrs, uploadId }); return true; }).setNodeSelection(pos).run();
}

/**
 * 올라간 사진을 문서에 채운다(되돌리기 기록에는 넣지 않는다 — 되돌리면 사진 넣기 자체가 되돌아가야 한다).
 * 노드는 위치가 아니라 uploadId 로 찾는다(올리는 사이에 글이 바뀐다). 그새 지워졌으면 아무 일도 없다.
 * 같이 정리하는 것:
 *  - 다 올라갔는데 아직 안 채운 것(다시 실행으로 되살아난 노드) → 채운다
 *  - 이 화면이 모르는 uploadId(붙여넣기 등) → src 가 있으면 표시만 떼고, 없으면 노드째 뺀다
 */
export function reconcileUploads(editor: Editor, justDone?: UploadEntry): void {
  if (editor.isDestroyed) return;
  const { state } = editor;
  const tr = state.tr;
  const removals: { from: number; to: number }[] = [];
  const fill = (a: PostImageAttrs): PostImageAttrs | null => {
    if (!a.uploadId) return a;
    const e = justDone && justDone.id === a.uploadId ? justDone : getUpload(a.uploadId);
    if (!e) return a.src ? { ...a, uploadId: null } : null;
    if (e.status === 'done' && e.result) {
      return { ...a, src: e.result.url, width: e.result.width, height: e.result.height, large: true, uploadId: null };
    }
    return a;
  };
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'video') {
      const a = node.attrs as { src: string | null; uploadId?: string | null; width: number | null; height: number | null };
      if (a.uploadId) {
        const e = justDone && justDone.id === a.uploadId ? justDone : getUpload(a.uploadId);
        if (!e) {
          if (a.src) tr.setNodeMarkup(pos, undefined, { ...node.attrs, uploadId: null });
          else removals.push({ from: pos, to: pos + node.nodeSize });
        } else if (e.status === 'done' && e.result) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: e.result.url, width: e.result.width ?? e.width, height: e.result.height ?? e.height, uploadId: null });
        }
      }
      return false;
    }
    if (node.type.name === 'figure') {
      if (node.attrs.uploadId) {
        const next = fill(node.attrs as PostImageAttrs);
        if (next === null) removals.push({ from: pos, to: pos + node.nodeSize });
        else if (next !== node.attrs) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...next });
      }
      return false;
    }
    if (node.type.name === 'gallery') {
      const items = (node.attrs.items as PostImageAttrs[]) ?? [];
      if (items.some((i) => i.uploadId)) {
        const next = items.map(fill).filter((x): x is PostImageAttrs => x !== null);
        const changed = next.length !== items.length || next.some((x, i) => x !== items[i]);
        if (changed) {
          if (next.length === 0) removals.push({ from: pos, to: pos + node.nodeSize });
          else tr.setNodeMarkup(pos, undefined, { ...node.attrs, items: next });
        }
      }
      return false;
    }
    return true;
  });
  // 뒤에서부터 지운다(앞을 지우면 뒤 위치가 바뀐다)
  for (const r of removals.reverse()) tr.delete(tr.mapping.map(r.from), tr.mapping.map(r.to));
  if (!tr.docChanged) return;
  tr.setMeta('addToHistory', false);
  editor.view.dispatch(tr);
}

/** 모음 → 사진 한 장씩(풀기) */
export function ungroupGallery(editor: Editor, pos: number): void {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'gallery') return;
  const items = (node.attrs.items as PostImageAttrs[]) ?? [];
  const figures = items.map((it) => ({ type: 'figure', attrs: { ...it, caption: '', size: node.attrs.size ?? 'text' } }));
  editor.chain().focus().insertContentAt({ from: pos, to: pos + node.nodeSize }, figures).run();
}
