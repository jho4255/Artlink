/**
 * 소식 댓글 — 보기 화면 안의 창(휴대폰은 아래에서 올라오고, PC 는 보기 창 오른쪽에 붙는다).
 * 읽기는 누구나, 쓰기는 로그인. @멘션은 부를 수 있는 사람만(서버가 판정 — MentionSuggest).
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { X, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { timeAgo, apiErrorMessage } from '@/lib/utils';
import ConfirmDeleteButton from '@/components/shared/ConfirmDeleteButton';
import { useMention, MentionSuggest } from '@/components/shared/MentionSuggest';
import type { Story, StoryComment } from '@/lib/story';

export default function StoryComments({ story, canWrite, isAdmin, focusCommentId, onCount, onClose, onNeedLogin, onLeave }: {
  story: Story;
  canWrite: boolean;
  isAdmin: boolean;
  /** 알림 링크(`comment=`)로 왔다 — 그 댓글로 내려가 잠깐 표시한다 */
  focusCommentId?: number | null;
  onCount: (delta: number) => void;
  onClose: () => void;
  onNeedLogin: () => void;
  /** 사람 이름을 눌러 홈페이지로 갈 때 — 보기 화면을 닫는다 */
  onLeave: () => void;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  // ⚠️ 나눠 받는다 — 한 객체로 들고 다니면 React 컴파일러 린트가 ref 와 같은 덩어리로 보고 렌더 중 접근으로 잡는다
  const { ref: mentionRef, onChange: onMentionChange, onBlur: onMentionBlur, onKeyDown: onMentionKey, suggest } = useMention(text, (v) => setText(v.slice(0, 1000)));
  const listRef = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState<number | null>(null);

  const { data: comments, isLoading } = useQuery<StoryComment[]>({
    queryKey: ['story-comments', story.id],
    queryFn: () => api.get(`/stories/${story.id}/comments`).then((r) => r.data),
  });

  // 알림으로 온 댓글로 내려간다 — 목록이 그려진 뒤 한 번
  const focused = useRef(false);
  useEffect(() => {
    if (!focusCommentId || focused.current || !comments) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-comment="${focusCommentId}"]`);
    if (!el) return;
    const t = window.setTimeout(() => {
      focused.current = true;
      el.scrollIntoView({ block: 'center' });
      setFlash(focusCommentId);
      window.setTimeout(() => setFlash(null), 2000);
    }, 80);
    return () => window.clearTimeout(t);
  }, [focusCommentId, comments]);

  const add = useMutation({
    mutationFn: () => api.post(`/stories/${story.id}/comments`, { body: text.trim() }).then((r) => r.data as StoryComment),
    onSuccess: (c) => {
      setText('');
      qc.setQueryData<StoryComment[]>(['story-comments', story.id], (old) => [...(old ?? []), c]);
      onCount(1);
      window.setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }), 30);
    },
    onError: (e) => toast.error(apiErrorMessage(e, '댓글을 남기지 못했어요.')),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/stories/${story.id}/comments/${id}`).then(() => id),
    onSuccess: (id) => {
      qc.setQueryData<StoryComment[]>(['story-comments', story.id], (old) => (old ?? []).filter((c) => c.id !== id));
      onCount(-1);
    },
    onError: () => toast.error('지우지 못했어요.'),
  });

  const submit = () => { if (text.trim() && !add.isPending) add.mutate(); };
  const list = comments ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-gray-900">
      <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-3">
        <h2 className="text-[15px] font-bold">댓글 {list.length || story.commentCount || ''}</h2>
        <button type="button" onClick={onClose} aria-label="댓글 닫기" className="-mr-2 grid h-11 w-11 place-items-center text-gray-600 hover:text-gray-900">
          <X size={20} />
        </button>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-4 pb-3 pt-1">
        {isLoading && <div className="h-12 animate-pulse rounded bg-gray-100" />}
        {!isLoading && list.length === 0 && <p className="py-4 text-sm text-gray-500">아직 댓글이 없어요.</p>}
        {list.map((c) => {
          const who = c.author.homepage
            ? <Link to={c.author.homepage} onClick={onLeave} className="font-bold hover:underline">{c.author.name}</Link>
            : <span className="font-bold">{c.author.name}</span>;
          return (
            <div key={c.id} data-comment={c.id}
              className={`flex items-start gap-2.5 rounded-md transition-colors ${flash === c.id ? 'bg-amber-50' : ''}`}>
              {c.author.avatar
                ? <img src={c.author.avatar} alt="" className="mt-0.5 h-8 w-8 shrink-0 rounded-full object-cover" />
                : <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gray-100 text-xs font-bold text-gray-600">{c.author.name.slice(0, 1)}</span>}
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-gray-900">{who} <span className="ml-1 text-xs font-normal text-gray-500">{timeAgo(c.createdAt)}</span></p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800 [overflow-wrap:anywhere]">{c.body}</p>
              </div>
              {(c.mine || story.mine || isAdmin) && (
                <ConfirmDeleteButton onConfirm={() => del.mutate(c.id)} aria-label="댓글 삭제" title="댓글 삭제" message="이 댓글을 지웁니다."
                  className="-mr-2 grid h-10 w-10 shrink-0 place-items-center text-gray-400 hover:text-accent">
                  <X size={14} />
                </ConfirmDeleteButton>
              )}
            </div>
          );
        })}
      </div>
      <div className="shrink-0 border-t border-gray-100 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-2.5">
        {canWrite ? (
          <div className="relative flex items-center gap-2">
            <label htmlFor={`story-comment-${story.id}`} className="sr-only">댓글 쓰기</label>
            <input
              id={`story-comment-${story.id}`}
              ref={mentionRef as React.Ref<HTMLInputElement>}
              value={text}
              onChange={onMentionChange}
              onBlur={onMentionBlur}
              onKeyDown={(e) => {
                if (onMentionKey(e)) return;
                // 한글 조합 중 Enter 는 두 번 잡혀 두 번 등록됐다(2026-09-19) — 조합이 끝난 Enter 만
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
              }}
              placeholder="댓글 쓰기"
              enterKeyHint="send"
              className="h-11 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-[15px] focus:border-gray-500 focus:outline-none"
            />
            <button type="button" onClick={submit} disabled={!text.trim() || add.isPending} aria-label="댓글 등록"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-gray-900 text-white disabled:bg-gray-200 disabled:text-gray-500">
              <Send size={17} />
            </button>
            <MentionSuggest {...suggest} placement="above" />
          </div>
        ) : (
          <button type="button" onClick={onNeedLogin} className="h-11 w-full rounded-lg border border-gray-300 text-sm font-bold text-gray-900 hover:bg-gray-50">
            로그인하고 댓글 쓰기
          </button>
        )}
      </div>
    </div>
  );
}
