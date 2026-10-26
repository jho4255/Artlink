import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import LazyRichTextEditor from '@/components/shared/LazyRichTextEditor';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { richTextLength } from '@/lib/richText';
import { EXHIBITION_TITLE_MAX } from '@/lib/exhibitionHost';

/**
 * 아트링크 주최 공모의 제목·소개 고치기 — 관리자 [주최 공모] 카드의 [제목·소개 수정] (2026-10-26 사용자 요청).
 * 아트링크가 주최자라 승인 없이 바로 바뀐다. 제목은 `PATCH /exhibitions/:id/title`(관리자·주최 공모만), 소개는 원래 있던
 * `PATCH /exhibitions/:id/description`. **바뀐 것만** 보낸다(둘 다 그대로면 그냥 닫는다).
 * 공고 상세에도 같은 일을 하는 [수정] 이 있다(제목 옆 · 공모 소개 옆) — 이 창은 관리자가 일하는 [주최 공모] 탭에서 바로 고치게 한다.
 * - 고친 게 있는데 닫으려 하면(취소·×·바깥·Esc) 버릴지 묻는다.
 * - 저장하면 여는 목록의 캐시에 곧바로 써 넣는다(추가 질문 창과 같은 이유 — 다시 받는 사이에 열면 옛 제목이 떴다).
 */
export default function HostedContentEditModal({
  exhibition,
  onClose,
}: {
  exhibition: { id: number; title: string; description?: string | null };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const initialDesc = exhibition.description ?? '';
  const [title, setTitle] = useState(exhibition.title);
  const [description, setDescription] = useState(initialDesc);
  const [asking, setAsking] = useState(false);
  const titleChanged = title.trim() !== exhibition.title;
  const descChanged = description !== initialDesc;
  const dirty = titleChanged || descChanged;

  const save = useMutation({
    mutationFn: async () => {
      const out: { title?: string; description?: string } = {};
      if (titleChanged) out.title = (await api.patch(`/exhibitions/${exhibition.id}/title`, { title: title.trim() })).data.title;
      if (descChanged) out.description = (await api.patch(`/exhibitions/${exhibition.id}/description`, { description })).data.description;
      return out;
    },
    onSuccess: (saved) => {
      const patchList = (old: unknown) => Array.isArray(old)
        ? old.map((ex: { id?: number } | null) => (ex?.id === exhibition.id ? { ...ex, ...saved } : ex))
        : old;
      queryClient.setQueriesData({ queryKey: ['hosted-exhibitions'] }, patchList);
      for (const key of [['hosted-exhibitions'], ['exhibition', String(exhibition.id)], ['exhibition', exhibition.id], ['exhibitions'], ['chats']]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success('공모 제목·소개를 저장했어요.');
      onClose();
    },
    onError: (err: { response?: { data?: { error?: string } } }) => toast.error(err.response?.data?.error || '저장하지 못했어요. 잠시 후 다시 시도해 주세요.'),
  });

  const submit = () => {
    if (!dirty) { onClose(); return; }
    if (!title.trim()) { toast.error('공모 제목을 입력해주세요.'); return; }
    if (descChanged && richTextLength(description) === 0) { toast.error('공모 소개를 입력해주세요.'); return; }
    save.mutate();
  };
  const requestClose = () => {
    if (save.isPending) return;
    if (dirty) setAsking(true);
    else onClose();
  };
  useEscapeKey(requestClose, { enabled: !asking });

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={requestClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="공모 제목·소개 수정"
          className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-medium text-gray-900">제목·소개 수정</h3>
              <p className="text-sm text-gray-400">아트링크 주최 공모라 저장하면 바로 바뀌어요.</p>
            </div>
            <button type="button" onClick={requestClose} aria-label="닫기" className="-mr-2 -mt-1 inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center text-gray-400 hover:text-gray-700"><X size={18} /></button>
          </div>

          <label className="block">
            <span className="mb-1 flex items-baseline justify-between text-sm font-medium text-gray-700">
              공모 제목
              <span className="text-xs font-normal text-gray-400 tabular-nums">{title.trim().length}/{EXHIBITION_TITLE_MAX}</span>
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
              maxLength={EXHIBITION_TITLE_MAX}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-gray-900 focus:outline-none"
            />
          </label>

          <div className="mt-4">
            <p className="mb-1 text-sm font-medium text-gray-700">공모 소개</p>
            <LazyRichTextEditor value={description} onChange={setDescription} placeholder="공모 소개" maxLength={20000} minHeight={220} />
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={requestClose} disabled={save.isPending} className="min-h-[44px] px-4 text-sm text-gray-500">취소</button>
            <button
              type="button"
              onClick={submit}
              disabled={save.isPending}
              className="min-h-[44px] rounded-lg bg-gray-900 px-4 text-sm text-white disabled:opacity-50"
            >
              {save.isPending ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={asking}
        title="고친 내용을 버릴까요?"
        message="저장하지 않은 제목·소개는 사라져요."
        confirmText="버리고 닫기"
        cancelText="계속 고치기"
        variant="danger"
        onConfirm={() => { setAsking(false); onClose(); }}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}
