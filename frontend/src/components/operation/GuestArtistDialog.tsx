/**
 * [비회원 작가 추가] · [이름 바꾸기] 창 (2026-11-23, CLAUDE.md 규칙 91).
 * 이름 하나만 받는다 — 연락처·약력은 출품 자료의 약력 칸에 적는다(사용자 결정: 따로 받지 않는다).
 * `role="dialog" aria-modal` · Esc 로 닫힘(앱 뒤로가기도 Esc 를 보낸다, lib/native.ts) · 뒤 페이지 스크롤 잠금.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GUEST_NAME_MAX, guestNameProblem } from '@/lib/guestArtists';
import { useEscapeKey } from '@/hooks/useEscapeKey';

export default function GuestArtistDialog({ mode, initialName = '', busy, onSubmit, onClose }: {
  mode: 'add' | 'rename';
  initialName?: string;
  busy?: boolean;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const inputId = useId();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEscapeKey(onClose);

  useEffect(() => {
    input.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const problem = guestNameProblem(name);
    if (problem) { setError(problem); input.current?.focus(); return; }
    onSubmit(name.replace(/\s+/g, ' ').trim());
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-guest-dialog
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl sm:p-6"
      >
        <h3 id={titleId} className="text-lg font-bold">{mode === 'add' ? '비회원 작가 추가' : '이름 바꾸기'}</h3>
        <label htmlFor={inputId} className="mt-4 block text-[13.5px] font-semibold text-gray-700">작가 이름</label>
        <input
          ref={input}
          id={inputId}
          type="text"
          value={name}
          maxLength={GUEST_NAME_MAX + 10}
          autoComplete="off"
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-err` : undefined}
          onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
          className={`mt-1.5 block h-12 w-full rounded-lg border px-3 text-base text-gray-950 outline-none focus:border-gray-900 ${error ? 'border-accent' : 'border-gray-300'}`}
        />
        {error && <p id={`${inputId}-err`} className="mt-1.5 text-[13px] text-accent">{error}</p>}
        {mode === 'add' && (
          <ul className="mt-4 space-y-2 text-sm leading-relaxed text-gray-600">
            <li className="flex gap-2.5"><span aria-hidden className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-gray-400" /><span>출품 자료 · 판매 · 정산을 갤러리가 직접 넣어요.</span></li>
            <li className="flex gap-2.5"><span aria-hidden className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-gray-400" /><span>지원자 목록과 정원에는 들어가지 않아요.</span></li>
          </ul>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-lg px-4 text-sm text-gray-500 hover:text-gray-700">취소</button>
          <button type="submit" disabled={busy} className="min-h-[44px] rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
            {mode === 'add' ? '추가하고 자료 입력' : '저장'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
