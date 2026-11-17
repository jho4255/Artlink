import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { GripVertical, Loader2, RotateCw, Trash2 } from 'lucide-react';
import { useUpload, retryUpload, forgetUpload } from '../uploadStore';
import { focusAfter } from '../focusAfter';
import CaptionInput from './CaptionInput';
import PostImage from '@/components/post/PostImage';
import { imageRatio } from '@/lib/postLayout';
import type { FigureAttrs } from '@/lib/postDoc';

/**
 * 편집기의 사진 한 장(노드뷰). 읽는 화면과 같은 틀(`post-figure-frame`)·같은 사진 부품(PostImage)을 써서 쓰는 모양 = 보이는 모양.
 *
 * 상태
 * - 보통: src 있음
 * - 올리는 중: src 없음 + uploadId → 고른 사진(blob) 미리보기 + 진행 막대. 실패면 [다시]·[지우기]
 * - 바꾸는 중(자르기·바꾸기): src 있음 + uploadId → 새 사진 미리보기. 실패하면 옛 사진 그대로 + [다시]·[취소]
 */
export default function FigureView({ node, editor, selected, updateAttributes, deleteNode, getPos }: ReactNodeViewProps) {
  const a = node.attrs as FigureAttrs;
  const up = useUpload(a.uploadId);
  const pending = !!up && up.status !== 'done';
  const replacing = !!a.src && pending;
  const showPreview = pending && up!.status !== 'error';
  const dims = showPreview && up!.width ? { width: up!.width, height: up!.height } : a;
  const ratio = imageRatio(dims);

  const removeSelf = () => {
    if (a.uploadId) forgetUpload(a.uploadId);
    deleteNode();
  };

  return (
    <NodeViewWrapper className="post-figure-inner" data-selected={selected ? '' : undefined}>
      {editor.isEditable && (
        <div data-drag-handle draggable="true" className="post-drag-handle" title="끌어서 옮기기" aria-hidden="true">
          <GripVertical size={16} />
        </div>
      )}
      <div className="post-figure-frame" style={{ aspectRatio: String(ratio) }}>
        {showPreview ? (
          <img src={up!.previewUrl} alt="" draggable={false} className="block h-full w-full object-contain" />
        ) : a.src ? (
          <PostImage attrs={a} size={a.size} alt={a.alt || a.caption || ''} />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gray-50 text-sm text-gray-500">사진을 불러올 수 없어요</div>
        )}

        {pending && up!.status !== 'error' && (
          <div className="post-upload-bar" role="status" aria-live="polite">
            <Loader2 size={14} className="shrink-0 animate-spin" />
            <span className="whitespace-nowrap">{up!.status === 'queued' ? '기다리는 중' : `올리는 중 ${Math.round(up!.progress * 100)}%`}</span>
            <span className="h-[3px] min-w-0 flex-1 overflow-hidden bg-gray-200"><span className="block h-full bg-gray-900 transition-[width]" style={{ width: `${Math.round(up!.progress * 100)}%` }} /></span>
          </div>
        )}
        {up?.status === 'error' && (
          <div className="post-upload-error" data-nv-control role="alert">
            <span className="min-w-0 text-[12px] leading-snug text-accent">{up.error || '사진을 올리지 못했어요.'}</span>
            <span className="flex shrink-0 gap-1">
              <button type="button" onClick={() => retryUpload(up.id)} className="post-mini-btn"><RotateCw size={13} />다시</button>
              <button
                type="button"
                onClick={() => (replacing ? updateAttributes({ uploadId: null }) : removeSelf())}
                className="post-mini-btn"
              >
                {replacing ? '취소' : <><Trash2 size={13} />지우기</>}
              </button>
            </span>
          </div>
        )}
      </div>
      <CaptionInput
        value={a.caption ?? ''}
        visible={selected}
        onCommit={(caption) => updateAttributes({ caption })}
        onEnter={() => focusAfter(editor, getPos())}
        onEscape={() => { const p = getPos(); if (typeof p === 'number') editor.commands.setNodeSelection(p); }}
      />
    </NodeViewWrapper>
  );
}
