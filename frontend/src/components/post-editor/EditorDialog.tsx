import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import type { InsertMode } from './imageOps';

/**
 * 글쓰기 화면의 작은 창 — 휴대폰은 아래에서 올라오는 창, 넓은 화면은 가운데 카드.
 * `role="dialog" aria-modal="true"` + Esc 로 닫힌다(앱의 뒤로가기가 이걸 보고 창만 닫는다 — 규칙 79).
 */
export function EditorDialog({ title, onClose, children, footer, labelledBy }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; labelledBy?: string;
}) {
  const id = useId();
  useEscapeKey(onClose);
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/45 sm:items-center sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? id}
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-white px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4 sm:max-w-md sm:rounded-xl sm:p-6"
      >
        <div aria-hidden="true" className="mx-auto mb-4 h-1 w-9 rounded-full bg-gray-300 sm:hidden" />
        <h2 id={labelledBy ?? id} className="text-[17px] font-semibold text-gray-900">{title}</h2>
        <div className="mt-3">{children}</div>
        {footer && <div className="mt-5 flex gap-2.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export const btnPrimary = 'h-11 flex-[2] rounded-lg bg-gray-900 px-4 text-[15px] font-semibold text-white disabled:opacity-40';
export const btnGhost = 'h-11 flex-1 rounded-lg border border-gray-300 bg-white px-4 text-[15px] font-medium text-gray-700';

/** 주소·대체 글 같은 한 줄 입력 */
export function PromptDialog({ title, label, initial = '', placeholder, hint, submitText = '적용', inputMode, onSubmit, onRemove, removeText, onClose, validate }: {
  title: string; label: string; initial?: string; placeholder?: string; hint?: string; submitText?: string;
  inputMode?: 'url' | 'text';
  onSubmit: (value: string) => void; onRemove?: () => void; removeText?: string; onClose: () => void;
  /** 문제가 있으면 이유 */
  validate?: (value: string) => string | null;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => ref.current?.focus(), 30); return () => clearTimeout(t); }, []);
  const submit = () => {
    const problem = validate?.(value) ?? null;
    if (problem) { setError(problem); return; }
    onSubmit(value);
  };
  return (
    <EditorDialog
      title={title}
      onClose={onClose}
      footer={<>
        {onRemove ? <button type="button" className={btnGhost} onClick={onRemove}>{removeText ?? '빼기'}</button> : <button type="button" className={btnGhost} onClick={onClose}>취소</button>}
        <button type="button" className={btnPrimary} onClick={submit}>{submitText}</button>
      </>}
    >
      <label className="block">
        <span className="sr-only">{label}</span>
        <input
          ref={ref}
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
          placeholder={placeholder}
          inputMode={inputMode === 'url' ? 'url' : 'text'}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          className={`h-12 w-full rounded-lg border px-3 text-[16px] focus:outline-none focus:ring-2 focus:ring-gray-400 ${error ? 'border-accent' : 'border-gray-300'}`}
        />
      </label>
      {error ? <p className="mt-2 text-[13px] text-accent" role="alert">{error}</p> : hint ? <p className="mt-2 text-[13px] text-gray-500">{hint}</p> : null}
    </EditorDialog>
  );
}

/** 사진을 여러 장 골랐을 때 — 어떻게 놓을까 */
export function PhotoChoiceDialog({ count, onChoose, onClose }: { count: number; onChoose: (mode: InsertMode) => void; onClose: () => void }) {
  const [mode, setMode] = useState<InsertMode>('row');
  const opt = (m: InsertMode, name: string, desc: string, pic: ReactNode) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      aria-pressed={mode === m}
      className={`flex min-h-[84px] w-full items-center gap-4 rounded-lg px-3.5 py-3 text-left ${mode === m ? 'border-2 border-gray-900' : 'border border-gray-200'}`}
    >
      <span aria-hidden="true" className="w-[76px] shrink-0">{pic}</span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold text-gray-900">{name}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-gray-500">{desc}</span>
      </span>
    </button>
  );
  const bar = (h: number, grow = 1, dark = false) => <span className={`block rounded-[2px] ${dark ? 'bg-gray-600' : 'bg-gray-300'}`} style={{ height: h, flexGrow: grow }} />;
  return (
    <EditorDialog
      title={`사진 ${count}장을 골랐어요`}
      onClose={onClose}
      footer={<>
        <button type="button" className={btnGhost} onClick={onClose}>취소</button>
        <button type="button" className={btnPrimary} onClick={() => onChoose(mode)}>사진 넣기</button>
      </>}
    >
      <p className="-mt-1 mb-4 text-[14px] text-gray-500">어떻게 놓을까요? 나중에 바꿀 수 있어요.</p>
      <div className="flex flex-col gap-2.5">
        {opt('single', '한 장씩', '사진마다 크게, 사이사이 글을 쓸 수 있어요',
          <span className="flex flex-col gap-1">{bar(20)}{bar(20)}{bar(12)}</span>)}
        {opt('row', '모아 놓기', '한 덩어리로 나란히. 사진은 자르지 않아요',
          <span className="flex flex-col gap-[3px]"><span className="flex gap-[3px]">{bar(28, 1.3, true)}{bar(28, 0.8, true)}{bar(28, 1, true)}</span><span className="flex gap-[3px]">{bar(28, 1.2, true)}{bar(28, 1, true)}</span></span>)}
        {opt('slide', '넘겨 보기', '한 장씩 옆으로 넘겨요. 과정 사진에 좋아요',
          <span className="block"><span className="flex gap-[3px] overflow-hidden">{bar(44, 4)}{bar(44, 1)}</span><span className="mt-1.5 flex justify-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-gray-900" /><span className="h-1.5 w-1.5 rounded-full bg-gray-300" /><span className="h-1.5 w-1.5 rounded-full bg-gray-300" /></span></span>)}
      </div>
    </EditorDialog>
  );
}
