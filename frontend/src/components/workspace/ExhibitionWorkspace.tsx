/**
 * 공모 한 건 화면 — 갤러리·관리자 (2026-11-20 공모 흐름 개편, CLAUDE.md 규칙 88)
 *
 * 예전엔 [내 공모] 카드 안에서 [지원자]/[운영] 탭이 펼쳐지고, [운영] 안에 다시 구역(공지 · 출품 자료 · 정산)이 접혀 있었다 —
 * 정산 중인 카드 하나가 PC 1,905px · 휴대폰 2,485px, 같은 문장이 세 번, 주 버튼 자리가 단계마다 달랐다(scratchpad/flow-review-2026-11/PLAN.md).
 * 지금은 공모를 누르면 **이 화면이 마이페이지 본문 전체**를 쓴다(주소 `?tab=my-exhibitions&ex=<id>` — 갤러리 · 관리자는 운영 주소에서):
 *
 *   ← 내 공모
 *   [포스터] 상태 · 제목 · 갤러리/유형/지역 ··········· [공고 보기] [⋯]
 *   진행 띠  모집 · 전시 준비 · 전시 · 정산 · 마무리        (lib/flowLabels.ts flowStrip)
 *   할 일 줄 ● 지금 할 일 한 문장 ·········· [보조] [주 버튼]   (휴대폰은 버튼이 하단 고정 줄로)
 *   탭       (요약) · 지원자 · 출품 자료 · 정산 · 공지         (처음 열 탭은 단계 — workspaceDefaultView)
 *
 * ⚠️ 주 버튼은 **한 자리**다 — PC 는 할 일 줄 오른쪽, 휴대폰은 하단 고정 줄(탭바 위). 둘 다 그리지 않는다(useMediaQuery).
 * ⚠️ 한 번 연 탭은 떼지 않고 숨긴다 — 정산 판매가를 적다가 [지원자]를 눌렀다 와도 입력이 남는다(2026-10-03 P1-2 와 같은 규칙).
 * ⚠️ 정산 단계의 할 일 줄은 정산 컨트롤러가 정한다(저장 안 된 입력 · 이의 · 모두 확인) — `useSettlementController`.
 * ⚠️ 단계 전환(모집 마감 · 전시 확정 · 전시 종료)은 `hooks/useLifecycle` 의 확인창을 거친다(규칙 59).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MoreHorizontal } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { authStashKeys, hasAuthStash, stashKeys } from '@/lib/authStash';
import { cn, getDday, regionLabels, exhibitionTypeLabels } from '@/lib/utils';
import { stageOf, recruitmentOver, galleryNextTask, flowStrip, gallerySubText, workspaceDefaultView, type WorkspaceView, type TaskActionId, type TaskAction } from '@/lib/flowLabels';
import { operatorWorkspace } from '@/lib/operationLinks';
import { hasContent, hasNoteContent } from '@/lib/submissionChecklist';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useLifecycle } from '@/hooks/useLifecycle';
import { confirmDiscardUnsaved } from '@/hooks/useUnsavedChanges';
import { checkDeletable, useMyDeleteRequests } from '@/hooks/useDeleteRequests';
import FlowStrip from '@/components/flow/FlowStrip';
import TaskBar, { TaskButton } from '@/components/flow/TaskBar';
import Notice from '@/components/flow/Notice';
import MenuButton, { type MenuItem } from '@/components/flow/MenuButton';
import PageTabBar from '@/components/shared/PageTabBar';
import Thumb from '@/components/shared/Thumb';
import HostBadge from '@/components/shared/HostBadge';
import ApplicantManager from '@/components/shared/ApplicantManager';
import CustomQuestionsEditModal from '@/components/shared/CustomQuestionsEditor';
import DeleteConfirmModal from '@/components/shared/DeleteConfirmModal';
import { DeleteRequestDialog, DeleteRequestLine } from '@/components/shared/DeleteRequest';
import SettlementSection from '@/components/operation/SettlementSection';
import { useSettlementController } from '@/components/operation/settlementController';
import WorkspaceSummary from '@/components/workspace/WorkspaceSummary';
import { NoticesSection, AdminSubmissionsSection, SubmissionRemindDialog } from '@/pages/OperationPage';
import type { CustomField, Exhibition, OperationAccess, OperationSubmission } from '@/types';

type Detail = Exhibition & { rejectReason?: string | null; submissionDeadline?: string | null; settledAt?: string | null; confirmed?: boolean };

export default function ExhibitionWorkspace({ exhibitionId, standalone = false, initialView = null, initialAct = null, onClose, backLabel = '내 공모', extraMenu = [] }: {
  exhibitionId: number;
  /** 관리자 운영 주소(`/exhibitions/:id/operation/new`)에서 — 돌아갈 곳은 operatorWorkspace 가 정한다 */
  standalone?: boolean;
  /** 처음 열 탭(주소의 view= · 목록 버튼) — 없으면 단계 */
  initialView?: WorkspaceView | null;
  /** 목록 버튼으로 왔을 때 도착하자마자 열 것(확인창 · 메시지 창) */
  initialAct?: TaskActionId | null;
  /** 갤러리 [내 공모] 안 — [← 내 공모] */
  onClose?: () => void;
  /** 마이페이지 안 돌아가기 글자 — 관리자 [주최 공모]는 '주최 공모'(2026-11-21) */
  backLabel?: string;
  /** [⋯] 에 더할 것 — 관리자 [주최 공모]의 제목·소개 수정 · 운영 갤러리 변경 */
  extraMenu?: MenuItem[];
}) {
  const id = String(exhibitionId);
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const wide = useMediaQuery('(min-width: 1024px)');
  const tableWide = useMediaQuery('(min-width: 1024px)');

  // 열 때마다 새로 — 알림을 눌러 들어오면(작가가 냈다·확인했다) 5분 캐시의 옛 상태가 할 일 줄에 남는다
  const { data: access, isLoading: accessLoading, error: accessError } = useQuery<OperationAccess>({
    queryKey: ['operation-access', id],
    queryFn: () => api.get(`/operations/${id}/access`).then(r => r.data),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const { data: detail, isLoading: detailLoading } = useQuery<Detail>({
    queryKey: ['exhibition', id],
    queryFn: () => api.get(`/exhibitions/${id}`).then(r => r.data),
    staleTime: 30_000,
  });
  const canManage = !!access && (access.isOwner || access.isAdmin);
  const approved = detail?.status === 'APPROVED';
  const recruitOnly = !!(access?.recruitOnly ?? detail?.recruitOnly);

  const { data: applicants = [], isFetched: applicantsFetched, isError: applicantsFailed } = useQuery<{ status: string }[]>({
    queryKey: ['exhibition-applicants', exhibitionId],
    queryFn: () => api.get(`/exhibitions/${exhibitionId}/applications`).then(r => r.data),
    enabled: canManage && approved,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const { data: submissions = [], isFetched: submissionsFetched, isError: submissionsFailed } = useQuery<{ user: any; guest?: boolean; submission: OperationSubmission }[]>({
    queryKey: ['operation-submissions', id],
    queryFn: () => api.get(`/operations/${id}/submissions`).then(r => r.data),
    enabled: canManage && approved && !recruitOnly,
    staleTime: 0,
  });
  const { data: notices = [] } = useQuery<unknown[]>({
    queryKey: ['operation-notices', id],
    queryFn: () => api.get(`/operations/${id}/notices`).then(r => r.data),
    enabled: canManage && approved,
  });
  const ctl = useSettlementController(id, { isAdmin: !!access?.isAdmin, enabled: canManage && approved && !recruitOnly && !!access?.ended });

  // ── 숫자 ──
  const pending = applicants.filter(a => a.status === 'SUBMITTED' || a.status === 'REVIEWED').length;
  const accepted = applicants.filter(a => a.status === 'ACCEPTED').length;
  const isComplete = ({ submission }: { submission: OperationSubmission }) => (submission.artworkList?.length || 0) > 0 && hasContent(submission.cv) && hasNoteContent(submission.note);
  const completeSubs = submissions.filter(isComplete).length;
  // 비회원 작가(규칙 91) — 출품 자료 칸(2/3)엔 들지만 안내는 회원만 받는다, 정산 확인도 회원만
  const memberSubs = submissions.filter(r => !r.guest);
  const guestSubs = submissions.filter(r => !!r.guest);
  const incomplete = memberSubs.filter(r => !isComplete(r)).length;
  const guestIncomplete = guestSubs.filter(r => !isComplete(r)).length;
  const settleArtists = (ctl.data?.artists ?? []).filter(a => !a.guest);
  const approvals = {
    total: settleArtists.length,
    approved: settleArtists.filter(a => a.approval?.status === 'APPROVED').length,
    issue: settleArtists.filter(a => a.approval?.status === 'ISSUE').length,
  };
  const settled = !!access?.settled;
  // 자동 정리(전시 종료 20일 · 정산 시작 안 함) — 서버 lib/exhibitionLifecycle.ts 와 같은 판정
  const closed = settled || (!!access?.exhibitDate && !!access.autoCloseDays && -getDday(access.exhibitDate) >= access.autoCloseDays && !access.settlementStarted);
  const stageInput = {
    ...(detail ?? {}),
    status: detail?.status,
    recruitOnly,
    recruitmentClosed: access?.recruitmentClosed ?? detail?.recruitmentClosed,
    confirmed: access?.confirmed,
    ended: access?.ended,
    settledAt: access?.settledAt ?? (settled ? 'y' : null),
    settlementRequestedAt: access?.settlementRequestedAt ?? null,
    settlementStarted: !!access?.settlementStarted,
    closed,
    exhibitStartDate: detail?.exhibitStartDate ?? null,
    // 접수 마감일이 지나면 [모집 마감]을 안 눌러도 선정이다(규칙 90)
    deadline: detail?.deadline ?? access?.deadline ?? null,
    // 공모만 진행하는 공고가 마감 뒤 '선정 중'인지 가른다(규칙 90)
    pending,
  };
  const selectionDeadline = access?.selectionDeadline ?? detail?.selectionDeadline ?? null;
  const over = recruitmentOver(stageInput);
  const stage = stageOf(stageInput);
  const task = galleryNextTask({
    status: detail?.status ?? 'APPROVED',
    recruitOnly,
    recruitmentClosed: !!access?.recruitmentClosed,
    confirmed: !!access?.manualConfirmed,
    ended: !!access?.ended,
    settled,
    settlementRequested: !!access?.settlementRequested,
    deadline: detail?.deadline,
    selectionDeadline,
    exhibitStartDate: detail?.exhibitStartDate,
    exhibitDate: detail?.exhibitDate ?? access?.exhibitDate,
    pending,
    accepted: applicants.length ? accepted : memberSubs.length,
    capacity: detail?.capacity ?? null,
    capacityMask: detail?.capacityMask ?? null,
    submissionsIncomplete: incomplete,
    guests: guestSubs.length,
    guestIncomplete,
    sales: ctl.grand.soldCount,
    approvals,
  });
  const strip = flowStrip('gallery', {
    ...stageInput,
    deadline: detail?.deadline,
    submissionDeadline: detail?.submissionDeadline,
    selectionDeadline,
    exhibitDate: detail?.exhibitDate ?? access?.exhibitDate,
    accepted, pending,
    capacity: detail?.capacity ?? null, capacityMask: detail?.capacityMask ?? null,
    submissionsComplete: completeSubs, submissionsRequired: submissions.length,
    sales: ctl.grand.soldCount, approvals,
  });

  const lifecycle = useLifecycle({
    exhibitionId: id,
    access,
    exhibitStartDate: detail?.exhibitStartDate ?? null,
    incompleteArtists: incomplete + guestIncomplete,
    pendingApplicants: pending,
    acceptedApplicants: accepted,
    capacity: detail?.capacity ?? null,
    onChanged: (kind) => {
      // 마감하면 선정이 시작된다(규칙 90) — 지원자 탭으로
      if (kind === 'close' || kind === 'finish') goView('applicants');
      else if (kind === 'confirm') goView('submissions');
      else if (kind === 'end') goView('settlement');
    },
  });

  // ── 탭 ──
  const defaultView = workspaceDefaultView(stage?.key, recruitOnly, pending);
  const [view, setView] = useState<WorkspaceView | null>(initialView);
  /** 같은 주소로 다시 들어와 새로 받는 중 — 그동안은 옛 단계로 기본 탭을 정하지 않는다(아래 location.key) */
  const [refreshing, setRefreshing] = useState(false);
  const ready = !!access && !!detail;
  /** 로그인이 풀리기 전에 쓰던 정산·대신 입력이 이 기기에 남아 있으면 그 탭부터(그 화면이 되살린다 — lib/authStash) */
  const stashView = (): WorkspaceView | null => {
    if (!recruitOnly && access?.ended && !access?.settled && hasAuthStash(user?.id, stashKeys.settlement(id))) return 'settlement';
    if (!recruitOnly && authStashKeys(user?.id, stashKeys.submissionPrefix(id)).length) return 'submissions';
    return null;
  };
  /*
    전시 준비(마감 뒤)는 결정을 기다리는 지원이 있으면 [지원자], 없으면 [출품 자료]로 연다(규칙 90 — 선정이 먼저).
    지원자 목록이 오기 전에 정하면 0명으로 보고 [출품 자료]를 연 채 굳는다 — 목록을 받은 뒤에(실패해도) 정한다.
  */
  const viewReady = ready && (stage?.key !== 'preparing' || applicantsFetched || applicantsFailed || !canManage);
  if (viewReady && approved && view === null && !refreshing) setView(stashView() ?? defaultView);
  /*
    열 수 없는 탭을 고르지 않는다(2026-11-20 신뢰성 점검 WS-02). 전시가 끝나기 전 `view=settlement`(옛 알림·북마크)로 오면
    잠긴 정산 탭이 선택된 채 받지 않는 데이터를 기다려 '불러오는 중' 모양으로 영원히 남았다. 그럴 땐 단계 기본 탭.
  */
  const openable = (v: WorkspaceView) => v === 'summary' ? !!access?.settled
    : v === 'settlement' ? !recruitOnly && !!access?.ended
      : v === 'submissions' ? !recruitOnly
        : true;
  const current: WorkspaceView = view && (!access || openable(view)) ? view : defaultView;
  const [visited, setVisited] = useState<WorkspaceView[]>([]);
  if (ready && approved && !visited.includes(current)) setVisited([...visited, current]);
  const goView = (v: WorkspaceView) => setView(v);
  // [정산 완료] 를 누르면 그 자리에서 [요약] 탭으로 — 끝났다는 것과 다음에 할 일을 보여 준다(계획 WP7). 렌더 중 상태 맞추기
  const [wasSettled, setWasSettled] = useState<boolean | null>(null);
  if (access && wasSettled !== !!access.settled) {
    if (wasSettled === false && access.settled) setView('summary');
    setWasSettled(!!access.settled);
  }
  /** 지원자 탭에서 고른 지원자 수 — 휴대폰은 하단 줄이 일괄 수락·거절 줄로 바뀐다 */
  const [selecting, setSelecting] = useState(0);

  // 들어오면 맨 위에서 시작한다(같은 /mypage 주소라 ScrollToTop 이 안 움직인다)
  useLayoutEffect(() => { if (!standalone) window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [standalone, exhibitionId]);

  // ── 안내 메시지 · 질문 수정 · 삭제 ──
  const [remindOpen, setRemindOpen] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [requestBlocked, setRequestBlocked] = useState<string | null>(null);
  const deleteRequestOf = useMyDeleteRequests();
  const deleteRequest = deleteRequestOf('exhibition', exhibitionId);
  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/exhibitions/${exhibitionId}`),
    onSuccess: () => {
      for (const queryKey of [['my-exhibitions'], ['my-operation-overview'], ['exhibitions']]) qc.invalidateQueries({ queryKey });
      toast.success('공모가 삭제되었습니다.');
      setDeleteOpen(false);
      onClose?.();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '삭제 실패'),
  });
  const askDelete = async () => {
    try {
      const blocked = await checkDeletable('exhibition', exhibitionId);
      if (blocked) setRequestBlocked(blocked); else setDeleteOpen(true);
    } catch (e: any) { toast.error(e.response?.data?.error || '삭제할 수 있는지 확인하지 못했어요.'); }
  };

  // ── 할 일 줄의 버튼 ──
  const runAct = (actId: TaskActionId) => {
    if (actId === 'close' || actId === 'confirm' || actId === 'end') lifecycle.ask(actId);
    else if (actId === 'finish-selection') lifecycle.ask('finish');
    else if (actId === 'remind-submissions') setRemindOpen(true);
    else if (actId === 'complete-settlement') { goView('settlement'); ctl.openComplete(); }
    else if (actId === 'remind-settlement') ctl.openRemind();
  };
  const inSettlement = !!access?.ended && !recruitOnly && approved;
  /*
    할 일은 숫자가 다 온 뒤에 말한다(2026-11-20 신뢰성 점검 REL-13). 지원자·출품 자료를 받기 전엔 0명으로 계산돼
    '수락한 작가가 없어요. 지원자를 수락해 주세요.' 가 잠깐 보였다가 바뀌었다 — 틀린 지시가 번쩍이면 누를 수도 있다.
  */
  // 받기에 실패했으면 0명으로 계산한 할 일을 말하지 않는다 — 이유만 말한다(REL-04)
  const countsFailed = applicantsFailed || submissionsFailed || (inSettlement && ctl.failed);
  const countsReady = !canManage || !approved || countsFailed
    || ((applicantsFetched || !canManage) && (recruitOnly || submissionsFetched) && (!inSettlement || ctl.ready));
  const barText: ReactNode = countsFailed ? '목록을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.'
    : !countsReady ? '' : inSettlement && ctl.task ? ctl.task.text
      // 선정 중이면 아래 작은 한 줄 — '그날이 지나면 수락하지 않은 지원자는 미선정이 돼요'(규칙 90)
      : task.note ? <>{task.text}<span className="mt-0.5 block text-[13.5px] font-normal text-gray-500">{task.note}</span></> : task.text;
  const barTone = inSettlement && ctl.task ? ctl.task.tone : task.tone;
  const actionButton = (a: TaskAction, kind: 'primary' | 'secondary') => (
    <TaskButton key={a.id} kind={kind} onClick={() => runAct(a.id)} busy={lifecycle.busy && (a.id === 'close' || a.id === 'finish-selection' || a.id === 'confirm' || a.id === 'end')}>{a.label}</TaskButton>
  );
  const buttons: ReactNode[] = [];
  if (countsReady && !countsFailed && canManage && approved && !(settled && !access?.isAdmin)) {
    if (inSettlement && ctl.ready) {
      if (ctl.secondary) buttons.push(<TaskButton key="s" kind="secondary" onClick={ctl.secondary.onClick} busy={ctl.secondary.busy} disabled={ctl.secondary.disabled}>{ctl.secondary.label}</TaskButton>);
      if (ctl.primary) buttons.push(<TaskButton key="p" onClick={ctl.primary.onClick} busy={ctl.primary.busy} disabled={ctl.primary.disabled}>{ctl.primary.label}</TaskButton>);
    } else if (!inSettlement) {
      if (task.secondary) buttons.push(actionButton(task.secondary, 'secondary'));
      if (task.primary) buttons.push(actionButton(task.primary, 'primary'));
    }
  }

  // 목록 버튼으로 왔으면 도착해서 바로 연다(확인창 · 메시지 창) — 한 번만. ⚠️ '한 번' 표시는 실제로 연 뒤에(규칙 61, StrictMode)
  const actDone = useRef(false);
  // ⚠️ 확인창이 적을 숫자가 다 온 뒤에 연다(2026-11-20 신뢰성 점검 S1) — 지원자 목록보다 먼저 열면 모집 마감 창에
  //    '아직 검토하지 않은 지원자가 N명' 과 '남은 N명을 미선정으로 처리' 가 빠졌다(창은 연 순간의 숫자를 쓴다)
  const actReady = !!initialAct && ready && approved && countsReady
    && (initialAct === 'complete-settlement' || initialAct === 'remind-settlement' ? ctl.ready : true)
    && (initialAct !== 'remind-submissions' || submissions.length > 0);
  useEffect(() => {
    if (!actReady || actDone.current || !initialAct) return;
    const t = window.setTimeout(() => {
      actDone.current = true;
      /*
        한 번 쓴 '도착해서 열 것'은 기록에서 지운다(S4) — 기록에 남아 있으면 새로고침·뒤로·앞으로 할 때마다 같은 확인창이 다시 떴다.
        React Router 의 state 는 history.state.usr 에 산다. navigate(replace) 로 바꾸면 화면이 다시 그려지므로 기록만 고친다.
      */
      const st = window.history.state as { usr?: Record<string, unknown> } | null;
      if (st?.usr && 'act' in st.usr) window.history.replaceState({ ...st, usr: { ...st.usr, act: undefined } }, '');
      runAct(initialAct);
    }, 60);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actReady]);

  /*
    같은 주소로 다시 들어오면(이 공모 화면을 보는 중에 이 공모의 알림을 눌렀다) 다시 받고, 알림이 가리킨 탭으로 간다(S5).
    주소가 같아 화면이 다시 뜨지 않아서, 예전엔 출품 자료가 들어왔다는 알림을 눌러도 화면이 옛 숫자 그대로였다.
  */
  const location = useLocation();
  const [seenKey, setSeenKey] = useState(location.key);
  if (seenKey !== location.key) {
    setSeenKey(location.key);
    setView(initialView);
    setRefreshing(true);
  }
  const firstKey = useRef(location.key);
  useEffect(() => {
    if (location.key === firstKey.current) return;
    let alive = true;
    const keys = [['operation-access', id], ['exhibition', id], ['exhibition-applicants', exhibitionId], ['operation-submissions', id], ['operation-settlement', id], ['operation-notices', id]];
    void Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey }))).finally(() => { if (alive) setRefreshing(false); });
    return () => { alive = false; };
  }, [location.key, id, exhibitionId, qc]);

  if (accessLoading || detailLoading) {
    return <div className={cn(standalone && 'mx-auto max-w-5xl px-6 py-8 md:px-12')}><div className="h-64 animate-pulse rounded-xl bg-gray-100" /></div>;
  }
  if (accessError || !access || !detail || !canManage) {
    return (
      <div className="py-20 text-center text-gray-500">
        <p>이 공모를 열 수 없어요.</p>
        <Link to={`/exhibitions/${id}`} className="mt-4 inline-block text-sm text-gray-600 underline underline-offset-4 hover:text-gray-900">공고 보기</Link>
      </div>
    );
  }

  const workspace = operatorWorkspace(user?.role, access.hostType, id);
  // 관리자 · 아트링크 주최 공모는 마이페이지 [주최 공모]의 그 공모 화면이 일터다(2026-11-21, 규칙 89) — 갤러리가 [내 공모]로 가는 것과 같다.
  // 운영 주소(알림·공고 상세)로 와도 메뉴·배지가 있는 그 자리에서 열고, [← 주최 공모]는 줄 목록으로 간다.
  if (standalone && user?.role === 'ADMIN' && access.hostType === 'ADMIN' && workspace) {
    const v = new URLSearchParams(location.search).get('view');
    return <Navigate to={`${workspace.listHref}${v ? `&view=${encodeURIComponent(v)}` : ''}`} state={location.state} replace />;
  }
  const back = standalone
    ? (workspace ? <Link to={workspace.listHref} className="-ml-1 inline-flex min-h-[44px] items-center gap-1.5 px-1 text-sm text-gray-600 hover:text-gray-950"><ArrowLeft size={16} aria-hidden /> {workspace.label}</Link> : null)
    : <button type="button" onClick={() => { if (confirmDiscardUnsaved()) onClose?.(); }} className="-ml-1 inline-flex min-h-[44px] items-center gap-1.5 px-1 text-sm text-gray-600 hover:text-gray-950"><ArrowLeft size={16} aria-hidden /> {backLabel}</button>;

  // 목록 줄과 같은 보조 글(gallerySubText) — 조회수는 올린 갤러리·관리자에게만 서버가 싣는다(규칙 63)
  const stageSub = gallerySubText({
    stageKey: stage?.key ?? null,
    deadline: detail.deadline, submissionDeadline: detail.submissionDeadline, exhibitStartDate: detail.exhibitStartDate, exhibitDate: detail.exhibitDate ?? access.exhibitDate,
    selectionDeadline, pending,
    settledAt: access.settledAt ?? null, settlementRequestedAt: access.settlementRequestedAt ?? null,
    viewCount: approved ? detail.viewCount ?? null : null,
  });
  const deletable = detail.hostType !== 'ADMIN' && !settled && deleteRequest?.status !== 'PENDING' && user?.role === 'GALLERY';
  const menuItems: MenuItem[] = [
    ...(lifecycle.canBack ? [{ id: 'back', label: lifecycle.backLabel, hint: lifecycle.backBlocked ?? undefined, disabled: !!lifecycle.backBlocked, onSelect: lifecycle.askBack }] : []),
    // 기간 중 조기 종료 — 주 버튼이 아닐 때만 여기서
    // ⚠️ [선정 마치기]는 여기 없다 — 할 일 줄의 버튼이다(모든 공고, 2026-11-21 사용자 결정 "점 세 개 안에 있으면 있는지도 모른다")
    ...(approved && !recruitOnly && !access.ended && over && task.primary?.id !== 'end' ? [{ id: 'end', label: '전시 종료', hint: '전시를 끝내고 정산을 시작해요', onSelect: () => lifecycle.ask('end') }] : []),
    ...(approved && !recruitOnly && over && !access.confirmed && task.primary?.id !== 'confirm' && task.secondary?.id !== 'confirm' ? [{ id: 'confirm', label: '전시 확정', onSelect: () => lifecycle.ask('confirm') }] : []),
    ...extraMenu,
    ...(deletable ? [{ id: 'delete', label: '공모 삭제', onSelect: askDelete }] : []),
  ];

  const tabs = [
    ...(settled ? [{ id: 'summary' as const, label: '요약' }] : []),
    { id: 'applicants' as const, label: '지원자', count: applicants.length },
    ...(!recruitOnly ? [{ id: 'submissions' as const, label: '출품 자료', count: submissions.length ? `${completeSubs}/${submissions.length}` : undefined }] : []),
    ...(!recruitOnly ? [{ id: 'settlement' as const, label: '정산', count: access.settlementRequested || settled ? `${approvals.approved}/${approvals.total}` : undefined, disabled: !access.ended, hint: '전시를 종료하면 열려요' }] : []),
    { id: 'notices' as const, label: '공지', count: notices.length || undefined },
  ];
  const panel = (v: WorkspaceView, node: ReactNode) => (visited.includes(v)
    ? <div key={v} role="tabpanel" id={`ws-${id}-panel-${v}`} aria-labelledby={`ws-${id}-tab-${v}`} hidden={current !== v}>{node}</div>
    : null);
  const hasButtons = buttons.length > 0;

  return (
    <div className={cn(standalone && 'mx-auto w-full max-w-5xl px-6 pb-10 pt-4 md:px-12')} data-exhibition-workspace={exhibitionId}>
      {back}

      {/* 머리 — 포스터 · 상태 · 제목 | 공고 보기 · ⋯ */}
      <header className="mt-2 flex items-start gap-4 sm:gap-5">
        <span className="block h-[79px] w-14 shrink-0 bg-gray-50 sm:h-[102px] sm:w-[72px]">
          {detail.imageUrl && <Thumb src={detail.imageUrl} alt="" className="h-full w-full object-contain" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-gray-600">
            <strong className="font-bold text-gray-950">{stage?.label}</strong>
            {stageSub && <span className="tabular-nums">{stageSub}</span>}
            <HostBadge exhibition={detail} />
          </p>
          <h1 className="mt-1 break-keep text-[19px] font-semibold leading-snug tracking-tight text-gray-950 [overflow-wrap:anywhere] sm:text-2xl">{detail.title}</h1>
          <p className="mt-1 text-[13px] text-gray-500 sm:text-sm">
            {[detail.gallery?.name || '아트링크', exhibitionTypeLabels[detail.type] || detail.type, regionLabels[detail.region] || detail.region].join(' · ')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-3">
          <Link to={`/exhibitions/${id}`} className="hidden min-h-[44px] items-center text-sm text-gray-700 underline-offset-4 hover:text-gray-950 hover:underline sm:inline-flex">공고 보기</Link>
          <MenuButton
            iconOnly
            label="더 보기"
            icon={<MoreHorizontal size={20} aria-hidden />}
            items={[{ id: 'detail', label: '공고 보기', onSelect: () => { window.location.assign(`/exhibitions/${id}`); } }, ...menuItems]}
          />
        </div>
      </header>
      <DeleteRequestLine request={deleteRequest} kind="exhibition" />

      {/* 진행 띠 */}
      <FlowStrip cells={strip} variant={wide ? 'full' : 'bar'} className="mt-6" />

      {/* 할 일 줄 — PC 는 버튼까지, 휴대폰은 문장만(버튼은 하단 줄) */}
      <TaskBar text={barText} tone={barTone} className="mt-5" actions={wide && hasButtons ? buttons : undefined} />

      {detail.status === 'REJECTED' && detail.rejectReason && <Notice tone="attention" title="반려 사유" className="mt-4">{detail.rejectReason}</Notice>}
      {lifecycle.autoCloseNote && <Notice className="mt-4">{lifecycle.autoCloseNote}</Notice>}

      {approved && (
        <>
          <div className="mt-2">
            <PageTabBar<WorkspaceView>
              sticky={false}
              idPrefix={`ws-${id}`}
              label="공모 운영"
              active={current}
              onSelect={goView}
              tabs={tabs}
            />
          </div>
          <div className={cn('pt-2', !wide && hasButtons && 'pb-2')}>
            {panel('summary', <WorkspaceSummary exhibitionId={exhibitionId} detail={detail} ctl={ctl} submissions={submissions} galleryId={detail.gallery?.id ?? null} />)}
            {/* 관리자가 갤러리가 올린 공모를 볼 땐 조회만 — 수락·거절은 그 갤러리의 일이다(operationLinks 의 canDecide, 2026-10-02 규칙 61) */}
            {panel('applicants', workspace && !workspace.canDecide ? (
              <p className="border-y border-gray-200 py-6 text-sm leading-relaxed text-gray-600">
                갤러리가 올린 공모예요. 선정(수락)은 그 갤러리가 해요.{' '}
                <Link to={workspace.applicantsHref} className="font-medium text-gray-900 underline underline-offset-4">운영 조회에서 지원 현황 보기</Link>
              </p>
            ) : (
              <ApplicantManager
                exhibitionId={exhibitionId}
                exhibitionTitle={detail.title}
                customFields={detail.customFields as CustomField[] | null | undefined}
                capacity={detail.capacity ?? null}
                capacityMask={detail.capacityMask ?? null}
                recruitOnly={recruitOnly}
                ended={!!access.ended || settled}
                // 수락은 접수가 끝난 뒤(모집 마감 또는 접수 마감일 경과) ~ 선정 마감일까지(규칙 90)
                recruitmentClosed={!!access.recruitmentClosed}
                deadline={detail.deadline}
                selectionDeadline={selectionDeadline}
                submissionDeadline={detail.submissionDeadline ?? null}
                // 아트링크 주최 공모의 모집 인원·선정 마감일은 아트링크(관리자)가 정한다 — 위임 갤러리는 못 고친다(서버 403)
                capacityEditable={detail.hostType !== 'ADMIN' || !!access.isAdmin}
                onSelectionChange={setSelecting}
                extraTools={!settled ? [{ label: '추가 질문 수정', onSelect: () => setQuestionsOpen(true) }] : undefined}
              />
            ))}
            {!recruitOnly && panel('submissions', (
              <AdminSubmissionsSection exhibitionId={id} exhibitionTitle={detail.title} myUserId={user!.id} confirmed={!!access.confirmed} ended={!!access.ended} isAdmin={!!access.isAdmin} />
            ))}
            {!recruitOnly && access.ended && panel('settlement', <SettlementSection ctl={ctl} wide={tableWide} isAdmin={!!access.isAdmin} />)}
            {panel('notices', <NoticesSection exhibitionId={id} canManage />)}
          </div>
        </>
      )}

      {/* 휴대폰 — 주 버튼 자리. 지원자를 고르는 동안엔 지원자 탭의 일괄 줄이 이 자리를 쓴다 */}
      {!wide && hasButtons && !(current === 'applicants' && selecting > 0) && (
        <div data-workspace-bar className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] tabbar-hidden:bottom-0 z-30 -mx-6 border-t border-gray-200 bg-white/95 px-6 py-3 backdrop-blur md:-mx-12 md:px-12">
          {current === 'settlement' && inSettlement && ctl.ready && (
            <p className="mb-2 flex justify-between text-[13px] text-gray-600">
              <span>판매 {ctl.grand.soldCount}점 · {ctl.grand.total.toLocaleString('ko')}원</span>
              <span>작가 지급 <b className="font-semibold text-gray-950">{ctl.grand.artistAmount.toLocaleString('ko')}원</b></span>
            </p>
          )}
          <div className={cn('grid gap-2', buttons.length > 1 ? 'grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]' : 'grid-cols-1')}>{buttons}</div>
        </div>
      )}

      {lifecycle.dialog}
      {ctl.dialogs}
      {remindOpen && <SubmissionRemindDialog exhibitionId={id} exhibitionTitle={detail.title} rows={submissions} onClose={() => setRemindOpen(false)} />}
      {questionsOpen && (
        <CustomQuestionsEditModal
          exhibitionId={exhibitionId}
          exhibitionTitle={detail.title}
          initialFields={detail.customFields as CustomField[] | null | undefined}
          onClose={() => { setQuestionsOpen(false); qc.invalidateQueries({ queryKey: ['exhibition', id] }); }}
        />
      )}
      <DeleteConfirmModal
        open={deleteOpen}
        name={detail.title}
        description="공모를 삭제하면 지원 내역도 함께 삭제되며 되돌릴 수 없습니다. 지원한 작가에게 삭제 알림이 가요."
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setDeleteOpen(false)}
      />
      <DeleteRequestDialog
        open={!!requestBlocked}
        kind="exhibition"
        targetId={exhibitionId}
        name={detail.title}
        blockedReason={requestBlocked ?? ''}
        onClose={() => setRequestBlocked(null)}
      />
    </div>
  );
}
