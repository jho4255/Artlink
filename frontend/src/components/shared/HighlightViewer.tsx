/**
 * 하이라이트 뷰어 — **ArtStory 보기 화면(StoryViewer)을 그대로 쓴다** (2026-11-14, 규칙 81).
 *
 * 그 전엔 따로 만든 뷰어였는데, 홈 ArtStory 보기 화면과 넘기는 법·모양이 같아야 하므로 하나로 합쳤다.
 * 그래서 하이라이트에서도 좋아요·댓글·공유가 된다. 다른 점:
 *  · 머리 첫 줄이 하이라이트 이름(그 아래 올린 사람 · 시각)
 *  · 끝까지 보면 '다 봤어요' 화면 없이 닫힌다
 *  · 주인에게는 머리에 관리 단추 — 이름 바꾸기·공개 전환·이 소식 빼기·삭제 (2026-09-19)
 *    관리 확인창이 떠 있는 동안 넘김을 멈춘다(`holdExternal`).
 * ⚠️ 한 칸 = 사진 한 장(소식 하나에 사진 세 장이면 칸 셋) — StoryViewer 가 그렇게 센다.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Lock, Pencil, Trash2, Eye, EyeOff, MinusCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { apiErrorMessage } from '@/lib/utils';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import StoryViewer from '@/components/story/StoryViewer';
import type { Story } from '@/lib/story';

interface HighlightDetail { id: number; name: string; isPublic: boolean; mine?: boolean; stories: Story[] }

export default function HighlightViewer({ highlightId, onClose }: { highlightId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery<HighlightDetail>({
    queryKey: ['highlight', highlightId],
    queryFn: () => api.get(`/stories/highlights/${highlightId}/stories`).then((r) => r.data),
  });

  const [confirm, setConfirm] = useState<null | 'delete' | 'remove'>(null);
  const [curStory, setCurStory] = useState<Story | null>(null);
  const [at, setAt] = useState(0);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['highlight', highlightId] }); qc.invalidateQueries({ queryKey: ['highlights'] }); };
  const patch = useMutation({
    mutationFn: (body: { name?: string; isPublic?: boolean }) => api.patch(`/stories/highlights/${highlightId}`, body),
    onSuccess: refresh,
    onError: (e) => toast.error(apiErrorMessage(e, '변경에 실패했습니다.')),
  });
  const removeStory = useMutation({
    mutationFn: (storyId: number) => api.delete(`/stories/highlights/${highlightId}/stories/${storyId}`),
    onSuccess: () => { toast.success('하이라이트에서 뺐습니다.'); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e, '빼기에 실패했습니다.')),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/stories/highlights/${highlightId}`),
    onSuccess: () => { toast.success('하이라이트를 지웠습니다.'); qc.invalidateQueries({ queryKey: ['highlights'] }); onClose(); },
    onError: (e) => toast.error(apiErrorMessage(e, '삭제에 실패했습니다.')),
  });
  const rename = () => {
    const next = window.prompt('하이라이트 이름', data?.name ?? '');
    if (next == null) return;
    const t = next.trim();
    if (!t || t.length > 50) { toast.error('이름은 1~50자입니다.'); return; }
    if (t !== data?.name) patch.mutate({ name: t });
  };

  const confirms = (
    <>
      <ConfirmDialog
        open={confirm === 'remove'}
        title="이 소식 빼기"
        message="이 소식을 하이라이트에서 뺍니다. 소식 자체는 그대로 남습니다."
        confirmText="빼기"
        variant="danger"
        onConfirm={() => { if (curStory) removeStory.mutate(curStory.id); setConfirm(null); }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title="하이라이트 삭제"
        message={`'${data?.name ?? ''}' 하이라이트를 지웁니다. 담긴 소식은 그대로 남습니다.`}
        confirmText="삭제"
        variant="danger"
        onConfirm={() => { remove.mutate(); setConfirm(null); }}
        onCancel={() => setConfirm(null)}
      />
    </>
  );

  // 받는 중·못 받음·빈 하이라이트 — 같은 검은 화면에 한 줄
  if (isLoading || isError || !data || data.stories.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={data?.name ?? '하이라이트'}>
        <div className="flex items-center gap-2 px-4 py-3">
          <p className="min-w-0 flex-1 truncate text-sm font-bold">{data?.name ?? '하이라이트'}</p>
          {data?.mine && (
            <button type="button" onClick={() => setConfirm('delete')} aria-label="하이라이트 삭제" className="grid h-10 w-10 place-items-center text-white/80 hover:text-white"><Trash2 size={17} /></button>
          )}
          <button type="button" onClick={onClose} aria-label="닫기" className="grid h-11 w-11 place-items-center"><X size={24} /></button>
        </div>
        <div className="grid flex-1 place-items-center px-8 text-center text-sm text-white/80">
          {isLoading ? <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
            : isError ? '하이라이트를 열 수 없습니다.'
              : '아직 담은 소식이 없어요.'}
        </div>
        {confirms}
      </div>
    );
  }

  const tools = (s: Story) => (
    <div className="flex shrink-0 items-center" onPointerDown={(e) => e.stopPropagation()}>
      {!data.isPublic && <span className="mr-1 inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px]"><Lock size={10} /> 비공개</span>}
      {data.mine && (
        <>
          <button type="button" onClick={rename} aria-label="이름 바꾸기" title="이름 바꾸기" className="grid h-10 w-9 place-items-center text-white/80 hover:text-white"><Pencil size={16} /></button>
          <button type="button" onClick={() => patch.mutate({ isPublic: !data.isPublic })} aria-label={data.isPublic ? '비공개로' : '공개로'} title={data.isPublic ? '비공개로 바꾸기' : '공개로 바꾸기'} className="grid h-10 w-9 place-items-center text-white/80 hover:text-white">
            {data.isPublic ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <button type="button" onClick={() => { setCurStory(s); setConfirm('remove'); }} aria-label="이 소식 빼기" title="이 소식을 하이라이트에서 빼기" className="grid h-10 w-9 place-items-center text-white/80 hover:text-white"><MinusCircle size={16} /></button>
          <button type="button" onClick={() => setConfirm('delete')} aria-label="하이라이트 삭제" title="하이라이트 삭제" className="grid h-10 w-9 place-items-center text-white/80 hover:text-accent"><Trash2 size={16} /></button>
        </>
      )}
    </div>
  );

  return (
    <>
      <StoryViewer
        // 담은 소식이 바뀌면(빼기) 처음부터 다시 그리되, 보던 자리 근처에서
        key={data.stories.map((s) => s.id).join(',')}
        stories={data.stories}
        startIndex={Math.min(at, data.stories.length - 1)}
        title={data.name}
        endScreen={false}
        headerExtra={tools}
        holdExternal={confirm !== null}
        onIndexChange={(i, s) => { setAt(i); setCurStory(s); }}
        onClose={() => onClose()}
      />
      {confirms}
    </>
  );
}
