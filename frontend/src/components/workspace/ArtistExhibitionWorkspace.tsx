/**
 * 작가의 전시 한 건 화면 — 마이페이지 [내 전시] 에서 전시를 누르면 본문 전체 (2026-11-20, 규칙 88).
 * 주소 `?tab=applications&ex=<공모 id>` — 알림 링크(`artistExhibitionLink`)·초대 코드 참여·공모 상세 [내 전시에서 보기]가 같은 주소다.
 *
 *   ← 내 전시
 *   [포스터] 상태 · 보조 / 제목 / 갤러리
 *   진행 띠  지원 · 전시 준비 · 전시 · 정산 · 마무리     (휴대폰은 띠 아래 지금 칸의 기한 한 줄 — 빨강)
 *   탭       출품 자료 · 정산 · 공지 · 내 지원서
 *
 * 예전엔 [내 전시] 카드 안에서 [전시 관리]를 눌러 구역 셋(공지 · 출품 자료 · 정산 확인)을 접었다 폈다 했다(옛 `ArtistOperationPanel`).
 * 판단은 그대로 옮겼다 — 지금 할 일이 있는 탭부터 연다(`artistDefaultView`) · 정산은 전시가 끝나야 열린다 · 공모만 진행이면 공지·지원서뿐.
 * 심사 중·미선정은 탭 없이 내가 낸 지원서만. 심사 중이고 모집이 열려 있으면 [지원서 수정]·[지원 취소](2026-11-21, 규칙 90 — lib/applicationWindow.ts).
 * ⚠️ 한 번 연 탭은 떼지 않고 숨긴다 — 출품 자료를 쓰다가 [공지]를 봐도 입력이 남는다.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { hasAuthStash, stashKeys } from '@/lib/authStash';
import { cn } from '@/lib/utils';
import { stageOf, flowStrip, artistDefaultView, artistNextTask, artistPendingText, artistSubText, applicationStatusView, type ArtistView, type ArtistSnapshot } from '@/lib/flowLabels';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { confirmDiscardUnsaved } from '@/hooks/useUnsavedChanges';
import FlowStrip from '@/components/flow/FlowStrip';
import Notice from '@/components/flow/Notice';
import PageTabBar from '@/components/shared/PageTabBar';
import Thumb from '@/components/shared/Thumb';
import HostBadge from '@/components/shared/HostBadge';
import ApplicationContent from '@/components/shared/ApplicationContent';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { canChangeApplication } from '@/lib/applicationWindow';
import { shortDate } from '@/lib/listings';
import { NoticesSection, MySubmissionSection, MyArtistSettlementSection } from '@/pages/OperationPage';
import type { OperationAccess } from '@/types';

export default function ArtistExhibitionWorkspace({ exhibitionId, initialView = null, onClose }: {
  exhibitionId: number;
  initialView?: ArtistView | null;
  onClose: () => void;
}) {
  const id = String(exhibitionId);
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const wide = useMediaQuery('(min-width: 1024px)');

  // 열 때마다 새로 — 알림(전시 확정·정산 요청)을 눌러 들어오면 5분 캐시의 옛 단계가 머리에 남았다(2026-11-20 앱 확인)
  const { data: apps = [], isLoading } = useQuery<any[]>({
    queryKey: ['my-applications'],
    queryFn: () => api.get('/exhibitions/my-applications').then(r => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const app = apps.find((a: any) => a.exhibitionId === exhibitionId) ?? null;
  const accepted = app?.status === 'ACCEPTED';
  const ex = app?.exhibition ?? {};
  const recruitOnly = !!ex.recruitOnly;
  // 지원서를 고치거나 취소할 수 있나 — 검토 대기 · 모집이 열려 있을 때만(서버와 같은 규칙, lib/applicationWindow.ts)
  const changeable = canChangeApplication(app, ex);

  // 잠금·종료는 운영 권한 응답이 정확하다(시작일 경과 자동 확정 — 서버 computeConfirmed). 목록 응답의 confirmed 는 수동 확정 값이다
  const { data: access } = useQuery<OperationAccess>({
    queryKey: ['operation-access', id],
    queryFn: () => api.get(`/operations/${id}/access`).then(r => r.data),
    enabled: accepted,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const { data: notices = [] } = useQuery<unknown[]>({
    queryKey: ['operation-notices', id],
    queryFn: () => api.get(`/operations/${id}/notices`).then(r => r.data),
    enabled: accepted,
  });

  const ended = !!(access?.ended ?? ex.ended);
  const snapshot: ArtistSnapshot = {
    status: app?.status ?? 'SUBMITTED',
    recruitOnly,
    confirmed: !!(access?.confirmed ?? ex.confirmed),
    ended,
    settled: !!ex.settledAt,
    settlementRequested: !!ex.settlementRequestedAt,
    submissionComplete: !!app?.submissionComplete,
    submissionDeadline: ex.submissionDeadline,
    exhibitStartDate: ex.exhibitStartDate,
    mySettlementStatus: app?.mySettlementStatus ?? null,
    // 심사 중 안내 — '○○까지 선정 결과가 나와요'(규칙 90)
    recruitmentClosed: !!(access?.recruitmentClosed ?? ex.recruitmentClosed),
    deadline: ex.deadline,
    selectionDeadline: ex.selectionDeadline ?? null,
  };
  // 단계 판단은 운영 권한 응답을 먼저 믿는다(시작일 경과 자동 확정 · 방금 바뀐 종료) — 목록 응답보다 새롭다
  const live = access ? { ...ex, confirmed: access.confirmed, ended: access.ended, recruitmentClosed: access.recruitmentClosed, settledAt: access.settledAt ?? ex.settledAt, settlementRequestedAt: access.settlementRequestedAt ?? ex.settlementRequestedAt } : ex;
  const stage = accepted ? stageOf(live) : null;
  const statusLabel = accepted ? (stage?.label ?? '선정') : applicationStatusView(app?.status, 'artist').label;
  const sub = app ? artistSubText({
    stageKey: stage?.key ?? null,
    applicationStatus: app.status,
    appliedAt: app.createdAt,
    submissionComplete: !!app.submissionComplete,
    mySettlementStatus: app.mySettlementStatus,
    deadline: ex.deadline, submissionDeadline: ex.submissionDeadline, exhibitStartDate: ex.exhibitStartDate, exhibitDate: ex.exhibitDate,
    settledAt: ex.settledAt, settlementRequestedAt: ex.settlementRequestedAt,
  }) : null;
  const strip = flowStrip('artist', {
    ...live,
    applicationStatus: app?.status,
    submissionComplete: !!app?.submissionComplete,
    mySettlementStatus: app?.mySettlementStatus ?? null,
  });
  const task = app ? artistNextTask(snapshot) : null;
  // 휴대폰 — 띠 아래 지금 칸의 기한 한 줄(휴대폰 띠는 이름만 그린다). 3일 안이거나 지났으면 빨강
  const noteCell = strip.find(c => c.state === 'current' && c.note) ?? null;

  // 탭
  const [view, setView] = useState<ArtistView | null>(initialView);
  /*
    같은 주소로 다시 들어오면(이 전시 화면을 보는 중에 이 전시의 알림 — 전시 확정·정산 요청 — 을 눌렀다) 새로 받고,
    받은 뒤의 단계로 탭을 다시 정한다(2026-11-20 신뢰성 점검 S5). 주소가 같아 화면이 다시 뜨지 않아서, 예전엔 확정 알림을 눌러도
    고칠 수 있는 옛 편집 화면이 그대로였고 [갤러리에 제출]을 누르고서야 403 을 받았다.
  */
  const location = useLocation();
  const [seenKey, setSeenKey] = useState(location.key);
  const [refreshing, setRefreshing] = useState(false);
  if (seenKey !== location.key) {
    setSeenKey(location.key);
    setView(initialView);
    setRefreshing(true);
  }
  const firstKey = useRef(location.key);
  useEffect(() => {
    if (location.key === firstKey.current) return;
    let alive = true;
    const keys = [['my-applications'], ['operation-access', id], ['operation-me', id], ['operation-my-settlement', id], ['operation-notices', id]];
    void Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey }))).finally(() => { if (alive) setRefreshing(false); });
    return () => { alive = false; };
  }, [location.key, id, qc]);
  // 로그인이 풀리기 전에 쓰던 출품 자료가 이 기기에 남아 있으면 그 탭부터(편집기가 되살린다 — lib/authStash)
  if (app && view === null && !refreshing) {
    setView(!recruitOnly && !live.confirmed && hasAuthStash(user?.id, stashKeys.submission(id, user?.id ?? 0)) ? 'submissions' : artistDefaultView(snapshot));
  }
  // 열 수 없는 탭은 고르지 않는다(WS-02 — 전시가 끝나기 전의 정산 · 공모만 진행의 출품 자료)
  const openable = (v: ArtistView) => v === 'settlement' ? !recruitOnly && ended : v === 'submissions' ? !recruitOnly : true;
  const current: ArtistView = !accepted ? 'application' : (view && openable(view) ? view : artistDefaultView(snapshot));
  const [visited, setVisited] = useState<ArtistView[]>([]);
  if (app && !visited.includes(current)) setVisited([...visited, current]);

  useLayoutEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [exhibitionId]);

  // 미선정 '확인' — 누르면 목록에서 사라지고 목록으로 돌아간다(예전 카드의 [확인])
  const ackMutation = useMutation({
    mutationFn: (appId: number) => api.post(`/exhibitions/applications/${appId}/acknowledge-rejection`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-applications'] }); onClose(); },
    onError: (e: any) => toast.error(e.response?.data?.error || '처리에 실패했습니다.'),
    onSettled: () => { acking.current = false; },
  });
  // 연타 — disabled(isPending)는 한 박자 늦게 켜져 두 번 톡 치면 요청이 두 번 갔다(S12 와 같은 모양, e2e 90 ART-03)
  const acking = useRef(false);
  const ack = (appId: number) => { if (acking.current) return; acking.current = true; ackMutation.mutate(appId); };

  /*
    지원 취소(2026-11-21, 규칙 90) — 검토 대기 · 모집 중에만. 지우면 이 화면이 비므로 **먼저** 공고 상세로 옮기고(다시 지원할 수 있는 곳),
    그 뒤에 목록을 다시 받는다 — 순서가 바뀌면 이 화면이 '찾지 못했어요'를 띄운 채 떠난다.
  */
  const navigate = useNavigate();
  const [cancelOpen, setCancelOpen] = useState(false);
  const cancelMutation = useMutation({
    mutationFn: () => api.delete(`/exhibitions/${exhibitionId}/my-application`),
    onSuccess: () => {
      navigate(`/exhibitions/${exhibitionId}`, { replace: true });
      toast.success('지원을 취소했어요.');
      for (const queryKey of [['my-applications'], ['exhibition', id], ['exhibitions']]) qc.invalidateQueries({ queryKey });
    },
    onError: (e: { response?: { data?: { error?: string } } }) => { toast.error(e.response?.data?.error || '취소하지 못했어요.'); qc.invalidateQueries({ queryKey: ['my-applications'] }); },
  });

  // 알림으로 들어왔는데 지원이 없다(지원을 지웠거나 다른 계정) — 빈 화면 대신 돌아갈 길
  const missing = !isLoading && !app && !cancelMutation.isSuccess;
  useEffect(() => { if (missing) toast.error('이 전시를 찾지 못했어요.'); }, [missing]);

  const back = (
    <button type="button" onClick={() => { if (confirmDiscardUnsaved()) onClose(); }} className="-ml-1 inline-flex min-h-[44px] items-center gap-1.5 px-1 text-sm text-gray-600 hover:text-gray-950">
      <ArrowLeft size={16} aria-hidden /> 내 전시
    </button>
  );
  if (isLoading) return <div><div className="h-64 animate-pulse rounded-xl bg-gray-100" /></div>;
  if (!app) return <div>{back}<p className="py-16 text-center text-sm text-gray-500">이 전시를 찾지 못했어요.</p></div>;

  const tabs = recruitOnly
    ? [{ id: 'notices' as const, label: '공지', count: notices.length || undefined }, { id: 'application' as const, label: '내 지원서' }]
    : [
      { id: 'submissions' as const, label: '출품 자료' },
      { id: 'settlement' as const, label: '정산', disabled: !ended, hint: '전시가 끝나면 열려요' },
      { id: 'notices' as const, label: '공지', count: notices.length || undefined },
      { id: 'application' as const, label: '내 지원서' },
    ];
  const panel = (v: ArtistView, node: ReactNode) => (visited.includes(v)
    ? <div key={v} role="tabpanel" id={`aw-${id}-panel-${v}`} aria-labelledby={`aw-${id}-tab-${v}`} hidden={current !== v}>{node}</div>
    : null);
  const galleryId = ex.gallery?.id ?? null;

  return (
    <div data-artist-workspace={exhibitionId}>
      {back}
      <header className="mt-2 flex items-start gap-4 sm:gap-5">
        <Link to={`/exhibitions/${id}`} tabIndex={-1} aria-hidden className="block h-[79px] w-14 shrink-0 bg-gray-50 sm:h-[102px] sm:w-[72px]">
          {ex.imageUrl && <Thumb src={ex.imageUrl} alt="" className="h-full w-full object-contain" />}
        </Link>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-gray-600">
            <strong className="font-bold text-gray-950">{statusLabel}</strong>
            {sub && <span className="tabular-nums">{sub}</span>}
            <HostBadge exhibition={ex} />
          </p>
          <h1 className="mt-1 break-keep text-[19px] font-semibold leading-snug tracking-tight text-gray-950 [overflow-wrap:anywhere] sm:text-2xl">{ex.title}</h1>
          <p className="mt-1 text-[13px] text-gray-500 sm:text-sm">
            {ex.gallery?.name || '아트링크'}
            <span className="mx-1.5 text-gray-300">·</span>
            <Link to={`/exhibitions/${id}`} className="underline-offset-4 hover:text-gray-900 hover:underline">공고 보기</Link>
          </p>
        </div>
      </header>

      <FlowStrip cells={strip} variant={wide ? 'full' : 'bar'} className="mt-5" />
      {!wide && noteCell && <p className={cn('mt-2.5 text-sm font-semibold', noteCell.hot ? 'text-accent' : 'text-gray-700')}>{noteCell.key === 'prepare' ? `출품 자료 ${noteCell.note}` : noteCell.note}</p>}

      {/* 심사 중 · 미선정 — 탭 없이 한 줄 + 내가 낸 지원서. 심사 중이고 모집이 열려 있으면 고치기·취소(규칙 90) */}
      {!accepted && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-y border-gray-200 py-3.5">
          <p className="text-[15px] text-gray-700">
            {app.status === 'REJECTED' ? '이번 공모에서는 선정되지 않았어요.' : artistPendingText(snapshot)}
          </p>
          {app.status === 'REJECTED' && (
            <button type="button" onClick={() => ack(app.id)} disabled={ackMutation.isPending} className="min-h-[44px] rounded-lg border border-gray-300 px-4 text-sm text-gray-900 hover:bg-gray-50 disabled:opacity-50">
              확인하고 목록에서 지우기
            </button>
          )}
          {changeable && (
            <div data-application-actions className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 sm:w-auto">
              <span className="order-last w-full text-[13px] text-gray-500 sm:order-none sm:mr-2 sm:w-auto">접수 마감 {shortDate(ex.deadline)}까지</span>
              <Link to={`/exhibitions/${exhibitionId}/apply/edit`} state={{ fromWorkspace: true }} className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-900 hover:bg-gray-50 sm:flex-none">
                지원서 수정
              </Link>
              <button type="button" onClick={() => setCancelOpen(true)} disabled={cancelMutation.isPending} className="min-h-[44px] px-3 text-sm text-gray-500 underline underline-offset-4 hover:text-gray-900 disabled:opacity-50">
                지원 취소
              </button>
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={cancelOpen}
        title="지원을 취소할까요?"
        details={[
          '갤러리 지원자 목록에서 빠지고, 낸 지원서는 지워져요.',
          '갤러리에 지원을 취소했다는 알림이 가요.',
          ...(ex.deadline ? [`${shortDate(ex.deadline)} 접수 마감 전이면 다시 지원할 수 있어요.`] : []),
        ]}
        cancelText="그대로 두기"
        confirmText="지원 취소"
        variant="danger"
        onConfirm={() => { setCancelOpen(false); cancelMutation.mutate(); }}
        onCancel={() => setCancelOpen(false)}
      />
      {accepted && task && wide && (
        <p className={cn('mt-4 text-[15px]', task.tone === 'attention' ? 'font-medium text-gray-950' : 'text-gray-600')}>
          <span aria-hidden className={cn('mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle', task.tone === 'attention' ? 'bg-accent' : 'bg-gray-400')} />
          {task.text}
        </p>
      )}

      {accepted ? (
        <>
          <div className="mt-3">
            <PageTabBar<ArtistView>
              sticky={false}
              idPrefix={`aw-${id}`}
              label="전시"
              active={current}
              onSelect={setView}
              tabs={tabs}
            />
          </div>
          <div className="pt-2">
            {/* 공모만 진행 — 여기까지가 끝이라고 말해 준다(아무 말 없이 탭만 사라지면 "자료를 언제 내나" 하고 기다린다) */}
            {recruitOnly && (
              <Notice className="my-4">
                공모만 진행하는 공고예요. <b className="font-medium text-gray-900">선정으로 절차가 끝났고</b>, 출품 자료·전시·정산 단계는 없어요.
              </Notice>
            )}
            {!recruitOnly && panel('submissions', (
              <MySubmissionSection
                exhibitionId={id}
                myUserId={user!.id}
                confirmed={!!(access?.confirmed ?? ex.confirmed)}
                ended={ended}
                manualConfirmed={!!access?.manualConfirmed}
                submissionDeadline={ex.submissionDeadline ?? null}
              />
            ))}
            {!recruitOnly && ended && panel('settlement', (
              <>
                <MyArtistSettlementSection exhibitionId={id} />
                {/* D6 — 정산까지 끝났으면 갤러리 리뷰를 남길 자리로 */}
                {ex.settledAt && galleryId && (
                  <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-5">
                    <p className="text-sm text-gray-600">이 갤러리와의 전시는 어땠나요?</p>
                    <Link to={`/galleries/${galleryId}?tab=reviews`} className="inline-flex min-h-[44px] items-center rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-900 hover:bg-gray-50">갤러리 리뷰 쓰기</Link>
                  </div>
                )}
              </>
            ))}
            {panel('notices', <NoticesSection exhibitionId={id} canManage={false} />)}
            {panel('application', <div className="py-4"><ApplicationContent app={app} customFields={ex.customFields} /></div>)}
          </div>
        </>
      ) : (
        <div className="pt-6">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-sm font-semibold text-gray-950">내가 낸 지원서</h2>
            <span className="text-[12.5px] tabular-nums text-gray-500">{shortDate(app.createdAt)} 제출{app.editedAt ? ` · ${shortDate(app.editedAt)} 수정` : ''}</span>
          </div>
          <ApplicationContent app={app} customFields={ex.customFields} />
        </div>
      )}
    </div>
  );
}
