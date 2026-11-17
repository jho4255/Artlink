import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { GripVertical, Loader2, Play, RotateCw, Trash2 } from 'lucide-react';
import { useUpload, retryUpload, forgetUpload } from '../uploadStore';
import { focusAfter } from '../focusAfter';
import CaptionInput from './CaptionInput';
import { videoFrameStyle, videoRatio } from '@/lib/postLayout';
import type { VideoAttrs } from '@/lib/postDoc';

/**
 * 편집기의 동영상(노드뷰, 2026-11-13). 편집 중에는 **재생하지 않는다** — 첫 장면만 보이고 누르면 고른 상태가 된다
 * (영상 조작 막대가 편집기의 클릭·초점을 가져가지 않게, 유튜브 칸과 같은 방식). 읽는 화면에서는 재생 막대가 있다.
 * 올리는 중: 고른 파일(blob) 첫 장면 + 진행 막대. 실패면 [다시]·[지우기].
 */
export default function VideoView({ node, editor, selected, updateAttributes, deleteNode, getPos }: ReactNodeViewProps) {
  const a = node.attrs as VideoAttrs;
  const up = useUpload(a.uploadId);
  const pending = !!up && up.status !== 'done';
  const src = pending && up!.status !== 'error' ? up!.previewUrl : a.src;
  const ratio = videoRatio(pending && up!.width ? up!.width : a.width, pending && up!.height ? up!.height : a.height);

  const removeSelf = () => {
    if (a.uploadId) forgetUpload(a.uploadId);
    deleteNode();
  };

  return (
    <NodeViewWrapper className="post-video-inner" data-selected={selected ? '' : undefined}>
      {editor.isEditable && (
        <div data-drag-handle draggable="true" className="post-drag-handle" title="끌어서 옮기기" aria-hidden="true">
          <GripVertical size={16} />
        </div>
      )}
      <div className="post-video-frame" style={videoFrameStyle(ratio)}>
        {src ? (
          // #t=0.1 — 첫 장면이 검은 화면인 영상이 많아 조금 뒤 장면을 보인다
          <video src={`${src}#t=0.1`} preload="metadata" muted playsInline tabIndex={-1} aria-hidden="true" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-gray-300">동영상을 불러올 수 없어요</div>
        )}
        <span className="post-video-badge"><Play size={12} className="fill-white" />동영상</span>
        {pending && up!.status !== 'error' && (
          <div className="post-upload-bar" role="status" aria-live="polite">
            <Loader2 size={14} className="shrink-0 animate-spin" />
            <span className="whitespace-nowrap">{up!.status === 'queued' ? '기다리는 중' : `올리는 중 ${Math.round(up!.progress * 100)}%`}</span>
            <span className="h-[3px] min-w-0 flex-1 overflow-hidden bg-gray-200"><span className="block h-full bg-gray-900 transition-[width]" style={{ width: `${Math.round(up!.progress * 100)}%` }} /></span>
          </div>
        )}
        {up?.status === 'error' && (
          <div className="post-upload-error" data-nv-control role="alert">
            <span className="min-w-0 text-[12px] leading-snug text-accent">{up.error || '동영상을 올리지 못했어요.'}</span>
            <span className="flex shrink-0 gap-1">
              <button type="button" onClick={() => retryUpload(up.id)} className="post-mini-btn"><RotateCw size={13} />다시</button>
              <button type="button" onClick={removeSelf} className="post-mini-btn"><Trash2 size={13} />지우기</button>
            </span>
          </div>
        )}
      </div>
      <CaptionInput
        value={a.caption ?? ''}
        visible={selected}
        placeholder="동영상 설명을 적어 주세요 (선택)"
        onCommit={(caption) => updateAttributes({ caption })}
        onEnter={() => focusAfter(editor, getPos())}
        onEscape={() => { const p = getPos(); if (typeof p === 'number') editor.commands.setNodeSelection(p); }}
      />
    </NodeViewWrapper>
  );
}
