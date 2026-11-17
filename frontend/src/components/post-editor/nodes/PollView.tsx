import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { GripVertical, Pencil } from 'lucide-react';
import { PollCard } from '@/components/post/PostPoll';
import { pollStorage } from '../extensions';
import type { PollAttrs } from '@/lib/postDoc';

/**
 * 편집기의 투표(노드뷰, 2026-11-13) — 읽는 화면과 같은 상자를 그대로 보이고, [고치기]로 투표 창을 연다(질문·보기·마감).
 * 창을 여는 일은 편집기 화면(PostEditor)이 한다 — 노드뷰는 `editor.storage.poll.onEdit` 만 부른다.
 */
export default function PollView({ node, editor, selected, getPos }: ReactNodeViewProps) {
  const a = node.attrs as PollAttrs;
  const edit = () => { const p = getPos(); if (typeof p === 'number') pollStorage(editor).onEdit?.(p); };
  return (
    <NodeViewWrapper className="post-poll-inner" data-selected={selected ? '' : undefined}>
      {editor.isEditable && (
        <div data-drag-handle draggable="true" className="post-drag-handle" title="끌어서 옮기기" aria-hidden="true">
          <GripVertical size={16} />
        </div>
      )}
      <PollCard attrs={a} />
      {editor.isEditable && (
        <button type="button" data-nv-control onClick={edit}
          className="absolute right-3 top-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-[13px] font-medium text-gray-700 hover:border-gray-500">
          <Pencil size={13} />투표 고치기
        </button>
      )}
    </NodeViewWrapper>
  );
}
