/**
 * ApplicantManager - 지원자 관리 (갤러리 오너·위임 갤러리·Admin, 인라인 공용 컴포넌트)
 *
 * MyPage '내 공모' 카드의 [지원자] 탭과 Admin [주최 공모] 안에서 창 이동 없이 지원자를 전부 관리한다.
 * 기능: 상태 탭 / 일괄 선택·수락·거절 / 수락 확인(되돌릴 수 없음) / 지원자별 지원서 PDF + 전체 ZIP /
 *       첫 지원·N번째 표시 / 연락처 / 작품 사진 클릭 확대(원본 비율) / 추가 질문 답변 / 초대 코드(접어 둠).
 *
 * ── 2026-09-29 개편 ─────────────────────────────────────────
 *  - 수락·거절이 각 줄의 '접수 ▾' 드롭다운에 숨어 있었다 — 처음 보면 **상태 표시**로 읽혔고, 지원서를 펼치지 않고도
 *    수락됐다. 지금은 지원서를 펼친 아래에 **[수락하기]·[거절]** 버튼. 거절도 확인을 거친다(작가에게 결과 알림이 간다).
 *  - '수락 (확정)' → '수락됨' — '확정' 은 전시 단계 이름이다(`lib/flowLabels.ts`).
 *  - 초대 코드 상자가 목록 **맨 위**를 차지했다(이미 선정이 끝난 공모를 옮겨 올 때만 쓰는 기능). 목록 아래 한 줄로 접었다.
 *  - 노랑(첫 지원)·파랑(선택)·검정(초대)·파랑(코드) 배지 → 글자.
 *  - **고를 수 있는 건 '검토 대기'뿐** — 수락·거절 탭에도 체크박스와 [선택 수락]·[선택 거절]이 떠서 이미 수락한 작가를
 *    다시 바꿀 수 있는 것처럼 보였다(2026-09-29 로컬 확인 중 지적). 일괄 처리는 결정을 내리는 도구라 결정할 게 남은 줄에만 둔다.
 *    상태 칩도 ▾ 바로 옆에 두면 옛 상태 드롭다운('접수 ▾')처럼 읽혀 이름 옆으로 옮겼다.
 *
 * API: GET /exhibitions/:id/applications, PATCH /exhibitions/:id/applications/:appId
 *  - 서버 규칙: 접수 → 수락/거절, 거절 → 수락만, 수락 → (개발자 도구 켜짐일 때만) 거절
 */
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { ChevronDown, FileText, FileArchive, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { nameWithNickname, cn } from '@/lib/utils';
import { applicationStatusView } from '@/lib/flowLabels';
import ImageLightbox from '@/components/shared/ImageLightbox';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import ApplicationContent from '@/components/shared/ApplicationContent';
import MissingImagesBanner from '@/components/shared/MissingImagesBanner';
import JoinCodePanel from '@/components/shared/JoinCodePanel';
import PageTabBar from '@/components/shared/PageTabBar';
import StatusChip from '@/components/flow/StatusChip';
import Disclosure from '@/components/flow/Disclosure';
import { downloadApplicationPdf, downloadAllApplicationsZip } from '@/lib/operationPdf';
import type { CustomField } from '@/types';

type StatusTab = 'ALL' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';
const isPending = (s: string) => s === 'SUBMITTED' || s === 'REVIEWED';

interface Props {
  exhibitionId: number;
  exhibitionTitle: string;
  customFields?: CustomField[] | null;
  /** 선정 인원(정원) — '수락 3/5 · 2자리 남음'. 모르면 숫자만 */
  capacity?: number | null;
  /** 도구 줄 오른쪽에 붙일 것(작가 초대·추가 질문 수정) — 부르는 화면마다 다르다 */
  toolbar?: ReactNode;
}

export default function ApplicantManager({ exhibitionId, exhibitionTitle, customFields, capacity, toolbar }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<StatusTab>('ALL');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [pdfBusy, setPdfBusy] = useState<number | 'all' | null>(null);
  // 진행률은 토스트가 아니라 **버튼 라벨**에 넣는다(토스트는 사라져서 "멈춘 줄" 알게 된다는 신고, 2026-08)
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  // 사진을 못 받은 지원자 — 배너로 남겨 [다시 받기]로 이어지게 한다
  const [missingPhotos, setMissingPhotos] = useState<string[]>([]);
  const [acceptTarget, setAcceptTarget] = useState<{ type: 'single'; appId: number; name: string } | { type: 'batch' } | null>(null);
  const [rejectTarget, setRejectTarget] = useState<{ type: 'single'; appId: number; name: string } | { type: 'batch' } | null>(null);
  const [revertTarget, setRevertTarget] = useState<number | null>(null);

  const { data: applicants = [], isLoading, isError } = useQuery<any[]>({
    queryKey: ['exhibition-applicants', exhibitionId],
    queryFn: () => api.get(`/exhibitions/${exhibitionId}/applications`).then(r => r.data),
  });

  // Admin 개발자 도구 전역 플래그 — ON이면 수락한 지원을 거절로 되돌릴 수 있음
  const { data: flags } = useQuery<{ allowAcceptedRevert: boolean }>({
    queryKey: ['feature-flags'],
    queryFn: () => api.get('/settings/flags').then(r => r.data),
    staleTime: 60_000,
  });
  const allowRevert = !!flags?.allowAcceptedRevert;

  // 초대 코드가 켜져 있는지 — 접힌 줄에서도 보이게(JoinCodePanel 과 같은 쿼리 키라 한 번만 받는다)
  const { data: joinCodeState } = useQuery<{ code: string | null }>({
    queryKey: ['join-code', exhibitionId],
    queryFn: () => api.get(`/exhibitions/${exhibitionId}/join-code`).then(r => r.data),
    staleTime: 60_000,
  });

  // 상태 변경 후 목록/카운트(운영 오버뷰·공모 목록·운영페이지 제출정보)까지 갱신
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['exhibition-applicants', exhibitionId] });
    queryClient.invalidateQueries({ queryKey: ['my-operation-overview'] });
    queryClient.invalidateQueries({ queryKey: ['my-exhibitions'] });
    queryClient.invalidateQueries({ queryKey: ['operation-submissions'] });
    queryClient.invalidateQueries({ queryKey: ['join-code', exhibitionId] }); // 초대 코드 상자의 '선정 N/M명'
  };

  const updateStatus = useMutation({
    mutationFn: ({ appId, status }: { appId: number; status: string }) =>
      api.patch(`/exhibitions/${exhibitionId}/applications/${appId}`, { status }),
    onSuccess: (_d, v) => { invalidate(); toast.success(v.status === 'ACCEPTED' ? '수락했습니다. 작가에게 알림이 갑니다.' : v.status === 'REJECTED' ? '거절했습니다. 작가에게 결과 알림이 갑니다.' : '상태를 바꿨습니다.'); },
    onError: (e: any) => toast.error(e.response?.data?.error || '상태 변경 실패'),
  });

  const [batchPending, setBatchPending] = useState(false);
  const batchUpdate = async (status: 'ACCEPTED' | 'REJECTED') => {
    if (selectedCount === 0 || batchPending) return;   // 이중 클릭이면 PATCH 가 두 벌 나갔다(2026-09-19)
    setBatchPending(true);
    try {
      // 검토 대기인 것만 — 골라 둔 뒤 한 줄씩 수락·거절한 지원이 섞여 있으면 건너뛴다
      //   (그대로 보내면 '같은 상태' 400·수락 되돌리기 403 이 실패로 세어져 헷갈린다)
      const targets = applicants.filter(a => selectedIds.has(a.id) && isPending(a.status)).map(a => a.id);
      const results = await Promise.allSettled(targets.map(appId =>
        api.patch(`/exhibitions/${exhibitionId}/applications/${appId}`, { status })));
      invalidate();
      const ok = results.filter(r => r.status === 'fulfilled').length;
      const fail = results.length - ok;
      // 실패 이유도 같이 — 일괄 수락이 선정 인원(정원)에 걸리면 '몇 건 실패'만으로는 왜인지 모른다(2026-09-27)
      const reason = (results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined)?.reason?.response?.data?.error;
      if (fail === 0) toast.success(`${ok}명을 ${status === 'ACCEPTED' ? '수락' : '거절'}했습니다.`);
      else toast.error(`${ok}건 처리, ${fail}건 실패${reason ? ` — ${reason}` : ''}`, { duration: 6000 });
      setSelectedIds(new Set());
    } finally { setBatchPending(false); }
  };

  const handlePdf = async (app: any) => {
    setPdfBusy(app.id);
    setProgress(null);
    try {
      const { missing } = await downloadApplicationPdf(exhibitionTitle, app, customFields,
        (done, total, phase) => setProgress({ done, total, label: phase === 'retry' ? '재시도' : '사진' }));
      if (missing > 0) toast.error(`작품 사진 ${missing}장을 받지 못해 PDF에 빠졌습니다. 다시 시도해 보세요.`, { duration: 8000 });
    }
    catch { toast.error('PDF 생성에 실패했습니다.'); }
    finally { setPdfBusy(null); setProgress(null); }
  };

  const handleZip = async () => {
    if (applicants.length === 0) return;
    setPdfBusy('all');
    setProgress(null);
    try {
      const { count, missing } = await downloadAllApplicationsZip(exhibitionTitle, applicants, customFields,
        (done, total, phase) => setProgress({ done, total, label: phase === 'retry' ? '재시도' : phase === 'pdf' ? 'PDF' : '사진' }));
      // 사진이 빠진 채로 나갔으면 **사라지는 토스트에만** 의존하지 않는다 — 배너로 남겨 다시 받을 수 있게.
      setMissingPhotos(missing);
      if (missing.length > 0) toast.success(`${count}명의 지원서를 ZIP으로 받았습니다. (사진 누락 ${missing.length}명)`);
      else toast.success(`${count}명의 지원서를 ZIP으로 받았습니다.`);
    } catch { toast.error('ZIP 생성에 실패했습니다.'); }
    finally { setPdfBusy(null); setProgress(null); }
  };

  const counts = {
    ALL: applicants.length,
    SUBMITTED: applicants.filter(a => isPending(a.status)).length,
    ACCEPTED: applicants.filter(a => a.status === 'ACCEPTED').length,
    REJECTED: applicants.filter(a => a.status === 'REJECTED').length,
  };
  const filtered = statusFilter === 'ALL' ? applicants
    : statusFilter === 'SUBMITTED' ? applicants.filter(a => isPending(a.status))
      : applicants.filter(a => a.status === statusFilter);
  // 일괄 선택은 **검토 대기**만 — 수락·거절한 지원은 한 줄씩 펼쳐서 다룬다(되돌리기 규칙이 서로 다르다)
  const selectable = filtered.filter(a => isPending(a.status));
  const anySelectable = selectable.length > 0;
  const allFilteredSelected = anySelectable && selectable.every(a => selectedIds.has(a.id));
  const toggleSelectAll = () => {
    const next = new Set(selectedIds);
    if (allFilteredSelected) selectable.forEach(a => next.delete(a.id));
    else selectable.forEach(a => next.add(a.id));
    setSelectedIds(next);
  };
  const toggleSelect = (appId: number) => {
    const next = new Set(selectedIds);
    if (next.has(appId)) next.delete(appId); else next.add(appId);
    setSelectedIds(next);
  };

  // 고른 것 중 아직 검토 대기인 것 — 화면의 'N명 선택'·확인창 숫자가 실제로 처리될 수와 같아야 한다
  const selectedCount = applicants.filter(a => selectedIds.has(a.id) && isPending(a.status)).length;
  const accepted = counts.ACCEPTED;
  const left = capacity != null ? Math.max(0, capacity - accepted) : null;

  // 초대 코드 — 목록 아래 한 줄로 접어 둔다. 지원자 0명이어도 보여야 한다(옮겨 온 공모는 코드를 돌리기 전엔 늘 0명이다)
  const joinCode = (
    <div className="border-t border-gray-100 pt-3">
      <Disclosure variant="link" title="이미 선정한 작가를 초대 코드로 데려오기" meta={joinCodeState?.code ? '코드 켜짐' : undefined}>
        <JoinCodePanel exhibitionId={exhibitionId} bare />
      </Disclosure>
    </div>
  );

  if (isLoading) return <div className="h-24 animate-pulse rounded-xl bg-gray-100" />;
  if (isError) return <p className="py-6 text-center text-sm text-gray-400">지원자 목록을 불러오지 못했습니다.</p>;

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-gray-600">
        수락 <b className="font-semibold tabular-nums text-gray-950">{accepted}{capacity != null ? `/${capacity}` : ''}</b>명
        {left != null && <span className="text-gray-400"> · {left > 0 ? `${left}자리 남음` : '정원이 찼어요'}</span>}
        {counts.SUBMITTED > 0 && <span className="text-gray-400"> · 검토 대기 {counts.SUBMITTED}명</span>}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {toolbar}
        {applicants.length > 0 && (
          <button
            type="button"
            onClick={handleZip}
            disabled={pdfBusy !== null}
            className="inline-flex min-h-[36px] items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-950 disabled:opacity-50"
          >
            {pdfBusy === 'all' ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <FileArchive size={13} aria-hidden />}
            {pdfBusy === 'all' && progress ? `${progress.label} ${progress.done}/${progress.total}` : '지원서 전체 받기 (ZIP)'}
          </button>
        )}
      </div>
    </div>
  );

  if (applicants.length === 0) return (
    <div className="space-y-4">
      {header}
      <p className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
        아직 지원자가 없어요. 공고가 모집공고 목록에 올라가 있고, 마감일까지 지원을 받습니다.
      </p>
      {joinCode}
    </div>
  );

  return (
    <div className="space-y-4">
      {header}

      <PageTabBar<StatusTab>
        sticky={false}
        idPrefix={`applicants-${exhibitionId}`}
        label="지원자 상태"
        active={statusFilter}
        onSelect={(t) => { setStatusFilter(t); setSelectedIds(new Set()); }}
        tabs={[
          { id: 'ALL', label: '전체', count: counts.ALL },
          { id: 'SUBMITTED', label: '검토 대기', count: counts.SUBMITTED },
          { id: 'ACCEPTED', label: '수락', count: counts.ACCEPTED },
          { id: 'REJECTED', label: '거절', count: counts.REJECTED },
        ]}
      />

      {/* 사진 누락 배너 — 토스트와 달리 사라지지 않는다. 다시 받기는 이미 받은 사진을 재사용하므로 금방 끝난다. */}
      <MissingImagesBanner
        items={missingPhotos}
        what="지원서에 들어갈 작품 사진"
        busy={pdfBusy !== null}
        onRetry={handleZip}
        onDismiss={() => setMissingPhotos([])}
      />

      {/* 일괄 선택 — 결정할 게 남은(검토 대기) 줄이 있을 때만 */}
      {anySelectable && (
        <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} className="h-4 w-4 rounded" />
            {selectedCount > 0
              ? <span className="font-medium text-gray-900">{selectedCount}명 선택</span>
              : statusFilter === 'SUBMITTED' ? '전체 선택' : `검토 대기 ${selectable.length}명 모두 선택`}
          </label>
          {selectedCount > 0 && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setAcceptTarget({ type: 'batch' })} disabled={batchPending} className="min-h-[36px] rounded-lg bg-gray-900 px-3 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-40">
                {batchPending ? '처리 중…' : '선택 수락'}
              </button>
              <button type="button" onClick={() => setRejectTarget({ type: 'batch' })} disabled={batchPending} className="min-h-[36px] rounded-lg border border-gray-200 px-3 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                선택 거절
              </button>
              <button type="button" onClick={() => setSelectedIds(new Set())} className="min-h-[36px] px-1 text-xs text-gray-500 hover:text-gray-900">해제</button>
            </div>
          )}
        </div>
      )}

      {/* 목록 */}
      {filtered.length === 0 ? (
        <p className="py-4 text-sm text-gray-400">이 상태의 지원자가 없어요.</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map(app => {
            const isExpanded = expandedId === app.id;
            const isSelected = selectedIds.has(app.id);
            const view = applicationStatusView(app.status, 'gallery');
            const name = nameWithNickname(app.user);
            const meta = [
              new Date(app.createdAt).toLocaleDateString('ko'),
              app.isFirstApplication ? '이 갤러리 첫 지원' : app.galleryApplicationOrder ? `이 갤러리 ${app.galleryApplicationOrder}번째 지원` : null,
              // 내가 둘러보기에서 초대한 작가 — 지원서 없이 포트폴리오로 간편 지원한 건이라 구분해서 보여준다
              app.invited ? '초대한 작가' : null,
              // 초대 코드로 들어온 작가 — 지원서 없이 곧바로 수락된 건이라 약력·작품이 비어 있을 수 있다
              app.joinedVia === 'CODE' ? '초대 코드로 참여' : null,
            ].filter(Boolean).join(' · ');
            return (
              <li key={app.id} className={cn('rounded-xl border transition-colors', isSelected ? 'border-gray-400 bg-gray-50' : 'border-gray-200')}>
                <div className="flex items-center gap-3 px-3 py-2 sm:px-4">
                  {/* 체크박스는 검토 대기 줄에만. 같은 목록에 섞여 있으면 빈 자리를 둬 이름 줄이 어긋나지 않게 */}
                  {isPending(app.status)
                    ? <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(app.id)} aria-label={`${name} 선택`} className="h-5 w-5 shrink-0 rounded sm:h-4 sm:w-4" />
                    : anySelectable && <span aria-hidden className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" />}
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : app.id)}
                    aria-expanded={isExpanded}
                    className="flex min-h-[48px] min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    {app.user?.avatar && <img src={app.user.avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />}
                    <span className="min-w-0 flex-1">
                      {/* 상태는 이름 옆 — ▾ 옆에 두면 옛 상태 드롭다운처럼 보였다 */}
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium text-gray-900">{name}</span>
                        <StatusChip variant={view.variant} className="shrink-0">{view.label}</StatusChip>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-gray-500">{meta}</span>
                    </span>
                    <ChevronDown size={16} aria-hidden className={cn('shrink-0 text-gray-400 transition-transform', isExpanded && 'rotate-180')} />
                  </button>
                </div>

                {isExpanded && (
                  <div className="space-y-4 border-t border-gray-100 px-3 pb-4 pt-3 sm:px-4 sm:pl-11">
                    {/* 연락처 + 개별 지원서 PDF */}
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 text-sm text-gray-600">
                        <button type="button" onClick={() => navigate(`/portfolio/${app.user?.id}`)} className="font-medium text-gray-900 underline-offset-4 hover:underline">{name}</button>
                        {app.user?.phone && <> · {app.user.phone}</>}
                        {app.user?.email && <> · <span className="break-all">{app.user.email}</span></>}
                      </p>
                      <button
                        type="button"
                        onClick={() => handlePdf(app)}
                        disabled={pdfBusy !== null}
                        className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-950 disabled:opacity-50"
                      >
                        {pdfBusy === app.id ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <FileText size={13} aria-hidden />}
                        {pdfBusy === app.id && progress ? `${progress.label} ${progress.done}/${progress.total}` : '지원서 PDF'}
                      </button>
                    </div>

                    <ApplicationContent app={app} customFields={customFields} onImageClick={(images, index) => setLightbox({ images, index })} />

                    {/* 결정 — 지원서를 읽은 자리에서 한다 */}
                    <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                      {isPending(app.status) && (
                        <>
                          <button type="button" onClick={() => setAcceptTarget({ type: 'single', appId: app.id, name })} disabled={updateStatus.isPending} className="min-h-[44px] rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40">수락하기</button>
                          <button type="button" onClick={() => setRejectTarget({ type: 'single', appId: app.id, name })} disabled={updateStatus.isPending} className="min-h-[44px] rounded-lg border border-gray-200 px-4 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">거절</button>
                        </>
                      )}
                      {app.status === 'REJECTED' && (
                        <>
                          <span className="text-sm text-gray-500">거절한 지원이에요.</span>
                          <button type="button" onClick={() => setAcceptTarget({ type: 'single', appId: app.id, name })} disabled={updateStatus.isPending} className="min-h-[40px] rounded-lg border border-gray-200 px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">수락으로 바꾸기</button>
                        </>
                      )}
                      {app.status === 'ACCEPTED' && (
                        <>
                          <span className="text-sm text-gray-600">수락한 작가예요. [운영] 탭의 출품 자료에서 이 작가의 자료를 볼 수 있어요.</span>
                          {allowRevert && (
                            <button type="button" onClick={() => setRevertTarget(app.id)} className="min-h-[40px] px-1 text-xs text-gray-500 underline-offset-4 hover:text-accent hover:underline">거절로 되돌리기</button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {joinCode}

      {/* 수락 확인 (되돌릴 수 없음) */}
      <ConfirmDialog
        open={acceptTarget !== null}
        title={acceptTarget?.type === 'single' ? `${acceptTarget.name} 님을 수락할까요?` : `${selectedCount}명을 수락할까요?`}
        details={[
          '수락하면 되돌릴 수 없어요.',
          '작가에게 선정 알림이 가고, 작가는 출품 자료를 내기 시작해요.',
          ...(capacity != null ? [`정원 ${capacity}명 중 지금 ${accepted}명이 수락되어 있어요.`] : []),
        ]}
        confirmText="수락하기"
        onConfirm={() => {
          if (acceptTarget?.type === 'single') updateStatus.mutate({ appId: acceptTarget.appId, status: 'ACCEPTED' });
          else if (acceptTarget?.type === 'batch') batchUpdate('ACCEPTED');
          setAcceptTarget(null);
        }}
        onCancel={() => setAcceptTarget(null)}
      />

      {/* 거절 확인 — 작가에게 결과 알림이 가므로 잘못 눌러선 안 된다 */}
      <ConfirmDialog
        open={rejectTarget !== null}
        title={rejectTarget?.type === 'single' ? `${rejectTarget.name} 님의 지원을 거절할까요?` : `${selectedCount}명을 거절할까요?`}
        details={['작가에게 결과 알림이 가요.', '나중에 마음이 바뀌면 [수락으로 바꾸기]로 수락할 수 있어요.']}
        confirmText="거절"
        onConfirm={() => {
          if (rejectTarget?.type === 'single') updateStatus.mutate({ appId: rejectTarget.appId, status: 'REJECTED' });
          else if (rejectTarget?.type === 'batch') batchUpdate('REJECTED');
          setRejectTarget(null);
        }}
        onCancel={() => setRejectTarget(null)}
      />

      {/* 수락 → 거절 되돌리기 확인 (개발자 도구 활성화 시에만 진입 가능) */}
      <ConfirmDialog
        open={revertTarget !== null}
        title="수락을 거절로 되돌리기"
        details={[
          '이 작가가 낸 출품 자료(출품리스트·약력·작가노트)가 모두 삭제돼요.',
          '이 작가의 판매·정산 기록도 함께 삭제돼요.',
          '정원 자리가 하나 다시 비어요.',
          '삭제된 자료는 복구할 수 없어요.',
        ]}
        confirmText="거절로 되돌리기"
        variant="danger"
        onConfirm={() => {
          if (revertTarget !== null) updateStatus.mutate({ appId: revertTarget, status: 'REJECTED' });
          setRevertTarget(null);
        }}
        onCancel={() => setRevertTarget(null)}
      />

      {/* 이미지 라이트박스 — 원본 비율 */}
      <AnimatePresence>
        {lightbox && (
          <ImageLightbox images={lightbox.images} initialIndex={lightbox.index} onClose={() => setLightbox(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
