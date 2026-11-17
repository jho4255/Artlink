import type { Editor } from '@tiptap/core';

/** 노드(사진 등) 바로 뒤 문단에 커서 — 뒤가 문단이 아니면 빈 문단을 만든다(설명 칸에서 Enter) */
export function focusAfter(editor: Editor, pos: number | undefined): void {
  if (typeof pos !== 'number') return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const after = pos + node.nodeSize;
  const next = editor.state.doc.nodeAt(after);
  if (next && next.isTextblock) editor.chain().focus().setTextSelection(after + 1).scrollIntoView().run();
  else editor.chain().focus().insertContentAt(after, { type: 'paragraph' }).setTextSelection(after + 1).scrollIntoView().run();
}
