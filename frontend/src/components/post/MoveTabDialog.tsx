import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { apiErrorMessage } from '@/lib/utils';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import type { CommunityTab } from '@/components/community/TabManager';

/**
 * 글 탭 옮기기 (2026-11-21, 사용자: "관리자 계정이나 작성자는 글 탭이동 할 수 있게").
 *
 * - 관리자는 어느 탭으로든(숨긴 탭·관리자 전용 탭 포함), 글쓴이는 **지금 새로 쓸 수 있는 탭**으로만(서버 `canWrite` — 글쓰기와 같은 판정).
 * - 익명 글은 익명을 받지 않는 탭으로 못 옮긴다 — 관리자도(익명을 벗기지 않는다). 글쓴이는 글을 고쳐 익명을 끄면 된다.
 * - 못 고르는 탭도 목록에 남기고 이유를 붙인다(사라지면 "왜 없지"가 된다). ⚠️ 화면은 편의일 뿐 — 서버 `PATCH /community/:id/category` 가 다시 막는다.
 */
export interface MoveTabTarget { id: number; categoryId: number | null; anonymous: boolean }

type Choice = number | null;   // null = 지금 탭이 없는 옛 글(고를 수는 없다 — '탭 없음'은 없다, 2026-11-21)

function blockReason(t: CommunityTab, post: MoveTabTarget, isAdmin: boolean): string | null {
  if (t.id === post.categoryId) return null;
  if (!isAdmin && !t.canWrite) {
    if (!t.active) return '숨긴 탭';
    if (t.writePolicy === 'admin' || (!t.writePolicy && t.writeAdminOnly)) return '관리자만 쓰는 탭';
    if (t.writePolicy === 'writers') return '필진만 쓰는 탭';
    return '쓸 수 없는 탭';
  }
  if (post.anonymous && t.allowAnonymous === false) return isAdmin ? '익명 글은 못 옮겨요' : '익명을 끄면 옮길 수 있어요';
  return null;
}

export default function MoveTabDialog({ post, isAdmin, onClose }: { post: MoveTabTarget; isAdmin: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const titleId = useId();
  const [choice, setChoice] = useState<Choice>(post.categoryId);
  const busy = useRef(false);

  const { data: tabs, isLoading, isError, refetch } = useQuery<CommunityTab[]>({
    queryKey: ['community-tabs'],
    queryFn: () => api.get('/community/categories').then((r) => r.data),
    staleTime: 0,
  });

  const move = useMutation({
    mutationFn: (categoryId: Choice) => api.patch(`/community/${post.id}/category`, { categoryId }).then((r) => r.data as { category: { name: string } | null }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['community'] });
      qc.invalidateQueries({ queryKey: ['community-tabs'] });
      qc.invalidateQueries({ queryKey: ['community-popular'] });
      toast.success(`‘${data.category?.name ?? ''}’ 탭으로 옮겼어요.`);
      onClose();
    },
    onError: (e) => { busy.current = false; toast.error(apiErrorMessage(e, '탭을 옮기지 못했어요.')); },
  });

  useEscapeKey(onClose, { enabled: !move.isPending });

  // 뒤 페이지 스크롤 잠금 — 휴대폰에서 창 밖을 건드리면 뒤가 밀린다
  useEffect(() => {
    const body = document.body;
    const prev = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => { body.style.overflow = prev; };
  }, []);

  const changed = choice != null && choice !== post.categoryId;
  const submit = () => {
    if (!changed || busy.current) return;
    busy.current = true;   // ⚠️ state 가 아니라 ref — 두 번 톡 치면 요청이 두 번 갔다(규칙 88 의 연타 방지)
    move.mutate(choice);
  };

  const visible = (tabs ?? []).filter((t) => t.active || isAdmin || t.id === post.categoryId);
  const row = (key: string, value: Choice, label: string, reason: string | null, note?: string) => {
    const on = choice === value;
    const disabled = !!reason;
    return (
      <li key={key}>
        <label className={`flex min-h-12 items-center gap-3 rounded-lg px-3 py-2.5 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'} ${on ? 'bg-gray-50' : ''}`}>
          <input type="radio" name={`move-tab-${post.id}`} checked={on} disabled={disabled} onChange={() => setChoice(value)}
            className="h-4 w-4 shrink-0 accent-gray-900" />
          <span className={`min-w-0 flex-1 break-keep text-[15px] ${disabled ? 'text-gray-400' : 'text-gray-900'}`}>
            {label}
            {note && <span className="ml-1.5 text-[13px] text-gray-400">{note}</span>}
          </span>
          {value === post.categoryId && <span className="shrink-0 text-[13px] text-gray-500">지금</span>}
          {reason && <span className="shrink-0 text-[13px] text-gray-400">{reason}</span>}
        </label>
      </li>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget && !move.isPending) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="flex max-h-[85svh] w-full flex-col rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-xl sm:max-w-md sm:rounded-2xl sm:pb-0">
        <h2 id={titleId} className="px-5 pb-2 pt-5 text-[18px] font-semibold text-gray-900">탭 옮기기</h2>
        <div className="min-h-0 flex-1 overflow-y-auto px-2">
          {isLoading ? (
            <p className="px-3 py-6 text-[14px] text-gray-500">탭을 불러오는 중…</p>
          ) : isError ? (
            <p className="px-3 py-6 text-[14px] text-gray-600">탭을 불러오지 못했어요. <button type="button" onClick={() => void refetch()} className="underline underline-offset-4">다시 시도</button></p>
          ) : (
            <ul aria-label="옮길 탭" className="py-1">
              {visible.map((t) => row(String(t.id), t.id, t.name, blockReason(t, post, isAdmin), t.active ? undefined : '(숨김)'))}
            </ul>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
          <button type="button" onClick={onClose} disabled={move.isPending} className="h-11 rounded-lg px-4 text-[15px] text-gray-600 hover:bg-gray-100 disabled:opacity-50">취소</button>
          <button type="button" onClick={submit} disabled={!changed || move.isPending}
            className="h-11 rounded-lg bg-gray-900 px-5 text-[15px] font-semibold text-white hover:bg-gray-800 disabled:bg-gray-300">
            {move.isPending ? '옮기는 중…' : '옮기기'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
