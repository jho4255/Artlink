/**
 * OperationPage — 공모 운영 (/exhibitions/:id/operation/new) 과 그 부품들
 *
 * 접근: 갤러리 오너 / Admin / 수락(ACCEPTED)된 작가
 *  - 운영 공지: 모두 열람, 오너·Admin 작성/수정/삭제
 *  - 수락 작가: 본인 출품 자료(출품작·약력·작가노트) 작성·수정 — 마이페이지 [내 전시] 카드 안에서(`ArtistOperationPanel`)
 *  - 오너·Admin: 전 작가 출품 자료 열람 + 문서별 PDF (타 작가끼리는 비공개)
 *
 * ── 2026-09-29 개편 (공모 프로세스 UX) ─────────────────────────
 * 처음 쓰는 사람이 "지금 무엇을 눌러야 하는지" 를 알 수 없던 곳들을 고쳤다.
 *  - 운영 화면: KPI 3칸 · 오렌지 안내 · 공지 · 출력 도구 · 스텝퍼 · '현재 운영 상태'(스텝퍼와 중복) · '운영 도우미'(대부분 비활성)가
 *    한꺼번에 떠 있었다 → **진행 단계 → (할 일) → 구역(운영 공지 · 출품 자료 · 정산)** 한 줄기로.
 *  - 출품 자료 편집기: 저장 버튼이 네다섯 개였고 [저장] → "대표작을 선택하세요" → 대표작은 "저장한 작품만" 이라 비활성 →
 *    작품 카드의 작은 [저장]을 먼저 눌러야 풀리는 순환이었다 → 버튼은 **[임시저장]·[갤러리에 제출] 둘**, 대표작은 작품 카드의 ☆,
 *    채울 것은 맨 위 체크리스트 네 줄(`lib/submissionChecklist.ts`).
 *  - 색은 흑백 + 빨강 하나(할 일). 이름은 `lib/flowLabels.ts` 한 곳.
 *
 * API: /api/operations/:id/(access|notices|me|submissions|submissions/:userId|lifecycle|settlement…)
 */
import { useState, useEffect, useRef, useId } from 'react';
import { Link, Navigate, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, Edit3, FileDown, ChevronDown, Loader2, Upload, ImageOff, User, Star, Check, RotateCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { composeSize, splitSize } from '@/lib/artwork';
import Thumb from '@/components/shared/Thumb';
import { nameWithNickname, compressImage, MAX_IMAGE_BYTES, formatPhoneNumber, koreanWon, formatArtworkPrice, getDday, cn } from '@/lib/utils';
import { STATE_UI, computeSaveState, isBlankArtwork, repOrdinal, type SaveState } from '@/lib/saveState';
import { artworkMissing, hasContent, hasNoteContent, serverStatus, submissionChecklist } from '@/lib/submissionChecklist';
import { galleryNextTask, stageOf, SUBMISSION_TERM, type TaskTarget } from '@/lib/flowLabels';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import StatusPanel from '@/components/operation/StatusPanel';
import { useBoothCatalogue, CATALOGUE_LABEL } from '@/components/operation/BoothKitBar';
import DmComposeModal from '@/components/operation/DmComposeModal';
// 정산 섹션은 클래식 뷰와 **한 벌을 공유**한다 (돈 계산이 두 벌로 갈라지면 한쪽만 조용히 틀어진다)
import SettlementSection from '@/components/operation/SettlementSection';
import StatusChip from '@/components/flow/StatusChip';
import Notice from '@/components/flow/Notice';
import Disclosure from '@/components/flow/Disclosure';
import MenuButton from '@/components/flow/MenuButton';
import PageTabBar from '@/components/shared/PageTabBar';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import MissingImagesBanner from '@/components/shared/MissingImagesBanner';

import type {
  OperationAccess, ExhibitionNotice, OperationSubmission,
  ArtworkItem, ArtistCv, CvEntry, ArtistNote, SettlementArtist,
} from '@/types';
import { EMPTY_CV, EMPTY_NOTE } from '@/types';

// 저장 전 이탈 경고 문구 (닫기·새로고침·뒤로가기·앱 내 링크 이동 시)
const UNSAVED_MESSAGE = [
  '저장하지 않은 출품 자료가 있습니다.',
  '[임시저장]을 누르면 작성 중인 내용을 보관할 수 있어요.',
  '',
  '저장하지 않고 나가시겠습니까?',
].join('\n');

const CV_SECTIONS: { key: keyof Pick<ArtistCv, 'solo' | 'group' | 'artFair' | 'award'>; label: string }[] = [
  { key: 'solo', label: '개인전' },
  { key: 'group', label: '단체전' },
  { key: 'artFair', label: '아트페어 / 옥션' },
  { key: 'award', label: '수상 및 선정' },
];

type SubmissionTab = 'artwork' | 'cv' | 'note';

/** 한 작가의 출품 자료에서 비어 있는 부분 — 갤러리 목록·안내 메시지 대상 */
function submissionMissingParts(submission: OperationSubmission): string[] {
  const parts: string[] = [];
  if ((submission.artworkList?.length || 0) === 0) parts.push('출품작');
  if (!hasContent(submission.cv)) parts.push('약력');
  if (!hasNoteContent(submission.note)) parts.push('작가노트');
  return parts;
}

const longDate = (v: string) => new Date(v).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });

/** 받침 있으면 a, 없으면 b — '약력이'·'작가노트가' (항목 이름을 이어 붙인 문장에서 조사가 틀리지 않게) */
const josa = (word: string, a: string, b: string) => {
  const c = word.charCodeAt(word.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 ? a : b;
};

/** 공모 상세(`GET /exhibitions/:id`) 중 운영 화면이 쓰는 값 — access 응답엔 날짜·정원이 없다 */
interface ExhibitionDates {
  deadline?: string | null;
  submissionDeadline?: string | null;
  exhibitStartDate?: string | null;
  exhibitDate?: string | null;
  capacity?: number | null;
}

/**
 * 갤러리 운영 화면의 본문.
 *
 * 두 곳에서 같은 코드를 쓴다:
 *  · `/exhibitions/:id/operation/new` 전용 페이지(기본 export) — 알림 링크가 이 주소를 가리킨다(라우트 유지 필수)
 *  · 마이페이지 [내 공모] 카드의 [운영] 탭 — `embedded` 로 바깥 껍데기(머리말·최대폭·할 일 안내)를 벗긴다
 *    (카드에 이미 제목·단계·할 일 줄이 있어 겹친다)
 *
 * `focus` 가 바뀌면 그 구역을 열고 스크롤한다 — 카드의 '다음 할 일' 을 누르면 거기로 데려간다.
 */
export function OperationBody({ id: idProp, embedded = false, focus = null }: {
  id?: string;
  embedded?: boolean;
  focus?: { target: TaskTarget; seq: number } | null;
} = {}) {
  const params = useParams<{ id: string }>();
  const id = idProp ?? params.id;
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const { data: access, isLoading, error } = useQuery<OperationAccess>({
    queryKey: ['operation-access', id],
    queryFn: () => api.get(`/operations/${id}/access`).then(r => r.data),
    enabled: !!id,
    retry: false,
  });

  const canManage = !!access && (access.isOwner || access.isAdmin);
  /**
   * 공모만 진행하는 공고 — 자료제출·전시·정산 단계가 없다.
   * ⚠️ 화면에서 감추는 것만으로 끝내지 말 것. 아래 쿼리들도 **끄지 않으면** 서버가 400 을 주고
   *    (`lib/exhibitionStage.ts`) 화면엔 이유 없는 에러만 남는다.
   */
  const recruitOnly = !!access?.recruitOnly;

  const { data: submissionSummary = [] } = useQuery<{ user: any; submission: OperationSubmission }[]>({
    queryKey: ['operation-submissions', id],
    queryFn: () => api.get(`/operations/${id}/submissions`).then(r => r.data),
    enabled: !!id && canManage && !recruitOnly,
    staleTime: 0,
  });

  const { data: settlementSummary } = useQuery<{
    settled?: boolean;
    settlementRequested?: boolean;
    allApproved?: boolean;
    artists: (SettlementArtist & { approval?: { status: string; comment?: string | null } | null })[];
  }>({
    queryKey: ['operation-settlement', id],
    queryFn: () => api.get(`/operations/${id}/settlement`).then(r => r.data),
    enabled: !!id && canManage && !!access?.ended && !recruitOnly,
    staleTime: 0,
  });

  // 운영 공지 개수 — 구역 머리의 요약용. NoticesSection 과 같은 쿼리 키라 한 번만 받는다
  const { data: notices = [] } = useQuery<ExhibitionNotice[]>({
    queryKey: ['operation-notices', id],
    queryFn: () => api.get(`/operations/${id}/notices`).then(r => r.data),
    enabled: !!id && canManage,
  });

  // 날짜·정원 — 공모 상세와 같은 쿼리 키(상세 페이지와 캐시를 나눠 쓴다)
  const { data: dates } = useQuery<ExhibitionDates>({
    queryKey: ['exhibition', id],
    queryFn: () => api.get(`/exhibitions/${id}`).then(r => r.data),
    enabled: !!id && canManage,
    staleTime: 60_000,
  });

  // 전용 페이지에서만 — '지원자 N명 검토 대기' 를 말하려면 지원자 수가 필요하다(카드 안에선 카드가 이미 말한다)
  const { data: applicants = [] } = useQuery<{ status: string }[]>({
    queryKey: ['exhibition-applicants', Number(id)],
    queryFn: () => api.get(`/exhibitions/${id}/applications`).then(r => r.data),
    enabled: !!id && canManage && !embedded,
  });

  /** 펼친 구역. null = 아직 access 가 없어 기본값을 못 정했다 */
  const [openSections, setOpenSections] = useState<Record<string, boolean> | null>(null);
  if (access && openSections === null) {
    // 지금 단계에서 볼 구역 하나만 펼쳐 시작한다 — 전부 펼치면 카드 하나가 수천 px 이 된다
    setOpenSections({
      notices: !!access.recruitOnly,
      submissions: !access.recruitOnly && !access.ended && access.recruitmentClosed,
      settlement: !access.recruitOnly && !!access.ended,
    });
  }
  const setSection = (key: string, open: boolean) => setOpenSections(prev => ({ ...(prev ?? {}), [key]: open }));

  // 카드의 '다음 할 일' → 그 구역을 열고 거기로 스크롤
  useEffect(() => {
    if (!focus?.target || !access) return;
    if (focus.target !== 'stage' && focus.target !== 'applicants') setOpenSections(prev => ({ ...(prev ?? {}), [focus.target as string]: true }));
    const t = window.setTimeout(() => document.getElementById(`op-${id}-${focus.target}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.seq, !!access]);

  if (isLoading) return <div className="mx-auto max-w-3xl px-6 py-10"><div className="h-40 animate-pulse rounded-xl bg-gray-100" /></div>;
  if (error || !access) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-20 text-center text-gray-400">
        <p>운영 화면에 들어갈 수 없습니다.</p>
        <button onClick={() => navigate(`/exhibitions/${id}`)} className="mt-4 text-sm text-gray-600 underline hover:text-gray-900">공모 상세로 이동</button>
      </div>
    );
  }

  /*
    작가는 이 페이지에 오지 않는다 — 마이페이지 [내 전시] 카드 안에서 공지·출품 자료·정산을 다 처리한다
    (`components/operation/ArtistOperationPanel.tsx`, 여기서 export 하는 세 섹션을 그대로 쓴다).

    ⚠️ **라우트를 지우지 말고 되돌려 보낼 것.** 이미 발송된 알림이 이 주소를 가리키고 있어서
       (수락·자료제출 안내·정산 확인 요청·리마인더) 404 로 두면 그 알림들이 전부 죽는다.
  */
  if (!canManage) {
    return <Navigate to="/mypage?tab=applications" replace />;
  }

  const isComplete = (s: OperationSubmission) => submissionMissingParts(s).length === 0;
  const completeArtists = submissionSummary.filter(({ submission }) => isComplete(submission)).length;
  const incompleteArtists = Math.max(0, submissionSummary.length - completeArtists);
  const approvals = settlementSummary?.artists ?? [];
  const approved = approvals.filter(a => a.approval?.status === 'APPROVED').length;
  const issues = approvals.filter(a => a.approval?.status === 'ISSUE').length;

  const stage = stageOf({ ...access, status: 'APPROVED', exhibitStartDate: dates?.exhibitStartDate ?? null, settledAt: access.settledAt ?? (access.settled ? 'y' : null) });
  const task = galleryNextTask({
    status: 'APPROVED',
    recruitOnly,
    recruitmentClosed: access.recruitmentClosed,
    confirmed: access.confirmed,
    ended: access.ended,
    settled: !!access.settled,
    settlementRequested: !!access.settlementRequested,
    deadline: dates?.deadline,
    exhibitStartDate: dates?.exhibitStartDate,
    exhibitDate: dates?.exhibitDate ?? access.exhibitDate,
    pending: applicants.filter(a => a.status === 'SUBMITTED' || a.status === 'REVIEWED').length,
    accepted: submissionSummary.length,
    submissionsIncomplete: incompleteArtists,
    sales: 0,
    approvals: { total: approvals.length, approved, issue: issues },
  });
  const goTask = () => {
    if (task.target === 'applicants') { navigate(`/mypage?tab=my-exhibitions&ex=${id}&panel=applicants`); return; }
    if (task.target && task.target !== 'stage') setSection(task.target, true);
    window.setTimeout(() => document.getElementById(`op-${id}-${task.target}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  const settlementMeta = access.settled
    ? '정산 완료'
    : access.settlementRequested
      ? (approvals.length > 0 && approved >= approvals.length
        ? '작가 모두 확인 · 정산 완료 전'
        : `작가 확인 ${approved}/${approvals.length}`)   // 이의는 옆의 빨간 표시(hint)가 말한다 — 두 번 적지 않는다
      : '판매 입력 전';

  const Body: 'main' | 'div' = embedded ? 'div' : 'main';
  return (
    <div className={embedded ? '' : 'bg-white'}>
      {/* 마이페이지 카드 안(embedded)에서는 `<main>` 을 두 번 만들지 않는다 — 문서에 main 은 하나여야 한다(감사 B4) */}
      <Body className={embedded ? 'w-full' : 'mx-auto w-full max-w-3xl px-6 py-8 md:px-12 md:py-12'}>
        {!embedded && (
          <header className="mb-8">
            <Link to={`/mypage?tab=my-exhibitions&ex=${id}`} className="inline-flex min-h-[40px] items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
              <ArrowLeft size={15} aria-hidden /> 내 공모
            </Link>
            <p className="mt-2 text-sm text-gray-500">공모 운영 · {access.galleryName}</p>
            <h1 className="mt-1 break-keep text-2xl font-semibold leading-tight text-gray-950 md:text-3xl">{access.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              {stage && <StatusChip variant={stage.variant}>{stage.label}</StatusChip>}
              <Link to={`/mypage?tab=my-exhibitions&ex=${id}&panel=applicants`} className="text-gray-600 underline-offset-4 hover:text-gray-950 hover:underline">지원자 보기</Link>
              <Link to={`/exhibitions/${id}`} className="text-gray-600 underline-offset-4 hover:text-gray-950 hover:underline">공고 보기</Link>
            </div>
          </header>
        )}

        {/* 지금 할 일 — 전용 페이지에서만(카드 안에선 카드의 할 일 줄이 같은 말을 한다) */}
        {!embedded && (
          <Notice
            tone={task.tone === 'attention' ? 'attention' : 'neutral'}
            className="mb-8"
            action={task.target && task.action ? (
              <button type="button" onClick={goTask} className="min-h-[40px] rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-900 hover:bg-gray-50">{task.action}</button>
            ) : undefined}
          >
            <span className={task.tone === 'attention' ? 'font-medium text-gray-900' : ''}>{task.text}</span>
          </Notice>
        )}

        <div id={`op-${id}-stage`} className="scroll-mt-24">
          <StatusPanel
            exhibitionId={id!}
            access={access}
            incompleteArtists={incompleteArtists}
            exhibitStartDate={dates?.exhibitStartDate ?? null}
            settlement={settlementSummary ? { approved, total: approvals.length, issues } : null}
          />
        </div>

        {recruitOnly && (
          <Notice className="mt-6">
            공모만 진행하는 공고예요 — 지원자 수락까지만 진행하고, 출품 자료·전시·정산 단계는 없어요.
            {embedded ? ' 지원자 확인과 수락은 위 [지원자] 탭에서 하세요.' : ' 지원자 확인과 수락은 [내 공모 › 지원자]에서 하세요.'}
          </Notice>
        )}

        {/* 구역 — 지금 단계에서 볼 것 하나만 펼쳐 시작한다 */}
        <div className="mt-8 divide-y divide-gray-100 border-t border-gray-100">
          <Disclosure
            id={`op-${id}-notices`}
            title="운영 공지"
            meta={notices.length ? `${notices.length}건` : '없음'}
            open={!!openSections?.notices}
            onOpenChange={(o) => setSection('notices', o)}
          >
            <NoticesSection exhibitionId={id!} canManage />
          </Disclosure>

          {!recruitOnly && (
            <Disclosure
              id={`op-${id}-submissions`}
              title={SUBMISSION_TERM}
              meta={submissionSummary.length ? `제출 완료 ${completeArtists}/${submissionSummary.length}` : '수락한 작가 없음'}
              hint={!access.ended && incompleteArtists > 0 && access.recruitmentClosed ? `미제출 ${incompleteArtists}명` : undefined}
              open={!!openSections?.submissions}
              onOpenChange={(o) => setSection('submissions', o)}
            >
              <AdminSubmissionsSection
                exhibitionId={id!}
                exhibitionTitle={access.title}
                myUserId={user!.id}
                confirmed={access.confirmed}
                ended={access.ended}
                isAdmin={access.isAdmin}
              />
            </Disclosure>
          )}

          {!recruitOnly && (access.ended ? (
            <Disclosure
              id={`op-${id}-settlement`}
              title="정산"
              meta={settlementMeta}
              hint={issues > 0 && !access.settled ? `이의 ${issues}건` : undefined}
              open={!!openSections?.settlement}
              onOpenChange={(o) => setSection('settlement', o)}
            >
              <SettlementSection exhibitionId={id!} isAdmin={access.isAdmin} className="" />
            </Disclosure>
          ) : (
            // 정산은 전시가 끝나야 열린다 — 자리는 미리 보여 준다(처음 쓰는 갤러리가 끝까지 무엇이 있는지 알게)
            <Disclosure id={`op-${id}-settlement`} title="정산" meta="전시를 종료하면 열려요" disabled />
          ))}
        </div>
      </Body>
    </div>
  );
}

/** `/exhibitions/:id/operation/new` 전용 페이지 — 본문은 OperationBody 가 그린다(마이페이지 카드와 공유) */
export default function OperationPage() {
  return <OperationBody />;
}


// ============ 운영 공지 ============
export function NoticesSection({ exhibitionId, canManage }: { exhibitionId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const { data: notices = [], isLoading } = useQuery<ExhibitionNotice[]>({
    queryKey: ['operation-notices', exhibitionId],
    queryFn: () => api.get(`/operations/${exhibitionId}/notices`).then(r => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [deleting, setDeleting] = useState<number | null>(null);

  const reset = () => { setShowForm(false); setEditId(null); setTitle(''); setContent(''); };

  const saveMutation = useMutation({
    mutationFn: () => editId
      ? api.patch(`/operations/${exhibitionId}/notices/${editId}`, { title, content })
      : api.post(`/operations/${exhibitionId}/notices`, { title, content }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['operation-notices', exhibitionId] }); reset(); toast.success('공지가 저장되었습니다.'); },
    onError: (e: any) => toast.error(e.response?.data?.error || '저장 실패'),
  });

  const deleteMutation = useMutation({
    mutationFn: (nid: number) => api.delete(`/operations/${exhibitionId}/notices/${nid}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['operation-notices', exhibitionId] }); toast.success('삭제되었습니다.'); },
    onError: (e: any) => toast.error(e.response?.data?.error || '삭제에 실패했습니다.'),   // 정산 완료 후 403 이 무음이었다(2026-09-19)
  });

  const startEdit = (n: ExhibitionNotice) => { setEditId(n.id); setTitle(n.title); setContent(n.content); setShowForm(true); };

  return (
    <div className="space-y-4">
      {canManage && !showForm && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-gray-500">수락한 작가 모두에게 보이는 안내예요.</p>
          <button onClick={() => { reset(); setShowForm(true); }} className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 hover:bg-gray-50">
            <Plus size={14} aria-hidden /> 공지 쓰기
          </button>
        </div>
      )}

      {showForm && (
        <div className="space-y-2 rounded-xl border border-gray-200 p-4">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="제목" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none" />
          <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="공지 내용" className="h-28 w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none" />
          <div className="flex justify-end gap-2">
            <button onClick={reset} className="min-h-[40px] px-3 text-sm text-gray-500 hover:text-gray-900">취소</button>
            <button onClick={() => { if (!title.trim() || !content.trim()) { toast.error('제목과 내용을 입력해주세요.'); return; } saveMutation.mutate(); }} disabled={saveMutation.isPending} className="min-h-[40px] rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">{editId ? '수정' : '올리기'}</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="h-16 animate-pulse rounded-lg bg-gray-100" />
      ) : notices.length === 0 ? (
        <p className="text-sm text-gray-400">{canManage ? '아직 올린 공지가 없어요. 설치·반입 일정처럼 작가 모두에게 알릴 일이 있으면 공지를 쓰세요.' : '갤러리가 올린 공지가 없어요.'}</p>
      ) : (
        <ul className="divide-y divide-gray-100 border-y border-gray-100">
          {notices.map(n => (
            <li key={n.id} className="py-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="text-sm font-medium text-gray-900">{n.title}</h4>
                  <p className="mt-0.5 text-xs text-gray-400">{new Date(n.createdAt).toLocaleString('ko')}</p>
                </div>
                {canManage && (
                  <div className="-mr-2 flex shrink-0 items-center">
                    <button onClick={() => startEdit(n)} className="grid h-9 w-9 place-items-center text-gray-400 hover:text-gray-900" aria-label="수정"><Edit3 size={14} /></button>
                    <button onClick={() => setDeleting(n.id)} className="grid h-9 w-9 place-items-center text-gray-400 hover:text-accent" aria-label="삭제"><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap break-keep text-sm leading-relaxed text-gray-700 [overflow-wrap:anywhere]">{n.content}</p>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="공지 삭제"
        message="이 공지를 삭제할까요? 작가 화면에서도 사라집니다."
        confirmText="삭제"
        variant="danger"
        onConfirm={() => { if (deleting !== null) deleteMutation.mutate(deleting); setDeleting(null); }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

// ============ 작가 본인 출품 자료 ============
/**
 * 출품 자료가 잠긴 이유와 다음 행동을 알려준다.
 * 예전엔 "확정되어 수정할 수 없습니다" 한 줄뿐이라, 작가 입장에서 **왜 잠겼는지·어떻게 해야 하는지**를 알 수 없었다.
 * 확정 경로가 둘(전시 시작일 경과 자동 확정 / 갤러리 수동 확정)이고 종료 후에는 기록 보존 목적이라 구분해서 안내한다.
 */
function lockedReason(ended?: boolean, manualConfirmed?: boolean): { title: string; detail: string } {
  if (ended) return {
    title: '전시가 끝나 출품 자료가 잠겼어요.',
    detail: '정산·기록 보존을 위해 종료 후에는 고칠 수 없어요. 고쳐야 할 내용이 있으면 갤러리에 문의해 주세요.',
  };
  if (manualConfirmed) return {
    title: '갤러리가 전시를 확정해 출품 자료가 잠겼어요.',
    detail: '확정 뒤에 출품 목록이 바뀌면 캡션·도록·정산 기준이 흔들리기 때문이에요. 고칠 게 있으면 갤러리에 문의해 주세요.',
  };
  return {
    title: '전시 시작일이 지나 자동으로 확정되었어요.',
    detail: '확정 뒤에 출품 목록이 바뀌면 캡션·도록·정산 기준이 흔들려 고칠 수 없게 잠겨요. 고칠 게 있으면 갤러리에 문의해 주세요.',
  };
}

/**
 * 작가 본인의 출품 자료 편집기 — `proxyFor` 를 주면 **갤러리/Admin 이 그 작가 대신** 쓰는 화면이 된다.
 *
 * 왜 같은 컴포넌트를 쓰나: 자료를 직접 못 올리는 작가(주로 고령)를 갤러리가 대신 입력해줘야 하는데,
 * 편집기를 따로 만들면 검증·임시저장·대표작 보정 규칙이 두 벌이 돼 반드시 갈라진다.
 * 서버도 같은 이유로 `submissionDataFrom` 하나를 공유한다.
 *
 * ── 저장은 두 가지뿐이다 (2026-09-29) ──
 *  - [임시저장]      다 못 채워도 보관. 새로 넣거나 고친 작품은 **갤러리에 안 보인다**(draft). 약력·노트는 서버에 draft 개념이
 *                    없어 저장되는 대로 갤러리에 보인다 — 그래서 '비공개 저장' 이라고 약속하지 않고 작품 기준으로만 말한다.
 *  - [갤러리에 제출]  작품마다 캡션 칸(작품명·크기·재료·연도·가격)과 대표작을 확인한 뒤 전부 공개한다.
 *                    약력·작가노트가 비어 있으면 막지 않고 "출품작만 먼저 보낼까요?" 를 묻는다.
 */
export function MySubmissionSection({ exhibitionId, myUserId, confirmed, ended, manualConfirmed, proxyFor, submissionDeadline }: {
  exhibitionId: string;
  myUserId: number;
  confirmed: boolean;
  ended?: boolean;
  manualConfirmed?: boolean;
  proxyFor?: { id: number; name: string };
  /** 자료 제출 마감일 — 상태 줄에 함께 적는다 */
  submissionDeadline?: string | null;
}) {
  const qc = useQueryClient();
  const targetUserId = proxyFor?.id ?? myUserId;
  // 대신 입력은 **원본**을 읽는다 — 임시저장(draft)까지 보여야 작가가 쓰다 만 내용을 모르고 날리지 않는다
  const path = proxyFor ? `/operations/${exhibitionId}/submissions/${proxyFor.id}` : `/operations/${exhibitionId}/me`;
  const queryKey = proxyFor ? ['operation-submission-edit', exhibitionId, proxyFor.id] : ['operation-me', exhibitionId];
  const { data, isLoading } = useQuery<OperationSubmission>({
    queryKey,
    queryFn: () => api.get(proxyFor ? `${path}/edit` : path).then(r => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const [artworkList, setArtworkList] = useState<ArtworkItem[]>([]);
  const [cv, setCv] = useState<ArtistCv>(EMPTY_CV);
  const [note, setNote] = useState<ArtistNote>(EMPTY_NOTE);
  const [repIndex, setRepIndex] = useState<number | null>(null);
  const [tab, setTab] = useState<SubmissionTab>('artwork');
  // 마지막으로 서버에 저장된 스냅샷 — 작품별 상태·'저장 안 된 변경'·갤러리에 보이는 상태의 기준
  const [savedList, setSavedList] = useState<ArtworkItem[]>([]);
  const [savedNote, setSavedNote] = useState<ArtistNote>(EMPTY_NOTE);
  const [savedCv, setSavedCv] = useState<ArtistCv>(EMPTY_CV);
  const [savedRepIndex, setSavedRepIndex] = useState<number | null>(null);
  // [갤러리에 제출]을 한 번 눌러 빈 칸이 드러난 뒤로는 칸을 채우는 대로 빨간 표시가 사라진다(실시간 판정)
  const [validated, setValidated] = useState(false);
  const [askPartial, setAskPartial] = useState<string[] | null>(null);
  const [cvLoaded, setCvLoaded] = useState(false);
  const idPrefix = useId();

  useEffect(() => {
    if (data) {
      setArtworkList(data.artworkList || []);
      setCv(data.cv || EMPTY_CV);
      setNote(data.note || EMPTY_NOTE);
      setRepIndex(data.representativeIndex ?? null);
      setSavedList(data.artworkList || []);
      setSavedNote(data.note || EMPTY_NOTE);
      setSavedCv(data.cv || EMPTY_CV);
      setSavedRepIndex(data.representativeIndex ?? null);
    }
  }, [data]);

  // 대표작 인덱스가 출품작 범위를 벗어나면 해제
  useEffect(() => {
    if (repIndex != null && repIndex >= artworkList.length) setRepIndex(null);
  }, [artworkList.length, repIndex]);

  // 작품 삭제 시 대표작 인덱스 보정 — 지운 것이 대표작이면 해제, 그보다 앞이면 한 칸 당긴다
  const handleArtworkRemoved = (removed: number) => {
    setRepIndex(prev => (prev == null ? null : prev === removed ? null : prev > removed ? prev - 1 : prev));
  };

  /*
    항상 전체를 보낸다(작품·약력·노트·대표작) — 서버가 한 행을 통째로 갈아끼운다.
    partial(임시저장)일 땐 refetch 를 하지 않는다 — 되받은 서버 값으로 폼을 덮으면 다른 작품에 입력 중이던 내용이 날아간다.
  */
  const saveMutation = useMutation({
    mutationFn: (v: { list: ArtworkItem[]; rep: number | null; msg: string; full?: boolean }) =>
      api.put(path, { artworkList: v.list, cv, note, representativeIndex: v.rep }),
    onSuccess: (res, v) => {
      // 기준선은 서버 응답(실제 저장된 값) — 요청이 나가는 동안 사용자가 더 입력한
      // 내용을 '저장됨'으로 잘못 표시하지 않기 위해 렌더 시점 값 대신 응답을 쓴다
      const srv = res.data || {};
      setSavedList(Array.isArray(srv.artworkList) ? srv.artworkList : v.list);
      setSavedNote(srv.note ?? EMPTY_NOTE);
      setSavedCv(srv.cv ?? EMPTY_CV);
      setSavedRepIndex(srv.representativeIndex ?? null);
      // 화면 목록은 자리 이동 없이 항목별로만 갱신 — 통째로 교체하면
      // ① 빈 칸이 뒤로 밀리며 repIndex 가 엉뚱한 칸을 가리키고 ② 저장 중에 다른 작품에 입력하던 내용이 날아간다.
      // draft 플래그만 다른(=이번 저장으로 플래그가 바뀐) 항목만 보낸 값으로 바꾼다.
      const sameArt = (a: ArtworkItem, b: ArtworkItem) => {
        const { draft: _a, ...x } = a; const { draft: _b, ...y } = b;
        return JSON.stringify(x) === JSON.stringify(y);
      };
      setArtworkList(prev => {
        let ord = 0;
        return prev.map(a => {
          if (isBlankArtwork(a)) return a;
          const sent = v.list[ord++];
          return sent && sameArt(a, sent) ? sent : a;
        });
      });
      if (v.full) { qc.invalidateQueries({ queryKey }); setValidated(false); }
      if (proxyFor) {
        // 대신 입력한 내용은 갤러리 목록(제출 완료 배지)·카드 숫자에도 바로 반영돼야 한다
        qc.invalidateQueries({ queryKey: ['operation-submissions', exhibitionId] });
        qc.invalidateQueries({ queryKey: ['my-operation-overview'] });
      } else {
        // 작가 카드의 '출품 자료를 제출해 주세요' 줄과 [내 전시] 분류가 이 값을 본다
        qc.invalidateQueries({ queryKey: ['my-applications'] });
      }
      toast.success(v.msg);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '저장하지 못했습니다.'),
  });

  // 서버에 보낼 목록 — 갓 추가해 비어 있는 칸은 제외한다(빈 작품이 쌓이면 갤러리 카운트가 어긋난다).
  // 상태 비교도 이 목록 기준으로 해야 인덱스가 어긋나지 않는다.
  const filledList = artworkList.filter(a => !isBlankArtwork(a));
  const ordinalOf = new Map<number, number>();
  artworkList.forEach((a, i) => { if (!isBlankArtwork(a)) ordinalOf.set(i, ordinalOf.size); });

  const artworkState = (i: number): SaveState => {
    // 갓 추가해 비어 있는 칸은 경고하지 않는다 (저장할 것도, 잃을 것도 없음)
    if (isBlankArtwork(artworkList[i])) return 'empty';
    const ord = ordinalOf.get(i)!;
    return computeSaveState(artworkList[i], savedList[ord], artworkList[i]?.draft);
  };

  // 대표작 변경도 저장 대상 — 빼먹으면 대표작만 바꾼 경우 이탈 경고 없이 조용히 유실된다
  const anyDirty = JSON.stringify(filledList) !== JSON.stringify(savedList)
    || JSON.stringify(note) !== JSON.stringify(savedNote)
    || JSON.stringify(cv) !== JSON.stringify(savedCv)
    || repOrdinal(artworkList, repIndex, filledList.length) !== (savedRepIndex ?? null);
  // 저장 전 이탈 경고 (닫기·새로고침·뒤로가기·앱 내 링크)
  useUnsavedChanges(anyDirty, UNSAVED_MESSAGE);

  const checklist = submissionChecklist({ artworkList, repIndex, cv, note });
  const server = serverStatus({ artworkList: savedList, cv: savedCv, note: savedNote });

  // 빈 칸 표시(제출을 한 번 눌러 본 뒤로만) — 칸을 채우면 바로 사라진다
  const liveErrors: Record<number, string[]> = {};
  if (validated) artworkList.forEach((a, i) => { const m = artworkMissing(a); if (m.length) liveErrors[i] = m; });
  const repChosen = repIndex != null && !isBlankArtwork(artworkList[repIndex]);
  const repErrorLive = validated && filledList.length > 1 && !repChosen;
  const noteErrorAt = validated ? note.sections.findIndex(s => !s.title.trim()) : -1;

  // 임시저장 — 아직 다 채우지 못했어도 작성한 만큼 서버에 보관. 새로 넣거나 고친 작품은 draft 로 갤러리에서 감춘다.
  const saveDraft = () => {
    const list = filledList.map((a, ord) => (
      JSON.stringify(a) === JSON.stringify(savedList[ord]) && !a.draft ? a : { ...a, draft: true }
    ));
    saveMutation.mutate({ list, rep: repOrdinal(artworkList, repIndex, list.length), msg: '임시저장했어요. 임시저장한 작품은 갤러리에 보이지 않아요.' });
  };

  /** [갤러리에 제출] — 빈 칸을 보여 주고, 약력·노트가 비면 먼저 물어본다 */
  const submit = (allowPartial = false) => {
    const missingByArt: number[] = [];
    artworkList.forEach((a, i) => { if (artworkMissing(a).length) missingByArt.push(i); });
    // 작품이 한 점뿐이면 그게 대표작이다 — 고르라고 붙잡을 이유가 없다
    let rep = repIndex;
    if (!(rep != null && !isBlankArtwork(artworkList[rep])) && filledList.length === 1) rep = artworkList.findIndex(a => !isBlankArtwork(a));
    const repMissing = filledList.length > 0 && !(rep != null && !isBlankArtwork(artworkList[rep]));
    const badSection = note.sections.findIndex(s => !s.title.trim());

    if (filledList.length === 0 || missingByArt.length || repMissing) {
      setValidated(true);
      setTab('artwork');
      if (filledList.length === 0) toast.error('출품작을 1점 이상 넣어 주세요.');
      else if (missingByArt.length) toast.error('빨간 칸을 채워 주세요 — 캡션에 들어가는 내용이라 비워 둘 수 없어요.', { duration: 5000 });
      else toast.error('대표작을 골라 주세요 — 작품 카드의 [☆ 대표작]을 누르면 됩니다.', { duration: 5000 });
      const first = missingByArt[0];
      window.setTimeout(() => {
        const el = first != null ? document.getElementById(`${idPrefix}-art-${first}`) : document.getElementById(`${idPrefix}-rep`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
      return;
    }
    if (badSection >= 0) {
      setValidated(true);
      setTab('note');
      toast.error(`작품별 설명 ${badSection + 1}: 어느 작품의 설명인지 골라 주세요.`);
      return;
    }
    // 약력·작가노트가 비어 있으면 막지 않고 묻는다 — 출품작만 먼저 보내야 하는 경우가 있다(도록을 먼저 만드는 갤러리)
    if (!allowPartial && !proxyFor) {
      const empty = [!hasContent(cv) && '약력', !hasNoteContent(note) && '작가노트'].filter(Boolean) as string[];
      if (empty.length) { setAskPartial(empty); return; }
    }
    if (rep !== repIndex) setRepIndex(rep);
    // 제출 → 모든 작품의 draft 해제(갤러리에 공개)
    const list = filledList.map(a => ({ ...a, draft: false }));
    saveMutation.mutate({
      list,
      rep: repOrdinal(artworkList, rep, list.length),
      full: true,
      msg: proxyFor ? `${proxyFor.name}님의 출품 자료를 저장했어요. 작가에게 알림이 갑니다.` : '갤러리에 제출했어요.',
    });
  };

  // 포트폴리오 경력 + 내 개인정보(이름/연락처/이메일)를 한 번에 약력으로 불러온다.
  // 대신 입력 중이면 **그 작가의 공개 포트폴리오**에서 가져온다 — 갤러리 자신의 것을 넣으면 안 되고,
  // 연락처·이메일은 공개 API 에 없으므로 갤러리가 직접 받아 적는다(없는 정보를 끌어오지 않는다).
  const loadFromPortfolio = async () => {
    try {
      const [{ data: p }, { data: me }] = await Promise.all([
        api.get(proxyFor ? `/portfolio/${proxyFor.id}` : '/portfolio'),
        proxyFor
          ? Promise.resolve({ data: { user: { name: proxyFor.name } } })
          : api.get('/auth/me').then(r => r).catch(() => ({ data: { user: null } })),
      ]);
      const c = p.career || {};
      const u = me?.user;
      setCv(prev => ({
        ...prev,
        nameKo: prev.nameKo || u?.name || '',
        tel: prev.tel || u?.phone || '',
        email: prev.email || u?.email || '',
        // ⚠️ 이미 손으로 적어 둔 항목은 덮지 않는다 — 비어 있는 칸만 포트폴리오에서 채운다. `award` 도 가져온다(2026-09-19)
        solo: prev.solo?.length ? prev.solo : (c.solo || []).map((e: any) => ({ year: e.year || '', content: e.content || '' })),
        group: prev.group?.length ? prev.group : (c.group || []).map((e: any) => ({ year: e.year || '', content: e.content || '' })),
        artFair: prev.artFair?.length ? prev.artFair : (c.artFair || []).map((e: any) => ({ year: e.year || '', content: e.content || '' })),
        award: prev.award?.length ? prev.award : (c.award || []).map((e: any) => ({ year: e.year || '', content: e.content || '' })),
      }));
      setCvLoaded(true);
    } catch {
      toast.error('불러오지 못했습니다.');
    }
  };

  const openPrint = (doc: SubmissionTab) => {
    window.open(`/exhibitions/${exhibitionId}/operation/print/${targetUserId}/${doc}`, '_blank');
  };

  if (isLoading) return <div className="h-40 animate-pulse rounded-xl bg-gray-100" />;

  const printItems = [
    { label: '출품리스트 PDF', onSelect: () => openPrint('artwork') },
    { label: '약력 PDF', onSelect: () => openPrint('cv') },
    { label: '작가노트 PDF', onSelect: () => openPrint('note') },
  ];

  // 확정됨 → 읽기 전용
  if (confirmed) {
    const r = lockedReason(ended, manualConfirmed);
    return (
      <section className="space-y-4">
        {proxyFor && <h3 className="text-base font-semibold text-gray-950">{proxyFor.name}님의 {SUBMISSION_TERM}</h3>}
        {!proxyFor && data?.proxyEdited && <Notice title="갤러리가 대신 입력한 자료예요">내용이 맞는지 확인해 주세요.</Notice>}
        <Notice title={r.title}>{r.detail}</Notice>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-gray-600">제출한 내용이에요.</p>
          <MenuButton label="PDF로 받기" icon={<FileDown size={13} aria-hidden />} items={printItems} />
        </div>
        <PageTabBar
          sticky={false}
          idPrefix={`${idPrefix}-ro`}
          label={SUBMISSION_TERM}
          active={tab}
          onSelect={setTab}
          tabs={[
            { id: 'artwork', label: '출품작', count: filledList.length },
            { id: 'cv', label: '약력' },
            { id: 'note', label: '작가노트' },
          ]}
        />
        <SubmissionReadonly submission={{ artworkList, cv, note, representativeIndex: repIndex }} activeTab={tab} />
      </section>
    );
  }

  const doneCount = checklist.filter(c => c.done).length;
  const dday = submissionDeadline ? getDday(submissionDeadline) : null;
  const deadlineText = submissionDeadline
    ? `마감 ${longDate(submissionDeadline)}${dday != null && dday >= 0 ? ` (${dday === 0 ? 'D-DAY' : `D-${dday}`})` : ' (지남)'}`
    : null;
  // 임시저장해 둔 작품 — 서버엔 있지만 갤러리엔 안 보인다. 있으면 '제출 완료' 로 잠그면 안 된다(낼 길이 없어진다)
  const draftCount = filledList.filter(a => a.draft).length;
  const settledView = server.complete && !anyDirty && draftCount === 0;
  const statusText = proxyFor
    ? '작가에게 받은 내용을 대신 입력해요. 저장하면 작가에게 알림이 가고 작가 화면에도 그대로 보여요.'
    : draftCount > 0 && !anyDirty
      ? `임시저장한 작품 ${draftCount}점은 아직 갤러리에 안 보여요. 다 채웠으면 제출해 주세요.`
      : server.complete
        ? (settledView ? '갤러리에 제출했어요. 고칠 게 있으면 고친 뒤 다시 제출하세요.' : '고친 내용은 [변경 내용 제출]을 눌러야 갤러리에 보여요.')
        : server.any
          ? '일부만 갤러리에 보냈어요. 남은 항목을 채워 제출해 주세요.'
          : '아직 갤러리에 보내지 않았어요. 네 가지를 채워 [갤러리에 제출]을 누르세요.';
  const primaryLabel = saveMutation.isPending
    ? '저장 중…'
    : proxyFor ? '저장' : settledView ? '제출 완료' : server.complete ? '변경 내용 제출' : '갤러리에 제출';
  const primaryDisabled = saveMutation.isPending || (proxyFor ? !anyDirty && draftCount === 0 : settledView);
  const emptyNames = (askPartial ?? []).join('·');
  const titled = artworkList.filter(a => !isBlankArtwork(a) && a.title?.trim());
  const repTitle = repChosen ? (artworkList[repIndex!]!.title?.trim() || `작품 ${repIndex! + 1}`) : null;

  return (
    <section className="space-y-5">
      {proxyFor && <h3 className="text-base font-semibold text-gray-950">{proxyFor.name}님 {SUBMISSION_TERM} 대신 입력</h3>}
      {!proxyFor && data?.proxyEdited && (
        <Notice title="갤러리가 대신 입력한 자료예요">내용이 맞는지 확인해 주세요. 직접 고쳐 제출하면 이 안내는 사라져요.</Notice>
      )}

      {/* 상태 + 채울 것 네 가지 */}
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {!proxyFor && settledView && <StatusChip variant="done">제출 완료</StatusChip>}
          {anyDirty && <StatusChip variant="attention">저장 안 된 변경</StatusChip>}
          <p className="min-w-0 text-sm text-gray-600">{statusText}</p>
        </div>
        <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1" aria-label="채울 것">
          {checklist.map(it => (
            <li key={it.key}>
              <button type="button" onClick={() => setTab(it.tab)} className="inline-flex min-h-[36px] items-center gap-1.5 text-sm">
                <span aria-hidden className={cn('grid h-[18px] w-[18px] place-items-center rounded-full', it.done ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white')}>
                  {it.done && <Check size={11} strokeWidth={3} />}
                </span>
                <span className={it.done ? 'text-gray-900' : 'text-gray-500'}>{it.label}</span>
                <span className="sr-only">{it.done ? '채움' : '비어 있음'}</span>
              </button>
            </li>
          ))}
          <li className="text-xs tabular-nums text-gray-400">
            {doneCount}/{checklist.length}{deadlineText ? ` · ${deadlineText}` : ''}
          </li>
        </ul>
      </div>

      <PageTabBar
        sticky={false}
        idPrefix={`${idPrefix}-sub`}
        label={SUBMISSION_TERM}
        active={tab}
        onSelect={setTab}
        tabs={[
          { id: 'artwork', label: '출품작', count: filledList.length, done: checklist[0]!.done && checklist[1]!.done },
          { id: 'cv', label: '약력', done: checklist[2]!.done },
          { id: 'note', label: '작가노트', done: checklist[3]!.done },
        ]}
      />

      <div role="tabpanel" id={`${idPrefix}-sub-panel-${tab}`} aria-labelledby={`${idPrefix}-sub-tab-${tab}`}>
        {tab === 'artwork' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <p id={`${idPrefix}-rep`} className={cn('flex min-w-0 items-center gap-1.5 text-sm', repErrorLive ? 'text-accent' : 'text-gray-500')}>
                <Star size={14} aria-hidden className={cn('shrink-0', repChosen ? 'fill-gray-900 text-gray-900' : '')} />
                {repTitle
                  ? <span className="min-w-0 truncate">대표작 <b className="font-medium text-gray-900">{repTitle}</b> · 엽서·홍보물·도록 첫 장에 들어가요</span>
                  : <span>대표작 1점을 골라 주세요 — 엽서·홍보물·도록 첫 장에 들어가요</span>}
              </p>
              <button type="button" onClick={() => openPrint('artwork')} className="inline-flex min-h-[32px] shrink-0 items-center gap-1 text-xs text-gray-500 hover:text-gray-900"><FileDown size={13} aria-hidden /> PDF 미리보기</button>
            </div>
            <ArtworkListEditor
              value={artworkList}
              onChange={setArtworkList}
              onRemoved={handleArtworkRemoved}
              stateOf={artworkState}
              repIndex={repIndex}
              onRepChange={setRepIndex}
              errors={liveErrors}
              idPrefix={idPrefix}
            />
          </div>
        )}
        {tab === 'cv' && (
          <div className="space-y-4">
            {!hasContent(cv) ? (
              <Notice action={<button type="button" onClick={loadFromPortfolio} className="min-h-[40px] rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-900 hover:bg-gray-50">홈페이지에서 불러오기</button>}>
                {proxyFor ? '작가의 홈페이지(포트폴리오)에 적힌 이름·경력을 불러와 채울 수 있어요.' : '홈페이지(포트폴리오)에 적은 이름·연락처·경력을 불러와 채울 수 있어요.'}
              </Notice>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" onClick={loadFromPortfolio} className="inline-flex min-h-[32px] items-center gap-1 text-xs text-gray-500 underline-offset-4 hover:text-gray-900 hover:underline">
                  <RotateCw size={12} aria-hidden /> 비어 있는 칸을 홈페이지에서 채우기
                </button>
                <button type="button" onClick={() => openPrint('cv')} className="inline-flex min-h-[32px] items-center gap-1 text-xs text-gray-500 hover:text-gray-900"><FileDown size={13} aria-hidden /> PDF 미리보기</button>
              </div>
            )}
            {cvLoaded && <p className="text-xs text-gray-500">홈페이지 내용으로 채웠어요 — 확인하고 고쳐 주세요.</p>}
            <CvEditor value={cv} onChange={setCv} />
          </div>
        )}
        {tab === 'note' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button type="button" onClick={() => openPrint('note')} className="inline-flex min-h-[32px] items-center gap-1 text-xs text-gray-500 hover:text-gray-900"><FileDown size={13} aria-hidden /> PDF 미리보기</button>
            </div>
            <NoteEditor value={note} onChange={setNote} artworkList={titled} errorAt={noteErrorAt} />
          </div>
        )}
      </div>

      {/* 저장 줄 — 화면 아래에 붙어 따라온다(작품이 많으면 위까지 올라가지 않게). 휴대폰에선 하단 탭바 위에 */}
      <div className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-20 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 bg-white/95 px-1 py-3 backdrop-blur lg:bottom-0">
        <p className="mr-auto min-w-0 text-xs text-gray-500">
          {proxyFor ? '작가 본인이 나중에 직접 고칠 수 있어요.' : '다 못 채웠으면 임시저장해 두세요. 다른 작가는 내 자료를 볼 수 없어요.'}
        </p>
        <button
          type="button"
          onClick={saveDraft}
          disabled={saveMutation.isPending || !anyDirty}
          title="다 채우지 않아도 지금까지 쓴 내용을 보관합니다. 임시저장한 작품은 갤러리에 보이지 않아요."
          className="min-h-[44px] rounded-lg border border-gray-200 bg-white px-4 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          임시저장
        </button>
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={primaryDisabled}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40"
        >
          {!proxyFor && settledView && <Check size={15} aria-hidden />}
          {primaryLabel}
        </button>
      </div>

      <ConfirmDialog
        open={!!askPartial}
        title={`${emptyNames}${josa(emptyNames, '이', '가')} 비어 있어요`}
        details={[
          '지금 채운 출품작만 먼저 갤러리에 보냅니다.',
          `${emptyNames}${josa(emptyNames, '은', '는')} 나중에 채워 다시 제출하면 돼요.`,
          ...(submissionDeadline ? [`자료 제출 마감은 ${longDate(submissionDeadline)}이에요.`] : []),
        ]}
        cancelText="계속 작성"
        confirmText="출품작만 먼저 제출"
        onConfirm={() => { setAskPartial(null); submit(true); }}
        onCancel={() => { setAskPartial(null); setTab(!hasContent(cv) ? 'cv' : 'note'); }}
      />
    </section>
  );
}

// ============ 갤러리/Admin: 전 작가 출품 자료 ============
function AdminSubmissionsSection({ exhibitionId, exhibitionTitle, myUserId, confirmed, ended, isAdmin }: {
  exhibitionId: string;
  exhibitionTitle: string;
  myUserId: number;
  confirmed: boolean;
  ended?: boolean;
  isAdmin?: boolean;
}) {
  const qc = useQueryClient();
  const { data = [], isLoading, refetch, isFetching } = useQuery<{ user: any; submission: OperationSubmission }[]>({
    queryKey: ['operation-submissions', exhibitionId],
    queryFn: () => api.get(`/operations/${exhibitionId}/submissions`).then(r => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const [openId, setOpenId] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<SubmissionTab>('artwork');
  const [busy, setBusy] = useState<string | null>(null);
  // 진행률은 토스트가 아니라 **버튼에 직접** 표시한다. 토스트는 사라질 수 있어 "몇 장째" 가 깜빡인다는 신고가 있었다(2026-08).
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  // 자동 회수까지 하고도 못 받은 항목 — 사라지는 토스트 대신 배너로 남겨 [다시 받기]로 잇는다
  const [missing, setMissing] = useState<{ items: string[]; what: string; retry: () => void } | null>(null);
  /** 지금 대신 입력 중인 작가 (null = 보기 모드). 자료를 못 올리는 작가를 갤러리가 도와주는 경로 */
  const [proxyEditId, setProxyEditId] = useState<number | null>(null);
  // 한 번 열었던 대신입력 폼은 접어도 언마운트하지 않는다 — 입력 중인 내용이 통째로 사라졌다(2026-09-19)
  const [proxyOpened, setProxyOpened] = useState<Set<number>>(() => new Set());
  const [remindOpen, setRemindOpen] = useState(false);
  const catalogue = useBoothCatalogue(exhibitionId, data);
  // 잠금 기준은 확정이 아니라 **전시종료**다. 확정 잠금은 *작가가* 인쇄 기준을 몰래 바꾸는 걸
  // 막는 장치라, 캡션·엽서를 만드는 갤러리까지 막으면 정작 도와줘야 할 때 못 돕는다.
  // 종료 후는 판매 기록이 출품목록 '위치'에 묶여 있어 반드시 막는다(Admin 만 예외).
  const canProxyEdit = !ended || !!isAdmin;

  const reminderMutation = useMutation({
    mutationFn: (payload: { subject: string; content: string }) => api.post(`/operations/${exhibitionId}/submission-reminders`, payload),
    onSuccess: (res) => { toast.success(`자료 제출 안내를 ${res.data.sentCount}명에게 보냈습니다.`); setRemindOpen(false); qc.invalidateQueries({ queryKey: ['chats'] }); },
    onError: (e: any) => toast.error(e.response?.data?.error || '자료 제출 안내를 보내지 못했습니다.'),
  });

  const totalArtworks = data.reduce((s, d) => s + (d.submission.artworkList?.length || 0), 0);
  const incompleteRows = data.filter(({ submission }) => submissionMissingParts(submission).length > 0);
  const completeCount = data.length - incompleteRows.length;

  const openPrint = (userId: number, doc: SubmissionTab) => {
    window.open(`/exhibitions/${exhibitionId}/operation/print/${userId}/${doc}`, '_blank');
  };

  const downloadAllZip = async () => {
    if (data.length === 0) { toast.error('수락된 작가가 없습니다.'); return; }
    setBusy('zip'); setMissing(null);
    const t = toast.loading('전체 출품 자료 PDF를 만드는 중입니다…');
    try {
      const { downloadAllSubmissionsZip } = await import('@/lib/operationPdf');
      const { missing: lost } = await downloadAllSubmissionsZip(exhibitionTitle, data, (done, total, phase) => {
        setProgress({ done, total, label: phase === 'images' ? '이미지' : phase === 'retry' ? '재시도' : 'PDF' });
      });
      if (lost.length > 0) {
        // 이미지가 빠진 채로 PDF가 나갔다는 걸 반드시 알린다(예전엔 조용히 넘어갔다). 배너로도 남겨 다시 받을 수 있게.
        toast.success(`ZIP 다운로드를 시작합니다. (이미지 ${lost.length}개 누락)`, { id: t });
        setMissing({ items: lost, what: 'PDF에 들어갈 작품 이미지', retry: downloadAllZip });
      } else {
        toast.success('ZIP 다운로드를 시작합니다.', { id: t });
      }
    } catch {
      toast.error('PDF 생성에 실패했습니다.', { id: t });
    } finally { setBusy(null); setProgress(null); }
  };

  // 캡션 HWP (한글 파일) — 서버에서 원본 양식 채워 생성, 작가명 미표기
  const downloadCaptions = async () => {
    if (totalArtworks === 0) { toast.error('등록된 출품작이 없습니다.'); return; }
    setBusy('caption');
    const t = toast.loading('캡션(한글 파일)을 만드는 중입니다…');
    try {
      const res = await api.get(`/operations/${exhibitionId}/caption.hwp`, { responseType: 'blob' });
      let fname = `${exhibitionTitle}_작품캡션.hwp`;
      const cd: string = res.headers['content-disposition'] || '';
      const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
      if (m) { try { fname = decodeURIComponent(m[1]!); } catch { /* keep default */ } }
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = fname; a.click();
      URL.revokeObjectURL(url);
      toast.success('캡션 한글 파일 다운로드를 시작합니다.', { id: t });
    } catch (e: any) {
      toast.error(e?.response?.status === 400 ? '등록된 출품작이 없습니다.' : '캡션 생성에 실패했습니다.', { id: t });
    } finally { setBusy(null); }
  };

  // 작품 원본 이미지 일괄 다운로드 (jpg ZIP) — rows 를 주면 그 작가만
  const downloadImages = async (rows = data, zipName?: string) => {
    if (rows.reduce((s, d) => s + (d.submission.artworkList?.length || 0), 0) === 0) { toast.error('등록된 출품작이 없습니다.'); return; }
    setBusy('images'); setMissing(null);
    const t = toast.loading('작품 원본 이미지를 모으는 중입니다…');
    try {
      const { downloadAllArtworkImagesZip } = await import('@/lib/operationPdf');
      const { ok, fail, failed } = await downloadAllArtworkImagesZip(
        exhibitionTitle, rows, zipName,
        (done, total, phase) => setProgress({ done, total, label: phase === 'retry' ? '재시도' : '이미지' }),
      );
      if (ok === 0) toast.error('다운로드 가능한 작품 이미지가 없습니다.', { id: t });
      else if (fail > 0) {
        // 실패한 작품을 조용히 빠뜨리지 않고 명시한다 (+ 사라지지 않는 배너로 다시 받기 제공)
        toast.success(`원본 ${ok}개 ZIP 다운로드 시작 (실패 ${fail}개)`, { id: t });
        setMissing({ items: failed, what: '작품 원본', retry: () => downloadImages(rows, zipName) });
      } else toast.success(`원본 ${ok}개 ZIP 다운로드 시작`, { id: t });
    } catch { toast.error('이미지 ZIP 생성에 실패했습니다.', { id: t }); }
    finally { setBusy(null); setProgress(null); }
  };

  const downloadArtistImages = async (row: { user: any; submission: OperationSubmission }) => {
    const { safeName } = await import('@/lib/operationPdf');
    await downloadImages([row], `${safeName(exhibitionTitle)}_${safeName(nameWithNickname(row.user))}_작품원본.zip`);
  };

  // 진행률은 토스트가 아니라 [내려받기] 버튼 라벨에 — 토스트는 사라져 "멈춘 줄" 안다(2026-08). 사진 모으기는 '장' 단위
  const busyLabel = busy === 'catalogue'
    ? catalogue.progress
    : busy === 'images'
      ? (progress ? `${progress.label} ${progress.done}/${progress.total}장` : '모으는 중…')
      : busy ? (progress ? `${progress.label} ${progress.done}/${progress.total}` : '만드는 중…') : catalogue.busy ? catalogue.progress : null;

  if (isLoading) return <div className="h-20 animate-pulse rounded-xl bg-gray-100" />;
  if (data.length === 0) {
    return <p className="text-sm text-gray-400">아직 수락한 작가가 없어요. [지원자]에서 지원자를 수락하면 여기에 작가별 {SUBMISSION_TERM}가 모여요.</p>;
  }

  return (
    <div className="space-y-4">
      {/* 요약 + 도구 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          제출 완료 <b className="font-semibold text-gray-950">{completeCount}명</b>
          {incompleteRows.length > 0 && <> · 미제출 <b className="font-semibold text-gray-950">{incompleteRows.length}명</b></>}
          <span className="text-gray-400"> · 출품작 {totalArtworks}점</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {incompleteRows.length > 0 && !ended && (
            <button type="button" onClick={() => setRemindOpen(true)} className="min-h-[36px] rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-700 hover:bg-gray-50">
              미제출 {incompleteRows.length}명에게 안내
            </button>
          )}
          {totalArtworks > 0 && (
            <MenuButton
              label="내려받기"
              icon={<FileDown size={13} aria-hidden />}
              busyLabel={busyLabel}
              items={[
                { label: '작품 캡션 (한글 .hwp)', hint: '전시장에 붙이는 캡션 — 작가명 없이', onSelect: downloadCaptions },
                { label: '작품 원본 (ZIP)', hint: '작가별 폴더의 원본 이미지', onSelect: () => downloadImages() },
                { label: '전체 출품 자료 PDF (ZIP)', hint: '작가마다 출품리스트·약력·작가노트', onSelect: downloadAllZip },
                { label: CATALOGUE_LABEL, hint: '표지 · 전시 소개 · 작가별 대표작·작품·약력', onSelect: () => { setBusy('catalogue'); catalogue.run().finally(() => setBusy(null)); } },
              ]}
            />
          )}
          <button type="button" onClick={() => refetch()} disabled={isFetching} aria-label="새로고침" title="새로고침" className="grid h-9 w-9 place-items-center rounded-lg text-gray-400 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-40">
            <RotateCw size={14} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {missing && (
        <MissingImagesBanner
          items={missing.items}
          what={missing.what}
          busy={!!busy}
          onRetry={missing.retry}
          onDismiss={() => setMissing(null)}
        />
      )}

      <ul className="space-y-2">
        {data.map((row) => {
          const { user, submission } = row;
          const isOpen = openId === user.id;
          const artCount = submission.artworkList?.length || 0;
          const hasCv = hasContent(submission.cv);
          const hasNote = hasNoteContent(submission.note);
          const complete = artCount > 0 && hasCv && hasNote;
          const name = nameWithNickname(user);
          return (
            <li key={user.id} className="rounded-xl border border-gray-200">
              <button
                type="button"
                onClick={() => { setOpenId(isOpen ? null : user.id); setDetailTab('artwork'); }}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left hover:bg-gray-50"
              >
                {user.avatar
                  ? <img src={user.avatar} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                  : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gray-100"><User size={14} className="text-gray-400" aria-hidden /></span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900" title={name}>{name}</span>
                  <span className="block text-xs tabular-nums text-gray-500">
                    출품작 {artCount}점 · 약력 {hasCv ? '✓' : '—'} · 작가노트 {hasNote ? '✓' : '—'}
                  </span>
                </span>
                {(submission as any).proxyEdited && <StatusChip className="hidden sm:inline-flex">대신 입력함</StatusChip>}
                <StatusChip variant={complete ? 'done' : 'neutral'}>{complete ? '제출 완료' : '미제출'}</StatusChip>
                <ChevronDown size={16} aria-hidden className={cn('shrink-0 text-gray-400 transition-transform', isOpen && 'rotate-180')} />
              </button>

              {isOpen && (
                <div className="space-y-4 border-t border-gray-100 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 break-all text-sm font-semibold text-gray-900">{name}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {canProxyEdit && (
                        <button
                          type="button"
                          onClick={() => { setProxyOpened((prev) => new Set(prev).add(user.id)); setProxyEditId(proxyEditId === user.id ? null : user.id); }}
                          className={cn('inline-flex min-h-[36px] items-center gap-1 rounded-lg border px-3 text-xs font-medium', proxyEditId === user.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700 hover:bg-gray-50')}
                        >
                          <Edit3 size={12} aria-hidden /> {proxyEditId === user.id ? '대신 입력 닫기' : '대신 입력'}
                        </button>
                      )}
                      <MenuButton
                        label="내려받기"
                        icon={<FileDown size={13} aria-hidden />}
                        items={[
                          { label: '출품리스트 PDF', onSelect: () => openPrint(user.id, 'artwork') },
                          { label: '약력 PDF', onSelect: () => openPrint(user.id, 'cv') },
                          { label: '작가노트 PDF', onSelect: () => openPrint(user.id, 'note') },
                          { label: '작품 원본 (ZIP)', disabled: artCount === 0, onSelect: () => downloadArtistImages(row) },
                        ]}
                      />
                    </div>
                  </div>

                  {/*
                    대신 입력 — 작가 본인이 쓰는 편집기를 그대로 띄운다(검증·임시저장 규칙이 갈라지면 안 된다).
                    자료를 직접 올리기 어려워하는 작가를 갤러리가 도와주는 경로다.
                  */}
                  {proxyOpened.has(user.id) && (
                    <div className={proxyEditId === user.id ? 'rounded-xl border border-gray-200 p-4' : 'hidden'}>
                      {/* 확정 후에도 열어두되, 인쇄물이 이미 나갔을 수 있다는 건 반드시 알린다 */}
                      {confirmed && (
                        <Notice className="mb-4">
                          <b className="font-medium text-gray-900">확정 이후예요.</b> 캡션·도록을 이미 만들었다면 고친 뒤 인쇄물도 다시 확인해 주세요.
                        </Notice>
                      )}
                      <MySubmissionSection
                        exhibitionId={exhibitionId}
                        myUserId={myUserId}
                        confirmed={false}
                        proxyFor={{ id: user.id, name }}
                      />
                    </div>
                  )}

                  {proxyEditId !== user.id && (
                    <>
                      <PageTabBar
                        sticky={false}
                        idPrefix={`sub-${exhibitionId}-${user.id}`}
                        label={`${name} ${SUBMISSION_TERM}`}
                        active={detailTab}
                        onSelect={setDetailTab}
                        tabs={[
                          { id: 'artwork', label: '출품작', count: artCount },
                          { id: 'cv', label: '약력', done: hasCv },
                          { id: 'note', label: '작가노트', done: hasNote },
                        ]}
                      />
                      <SubmissionReadonly submission={submission} activeTab={detailTab} />
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {remindOpen && (
        <DmComposeModal
          open={remindOpen}
          title="출품 자료 제출 안내"
          description="아직 다 내지 않은 작가에게 1:1 메시지로 보내요. 문구는 고쳐서 보낼 수 있어요."
          recipients={incompleteRows.map(({ user, submission }) => ({ id: user.id, name: nameWithNickname(user), note: submissionMissingParts(submission).join(' · ') }))}
          defaultSubject={`[${exhibitionTitle}] 출품 자료 제출 안내`}
          defaultContent={[
            `안녕하세요. ${exhibitionTitle} 운영팀입니다.`,
            '',
            '전시 준비를 위해 아직 내지 않은 출품 자료를 확인해 주세요.',
            '마이페이지 [내 전시]에서 비어 있는 항목을 채워 [갤러리에 제출]을 눌러 주시면 됩니다.',
            '',
            `바로가기: ${window.location.origin}/mypage?tab=applications&ex=${exhibitionId}`,
          ].join('\n')}
          sending={reminderMutation.isPending}
          sendLabel={(n) => `${n}명에게 보내기`}
          onSend={(v) => reminderMutation.mutate(v)}
          onClose={() => setRemindOpen(false)}
        />
      )}
    </div>
  );
}

// 읽기 전용 출품 자료 (갤러리/Admin, 잠긴 작가 화면)
function SubmissionReadonly({ submission, activeTab = 'artwork' }: { submission: OperationSubmission; activeTab?: SubmissionTab }) {
  const { artworkList = [], cv, note } = submission;
  const repIndex = submission.representativeIndex ?? null;
  const empty = <p className="text-sm text-gray-400">비어 있어요.</p>;
  return (
    <div className="text-sm">
      {/* 출품작 — 제목/메타 2줄 + 가격 우측 정렬(제목 길이와 무관하게 컬럼 시작·끝점 고정) */}
      {activeTab === 'artwork' && (artworkList.length === 0 ? empty : (
        <ul className="divide-y divide-gray-100">
          {artworkList.map((a, i) => (
            <li key={i} className="flex items-center gap-3 py-2.5">
              {a.image
                ? <Thumb src={a.image} alt="" className="h-12 w-12 shrink-0 rounded bg-gray-50 object-contain" />
                : <div className="grid h-12 w-12 shrink-0 place-items-center rounded bg-gray-100"><ImageOff size={14} className="text-gray-300" aria-hidden /></div>}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5">
                  <span className="min-w-0 truncate font-medium text-gray-900" title={a.title || undefined}>{a.title || '(제목 없음)'}</span>
                  {repIndex === i && (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-gray-500"><Star size={10} className="fill-gray-900 text-gray-900" aria-hidden /> 대표작</span>
                  )}
                </p>
                {[a.size, a.medium, a.year].some(Boolean) && (
                  <p className="mt-0.5 truncate text-xs text-gray-500">{[a.size, a.medium, a.year].filter(Boolean).join(' · ')}</p>
                )}
              </div>
              {a.price && <span className="shrink-0 tabular-nums text-gray-700">{formatArtworkPrice(a.price)}</span>}
            </li>
          ))}
        </ul>
      ))}
      {/* 약력 */}
      {activeTab === 'cv' && (!hasContent(cv) ? empty : (
        <div className="space-y-1.5 text-gray-700">
          <p>{cv!.nameKo}{cv!.tel ? ` · ${cv!.tel}` : ''}{cv!.email ? ` · ${cv!.email}` : ''}</p>
          {CV_SECTIONS.map(({ key, label }) => (cv![key]?.length > 0) && (
            <p key={key}><span className="text-gray-400">{label}: </span>{cv![key].map(e => `${e.year} ${e.content}`.trim()).join(' / ')}</p>
          ))}
        </div>
      ))}
      {/* 노트 — 전체 노트와 작품별 상세설명(썸네일 + 제목 + 본문)을 구분해서 보여준다 */}
      {activeTab === 'note' && (!hasNoteContent(note) ? empty : (
        <div className="space-y-4">
          {note!.statement && <p className="whitespace-pre-wrap leading-relaxed text-gray-700">{note!.statement}</p>}
          {!!note!.sections?.length && (
            <div>
              <p className="mb-2 text-xs font-medium text-gray-500">작품별 설명 {note!.sections.length}</p>
              <ul className="space-y-3">
                {note!.sections.map((s, i) => {
                  const art = artworkList.find(a => a.title?.trim() === s.title);
                  return (
                    <li key={i} className="flex items-start gap-3">
                      {art?.image
                        ? <Thumb src={art.image} alt="" className="h-12 w-12 shrink-0 rounded bg-gray-50 object-contain" />
                        : <div className="grid h-12 w-12 shrink-0 place-items-center rounded bg-gray-100"><ImageOff size={14} className="text-gray-300" aria-hidden /></div>}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-gray-900">{s.title || '(작품 미선택)'}</p>
                        <p className={cn('mt-0.5 whitespace-pre-wrap', s.body ? 'text-gray-600' : 'text-gray-300')}>{s.body || '설명 없음'}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ============ 작가 본인 정산 내역 (전시종료 후) — 확인 요청 시 수락/문제제기 ============
export function MyArtistSettlementSection({ exhibitionId }: { exhibitionId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ exhibitionTitle: string; ended: boolean; requested?: boolean; settled?: boolean; artist: SettlementArtist | null; myApproval?: { status: string; comment?: string | null; autoApproved?: boolean } | null; fingerprint?: string; autoApproveAt?: string | null; autoApproveDays?: number; cardFeeRate?: number }>({
    queryKey: ['operation-my-settlement', exhibitionId],
    queryFn: () => api.get(`/operations/${exhibitionId}/my-settlement`).then(r => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const [downloading, setDownloading] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [comment, setComment] = useState('');
  const commentRef = useRef<HTMLTextAreaElement>(null);

  const respondMutation = useMutation({
    // fingerprint: 지금 화면에 그린 금액의 지문. 갤러리가 검토 중에 금액을 고칠 수 있으므로
    // 서버가 이걸 대조해 **내가 본 적 없는 금액에 동의하는 사고**를 막는다(불일치 시 409).
    mutationFn: (body: { approve: boolean; comment?: string }) =>
      api.post(`/operations/${exhibitionId}/settlement/respond`, { ...body, fingerprint: data?.fingerprint }),
    onSuccess: (_d, vars) => {
      toast.success(vars.approve ? '정산을 확인(수락)했습니다.' : '문제를 갤러리에 전달했습니다.');
      setIssueOpen(false); setComment('');
      qc.invalidateQueries({ queryKey: ['operation-my-settlement', exhibitionId] });
      qc.invalidateQueries({ queryKey: ['my-applications'] });
    },
    onError: (e: any) => {
      toast.error(e.response?.data?.error || '처리에 실패했습니다.');
      // 금액이 바뀌어 거절된 경우 — 최신 내역을 바로 다시 그려준다
      if (e.response?.status === 409) qc.invalidateQueries({ queryKey: ['operation-my-settlement', exhibitionId] });
    },
  });

  if (isLoading) return <div className="h-24 animate-pulse rounded-xl bg-gray-100" />;
  const requested = !!data?.requested, settled = !!data?.settled;
  // 확인 요청/완료 전에는 작가에게 내역 비공개
  if ((!requested && !settled) || !data?.artist) {
    return <Notice>갤러리가 판매 내역을 정리해 확인을 요청하면 여기에 내 정산 내역이 보여요.</Notice>;
  }
  const a = data.artist;
  const sold = a.works.filter(w => w.sold);
  const myStatus = data.myApproval?.status;

  const downloadMine = async () => {
    setDownloading(true);
    try {
      const { downloadArtistSettlementPdf } = await import('@/lib/operationPdf');
      // forArtist: 작가 본인 문서라 갤러리 몫 금액은 찍지 않는다 (화면 표기와 맞춤)
      const { missing } = await downloadArtistSettlementPdf(data.exhibitionTitle, a, undefined, undefined, { forArtist: true, cardFeeRate: data.cardFeeRate ?? 0 });
      if (missing.length > 0) toast.error(`작품 이미지 ${missing.length}건이 빠졌습니다: ${missing.slice(0, 3).join(', ')}`, { duration: 8000 });
    } catch { toast.error('PDF 생성 실패'); } finally { setDownloading(false); }
  };

  const waiting = requested && !settled && myStatus !== 'APPROVED' && myStatus !== 'ISSUE';
  return (
    <section className="space-y-4">
      {/* 상태 한 줄 — 지금 내가 할 일이 있는가 */}
      {settled ? (
        <Notice title="정산이 완료되었어요">갤러리가 정산을 마감했어요. 아래 내역이 최종이에요.</Notice>
      ) : myStatus === 'APPROVED' ? (
        <Notice title="✓ 정산 내역을 확인했어요">
          {data.myApproval?.autoApproved
            ? '기한 안에 응답이 없어 자동으로 수락 처리되었어요. 문제가 있으면 갤러리에 문의해 주세요.'
            : '갤러리가 정산을 완료하기를 기다리고 있어요.'}
        </Notice>
      ) : myStatus === 'ISSUE' ? (
        <Notice tone="attention" title="문제를 갤러리에 전달했어요">
          “{data.myApproval?.comment}” — 갤러리가 고쳐서 다시 요청하면 새 내역으로 다시 확인할 수 있어요.
        </Notice>
      ) : (
        <Notice tone="attention" title="갤러리가 정산 확인을 요청했어요">
          아래 내역을 보고 맞으면 [정산 확인]을, 틀리면 [문제 제기]를 눌러 주세요.
          {/* 침묵이 동의로 바뀌는 규칙이라, 기한은 반드시 눈에 보여야 한다 */}
          {data.autoApproveAt && <> <b className="font-medium text-gray-900">{longDate(data.autoApproveAt)}까지</b> 응답이 없으면 자동으로 수락돼요.</>}
        </Notice>
      )}

      <div className="rounded-xl border border-gray-200">
        {sold.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gray-400">판매된 작품이 없어요.</p>
        ) : (
          <ul className="divide-y divide-gray-100 px-4">
            {sold.map((w, i) => (
              <li key={i} className="flex items-center gap-3 py-3 text-sm">
                {w.image ? <Thumb src={w.image} alt="" className="h-12 w-12 shrink-0 rounded bg-gray-50 object-contain" /> : <div className="grid h-12 w-12 shrink-0 place-items-center rounded bg-gray-100"><ImageOff size={14} className="text-gray-300" aria-hidden /></div>}
                <span className="min-w-0 flex-1 truncate text-gray-900">{w.title || '(제목 없음)'}</span>
                <span className="shrink-0 tabular-nums text-gray-700">{w.soldPrice.toLocaleString('ko')}원</span>
              </li>
            ))}
          </ul>
        )}
        <dl className="flex flex-wrap gap-x-6 gap-y-1 border-t border-gray-100 px-4 py-3 text-sm">
          <div className="flex gap-1.5"><dt className="text-gray-500">판매 합계</dt><dd className="font-medium tabular-nums text-gray-900">{a.total.toLocaleString('ko')}원</dd></div>
          {/* 수수료를 뗐으면 반드시 보여준다 — 작가가 수락 여부를 판단하는 근거고,
              안 보이면 "판매 합계 × 비율" 과 안 맞아 계산이 틀린 것처럼 읽힌다 */}
          {(a.cardFee ?? 0) > 0 && (
            <>
              <div className="flex gap-1.5"><dt className="text-gray-500">카드 수수료{data.cardFeeRate ? ` (${data.cardFeeRate}%)` : ''}</dt><dd className="font-medium tabular-nums text-gray-900">-{(a.cardFee ?? 0).toLocaleString('ko')}원</dd></div>
              <div className="flex gap-1.5"><dt className="text-gray-500">정산 대상</dt><dd className="font-medium tabular-nums text-gray-900">{(a.settleBase ?? 0).toLocaleString('ko')}원</dd></div>
            </>
          )}
          <div className="flex gap-1.5"><dt className="text-gray-500">비율</dt><dd className="font-medium text-gray-900">갤러리 {a.galleryRatio}% : 작가 {a.artistRatio}%</dd></div>
          <div className="flex gap-1.5"><dt className="text-gray-900">내 정산액</dt><dd className="font-semibold tabular-nums text-gray-950">{a.artistAmount.toLocaleString('ko')}원</dd></div>
        </dl>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {requested && !settled && (
          <>
            <button
              type="button"
              onClick={() => respondMutation.mutate({ approve: true })}
              disabled={respondMutation.isPending || myStatus === 'APPROVED'}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40"
            >
              {myStatus === 'APPROVED' ? <><Check size={15} aria-hidden /> 확인함</> : '정산 확인(수락)'}
            </button>
            <button
              type="button"
              onClick={() => { setIssueOpen(v => !v); window.setTimeout(() => commentRef.current?.focus(), 30); }}
              className={cn('min-h-[44px] rounded-lg border px-4 text-sm', waiting ? 'border-gray-300 text-gray-800 hover:bg-gray-50' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}
            >
              문제 제기
            </button>
          </>
        )}
        <button type="button" onClick={downloadMine} disabled={downloading} className="ml-auto inline-flex min-h-[36px] items-center gap-1 text-xs text-gray-500 hover:text-gray-900 disabled:opacity-50">
          {downloading ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <FileDown size={13} aria-hidden />} 내 정산서 PDF
        </button>
      </div>

      {issueOpen && requested && !settled && (
        <div className="space-y-2">
          <textarea
            ref={commentRef}
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={3}
            placeholder="어떤 점이 틀렸는지 적어 주세요 (예: 판매가·정산 비율이 다릅니다)"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => comment.trim() ? respondMutation.mutate({ approve: false, comment: comment.trim() }) : toast.error('문제 내용을 입력해주세요.')}
            disabled={respondMutation.isPending}
            className="min-h-[40px] rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            갤러리에 전달
          </button>
        </div>
      )}
    </section>
  );
}


// ============ 에디터들 ============

// 출품작 이미지 셀 (compact 업로드)
function ArtworkImageCell({ value, onChange, className = '' }: { value?: string; onChange: (url: string) => void; className?: string }) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const handle = async (raw: File) => {
    setUploading(true);
    try {
      const file = await compressImage(raw);
      if (file.size > MAX_IMAGE_BYTES) { toast.error('이미지 용량이 너무 큽니다.'); return; }
      const fd = new FormData(); fd.append('image', file);
      const res = await api.post('/upload/image', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onChange(res.data.url);
    } catch { toast.error('이미지 업로드 실패'); } finally { setUploading(false); }
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = Array.from(e.dataTransfer.files).find(file => file.type.startsWith('image/'));
    if (f) handle(f);
    else if (e.dataTransfer.files.length) toast.error('이미지 파일만 업로드할 수 있습니다.');
  };
  return (
    <button type="button" onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      title="클릭 또는 이미지를 끌어다 놓기"
      className={`shrink-0 overflow-hidden rounded-lg border border-dashed flex items-center justify-center bg-gray-50 transition-colors ${className || 'w-32 h-32'} ${dragOver ? 'border-gray-600 text-gray-600 bg-gray-100' : 'border-gray-300 text-gray-400 hover:border-gray-400'}`}>
      {/* max-* + contain — 작품 비율은 자르지 않고, 이미지가 칸 높이를 밀어올리지도 않게 한다 */}
      {uploading ? <Loader2 size={20} className="animate-spin" /> : value ? <img src={value} alt="" className="max-w-full max-h-full object-contain" /> : <span className="flex flex-col items-center gap-1 text-xs"><Upload size={20} aria-hidden />작품 사진</span>}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handle(f); e.target.value = ''; }} />
    </button>
  );
}

// 크기 문자열 ↔ 가로/세로 분리는 lib/artwork.ts로 옮겼다 (포트폴리오 작품 정보 입력과 표기를 하나로 맞추기 위해)

// 숫자 전용 입력 새니타이저 — 가로/세로는 소수점 1개 허용(72.7cm), 제작년도/가격은 정수만
const decimalOnly = (v: string) => { const t = v.replace(/[^0-9.]/g, ''); const i = t.indexOf('.'); return i === -1 ? t : t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, ''); };
const digitsOnly = (v: string) => v.replace(/[^0-9]/g, '');

/**
 * 작품 사진 일괄 업로드 — 여러 장을 한 번에 골라 빈 사진 칸부터 채우고, 모자라면 작품을 새로 추가한다.
 * 파일명을 작품명 기본값으로 넣어 어떤 사진인지 바로 알아볼 수 있게 한다(비어 있을 때만).
 */
function BulkImageUpload({ onAdd }: { onAdd: (items: { image: string; title: string }[]) => void }) {
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pick = async (files: File[]) => {
    const images = files.filter(f => f.type.startsWith('image/'));
    if (images.length === 0) { toast.error('이미지 파일만 업로드할 수 있습니다.'); return; }
    setBusy({ done: 0, total: images.length });
    const uploaded: { image: string; title: string }[] = [];
    let failed = 0;
    for (let i = 0; i < images.length; i++) {
      try {
        const file = await compressImage(images[i]!);
        if (file.size > MAX_IMAGE_BYTES) { failed++; continue; }
        const fd = new FormData(); fd.append('image', file);
        const res = await api.post('/upload/image', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        uploaded.push({ image: res.data.url, title: images[i]!.name.replace(/\.[^.]+$/, '') });
      } catch { failed++; }
      setBusy({ done: i + 1, total: images.length });
    }
    setBusy(null);
    if (uploaded.length) onAdd(uploaded);
    if (failed) toast.error(`${failed}장은 올리지 못했습니다.`);
    if (uploaded.length) toast.success(`사진 ${uploaded.length}장을 넣었습니다. 작품 정보를 채워주세요.`);
  };
  return (
    <>
      <button type="button" onClick={() => inputRef.current?.click()} disabled={!!busy}
        className="inline-flex min-h-[40px] items-center gap-1.5 text-sm text-gray-700 hover:text-gray-950 disabled:opacity-50">
        {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Upload size={15} aria-hidden />}
        {busy ? `올리는 중 ${busy.done}/${busy.total}` : '사진 여러 장 한 번에 올리기'}
      </button>
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
        onChange={e => { const fs = Array.from(e.target.files || []); e.target.value = ''; if (fs.length) pick(fs); }} />
    </>
  );
}

function ArtworkListEditor({ value, onChange, onRemoved, stateOf, repIndex, onRepChange, errors, idPrefix }: {
  value: ArtworkItem[];
  onChange: (v: ArtworkItem[]) => void;
  onRemoved?: (i: number) => void;
  stateOf?: (i: number) => SaveState;
  repIndex: number | null;
  onRepChange: (i: number | null) => void;
  /** 작품 번호 → 빈 필수 칸 이름들 (제출을 눌러 본 뒤로만 채워진다) */
  errors: Record<number, string[]>;
  idPrefix: string;
}) {
  const add = () => onChange([...value, { image: '', title: '', size: '', width: '', height: '', medium: '', year: '', price: '' }]);
  // 일괄 업로드: 사진이 비어 있는 기존 작품부터 채우고, 남으면 새 작품으로 추가
  const addImages = (items: { image: string; title: string }[]) => {
    const next = value.map(a => ({ ...a }));
    const queue = [...items];
    for (const a of next) {
      if (queue.length === 0) break;
      if (!a.image) { const it = queue.shift()!; a.image = it.image; if (!a.title.trim()) a.title = it.title; }
    }
    queue.forEach(it => next.push({ image: it.image, title: it.title, size: '', width: '', height: '', medium: '', year: '', price: '' }));
    onChange(next);
  };
  const upd = (i: number, patch: Partial<ArtworkItem>) => onChange(value.map((a, idx) => idx === i ? { ...a, ...patch } : a));
  // 삭제한 위치를 부모에 알린다 — 대표작보다 앞을 지우면 인덱스가 밀려 엉뚱한 작품이 대표작이 된다
  const rm = (i: number) => { onChange(value.filter((_, idx) => idx !== i)); onRemoved?.(i); };
  const inputCls = (bad: boolean) => cn('rounded-lg border px-2.5 py-2 text-sm focus:outline-none', bad ? 'border-accent/60 bg-accent/5 focus:border-accent' : 'border-gray-200 focus:border-gray-400');
  // 단위(cm·원)와 입력 칸의 오른쪽 끝이 같은 세로 열에 오도록 고정 폭
  const unitCol = 'w-7 shrink-0 flex items-center justify-center';
  // 입력 후에도 어느 칸인지 알 수 있도록 항상 보이는 라벨 (placeholder만으론 채우면 사라짐)
  const labelCls = 'mb-1 block text-xs text-gray-500';
  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
          출품할 작품을 넣어 주세요. 사진을 여러 장 한 번에 올리면 작품 칸이 알아서 생겨요.
        </p>
      )}
      {value.map((a, i) => {
        const parsed = splitSize(a.size);
        const w = a.width !== undefined ? a.width : parsed.w;
        const h = a.height !== undefined ? a.height : parsed.h;
        const priceHint = koreanWon(a.price);
        const st: SaveState = stateOf ? stateOf(i) : 'saved';
        const ui = STATE_UI[st];
        const missing = errors[i] ?? [];
        const miss = (label: string) => missing.includes(label);
        const isRep = repIndex === i;
        const blank = isBlankArtwork(a);
        return (
          <div key={i} id={`${idPrefix}-art-${i}`} className={cn('scroll-mt-28 rounded-xl border p-3 sm:p-4', missing.length ? 'border-accent/50' : 'border-gray-200')}>
            {/* 카드 머리 — 번호 · 대표작 · 상태 · 빼기 */}
            <div className="mb-3 flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900">작품 {i + 1}</span>
              <button
                type="button"
                onClick={() => onRepChange(isRep ? null : i)}
                disabled={blank}
                aria-pressed={isRep}
                title={blank ? '작품을 채우면 대표작으로 고를 수 있어요' : isRep ? '대표작 해제' : '이 작품을 대표작으로'}
                className={cn(
                  'inline-flex min-h-[28px] items-center gap-1 rounded-full border px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  isRep ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-900',
                )}
              >
                <Star size={12} aria-hidden className={isRep ? 'fill-white' : ''} /> 대표작
              </button>
              <span className={cn('ml-auto truncate text-xs', ui.text)}>{ui.label}</span>
              <button type="button" onClick={() => rm(i)} className="-my-2 -mr-2 grid h-11 w-11 shrink-0 place-items-center text-gray-400 hover:text-accent" aria-label={`작품 ${i + 1} 빼기`}>
                <Trash2 size={15} />
              </button>
            </div>
            {missing.length > 0 && <p className="mb-3 text-xs text-accent">채워 주세요: {missing.join(' · ')}</p>}
            {/* 모바일: 사진을 위로 쌓는다 (옆에 두면 입력 칸이 짜부라진다) / sm+: 좌측 사진 + 우측 입력 */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
              <div className="flex shrink-0 flex-col sm:w-40">
                {/* 사진 칸을 absolute로 띄워 레이아웃 높이에서 빼면, 카드 높이는 입력 칸들이 정하고
                    사진 아래선이 '제작년도' 박스 아래와 정확히 맞는다 (이미지가 높이를 밀어올리지 않음) */}
                <div className="relative h-40 w-full sm:h-auto sm:flex-1">
                  <ArtworkImageCell value={a.image} onChange={url => upd(i, { image: url })} className="absolute inset-0 h-full w-full" />
                </div>
              </div>
              {/* 입력 칸은 모두 같은 오른쪽 끝에서 멈추고, 단위(cm·원)는 그 오른쪽 고정 폭 열에 세로로 정렬 */}
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="flex items-end gap-1.5">
                  <label className="min-w-0 flex-1">
                    <span className={labelCls}>작품명</span>
                    <input value={a.title} onChange={e => upd(i, { title: e.target.value })} placeholder="예: 푸른 밤의 정원" className={cn('w-full', inputCls(miss('작품명')))} />
                  </label>
                  <span className={unitCol} />
                </div>
                {/* 크기: 세로 × 가로 (cm) — 관례가 높이 먼저다(2026-09-16). `size` 문자열은 캡션·hwp 의 단일 출처 */}
                <div className="flex items-end gap-1.5">
                  <label className="w-0 min-w-0 flex-1">
                    <span className={labelCls}>세로</span>
                    <input value={h} onChange={e => { const v = decimalOnly(e.target.value); upd(i, { height: v, size: composeSize(v, w) }); }} placeholder="0" inputMode="decimal" className={cn('w-full text-center', inputCls(miss('크기')))} />
                  </label>
                  <span className="shrink-0 pb-2 text-sm text-gray-400">×</span>
                  <label className="w-0 min-w-0 flex-1">
                    <span className={labelCls}>가로</span>
                    <input value={w} onChange={e => { const v = decimalOnly(e.target.value); upd(i, { width: v, size: composeSize(h, v) }); }} placeholder="0" inputMode="decimal" className={cn('w-full text-center', inputCls(miss('크기')))} />
                  </label>
                  <span className={`${unitCol} items-end pb-2 text-xs text-gray-500`}>cm</span>
                </div>
                <div className="flex items-end gap-1.5">
                  <label className="min-w-0 flex-1">
                    <span className={labelCls}>재료</span>
                    <input value={a.medium} onChange={e => upd(i, { medium: e.target.value })} placeholder="예: Acrylic on Canvas" className={cn('w-full', inputCls(miss('재료')))} />
                  </label>
                  <span className={unitCol} />
                </div>
                {/* 제작년도 | 가격(단위 '원' + 한글 금액 힌트) */}
                <div className="flex items-start gap-1.5">
                  <label className="min-w-0 flex-1">
                    <span className={`${labelCls} whitespace-nowrap`}>제작년도</span>
                    <input value={a.year} onChange={e => upd(i, { year: digitsOnly(e.target.value).slice(0, 4) })} placeholder="예: 2026" inputMode="numeric" className={cn('w-full', inputCls(miss('제작년도')))} />
                  </label>
                  <label className="relative min-w-0 flex-1">
                    <span className={labelCls}>가격</span>
                    <input value={a.price} onChange={e => upd(i, { price: digitsOnly(e.target.value) })} placeholder="예: 230000" inputMode="numeric" className={cn('w-full text-right', inputCls(miss('가격')))} />
                    {/* 힌트는 absolute — 이 줄이 높아지면 사진 아래선이 제작년도 박스 아래보다 내려간다 */}
                    {priceHint && <span className="absolute right-0 top-full mt-0.5 max-w-full truncate text-[11px] text-gray-400">{priceHint}</span>}
                  </label>
                  <span className={`${unitCol} items-start pt-[1.6rem] text-xs text-gray-500`}>원</span>
                </div>
              </div>
            </div>
            {/* 가격 칸 아래 한글 금액 힌트(absolute)가 들어갈 자리 */}
            <div className="h-4" aria-hidden />
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pt-1">
        <button type="button" onClick={add} className="inline-flex min-h-[40px] items-center gap-1 text-sm text-gray-700 hover:text-gray-950"><Plus size={15} aria-hidden /> 작품 추가</button>
        <BulkImageUpload onAdd={addImages} />
      </div>
    </div>
  );
}

// 작가약력 경력 항목 — 자유 입력 칸(한 줄 = 한 건). 기존 [연도][내용] 데이터는 "연도 내용" 한 줄로 표시.
function EntryListEditor({ label, value, onChange }: { label: string; value: CvEntry[]; onChange: (v: CvEntry[]) => void }) {
  const toText = (entries: CvEntry[]) => entries.map(e => [e.year, e.content].filter(Boolean).join(' ')).join('\n');
  const [raw, setRaw] = useState(() => toText(value));
  useEffect(() => {
    const incoming = toText(value);
    // raw도 저장 시와 동일하게 줄별 trim 후 비교 — 안 그러면 입력 중 끝 공백이 즉시 지워짐(스페이스 안 먹힘)
    const currentNormalized = raw.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
    if (incoming !== currentNormalized) setRaw(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const setText = (text: string) => {
    setRaw(text);
    onChange(text.split('\n').map(l => l.trim()).filter(Boolean).map(line => ({ year: '', content: line })));
  };
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-800">{label}</span>
      <textarea
        value={raw}
        onChange={e => setText(e.target.value)}
        placeholder={`예: 2025 ${label} 참여\n(한 줄에 한 건씩 자유롭게 입력하세요)`}
        rows={4}
        className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm leading-relaxed placeholder:text-gray-300 focus:border-gray-400 focus:outline-none"
      />
    </label>
  );
}

function CvEditor({ value, onChange }: { value: ArtistCv; onChange: (v: ArtistCv) => void }) {
  const set = (patch: Partial<ArtistCv>) => onChange({ ...value, ...patch });
  const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none';
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-xs text-gray-500">이름 (한글)</span><input value={value.nameKo} onChange={e => set({ nameKo: e.target.value })} placeholder="예: 홍길동" className={inputCls} /></label>
        <label className="block"><span className="mb-1 block text-xs text-gray-500">연락처</span><input value={value.tel} onChange={e => set({ tel: formatPhoneNumber(e.target.value) })} placeholder="010-1234-5678" inputMode="numeric" className={inputCls} /></label>
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs text-gray-500">이메일</span><input value={value.email} onChange={e => set({ email: e.target.value })} placeholder="name@example.com" className={inputCls} /></label>
      </div>
      {CV_SECTIONS.map(({ key, label }) => (
        <EntryListEditor key={key} label={label} value={value[key]} onChange={v => set({ [key]: v } as Partial<ArtistCv>)} />
      ))}
    </div>
  );
}

/**
 * 작가노트 — 전체 노트 + 작품별 상세설명.
 * 상세설명 대상은 출품작 — 자유 입력 대신 지금 채운 출품작(제목 있는 것)에서 고른다.
 * 저장 형식은 기존과 같은 작품명 문자열이라 PDF·갤러리 열람은 그대로 동작한다.
 * (2026-09-29: 예전엔 '저장한 작품만' 고를 수 있었다 — 저장 버튼이 하나가 되면서 그 제약이 필요 없어졌다)
 */
function NoteEditor({ value, onChange, artworkList = [], errorAt = -1 }: { value: ArtistNote; onChange: (v: ArtistNote) => void; artworkList?: ArtworkItem[]; errorAt?: number }) {
  const set = (patch: Partial<ArtistNote>) => onChange({ ...value, ...patch });
  const updSection = (i: number, patch: Partial<{ title: string; body: string }>) => set({ sections: value.sections.map((s, idx) => idx === i ? { ...s, ...patch } : s) });
  const rmSection = (i: number) => set({ sections: value.sections.filter((_, idx) => idx !== i) });
  const titled = artworkList.filter(a => a.title?.trim());
  // 한 작품에 상세설명은 하나만 — 이미 쓴 작품은 다른 칸에서 선택 불가
  const usedElsewhere = (exceptIdx: number) => new Set(value.sections.filter((_, idx) => idx !== exceptIdx).map(s => s.title).filter(Boolean));
  const allUsed = titled.length > 0 && titled.every(a => value.sections.some(s => s.title === a.title.trim()));
  const addSection = () => {
    const used = new Set(value.sections.map(s => s.title).filter(Boolean));
    const next = titled.find(a => !used.has(a.title.trim()));
    set({ sections: [...value.sections, { title: next ? next.title.trim() : '', body: '' }] });
  };
  return (
    <div className="space-y-6">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-800">작가노트</span>
        <span className="mb-2 block text-xs text-gray-500">작품 세계 전반에 대한 글이에요. 도록·작가노트 PDF에 그대로 들어가요.</span>
        <textarea value={value.statement} onChange={e => set({ statement: e.target.value })} placeholder="작품 세계 전반에 대한 이야기를 자유롭게 작성하세요." className="h-44 w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm leading-relaxed focus:border-gray-400 focus:outline-none" />
      </label>
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-gray-800">작품별 설명 <span className="font-normal text-gray-400">(선택)</span></span>
          <button type="button" onClick={addSection} disabled={titled.length === 0 || allUsed} title={allUsed ? '모든 출품작에 설명을 썼어요.' : ''} className="inline-flex min-h-[36px] items-center gap-1 text-xs text-gray-600 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40"><Plus size={13} aria-hidden /> 설명 추가</button>
        </div>
        {titled.length === 0 ? (
          <p className="text-xs text-gray-400">[출품작] 탭에서 작품명을 적으면 여기서 그 작품을 골라 설명을 쓸 수 있어요.</p>
        ) : value.sections.length === 0 ? (
          <p className="text-xs text-gray-400">작품마다 따로 설명을 적고 싶을 때 추가하세요.</p>
        ) : (
          <div className="space-y-2">
            {value.sections.map((s, i) => {
              const matched = titled.find(a => a.title.trim() === s.title);
              const orphan = !!s.title && !matched; // 옛 데이터: 출품리스트에 없는 제목 — 선택지를 유지해 값이 사라지지 않게
              const used = usedElsewhere(i);
              const bad = errorAt === i;
              return (
                // 좌: 작품 이미지 / 우: 작품 선택 + 설명
                <div key={i} className={cn('flex gap-3 rounded-xl border p-3', bad ? 'border-accent/50' : 'border-gray-200')}>
                  {matched?.image ? (
                    <img src={matched.image} alt="" className="min-h-[7rem] w-24 shrink-0 self-stretch rounded bg-gray-50 object-contain sm:w-32" />
                  ) : (
                    <div className="grid min-h-[7rem] w-24 shrink-0 place-items-center self-stretch rounded bg-gray-100 sm:w-32"><ImageOff size={20} className="text-gray-300" aria-hidden /></div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex items-end gap-2">
                      <label className="min-w-0 flex-1">
                        <span className={cn('mb-1 block text-xs', bad ? 'text-accent' : 'text-gray-500')}>{bad ? '어느 작품의 설명인지 골라 주세요' : '작품'}</span>
                        <select value={s.title} onChange={e => updSection(i, { title: e.target.value })} className={cn('w-full rounded-lg border bg-white px-2.5 py-2 text-sm', bad ? 'border-accent/60' : 'border-gray-200')}>
                          <option value="">작품 선택…</option>
                          {titled.map((a, ai) => {
                            const t = a.title.trim();
                            return <option key={ai} value={t} disabled={used.has(t)}>{ai + 1}. {t}{used.has(t) ? ' (이미 작성됨)' : ''}</option>;
                          })}
                          {orphan && <option value={s.title}>{s.title} (출품작에 없음)</option>}
                        </select>
                      </label>
                      <button type="button" onClick={() => rmSection(i)} className="-mr-1 grid h-10 w-10 shrink-0 place-items-center text-gray-400 hover:text-accent" aria-label={`설명 ${i + 1} 빼기`}><Trash2 size={15} /></button>
                    </div>
                    <label className="flex min-h-0 flex-1 flex-col">
                      <span className="mb-1 block text-xs text-gray-500">설명</span>
                      <textarea value={s.body} onChange={e => updSection(i, { body: e.target.value })} placeholder="선택한 작품에 대한 설명" className="min-h-[5rem] w-full flex-1 resize-y rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:border-gray-400 focus:outline-none" />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
