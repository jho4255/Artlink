import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { GripVertical } from 'lucide-react';
import { focusAfter } from '../focusAfter';
import CaptionInput from './CaptionInput';
import { YoutubeFacade } from '@/components/post/PostYoutube';

/** 편집기의 유튜브 영상 — 재생하지 않고 그림만(편집 중에 영상 틀이 초점을 가져가지 않게) */
export default function YoutubeView({ node, editor, selected, updateAttributes, getPos }: ReactNodeViewProps) {
  const videoId = node.attrs.videoId as string;
  return (
    <NodeViewWrapper className="post-youtube-inner" data-selected={selected ? '' : undefined}>
      {editor.isEditable && (
        <div data-drag-handle draggable="true" className="post-drag-handle" title="끌어서 옮기기" aria-hidden="true">
          <GripVertical size={16} />
        </div>
      )}
      <YoutubeFacade videoId={videoId} playable={false} />
      <CaptionInput
        value={(node.attrs.caption as string) ?? ''}
        visible={selected}
        placeholder="영상 설명을 적어 주세요 (선택)"
        onCommit={(caption) => updateAttributes({ caption })}
        onEnter={() => focusAfter(editor, getPos())}
        onEscape={() => { const p = getPos(); if (typeof p === 'number') editor.commands.setNodeSelection(p); }}
      />
    </NodeViewWrapper>
  );
}
