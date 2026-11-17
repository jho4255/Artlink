import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { ArrowDown, ArrowUp, Captions, Crop, ImagePlus, Pencil, Replace, Trash2, Type, Ungroup } from 'lucide-react';
import { moveBlock } from './extensions';
import { forgetUpload } from './uploadStore';
import { ungroupGallery } from './imageOps';
import type { FigureSize, GalleryLayout, PostImageAttrs } from '@/lib/postDoc';

/**
 * 고른 사진·모음·영상·동영상·투표의 도구 — 넓은 화면은 그 위에 떠 있는 막대(BubbleMenu), 휴대폰은 아래 막대 자리를 대신한다.
 * 크기(본문 폭·넓게·화면 폭) · 모음 배치(줄·격자·넘겨 보기) · 자르기 · 설명 · 대체 글 · 바꾸기 · 사진 더하기 · 풀기 · 투표 고치기 · 위/아래 · 삭제.
 * (표지 고르기는 없앴다 — 표지는 늘 첫 사진, 2026-11-13)
 */
export interface PhotoToolActions {
  onCrop: (pos: number) => void;
  onReplace: (pos: number) => void;
  onAlt: (pos: number) => void;
  onAddToGallery: (pos: number) => void;
  onEditPoll: (pos: number) => void;
}

const TOOL_NAME: Record<string, { toolbar: string; remove: string }> = {
  figure: { toolbar: '사진 도구', remove: '사진 지우기' },
  gallery: { toolbar: '사진 모음 도구', remove: '모음 지우기' },
  youtube: { toolbar: '영상 도구', remove: '영상 지우기' },
  video: { toolbar: '동영상 도구', remove: '동영상 지우기' },
  poll: { toolbar: '투표 도구', remove: '투표 지우기' },
};

const SIZES: [FigureSize, string][] = [['text', '본문 폭'], ['wide', '넓게'], ['full', '화면 폭']];
const LAYOUTS: [GalleryLayout, string][] = [['row', '줄'], ['grid', '격자'], ['slide', '넘겨 보기']];

function Segmented<T extends string>({ value, options, onChange, label, compact }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string; compact?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className={`flex shrink-0 gap-0.5 rounded-lg border border-gray-200 p-0.5 ${compact ? '' : 'w-full'}`}>
      {options.map(([v, name]) => (
        <button
          key={v} type="button" role="radio" aria-checked={value === v}
          onMouseDown={(e) => e.preventDefault()} onClick={() => onChange(v)}
          className={`h-9 flex-1 whitespace-nowrap rounded-md px-3 text-[13px] font-medium ${value === v ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

function Act({ label, onClick, children, danger = false, compact }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean; compact?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={compact
        ? `inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium hover:bg-gray-100 ${danger ? 'text-accent' : 'text-gray-700'}`
        : `flex h-14 min-w-[60px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-1.5 text-[11.5px] font-medium ${danger ? 'text-accent' : 'text-gray-700'} active:bg-gray-100`}
    >
      {children}
    </button>
  );
}

export default function PhotoTools({ editor, node, pos, actions, compact = false }: {
  editor: Editor; node: PMNode; pos: number; actions: PhotoToolActions; compact?: boolean;
}) {
  const type = node.type.name;
  const a = node.attrs as Record<string, unknown>;
  const setAttrs = (patch: Record<string, unknown>) =>
    editor.chain().command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch }); return true; }).setNodeSelection(pos).run();
  const focusCaption = () => {
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
    dom?.querySelector<HTMLInputElement>('.post-caption-edit input')?.focus();
  };
  const remove = () => {
    if ((type === 'figure' || type === 'video') && a.uploadId) forgetUpload(a.uploadId as string);
    if (type === 'gallery') for (const it of (a.items as PostImageAttrs[]) ?? []) if (it.uploadId) forgetUpload(it.uploadId);
    editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
  };
  const iconSize = compact ? 15 : 19;

  const sizeControl = (type === 'figure' || type === 'gallery') && (
    <Segmented label="사진 크기" compact={compact} value={(a.size as FigureSize) ?? 'text'} options={SIZES} onChange={(size) => setAttrs({ size })} />
  );
  const layoutControl = type === 'gallery' && (
    <Segmented label="모음 배치" compact={compact} value={(a.layout as GalleryLayout) ?? 'row'} options={LAYOUTS} onChange={(layout) => setAttrs({ layout })} />
  );

  const acts = (
    <>
      {type === 'figure' && !!a.src && <Act compact={compact} label="자르기·돌리기" onClick={() => actions.onCrop(pos)}><Crop size={iconSize} />자르기</Act>}
      {type === 'gallery' && <Act compact={compact} label="모음에 사진 더하기" onClick={() => actions.onAddToGallery(pos)}><ImagePlus size={iconSize} />사진 더하기</Act>}
      {type === 'poll' && <Act compact={compact} label="투표 고치기" onClick={() => actions.onEditPoll(pos)}><Pencil size={iconSize} />고치기</Act>}
      {type !== 'poll' && <Act compact={compact} label="설명 쓰기" onClick={focusCaption}><Captions size={iconSize} />설명</Act>}
      {type === 'figure' && <Act compact={compact} label="대체 글(화면 낭독용 사진 설명)" onClick={() => actions.onAlt(pos)}><Type size={iconSize} />대체 글</Act>}
      {type === 'figure' && <Act compact={compact} label="사진 바꾸기" onClick={() => actions.onReplace(pos)}><Replace size={iconSize} />바꾸기</Act>}
      {type === 'gallery' && <Act compact={compact} label="한 장씩으로 풀기" onClick={() => ungroupGallery(editor, pos)}><Ungroup size={iconSize} />풀기</Act>}
      {!compact && <Act label="위로 옮기기" onClick={() => moveBlock(editor, -1)}><ArrowUp size={iconSize} />위로</Act>}
      {!compact && <Act label="아래로 옮기기" onClick={() => moveBlock(editor, 1)}><ArrowDown size={iconSize} />아래로</Act>}
      <Act compact={compact} label={TOOL_NAME[type]?.remove ?? '지우기'} onClick={remove} danger><Trash2 size={iconSize} />삭제</Act>
    </>
  );

  if (compact) {
    // 넓은 화면 — 사진 위에 떠 있는 한 줄
    return (
      <div role="toolbar" aria-label={TOOL_NAME[type]?.toolbar ?? '사진 도구'}
        className="flex max-w-[calc(100vw-32px)] items-center gap-1 overflow-x-auto rounded-lg border border-gray-200 bg-white p-1 shadow-[0_6px_20px_rgba(0,0,0,0.08)] scrollbar-hide">
        {layoutControl}
        {sizeControl}
        {(layoutControl || sizeControl) && <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-gray-200" />}
        {acts}
      </div>
    );
  }
  return (
    <div className="px-3 pb-1 pt-2.5">
      {(layoutControl || sizeControl) && (
        <div className="flex flex-col gap-1.5">{layoutControl}{sizeControl}</div>
      )}
      <div role="toolbar" aria-label={TOOL_NAME[type]?.toolbar ?? '사진 도구'}
        className="mt-1.5 flex gap-0.5 overflow-x-auto scrollbar-hide [touch-action:pan-x]">
        {acts}
      </div>
    </div>
  );
}

