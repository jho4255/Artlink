/**
 * 삭제 요청 (2026-10-03 사용자 결정) — 수락한 작가가 있거나 판매·정산 기록이 있는 공모(와 그런 공모가 있는 갤러리)는 갤러리가 직접 지울 수 없다.
 * 피치 못할 사정이 있을 수 있어, 사유를 적어 **관리자에게 삭제 요청**을 보낸다. 관리자가 [승인 관리]에서 무엇이 사라지는지 보고 지운다.
 *
 *  - `DeleteRequestDialog` — 왜 직접 못 지우는지 + 사유 칸 + [삭제 요청 보내기]
 *  - `DeleteRequestLine` — 카드에 '삭제 요청 중 [요청 취소]' · 반려됐으면 사유 한 줄
 * 데이터 쪽(`checkDeletable` · `useMyDeleteRequests`)은 `hooks/useDeleteRequests.ts`.
 * API: `POST /approvals/delete-request` · `GET /approvals/my-delete-requests` · `DELETE /approvals/delete-request/:id`
 */
import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import type { DeleteKind, MyDeleteRequest } from '@/hooks/useDeleteRequests';

const TYPE: Record<DeleteKind, 'EXHIBITION_DELETE' | 'GALLERY_DELETE'> = { exhibition: 'EXHIBITION_DELETE', gallery: 'GALLERY_DELETE' };
const NOUN: Record<DeleteKind, string> = { exhibition: '공모', gallery: '갤러리' };

/** 카드에 붙는 한 줄 — 요청 중이면 [요청 취소], 반려됐으면 사유 */
export function DeleteRequestLine({ request, kind }: { request: MyDeleteRequest | null; kind: DeleteKind }) {
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: (id: number) => api.delete(`/approvals/delete-request/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-delete-requests'] }); toast.success('삭제 요청을 취소했어요.'); },
    onError: (e: any) => toast.error(e.response?.data?.error || '취소하지 못했어요.'),
  });
  if (!request) return null;
  if (request.status === 'PENDING') {
    return (
      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600" data-delete-request="pending">
        <span><b className="font-medium text-gray-900">{NOUN[kind]} 삭제 요청 중</b> · 관리자 확인을 기다리고 있어요.</span>
        <button
          type="button"
          onClick={() => cancel.mutate(request.id)}
          disabled={cancel.isPending}
          className="min-h-[40px] text-sm text-gray-500 underline underline-offset-4 hover:text-gray-900 disabled:opacity-50"
        >요청 취소</button>
      </p>
    );
  }
  return (
    <p className="mt-3 text-sm text-gray-600" data-delete-request="rejected">
      <b className="font-medium text-gray-900">삭제 요청이 반려되었어요</b>{request.rejectReason ? ` · ${request.rejectReason}` : ''}
    </p>
  );
}

interface DialogProps {
  open: boolean;
  kind: DeleteKind;
  targetId: number;
  name: string;
  /** 서버가 말한 '직접 못 지우는 이유' */
  blockedReason: string;
  onClose: () => void;
}

/** 열 때마다 새로 그린다 — 사유 칸이 비어서 시작한다(닫았다 열면 지난 사유가 남지 않게) */
export function DeleteRequestDialog(props: DialogProps) {
  if (!props.open) return null;
  return <DeleteRequestForm {...props} />;
}

function DeleteRequestForm({ kind, targetId, name, blockedReason, onClose }: DialogProps) {
  const qc = useQueryClient();
  const titleId = useId();
  const [reason, setReason] = useState('');
  useEscapeKey(onClose);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const send = useMutation({
    mutationFn: () => api.post('/approvals/delete-request', { type: TYPE[kind], targetId, reason: reason.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-delete-requests'] });
      toast.success('삭제 요청을 보냈어요. 관리자가 확인하면 알림으로 알려 드려요.');
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '요청을 보내지 못했어요.'),
  });

  const tooShort = reason.trim().length < 5;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} className="text-lg font-bold text-gray-950">관리자에게 삭제 요청</h3>
        <p className="mt-2 break-keep text-sm leading-relaxed text-gray-600">
          <b className="font-medium text-gray-900">{name}</b> — {blockedReason}
        </p>
        <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-gray-600">
          <li className="flex gap-2.5"><span aria-hidden className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-gray-400" />관리자가 사유를 보고 확인한 뒤 삭제해요. 결과는 알림으로 알려 드려요.</li>
          <li className="flex gap-2.5"><span aria-hidden className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-gray-400" />삭제되면 지원·출품 자료·판매·정산 기록이 함께 사라지고, 참여 작가에게 알림이 가요.</li>
        </ul>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-sm font-medium text-gray-800">삭제하려는 이유</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            maxLength={1000}
            placeholder="예: 전시가 취소되어 공고를 내려야 해요. 참여 작가들에게는 따로 안내했어요."
            className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2.5 text-sm leading-relaxed focus:border-gray-400 focus:outline-none"
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-lg px-4 text-sm text-gray-500 hover:text-gray-700">취소</button>
          <button
            type="button"
            onClick={() => send.mutate()}
            disabled={tooShort || send.isPending}
            className="min-h-[44px] rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40"
          >{send.isPending ? '보내는 중…' : '삭제 요청 보내기'}</button>
        </div>
        {tooShort && reason.length > 0 && <p className="mt-2 text-right text-xs text-gray-500">이유를 5자 이상 적어 주세요.</p>}
      </div>
    </div>,
    document.body,
  );
}
