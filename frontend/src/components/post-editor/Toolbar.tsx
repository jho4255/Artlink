import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import {
  AlignCenter, Bold, ChevronDown, Highlighter, ImagePlus, Italic, KeyboardOff, Lightbulb, Link2, List, ListChecks, ListOrdered, Minus,
  Quote, Redo2, Strikethrough, TextQuote, Underline, Undo2, Video,
} from 'lucide-react';
import { toggleCallout, toggleCenter, togglePullQuote } from './extensions';
import { useFormatState } from './formatState';

/**
 * 글쓰기 도구 막대 — 넓은 화면은 위(머리 아래), 휴대폰은 **자판 바로 위**(PostEditor 가 보이는 영역에 맞춘다).
 * 단추는 누를 때 편집 영역의 선택·자판이 풀리지 않게 `onMouseDown preventDefault`(기존 서식 편집기와 같다).
 * 켜짐 상태는 `useEditorState` 선택자로만 읽는다(트랜잭션마다 막대 전체를 다시 그리지 않게).
 * 인용 이름(2026-11-13): '인용'·'크게 인용' 이 무슨 차이인지 안 읽혀 **인용구**(왼쪽 선) · **강조 문장**(가운데 큰 글)로 바꿨다.
 * [동영상]은 파일(유튜브 주소 넣기는 없앴다 — 유튜브 주소를 빈 줄에 붙여 넣으면 그대로 들어간다), [투표]는 한 글에 하나.
 */
export interface ToolbarActions {
  onPhoto: () => void;
  onVideo: () => void;
  onPoll: () => void;
  onLink: () => void;
}

export function ToolButton({ label, active = false, disabled = false, onClick, children, wide = false, className = '' }: {
  label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode; wide?: boolean; className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md transition-colors disabled:opacity-30 ${wide ? 'px-2.5' : ''} ${active ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'} ${className}`}
    >
      {children}
    </button>
  );
}

const Sep = () => <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-gray-200" />;

/** 문단 종류 — 본문 / 제목 / 소제목 */
function BlockTypeMenu({ editor, s }: { editor: Editor; s: ReturnType<typeof useFormatState> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const current = s.h2 ? '제목' : s.h3 ? '소제목' : '본문';
  const pick = (kind: 'p' | 'h2' | 'h3') => {
    const c = editor.chain().focus();
    if (kind === 'p') c.setParagraph().run();
    else c.setHeading({ level: kind === 'h2' ? 2 : 3 }).run();
    setOpen(false);
  };
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`문단 종류: ${current}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 min-w-[76px] items-center justify-between gap-1 rounded-md px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
      >
        {current}<ChevronDown size={14} />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-10 z-20 w-36 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-[0_6px_20px_rgba(0,0,0,0.08)]">
          {([['p', '본문', 'text-[15px]'], ['h2', '제목', 'text-[17px] font-semibold'], ['h3', '소제목', 'text-[15px] font-semibold']] as const).map(([k, name, cls]) => (
            <button key={k} type="button" role="menuitemradio" aria-checked={current === name}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(k)}
              className={`block w-full px-3 py-2 text-left hover:bg-gray-50 ${cls} ${current === name ? 'text-gray-900' : 'text-gray-600'}`}>
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 넓은 화면 도구 막대 */
export function DesktopToolbar({ editor, actions }: { editor: Editor; actions: ToolbarActions }) {
  const s = useFormatState(editor);
  const c = () => editor.chain().focus();
  const sz = 'h-9 w-9';
  return (
    <div role="toolbar" aria-label="서식" className="flex flex-wrap items-center justify-center gap-0.5 px-4 py-1.5">
      <BlockTypeMenu editor={editor} s={s} />
      <Sep />
      <ToolButton label="굵게 (Ctrl+B)" active={s.bold} onClick={() => c().toggleBold().run()} className={sz}><Bold size={17} /></ToolButton>
      <ToolButton label="기울임 (Ctrl+I)" active={s.italic} onClick={() => c().toggleItalic().run()} className={sz}><Italic size={17} /></ToolButton>
      <ToolButton label="밑줄 (Ctrl+U)" active={s.underline} onClick={() => c().toggleUnderline().run()} className={sz}><Underline size={17} /></ToolButton>
      <ToolButton label="취소선" active={s.strike} onClick={() => c().toggleStrike().run()} className={sz}><Strikethrough size={17} /></ToolButton>
      <ToolButton label="형광펜" active={s.highlight} onClick={() => c().toggleMark('highlight').run()} className={sz}><Highlighter size={17} /></ToolButton>
      <ToolButton label="링크 (Ctrl+K)" active={s.link} onClick={actions.onLink} className={sz}><Link2 size={17} /></ToolButton>
      <Sep />
      <ToolButton label="글머리 목록" active={s.bullet} onClick={() => c().toggleBulletList().run()} className={sz}><List size={17} /></ToolButton>
      <ToolButton label="번호 목록" active={s.ordered} onClick={() => c().toggleOrderedList().run()} className={sz}><ListOrdered size={17} /></ToolButton>
      <ToolButton label="인용구" active={s.quote && !s.pull} onClick={() => (s.pull ? togglePullQuote(editor) : c().toggleBlockquote().run())} className={sz}><Quote size={17} /></ToolButton>
      <ToolButton label="강조 문장 (가운데 큰 글)" active={s.pull} onClick={() => togglePullQuote(editor)} className={sz}><TextQuote size={17} /></ToolButton>
      <ToolButton label="가운데 맞춤 (Ctrl+E)" active={s.center} onClick={() => toggleCenter(editor)} className={sz}><AlignCenter size={17} /></ToolButton>
      <ToolButton label="구분선" onClick={() => c().setHorizontalRule().run()} className={sz}><Minus size={17} /></ToolButton>
      <Sep />
      <ToolButton label="사진 넣기" onClick={actions.onPhoto} wide className="h-9 text-sm font-medium"><ImagePlus size={17} />사진</ToolButton>
      <ToolButton label="동영상 넣기" onClick={actions.onVideo} wide className="h-9 text-sm font-medium"><Video size={17} />동영상</ToolButton>
      <ToolButton label="투표 넣기" onClick={actions.onPoll} wide className="h-9 text-sm font-medium"><ListChecks size={17} />투표</ToolButton>
      <ToolButton label="팁 상자" active={s.callout} onClick={() => toggleCallout(editor)} wide className="h-9 text-sm font-medium"><Lightbulb size={17} />팁 상자</ToolButton>
      <Sep />
      <ToolButton label="실행 취소 (Ctrl+Z)" disabled={!s.canUndo} onClick={() => c().undo().run()} className={sz}><Undo2 size={17} /></ToolButton>
      <ToolButton label="다시 실행" disabled={!s.canRedo} onClick={() => c().redo().run()} className={sz}><Redo2 size={17} /></ToolButton>
    </div>
  );
}

/** 휴대폰 도구 막대 — 한 줄, 옆으로 민다. 맨 오른쪽 [자판 내리기]는 늘 보인다 */
export function MobileToolbar({ editor, actions, typing }: { editor: Editor; actions: ToolbarActions; typing: boolean }) {
  const s = useFormatState(editor);
  const c = () => editor.chain().focus();
  const sz = 'h-11 min-w-11';
  const cycleHeading = () => {
    if (s.h2) c().setHeading({ level: 3 }).run();
    else if (s.h3) c().setParagraph().run();
    else c().setHeading({ level: 2 }).run();
  };
  return (
    <div className="flex items-center">
      <div role="toolbar" aria-label="서식" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1.5 py-1 scrollbar-hide [touch-action:pan-x]">
        <ToolButton label="사진 넣기" onClick={actions.onPhoto} className={sz}><ImagePlus size={21} /></ToolButton>
        <ToolButton label="동영상 넣기" onClick={actions.onVideo} className={sz}><Video size={21} /></ToolButton>
        <span aria-hidden="true" className="mx-0.5 h-6 w-px shrink-0 bg-gray-200" />
        <ToolButton label={s.h2 ? '제목 (누르면 소제목)' : s.h3 ? '소제목 (누르면 본문)' : '제목'} active={s.h2 || s.h3} onClick={cycleHeading} className={`${sz} px-2 text-[15px] font-semibold`}>{s.h3 ? '소제목' : '제목'}</ToolButton>
        <ToolButton label="굵게" active={s.bold} onClick={() => c().toggleBold().run()} className={sz}><Bold size={20} /></ToolButton>
        <ToolButton label="형광펜" active={s.highlight} onClick={() => c().toggleMark('highlight').run()} className={sz}><Highlighter size={20} /></ToolButton>
        {/* 인용구 → 강조 문장 → 해제 (한 단추로 돈다) */}
        <ToolButton
          label={!s.quote ? '인용구' : !s.pull ? '인용구 (누르면 강조 문장)' : '강조 문장 (누르면 해제)'}
          active={s.quote}
          onClick={() => (!s.quote ? c().toggleBlockquote().run() : !s.pull ? togglePullQuote(editor) : c().toggleBlockquote().run())}
          className={sz}
        >
          {s.pull ? <TextQuote size={20} /> : <Quote size={20} />}
        </ToolButton>
        <ToolButton label="글머리 목록" active={s.bullet} onClick={() => c().toggleBulletList().run()} className={sz}><List size={20} /></ToolButton>
        <ToolButton label="링크" active={s.link} onClick={actions.onLink} className={sz}><Link2 size={20} /></ToolButton>
        <ToolButton label="팁 상자" active={s.callout} onClick={() => toggleCallout(editor)} className={sz}><Lightbulb size={20} /></ToolButton>
        <ToolButton label="투표 넣기" onClick={actions.onPoll} className={sz}><ListChecks size={20} /></ToolButton>
        <ToolButton label="가운데 맞춤" active={s.center} onClick={() => toggleCenter(editor)} className={sz}><AlignCenter size={20} /></ToolButton>
        <ToolButton label="번호 목록" active={s.ordered} onClick={() => c().toggleOrderedList().run()} className={sz}><ListOrdered size={20} /></ToolButton>
        <ToolButton label="기울임" active={s.italic} onClick={() => c().toggleItalic().run()} className={sz}><Italic size={20} /></ToolButton>
        <ToolButton label="밑줄" active={s.underline} onClick={() => c().toggleUnderline().run()} className={sz}><Underline size={20} /></ToolButton>
        <ToolButton label="취소선" active={s.strike} onClick={() => c().toggleStrike().run()} className={sz}><Strikethrough size={20} /></ToolButton>
        <ToolButton label="구분선" onClick={() => c().setHorizontalRule().run()} className={sz}><Minus size={20} /></ToolButton>
        <ToolButton label="실행 취소" disabled={!s.canUndo} onClick={() => c().undo().run()} className={sz}><Undo2 size={20} /></ToolButton>
        <ToolButton label="다시 실행" disabled={!s.canRedo} onClick={() => c().redo().run()} className={sz}><Redo2 size={20} /></ToolButton>
      </div>
      {typing && (
        <>
          <span aria-hidden="true" className="h-6 w-px shrink-0 bg-gray-200" />
          <button
            type="button"
            aria-label="자판 내리기"
            title="자판 내리기"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (document.activeElement as HTMLElement | null)?.blur()}
            className="inline-flex h-11 w-12 shrink-0 items-center justify-center text-gray-600"
          >
            <KeyboardOff size={20} />
          </button>
        </>
      )}
    </div>
  );
}
