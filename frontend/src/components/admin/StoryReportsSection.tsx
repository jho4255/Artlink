/**
 * [신고 관리] 탭 맨 위 — ArtStory 소식 신고 (2026-11-14, 규칙 81).
 *
 * 서로 다른 3명이 신고하면 소식이 저절로 내려가고 관리자에게 알림이 온다. 여기서 정한다:
 *  · [문제없음 · 다시 보이기] — 내려간 것이면 되살리고, 그 뒤에 들어온 신고만 다시 센다
 *  · [내리기] — 운영이 내린 것으로 확정(주인에게 알림)
 *  · [삭제] — 소식을 지운다
 * 어느 쪽이든 '확인했다'가 남아 [확인할 것]에서 빠진다. 소식을 눌러 보기 화면에서 직접 볼 수 있다.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import ConfirmDeleteButton from '@/components/shared/ConfirmDeleteButton';
import StoryCard from '@/components/story/StoryCard';
import StoryViewer from '@/components/story/StoryViewer';
import { STORY_REPORT_LABELS, type Story, type StoryReportReason } from '@/lib/story';
import { ADMIN_TODO_KEY } from '@/hooks/useAdminTodo';

interface ReportItem {
  id: number; caption: string; images: string[]; bg: string | null; visibility: 'PUBLIC' | 'NEIGHBORS'; createdAt: string;
  author: Story['author'];
  hidden: boolean; hiddenReason: 'ADMIN' | 'REPORTS' | null; hiddenAt: string | null; reviewedAt: string | null;
  reportCount: number; freshCount: number; pending: boolean; reasons: Record<string, number>;
  reporters: { name: string; reason: string; createdAt: string }[];
}

const asStory = (r: ReportItem): Story => ({
  id: r.id, caption: r.caption, images: r.images, bg: r.bg, visibility: r.visibility, createdAt: r.createdAt,
  author: r.author, mine: false, likeCount: 0, commentCount: 0, liked: false, hidden: r.hidden, hiddenReason: r.hiddenReason,
});

export default function StoryReportsSection() {
  const qc = useQueryClient();
  const [view, setView] = useState<'pending' | 'done'>('pending');
  const [open, setOpen] = useState<Story | null>(null);
  const { data = [], isLoading } = useQuery<ReportItem[]>({
    queryKey: ['story-reports'],
    queryFn: () => api.get('/stories/reports').then((r) => r.data),
  });
  const decide = useMutation({
    mutationFn: ({ id, hidden }: { id: number; hidden: boolean }) => api.patch(`/stories/${id}/hidden`, { hidden }),
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: ['story-reports'] }); qc.invalidateQueries({ queryKey: ADMIN_TODO_KEY }); qc.invalidateQueries({ queryKey: ['stories'] }); toast.success(v.hidden ? '내렸어요.' : '다시 보이게 했어요.'); },
    onError: () => toast.error('처리하지 못했어요.'),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/stories/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['story-reports'] }); qc.invalidateQueries({ queryKey: ADMIN_TODO_KEY }); qc.invalidateQueries({ queryKey: ['stories'] }); toast.success('삭제했어요.'); },
    onError: () => toast.error('삭제하지 못했어요.'),
  });

  const pending = data.filter((r) => r.pending);
  const done = data.filter((r) => !r.pending);
  const rows = view === 'pending' ? pending : done;

  return (
    <section className="mb-10" aria-labelledby="story-reports-title">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h2 id="story-reports-title" className="text-base font-bold text-gray-900">ArtStory 소식 신고</h2>
        <div className="flex gap-3 text-sm" role="tablist" aria-label="소식 신고 보기">
          {([['pending', `확인할 것 ${pending.length}`], ['done', `처리한 것 ${done.length}`]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
              className={view === k ? 'text-gray-900 underline decoration-1 underline-offset-4' : 'text-gray-500 hover:text-gray-900'}>{label}</button>
          ))}
        </div>
      </div>

      {isLoading ? <div className="h-24 animate-pulse bg-gray-100" />
        : rows.length === 0 ? <p className="py-6 text-sm text-gray-500">{view === 'pending' ? '확인할 소식 신고가 없어요.' : '처리한 소식 신고가 없어요.'}</p>
          : (
            <ul className="divide-y divide-gray-100 border-y border-gray-100">
              {rows.map((r) => (
                <li key={r.id} className="flex gap-4 py-4">
                  <StoryCard story={asStory(r)} onOpen={() => setOpen(asStory(r))} className="h-[150px] w-[90px]" label={`${r.author.name}님의 신고된 소식 보기`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-900">
                      <b>{r.author.name}</b>
                      <span className="ml-2 text-xs text-gray-500">{new Date(r.createdAt).toLocaleDateString('ko')}</span>
                      {r.hidden && <span className="ml-2 rounded bg-gray-900 px-1.5 py-0.5 text-[11px] font-bold text-white">{r.hiddenReason === 'REPORTS' ? '신고로 내려감' : '운영이 내림'}</span>}
                    </p>
                    {r.caption && <p className="mt-1 line-clamp-2 whitespace-pre-line text-sm text-gray-700 [overflow-wrap:anywhere]">{r.caption}</p>}
                    <p className="mt-1.5 text-xs text-gray-600">
                      신고 {r.reportCount}건{r.freshCount !== r.reportCount ? ` (새 신고 ${r.freshCount})` : ''} ·{' '}
                      {Object.entries(r.reasons).map(([k, n]) => `${STORY_REPORT_LABELS[k as StoryReportReason] ?? k} ${n}`).join(' · ')}
                    </p>
                    {r.reporters.length > 0 && (
                      <p className="mt-0.5 truncate text-xs text-gray-500">신고한 사람: {r.reporters.map((x) => x.name).join(', ')}{r.reportCount > r.reporters.length ? ' 외' : ''}</p>
                    )}
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, hidden: false })}
                        className="h-9 rounded-lg border border-gray-300 px-3 text-sm text-gray-900 hover:bg-gray-50">{r.hidden ? '문제없음 · 다시 보이기' : '문제없음'}</button>
                      {(!r.hidden || r.hiddenReason !== 'ADMIN') && (
                        <button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, hidden: true })}
                          className="h-9 rounded-lg bg-gray-900 px-3 text-sm text-white hover:bg-gray-800">{r.hidden ? '내린 채로 두기' : '내리기'}</button>
                      )}
                      <ConfirmDeleteButton onConfirm={() => del.mutate(r.id)} title="소식 삭제" message="이 소식을 지웁니다. 사진과 댓글도 함께 사라지며 되돌릴 수 없습니다."
                        className="h-9 px-2 text-sm text-accent hover:underline">삭제</ConfirmDeleteButton>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
      {open && <StoryViewer stories={[open]} endScreen={false} onClose={() => setOpen(null)} />}
    </section>
  );
}
