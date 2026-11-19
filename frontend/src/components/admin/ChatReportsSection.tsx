/**
 * [신고 관리] 탭 — ArtTalk 신고 (2026-11-19, CLAUDE.md 규칙 33 을 닫는다).
 *
 * 관리자는 방을 열 수 없다(남의 방 404) — 신고할 때 찍어 둔 **사본**(그 메시지와 앞뒤 몇 줄, 1:1 사람 신고면 최근 대화)만 본다.
 * 처리는 상태만 남긴다: [처리함](조치했다) · [문제없음]. 회원 제재는 [사용자 관리]에서 한다(신고당한 회원의 이메일로 찾는다).
 * 옛 쪽지 신고 구역(ReportManageSection)은 화면에서 뗐다 — 옛 쪽지는 더 쓰이지 않는다(표·라우트는 남아 있다).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { bubbleTime, dividerLabel, chatRoleTag } from '@/lib/chatView';
import { CHAT_REPORT_REASONS } from '@/lib/chatTypes';

interface Line { id: number; senderId: number; senderName: string; content: string; attachmentType: string | null; attachmentName: string | null; createdAt: string; target: boolean }
interface ReportItem {
  id: number; chatId: number; messageId: number | null; reason: string; detail: string | null;
  snapshot: { kind: 'DIRECT' | 'GROUP'; title: string | null; lines: Line[] };
  status: 'OPEN' | 'DONE' | 'DISMISSED'; adminNote: string | null; createdAt: string; reviewedAt: string | null;
  reporter: { id: number; name: string; role: string };
  target: { id: number; name: string; role: string; email: string; deleted: boolean; openReports: number };
}

const REASON = Object.fromEntries(CHAT_REPORT_REASONS) as Record<string, string>;

export default function ChatReportsSection() {
  const qc = useQueryClient();
  const [view, setView] = useState<'open' | 'done'>('open');
  const { data = [], isLoading } = useQuery<ReportItem[]>({
    queryKey: ['chat-reports'],
    queryFn: () => api.get('/chat-reports').then((r) => r.data),
  });
  const decide = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'DONE' | 'DISMISSED' | 'OPEN' }) => api.patch(`/chat-reports/${id}`, { status }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ['chat-reports'] });
      toast.success(v.status === 'OPEN' ? '확인할 것으로 되돌렸어요.' : v.status === 'DONE' ? '처리함으로 남겼어요.' : '문제없음으로 남겼어요.');
    },
    onError: () => toast.error('처리하지 못했어요.'),
  });
  const open = data.filter((r) => r.status === 'OPEN');
  const done = data.filter((r) => r.status !== 'OPEN');
  const rows = view === 'open' ? open : done;

  return (
    <section className="mb-10" aria-labelledby="chat-reports-title" data-testid="chat-reports">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h2 id="chat-reports-title" className="text-base font-bold text-gray-900">ArtTalk 신고</h2>
        <div className="flex gap-3 text-sm" role="tablist" aria-label="ArtTalk 신고 보기">
          {([['open', `확인할 것 ${open.length}`], ['done', `처리한 것 ${done.length}`]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
              className={view === k ? 'text-gray-900 underline decoration-1 underline-offset-4' : 'text-gray-500 hover:text-gray-900'}>{label}</button>
          ))}
        </div>
      </div>

      {isLoading ? <div className="h-24 animate-pulse bg-gray-100" />
        : rows.length === 0 ? <p className="py-6 text-sm text-gray-500">{view === 'open' ? '확인할 ArtTalk 신고가 없어요.' : '처리한 ArtTalk 신고가 없어요.'}</p>
          : (
            <ul className="divide-y divide-gray-100 border-y border-gray-100">
              {rows.map((r) => (
                <li key={r.id} className="py-4">
                  <p className="text-sm text-gray-900">
                    <b>{REASON[r.reason] ?? r.reason}</b>
                    <span className="ml-2 text-xs text-gray-500">{dividerLabel(r.createdAt)} {bubbleTime(r.createdAt)}</span>
                    {r.status !== 'OPEN' && <span className="ml-2 text-xs font-medium text-gray-700">{r.status === 'DONE' ? '처리함' : '문제없음'}</span>}
                  </p>
                  <p className="mt-1 text-xs text-gray-600">
                    신고당한 회원: <b className="text-gray-900">{r.target.name}</b> ({chatRoleTag(r.target.role)}{r.target.deleted ? ' · 탈퇴' : ''} · {r.target.email})
                    {r.target.openReports > 1 && <span className="ml-1 font-medium text-accent">처리 안 한 신고 {r.target.openReports}건</span>}
                    {' · '}신고한 회원: {r.reporter.name}
                    {' · '}{r.snapshot.kind === 'GROUP' ? `단체 대화 「${r.snapshot.title ?? ''}」` : '1:1 대화'}
                    {r.messageId ? '' : ' · 사람 신고'}
                    {!r.target.deleted && (
                      <>
                        {' · '}
                        <Link
                          to={`/mypage?tab=user-manage&role=${encodeURIComponent(r.target.role)}&q=${encodeURIComponent(r.target.email)}`}
                          className="text-gray-900 underline underline-offset-2"
                        >
                          사용자 관리에서 보기
                        </Link>
                      </>
                    )}
                  </p>
                  {r.detail && <p className="mt-1 whitespace-pre-line text-sm text-gray-700 [overflow-wrap:anywhere]">“{r.detail}”</p>}
                  <ol className="mt-2 space-y-1 rounded-lg bg-gray-50 p-3 text-[13px]">
                    {r.snapshot.lines.map((l) => (
                      <li key={l.id} className={l.target ? 'font-medium text-gray-900' : 'text-gray-600'}>
                        <span className="text-gray-500">{bubbleTime(l.createdAt)}</span>{' '}
                        <span className={l.senderId === r.target.id ? 'text-accent' : ''}>{l.senderName}</span>:{' '}
                        <span className="whitespace-pre-line [overflow-wrap:anywhere]">{l.content}</span>
                        {l.target && <span className="ml-1 text-xs text-accent">← 신고한 메시지</span>}
                      </li>
                    ))}
                    {r.snapshot.lines.length === 0 && <li className="text-gray-500">대화가 없어요.</li>}
                  </ol>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {r.status === 'OPEN' ? (
                      <>
                        <button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, status: 'DISMISSED' })}
                          className="h-9 rounded-lg border border-gray-300 px-3 text-sm text-gray-900 hover:bg-gray-50">문제없음</button>
                        <button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, status: 'DONE' })}
                          className="h-9 rounded-lg bg-gray-900 px-3 text-sm text-white hover:bg-gray-800">처리함</button>
                      </>
                    ) : (
                      <button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, status: 'OPEN' })}
                        className="h-9 px-1 text-sm text-gray-600 underline underline-offset-4 hover:text-gray-900">확인할 것으로 되돌리기</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
    </section>
  );
}
