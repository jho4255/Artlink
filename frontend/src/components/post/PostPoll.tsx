import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { apiErrorMessage } from '@/lib/utils';
import { pollDeadlineText, pollPercent, type PollView } from '@/lib/postPoll';
import type { PollAttrs } from '@/lib/postDoc';

/**
 * 글 안 투표 (2026-11-13) — 읽는 화면(live)과 편집기·미리보기(static) 공용.
 * - live: 서버 `poll` 응답(PollView)으로 그린다. 투표하면 그 자리에서 결과 막대로 바뀐다(글 상세 캐시를 그 응답으로 고친다).
 *   결과는 투표한 사람·글쓴이·마감 뒤에만(서버가 정한다 — count 가 null 이면 숨긴다). 마감 전에는 [다시 고르기].
 * - static: 문서 속 정의(PollAttrs)만 — 고를 수 없다.
 * 모양은 팁 상자와 같은 테두리 상자(색 배경 없음, DESIGN.md). 고른 보기만 검정, 강조색은 쓰지 않는다.
 */
export default function PostPoll({ attrs, live }: {
  attrs: PollAttrs;
  live?: { postId: number; view: PollView | null; loggedIn: boolean; onNeedLogin: () => void };
}) {
  if (!live || !live.view) return <PollCard attrs={attrs} />;
  return <LivePoll postId={live.postId} view={live.view} loggedIn={live.loggedIn} onNeedLogin={live.onNeedLogin} />;
}

function Meta({ multiple, endsAt, voters }: { multiple: boolean; endsAt: string | null; voters?: number }) {
  const parts = [multiple ? '여러 개 고를 수 있어요' : '하나만 고를 수 있어요'];
  if (voters != null) parts.push(`${voters.toLocaleString()}명 참여`);
  const d = pollDeadlineText(endsAt);
  if (d) parts.push(d);
  return <p className="mt-1 text-[13px] text-gray-500">{parts.join(' · ')}</p>;
}

/** 정의만 — 편집기·미리보기 */
export function PollCard({ attrs }: { attrs: PollAttrs }) {
  const options = (attrs.options ?? []).filter((o) => o.text?.trim());
  return (
    <div className="post-poll-card border border-gray-200 px-5 py-4" role="group" aria-label="투표">
      <p className="text-[12px] font-semibold tracking-[0.08em] text-gray-900">투표</p>
      <p className="mt-1.5 text-[17px] font-semibold leading-snug text-gray-900">{attrs.question?.trim() || '질문을 써 주세요'}</p>
      <Meta multiple={!!attrs.multiple} endsAt={attrs.endsAt ?? null} />
      <ul className="mt-3 space-y-2">
        {(options.length ? options : [{ id: 'a', text: '보기 1' }, { id: 'b', text: '보기 2' }]).map((o) => (
          <li key={o.id} className="flex min-h-11 items-center gap-3 border border-gray-200 px-3.5 text-[15px] text-gray-700">
            <span aria-hidden="true" className={`h-4 w-4 shrink-0 border border-gray-400 ${attrs.multiple ? 'rounded-[3px]' : 'rounded-full'}`} />
            <span className="min-w-0 break-keep [overflow-wrap:anywhere]">{o.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LivePoll({ postId, view, loggedIn, onNeedLogin }: { postId: number; view: PollView; loggedIn: boolean; onNeedLogin: () => void }) {
  const qc = useQueryClient();
  const voted = view.myVotes.length > 0;
  const [choosing, setChoosing] = useState(false);
  const [picked, setPicked] = useState<string[]>(view.myVotes);
  const showBars = view.showResults && (!choosing || view.closed);
  const total = view.options.reduce((n, o) => n + (o.count ?? 0), 0);

  const apply = (next: PollView) => {
    qc.setQueryData(['community', 'post', String(postId)], (old: Record<string, unknown> | undefined) => (old ? { ...old, poll: next } : old));
  };
  const vote = useMutation({
    mutationFn: (optionIds: string[]) => api.post<PollView>(`/community/${postId}/poll`, { optionIds }).then((r) => r.data),
    onSuccess: (next) => { apply(next); setChoosing(false); setPicked(next.myVotes); },
    onError: (e) => toast.error(apiErrorMessage(e, '투표하지 못했어요.')),
  });
  const cancel = useMutation({
    mutationFn: () => api.delete<PollView>(`/community/${postId}/poll`).then((r) => r.data),
    onSuccess: (next) => { apply(next); setChoosing(true); setPicked([]); },
    onError: (e) => toast.error(apiErrorMessage(e, '취소하지 못했어요.')),
  });

  const toggle = (id: string) => {
    if (!loggedIn) { onNeedLogin(); return; }
    setPicked((cur) => (view.multiple ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id]));
  };

  return (
    <div className="post-poll-card border border-gray-200 px-5 py-4" role="group" aria-label={`투표: ${view.question}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-semibold tracking-[0.08em] text-gray-900">투표</p>
        {view.closed && <span className="text-[12px] font-medium text-gray-500">마감된 투표</span>}
      </div>
      <p className="mt-1.5 text-[17px] font-semibold leading-snug text-gray-900">{view.question}</p>
      <Meta multiple={view.multiple} endsAt={view.endsAt} voters={view.voters} />

      {showBars ? (
        <ul className="mt-3 space-y-2" aria-label="투표 결과">
          {view.options.map((o) => {
            const mine = view.myVotes.includes(o.id);
            const pct = pollPercent(o.count, total);
            return (
              <li key={o.id} className={`relative overflow-hidden border px-3.5 py-2.5 ${mine ? 'border-gray-900' : 'border-gray-200'}`}>
                <span aria-hidden="true" className={`absolute inset-y-0 left-0 ${mine ? 'bg-gray-900/10' : 'bg-gray-100'}`} style={{ width: `${pct}%` }} />
                <span className="relative flex items-center gap-2 text-[15px]">
                  {mine && <Check size={15} className="shrink-0 text-gray-900" aria-label="내가 고른 보기" />}
                  <span className={`min-w-0 flex-1 break-keep [overflow-wrap:anywhere] ${mine ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{o.text}</span>
                  <span className="shrink-0 tabular-nums text-[14px] text-gray-600">{pct}% <span className="text-gray-400">({o.count ?? 0})</span></span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="mt-3 space-y-2">
          {view.options.map((o) => {
            const on = picked.includes(o.id);
            return (
              <li key={o.id}>
                <button
                  type="button"
                  role={view.multiple ? 'checkbox' : 'radio'}
                  aria-checked={on}
                  disabled={view.closed}
                  onClick={() => toggle(o.id)}
                  className={`flex min-h-12 w-full items-center gap-3 border px-3.5 text-left text-[15px] ${on ? 'border-gray-900 text-gray-900' : 'border-gray-200 text-gray-700 hover:border-gray-400'}`}
                >
                  <span aria-hidden="true" className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center border ${view.multiple ? 'rounded-[3px]' : 'rounded-full'} ${on ? 'border-gray-900 bg-gray-900' : 'border-gray-400'}`}>
                    {on && <Check size={12} className="text-white" />}
                  </span>
                  <span className="min-w-0 break-keep [overflow-wrap:anywhere]">{o.text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!view.closed && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {showBars ? (
            <>
              {voted && <button type="button" onClick={() => { setChoosing(true); setPicked(view.myVotes); }} className="h-10 rounded-lg border border-gray-300 px-4 text-[14px] font-medium text-gray-700 hover:border-gray-500">다시 고르기</button>}
              {!voted && <button type="button" onClick={() => setChoosing(true)} className="h-10 rounded-lg bg-gray-900 px-4 text-[14px] font-semibold text-white">투표하기</button>}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => (loggedIn ? vote.mutate(picked) : onNeedLogin())}
                disabled={loggedIn && (picked.length === 0 || vote.isPending)}
                className="h-10 rounded-lg bg-gray-900 px-5 text-[14px] font-semibold text-white disabled:opacity-40"
              >
                {loggedIn ? (voted ? '이걸로 바꾸기' : '투표하기') : '로그인하고 투표하기'}
              </button>
              {voted && <button type="button" onClick={() => cancel.mutate()} disabled={cancel.isPending} className="h-10 px-2 text-[13px] text-gray-500 underline underline-offset-4">투표 취소</button>}
              {voted && view.showResults && <button type="button" onClick={() => { setChoosing(false); setPicked(view.myVotes); }} className="h-10 px-2 text-[13px] text-gray-500 underline underline-offset-4">결과 보기</button>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
