import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { EditorDialog, btnGhost, btnPrimary } from './EditorDialog';
import { POST_DOC_LIMITS, type PollAttrs } from '@/lib/postDoc';
import { POLL_DURATIONS, emptyPoll, endsAtAfterDays, newOptionId, pollDeadlineText, pollProblem, tidyPoll } from '@/lib/postPoll';

/**
 * 투표 넣기·고치기 창 (2026-11-13) — 질문 · 보기(2~10개) · 여러 개 고르기 · 마감.
 * `locked`(이미 표가 있는 글을 고칠 때)면 질문·보기·복수 선택은 잠그고 마감만 바꾼다 — 서버도 같은 규칙으로 막는다(lib/postPoll.ts).
 */
export default function PollDialog({ initial, locked = false, onSubmit, onRemove, onClose }: {
  initial: PollAttrs | null; locked?: boolean;
  onSubmit: (poll: PollAttrs) => void; onRemove?: () => void; onClose: () => void;
}) {
  const [poll, setPoll] = useState<PollAttrs>(() => initial ? { ...initial, options: initial.options.map((o) => ({ ...o })) } : emptyPoll());
  // 마감 — 고칠 때는 '그대로'(지금 마감 유지)가 먼저 고른 값
  const [duration, setDuration] = useState<number>(initial ? -1 : 0);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => first.current?.focus(), 30); return () => clearTimeout(t); }, []);

  const setOption = (i: number, text: string) => setPoll((p) => ({ ...p, options: p.options.map((o, k) => (k === i ? { ...o, text } : o)) }));
  const addOption = () => setPoll((p) => (p.options.length >= POST_DOC_LIMITS.pollOptionsMax ? p : { ...p, options: [...p.options, { id: newOptionId(), text: '' }] }));
  const removeOption = (i: number) => setPoll((p) => (p.options.length <= POST_DOC_LIMITS.pollOptionsMin ? p : { ...p, options: p.options.filter((_, k) => k !== i) }));

  const submit = () => {
    const endsAt = duration === -1 ? (initial?.endsAt ?? null) : endsAtAfterDays(duration);
    const next = tidyPoll({ ...poll, endsAt });
    const problem = pollProblem(next);
    if (problem) { setError(problem); return; }
    onSubmit(next);
  };

  const keepText = initial?.endsAt ? `그대로 (${pollDeadlineText(initial.endsAt) || '마감 없음'})` : '그대로 (마감 없음)';

  return (
    <EditorDialog
      title={initial ? '투표 고치기' : '투표 넣기'}
      onClose={onClose}
      footer={<>
        {onRemove ? <button type="button" className={btnGhost} onClick={onRemove}>투표 빼기</button> : <button type="button" className={btnGhost} onClick={onClose}>취소</button>}
        <button type="button" className={btnPrimary} onClick={submit}>{initial ? '고치기' : '넣기'}</button>
      </>}
    >
      {locked && <p className="mb-3 bg-gray-50 px-3 py-2 text-[13px] leading-relaxed text-gray-600">이미 투표한 사람이 있어 질문과 보기는 바꿀 수 없어요. 마감만 바꿀 수 있어요.</p>}
      <label className="block">
        <span className="text-[13px] font-medium text-gray-700">질문</span>
        <input
          ref={first} value={poll.question} disabled={locked} maxLength={POST_DOC_LIMITS.pollQuestionChars}
          onChange={(e) => { setPoll((p) => ({ ...p, question: e.target.value })); setError(null); }}
          placeholder="예) 다음 단체전 주제는 무엇이 좋을까요?"
          className="mt-1.5 h-11 w-full rounded-lg border border-gray-300 px-3 text-[15px] focus:border-gray-900 focus:outline-none disabled:bg-gray-50 disabled:text-gray-500"
        />
      </label>
      <fieldset className="mt-4">
        <legend className="text-[13px] font-medium text-gray-700">보기</legend>
        <ul className="mt-1.5 space-y-2">
          {poll.options.map((o, i) => (
            <li key={o.id} className="flex items-center gap-2">
              <input
                value={o.text} disabled={locked} maxLength={POST_DOC_LIMITS.pollOptionChars}
                onChange={(e) => { setOption(i, e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (i === poll.options.length - 1) addOption(); } }}
                placeholder={`보기 ${i + 1}`} aria-label={`보기 ${i + 1}`}
                className="h-11 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-[15px] focus:border-gray-900 focus:outline-none disabled:bg-gray-50 disabled:text-gray-500"
              />
              {!locked && poll.options.length > POST_DOC_LIMITS.pollOptionsMin && (
                <button type="button" onClick={() => removeOption(i)} aria-label={`보기 ${i + 1} 빼기`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X size={16} /></button>
              )}
            </li>
          ))}
        </ul>
        {!locked && poll.options.length < POST_DOC_LIMITS.pollOptionsMax && (
          <button type="button" onClick={addOption} className="mt-2 inline-flex h-10 items-center gap-1.5 text-[14px] font-medium text-gray-700 hover:text-gray-900"><Plus size={15} />보기 더하기</button>
        )}
      </fieldset>
      <label className={`mt-3 flex min-h-10 items-center gap-2 text-[14px] ${locked ? 'text-gray-400' : 'cursor-pointer text-gray-700'}`}>
        <input type="checkbox" checked={poll.multiple} disabled={locked} onChange={(e) => setPoll((p) => ({ ...p, multiple: e.target.checked }))} className="h-4 w-4 accent-gray-900" />
        여러 개 고를 수 있게
      </label>
      <label className="mt-2 block">
        <span className="text-[13px] font-medium text-gray-700">마감</span>
        <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}
          className="mt-1.5 h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-[15px] focus:border-gray-900 focus:outline-none">
          {initial && <option value={-1}>{keepText}</option>}
          {POLL_DURATIONS.map(([d, name]) => <option key={d} value={d}>{name}</option>)}
        </select>
      </label>
      <p className="mt-3 text-[12px] leading-relaxed text-gray-500">누가 무엇을 골랐는지는 아무에게도 보이지 않아요. 결과는 투표한 사람과 글쓴이, 마감 뒤에는 모두가 봐요.</p>
      {error && <p role="alert" className="mt-2 text-[13px] text-accent">{error}</p>}
    </EditorDialog>
  );
}
