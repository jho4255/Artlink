import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { GripVertical, Loader2, RotateCw, X } from 'lucide-react';
import { useUpload, retryUpload, forgetUpload } from '../uploadStore';
import { focusAfter } from '../focusAfter';
import CaptionInput from './CaptionInput';
import PostImage from '@/components/post/PostImage';
import PostGalleryLayout from '@/components/post/PostGalleryLayout';
import type { GalleryAttrs, GalleryLayout, PostImageAttrs } from '@/lib/postDoc';

/** 편집기의 사진 모음(노드뷰) — 읽는 화면과 같은 배치(PostGalleryLayout). 고르면 사진마다 [×] */
export default function GalleryView({ node, editor, selected, updateAttributes, deleteNode, getPos }: ReactNodeViewProps) {
  const a = node.attrs as GalleryAttrs;
  const items = (a.items ?? []) as PostImageAttrs[];
  const layout = (a.layout ?? 'row') as GalleryLayout;

  const removeAt = (i: number) => {
    const it = items[i];
    if (it?.uploadId) forgetUpload(it.uploadId);
    const next = items.filter((_, j) => j !== i);
    if (next.length === 0) deleteNode();
    else updateAttributes({ items: next });
  };

  return (
    <NodeViewWrapper className="post-gallery-inner" data-selected={selected ? '' : undefined}>
      {editor.isEditable && (
        <div data-drag-handle draggable="true" className="post-drag-handle" title="끌어서 옮기기" aria-hidden="true">
          <GripVertical size={16} />
        </div>
      )}
      <PostGalleryLayout
        items={items.map((it) => it)}
        layout={layout}
        label={a.caption || '사진 모음'}
        renderCell={(it, i, columns) => (
          <GalleryCell
            item={it}
            index={i}
            columns={columns}
            size={a.size}
            selected={selected}
            onRemove={() => removeAt(i)}
          />
        )}
      />
      <CaptionInput
        value={a.caption ?? ''}
        visible={selected}
        placeholder="사진 모음 설명을 적어 주세요 (선택)"
        onCommit={(caption) => updateAttributes({ caption })}
        onEnter={() => focusAfter(editor, getPos())}
        onEscape={() => { const p = getPos(); if (typeof p === 'number') editor.commands.setNodeSelection(p); }}
      />
    </NodeViewWrapper>
  );
}

function GalleryCell({ item, index, columns, size, selected, onRemove }: {
  item: PostImageAttrs; index: number; columns: number; size?: GalleryAttrs['size']; selected: boolean; onRemove: () => void;
}) {
  const up = useUpload(item.uploadId);
  const pending = !!up && up.status !== 'done';
  return (
    <div className="relative h-full w-full">
      {pending && up!.status !== 'error' ? (
        <img src={up!.previewUrl} alt="" draggable={false} className="block h-full w-full object-cover" />
      ) : item.src ? (
        <PostImage attrs={item} size={size} columns={columns} alt={item.alt || `사진 ${index + 1}`} className="object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gray-50 text-xs text-gray-500">사진 없음</div>
      )}
      {pending && up!.status !== 'error' && (
        <span className="absolute inset-x-1.5 bottom-1.5 flex items-center gap-1.5 bg-white/95 px-1.5 py-1 text-[11px] text-gray-700">
          <Loader2 size={12} className="shrink-0 animate-spin" />
          <span className="h-[3px] min-w-0 flex-1 overflow-hidden bg-gray-200"><span className="block h-full bg-gray-900" style={{ width: `${Math.round(up!.progress * 100)}%` }} /></span>
        </span>
      )}
      {up?.status === 'error' && (
        <span className="absolute inset-x-1.5 bottom-1.5 flex flex-wrap items-center justify-between gap-1 bg-white/95 p-1" data-nv-control role="alert">
          <span className="text-[11px] text-accent">{up.error || '못 올렸어요'}</span>
          <button type="button" onClick={() => retryUpload(up.id)} className="post-mini-btn"><RotateCw size={12} />다시</button>
        </span>
      )}
      {selected && (
        <button type="button" data-nv-control onClick={onRemove} aria-label={`${index + 1}번째 사진 빼기`} className="post-cell-remove">
          <X size={14} />
        </button>
      )}
    </div>
  );
}
