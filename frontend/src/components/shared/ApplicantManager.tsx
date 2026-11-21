/**
 * ApplicantManager - 지원자 관리 (갤러리 오너·위임 갤러리·Admin, 인라인 공용 컴포넌트)
 *
 * MyPage '내 공모' 카드의 [지원자] 탭과 Admin [주최 공모] 안에서 창 이동 없이 지원자를 전부 관리한다.
 * 기능: 상태 탭 / 일괄 선택·수락 / 수락 확인(되돌릴 수 없음) / 지원자별 지원서 PDF + 전체 ZIP /
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
 * ── 2026-10-03 공모 흐름 점검 후속 ─────────────────────────────
 *  - **[모집 인원 변경]** — 정원이 차면 "수정 요청을 보내라" 고 했는데 보낼 곳이 없었다. 갤러리 주최 공모는 그 갤러리가,
 *    아트링크 주최 공모는 관리자가 여기서 직접 고친다(`capacityEditable`). 수락한 수보다 적게는 못 줄인다(서버가 같은 잠금 안에서 센다).
 *  - **전시가 끝나면 결정을 잠근다**(`ended`) — 정산 중에 거절 → 수락이 되면 정산 대상이 늘어 완료가 막히고, 수락 → 거절은
 *    판매 기록이 있는 작가를 빼 버린다. 서버도 400(관리자 예외). 초대 코드 줄도 감춘다(끝난 공모에는 코드를 못 쓴다).
 *  - **공모만 진행**(`recruitOnly`) 공고에서 '출품 자료' 를 말하지 않는다 — 그 공고엔 그 단계가 없다.
 *
 * ── 2026-11-21 수락만 · 접수가 끝난 뒤 ~ 선정 마감일(규칙 90) ─────────────────────
 *  - 접수 중엔 지원서를 읽기만 한다 — 결정 줄에 이유 한 줄(`DECIDE_AFTER_CLOSE`), 체크박스·일괄 줄 없음.
 *    작가가 그동안 지원서를 고치거나 취소할 수 있어서다(사용자 결정 — "결정한 뒤에 고치는 경우가 없게, 선정은 마감 뒤에").
 *    접수가 끝났다 = 모집 마감을 눌렀거나 접수 마감일이 지났다.
 *  - **[거절]·[선택 거절]은 없다**(사용자 결정 — "안 뽑으면 그게 거절"). 수락하지 않은 지원은 선정이 끝날 때(선정 마감일이 지나면 ·
 *    옛 공고는 [선정 마치기] · 전시 확정·종료) 알림 없이 미선정(`closedOutAt`) — **되돌릴 수 없다**(버튼이 없다).
 *  - [선정 마감일 변경] — 그날이 지나기 전까지(`capacityEditable` 과 같은 사람 = 주최자). 작가가 고친 지원서는 '11.22 수정'(`editedAt`).
 *
 * API: GET /exhibitions/:id/applications, PATCH /exhibitions/:id/applications/:appId, PATCH /exhibitions/:id/capacity · /selection-deadline
 *  - 서버 규칙: 검토 대기 → 수락만 · 결과가 난 지원은 그대로 · 수락 → (개발자 도구 켜짐일 때만) 거절 · 전시 종료 뒤엔 갤러리는 못 바꾼다
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { ArrowLeft, ChevronLeft, ChevronRight, FileText, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { nameWithNickname, cn, getDday, CAPACITY_MAX, capacityLimit, capacityText, capacityWithLimit, capacityPayload, type CapacityMask } from '@/lib/utils';
import CapacityPicker, { type CapacityValue } from '@/components/shared/CapacityPicker';
import { applicationStatusView } from '@/lib/flowLabels';
import { DECIDE_AFTER_CLOSE, SELECTION_REMIND_DAYS, closedOutByDeadline, selectionDeadlinePassed, selectionStarted } from '@/lib/applicationWindow';
import { addDays, todayKst, toYmd } from '@/lib/scheduleCalendar';
import SchedulePicker from '@/components/shared/SchedulePicker';
import { shortDate } from '@/lib/listings';
import ImageLightbox from '@/components/shared/ImageLightbox';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import ApplicationContent from '@/components/shared/ApplicationContent';
import MissingImagesBanner from '@/components/shared/MissingImagesBanner';
import JoinCodePanel from '@/components/shared/JoinCodePanel';
import Thumb from '@/components/shared/Thumb';
import MenuButton from '@/components/flow/MenuButton';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useEscapeKey } from '@/hooks/useEscapeKey';
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
  /** 공고에 0명·00명으로 적었으면 'ONE'·'TWO' — capacity 는 그 한도(9·99) */
  capacityMask?: 'ONE' | 'TWO' | null;
  /** 도구 줄 오른쪽에 붙일 것(작가 초대·추가 질문 수정) — 부르는 화면마다 다르다 */
  toolbar?: ReactNode;
  /** 공모만 진행(수락에서 끝) — 확인창·수락 줄에서 출품 자료를 말하지 않는다 */
  recruitOnly?: boolean;
  /** 전시가 끝났는가 — 갤러리는 더 이상 수락·거절할 수 없다(관리자는 예외, 서버와 같은 규칙) */
  ended?: boolean;
  /** 모집을 마감했는가 — 수락은 접수가 끝난 뒤에만(규칙 90, 관리자도). 모르면 마감한 것으로 본다 */
  recruitmentClosed?: boolean;
  /** 접수 마감일 — 지나면 마감을 안 눌렀어도 선정을 시작한다 */
  deadline?: string | null;
  /** 선정 마감일(새 공고) — 지나면 더 수락할 수 없다. 옛 공고는 null */
  selectionDeadline?: string | null;
  /** 출품 자료 마감일 — [선정 마감일 변경]은 그 전날까지 */
  submissionDeadline?: string | null;
  /** 여기서 모집 인원·선정 마감일을 고칠 수 있는가(주최자가 정하는 값) — 갤러리 주최 공모의 갤러리 · 아트링크 주최 공모의 관리자 */
  capacityEditable?: boolean;
  /** 고른(검토 대기) 지원자 수가 바뀔 때 — 공모 한 건 화면이 휴대폰 하단 줄을 일괄 줄에 내준다 */
  onSelectionChange?: (n: number) => void;
  /** 도구 줄에 더할 것(추가 질문 수정) — 넓은 화면은 글자 링크, 휴대폰은 [관리] 메뉴 항목 */
  extraTools?: { label: string; onSelect: () => void }[];
}

/** 지원자 한 줄(GET /exhibitions/:id/applications) — 이 화면이 읽는 칸만 적는다 */
interface ApplicantRow {
  id: number;
  status: string;
  createdAt: string;
  joinedVia?: string | null;
  isFirstApplication?: boolean;
  galleryApplicationOrder?: number | null;
  artworkImages?: string[] | null;
  /** 작가가 지원서를 마지막으로 고친 때(규칙 90) */
  editedAt?: string | null;
  /** 선정을 마칠 때 검토 대기라 미선정이 된 때(규칙 90) — 갤러리가 직접 거절한 것과 가른다 */
  closedOutAt?: string | null;
  user: { id: number; name?: string | null; nickname?: string | null; email?: string | null; phone?: string | null; avatar?: string | null };
}
/** 선정이 끝날 때 미선정이 된 지원인가 — 옛 화면에서 직접 거절한 것과 말을 다르게 한다 */
const closedOut = (app: ApplicantRow) => app.status === 'REJECTED' && !!app.closedOutAt;

export default function ApplicantManager({ exhibitionId, exhibitionTitle, customFields, capacity, capacityMask = null, toolbar, recruitOnly = false, ended = false, recruitmentClosed = true, deadline = null, selectionDeadline = null, submissionDeadline = null, capacityEditable = false, onSelectionChange, extraTools }: Props) {
  const queryClient = useQueryClient();
  const isAdmin = useAuthStore(s => s.user?.role === 'ADMIN');
  // 넓은 화면은 목록 | 지원서 두 칸, 그 아래는 목록 → 한 장씩 넘기는 창(마이페이지 본문이 이 폭에서 약 900px 이다)
  const twoPane = useMediaQuery('(min-width: 1180px)');
  const wideTools = useMediaQuery('(min-width: 640px)');
  // 전시가 끝나면 결정을 잠근다(관리자 제외) — 개발자 도구의 '수락 되돌리기'는 서버가 따로 허용하므로 그대로 둔다
  const endedLocked = ended && !isAdmin;
  // 접수 중엔 결정하지 않는다(규칙 90, 관리자도) — 지원서를 읽기만 한다. 접수가 끝났다 = 모집 마감 또는 접수 마감일 경과
  const windowEx = { recruitmentClosed, deadline, selectionDeadline };
  const beforeClose = !selectionStarted(windowEx);
  // 선정 마감일이 지났으면 끝 — 남은 검토 대기는 서버가 미선정으로 바꾼다(목록을 받을 때 먼저 정리한다)
  const selectionOver = selectionDeadlinePassed(windowEx);
  const decisionsLocked = endedLocked || beforeClose || selectionOver;
  /** 결정할 수 없는 검토 대기에 붙는 한 줄 — 버튼만 사라지면 고장처럼 보인다 */
  const lockedPendingText = beforeClose ? DECIDE_AFTER_CLOSE : selectionOver ? '선정 마감일이 지나 미선정이 돼요.' : '결정하지 않은 채 전시가 끝났어요.';
  /** 미선정이 된 까닭 — 선정 마감일이 지나서면 그 날짜를, 아니면(선정 마치기·전시 확정·종료) 그냥 '선정이 끝날 때' */
  const closedOutNote = (app: ApplicantRow) => closedOutByDeadline(app.closedOutAt, selectionDeadline)
    ? `선정 마감일 ${shortDate(selectionDeadline!)}까지 수락하지 않아 미선정이 됐어요.`
    : '선정이 끝날 때 수락하지 않아 미선정이 됐어요.';
  const closedOutBar = (app: ApplicantRow) => closedOutByDeadline(app.closedOutAt, selectionDeadline)
    ? '미선정 — 선정 마감일이 지나 바꿀 수 없어요.'
    : '미선정 — 선정이 끝나 바꿀 수 없어요.';
  /** 휴대폰 지원서 창의 정원 줄 오른쪽 — '선정 마감 D-3'(3일 안이면 빨갛게) */
  const selectionDday = selectionDeadline && !beforeClose && !selectionOver ? getDday(selectionDeadline) : null;
  const [editingCapacity, setEditingCapacity] = useState(false);
  const [editingSelection, setEditingSelection] = useState(false);

  const [statusFilter, setStatusFilter] = useState<StatusTab>('ALL');
  /** 두 칸에서 오른쪽에 펼친 지원서 · 좁은 화면에서 창으로 연 지원서 */
  const [focusId, setFocusId] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [pdfBusy, setPdfBusy] = useState<number | 'all' | null>(null);
  // 진행률은 토스트가 아니라 **버튼 라벨**에 넣는다(토스트는 사라져서 "멈춘 줄" 알게 된다는 신고, 2026-08)
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  // 사진을 못 받은 지원자 — 배너로 남겨 [다시 받기]로 이어지게 한다
  const [missingPhotos, setMissingPhotos] = useState<string[]>([]);
  const [acceptTarget, setAcceptTarget] = useState<{ type: 'single'; appId: number; name: string } | { type: 'batch' } | null>(null);
  const [revertTarget, setRevertTarget] = useState<number | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);

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
  const { data: joinCodeState } = useQuery<{ code: string | null; blocked?: string | null }>({
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

  const counts = {
    ALL: applicants.length,
    SUBMITTED: applicants.filter(a => isPending(a.status)).length,
    ACCEPTED: applicants.filter(a => a.status === 'ACCEPTED').length,
    REJECTED: applicants.filter(a => a.status === 'REJECTED').length,
  };
  // 거르기 — 검토 대기·미선정은 있을 때만(거절 버튼이 없으니 '거절' 탭도 없다. 결과가 미선정인 지원은 '미선정'으로 모은다)
  const filterTabs: { id: StatusTab; label: string; n: number }[] = [
    { id: 'ALL', label: '전체', n: counts.ALL },
    ...(counts.SUBMITTED > 0 ? [{ id: 'SUBMITTED' as const, label: '검토 대기', n: counts.SUBMITTED }] : []),
    { id: 'ACCEPTED', label: '수락', n: counts.ACCEPTED },
    ...(counts.REJECTED > 0 ? [{ id: 'REJECTED' as const, label: '미선정', n: counts.REJECTED }] : []),
  ];
  // 고른 탭이 사라졌으면(마지막 검토 대기를 수락) 전체로
  const activeFilter: StatusTab = filterTabs.some(t => t.id === statusFilter) ? statusFilter : 'ALL';
  const filtered = activeFilter === 'ALL' ? applicants
    : activeFilter === 'SUBMITTED' ? applicants.filter(a => isPending(a.status))
      : applicants.filter(a => a.status === activeFilter);
  /** 결정한 뒤 다음으로 — 지금 목록에서 이 줄 다음의 검토 대기(없으면 앞쪽에서), 하나도 없으면 null */
  const nextPendingAfter = (appId: number): number | null => {
    const i = filtered.findIndex(a => a.id === appId);
    const order = [...filtered.slice(i + 1), ...filtered.slice(0, Math.max(0, i))];
    return order.find(a => isPending(a.status) && a.id !== appId)?.id ?? null;
  };

  const updateStatus = useMutation({
    mutationFn: ({ appId, status }: { appId: number; status: string }) =>
      api.patch(`/exhibitions/${exhibitionId}/applications/${appId}`, { status }),
    onSuccess: (_d, v) => {
      invalidate();
      // REJECTED 는 개발자 도구의 '수락 되돌리기'뿐이다(거절 버튼은 없다, 규칙 90)
      toast.success(v.status === 'ACCEPTED' ? '수락했습니다. 작가에게 알림이 갑니다.' : v.status === 'REJECTED' ? '수락을 되돌렸어요.' : '상태를 바꿨습니다.');
      // 수락했으면 다음 검토 대기로 — 예전엔 접고 → 스크롤 → 다음을 펼쳐야 했다(2026-11-20)
      if (v.status === 'ACCEPTED') {
        const next = nextPendingAfter(v.appId);
        if (next != null) setFocusId(next);
        else if (!twoPane) setSheetOpen(false);
      }
    },
    // 실패하면 목록을 다시 받는다 — 다른 탭·다른 운영자가 먼저 결정했으면(400·409) 옛 줄('검토 대기')이 남아
    // 같은 실패를 되풀이했다(2026-11-20 신뢰성 점검 S6)
    onError: (e: any) => { toast.error(e.response?.data?.error || '상태 변경 실패'); invalidate(); },
  });

  const [batchPending, setBatchPending] = useState(false);
  // 고른 것 중 아직 검토 대기인 것 — 화면의 'N명 선택'·확인창 숫자가 실제로 처리될 수와 같아야 한다
  const selectedCount = applicants.filter(a => selectedIds.has(a.id) && isPending(a.status)).length;
  useEffect(() => { onSelectionChange?.(selectedCount); }, [selectedCount, onSelectionChange]);
  const batchUpdate = async (status: 'ACCEPTED') => {
    if (selectedCount === 0 || batchPending) return;   // 이중 클릭이면 PATCH 가 두 벌 나갔다(2026-09-19)
    setBatchPending(true);
    try {
      // 검토 대기인 것만 — 골라 둔 뒤 한 줄씩 수락한 지원이 섞여 있으면 건너뛴다
      //   (그대로 보내면 '같은 상태' 400·수락 되돌리기 403 이 실패로 세어져 헷갈린다)
      const targets = applicants.filter(a => selectedIds.has(a.id) && isPending(a.status)).map(a => a.id);
      const results = await Promise.allSettled(targets.map(appId =>
        api.patch(`/exhibitions/${exhibitionId}/applications/${appId}`, { status })));
      invalidate();
      const ok = results.filter(r => r.status === 'fulfilled').length;
      const fail = results.length - ok;
      // 실패 이유도 같이 — 일괄 수락이 선정 인원(정원)에 걸리면 '몇 건 실패'만으로는 왜인지 모른다(2026-09-27)
      const reason = (results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined)?.reason?.response?.data?.error;
      if (fail === 0) toast.success(`${ok}명을 수락했습니다.`);
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

  // 일괄 선택은 **검토 대기**만 — 결과가 난 지원은 바꾸지 않는다. 결정이 잠기면 아무것도 못 고른다
  const selectable = decisionsLocked ? [] : filtered.filter(a => isPending(a.status));
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

  const accepted = counts.ACCEPTED;
  const left = capacity != null ? Math.max(0, capacity - accepted) : null;
  const seatsLine = `수락 ${accepted}${capacity != null ? `/${capacityLimit({ capacity, capacityMask })}` : ''}${left != null ? ` · ${left > 0 ? `${left}자리 남음` : '정원이 찼어요'}` : ''}`;

  // 오른쪽 칸(두 칸)에 펼칠 지원서 — 처음엔 검토 대기 첫 사람, 없으면 목록 첫 사람. 고른 사람이 거르기에서 빠지면 다시 고른다
  const focused = filtered.find(a => a.id === focusId) ?? (twoPane ? (filtered.find(a => isPending(a.status)) ?? filtered[0] ?? null) : null);
  const openApp = (appId: number) => { setFocusId(appId); if (!twoPane) setSheetOpen(true); };
  const sheetApp = !twoPane && sheetOpen ? focused : null;

  const navOf = (app: ApplicantRow) => {
    const pendingList = filtered.filter(a => isPending(a.status));
    const pi = pendingList.findIndex(a => a.id === app.id);
    const list = pi >= 0 ? pendingList : filtered;
    const i = list.findIndex(a => a.id === app.id);
    return {
      label: pi >= 0 ? `검토 대기 ${pi + 1} / ${pendingList.length}` : `${i + 1} / ${list.length}`,
      prev: i > 0 ? () => setFocusId(list[i - 1]!.id) : null,
      next: i >= 0 && i < list.length - 1 ? () => setFocusId(list[i + 1]!.id) : null,
    };
  };

  // 초대 코드 — 도구 줄의 [초대 코드]가 아래에 펼친다. 지원자 0명이어도 보여야 한다(옮겨 온 공모는 코드를 돌리기 전엔 늘 0명이다).
  // 전시가 끝난 공모에는 코드를 만들 수도 쓸 수도 없다(서버 `joinBlockReason`) — 줄째로 감춘다(점검 P3)
  const joinCode = ended || joinCodeState?.blocked ? null : (
    <div className="border-t border-gray-100 pt-3">
      <Disclosure variant="link" title="이미 선정한 작가를 초대 코드로 데려오기" meta={joinCodeState?.code ? '코드 켜짐' : undefined} open={joinOpen} onOpenChange={setJoinOpen}>
        <JoinCodePanel exhibitionId={exhibitionId} bare />
      </Disclosure>
    </div>
  );

  if (isLoading) return <div className="h-24 animate-pulse rounded-xl bg-gray-100" />;
  if (isError) return <p className="py-6 text-center text-sm text-gray-400">지원자 목록을 불러오지 못했습니다.</p>;

  const canEditCapacity = capacityEditable && !ended;
  // 선정 마감일 — 날짜가 있는 새 공고, 그날이 지나기 전까지(서버 PATCH /selection-deadline 과 같은 규칙)
  const canEditSelection = capacityEditable && !ended && !!selectionDeadline && !selectionOver;
  const openJoinCode = () => { setJoinOpen(true); window.setTimeout(() => document.getElementById(`join-code-${exhibitionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); };
  /** 도구 — 넓은 화면은 글자 링크 줄, 휴대폰은 [관리 ▾] 하나(줄이 두 번 꺾여 첫 지원자가 첫 화면 밖으로 밀렸다) */
  const tools = [
    ...(canEditSelection && !editingSelection ? [{ label: '선정 마감일 변경', onSelect: () => setEditingSelection(true) }] : []),
    ...(canEditCapacity && !editingCapacity ? [{ label: '모집 인원 변경', onSelect: () => setEditingCapacity(true) }] : []),
    ...(extraTools ?? []),
    ...(applicants.length > 0 ? [{ label: '지원서 전체 받기 (ZIP)', onSelect: handleZip }] : []),
    ...(joinCode ? [{ label: `초대 코드${joinCodeState?.code ? ' · 켜짐' : ''}`, onSelect: openJoinCode }] : []),
  ];
  const zipBusyLabel = pdfBusy === 'all' ? (progress ? `${progress.label} ${progress.done}/${progress.total}` : '만드는 중…') : null;
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-2">
      <p className="min-w-0 text-sm text-gray-600">
        <b className="font-semibold tabular-nums text-gray-950">{seatsLine}</b>
        {capacityMask && <span className="text-gray-500"> (공고에는 {capacityText({ capacity, capacityMask })})</span>}
        {counts.SUBMITTED > 0 && <span className="text-gray-500"> · 검토 대기 {counts.SUBMITTED}명</span>}
      </p>
      {wideTools ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px]">
          {tools.map((t) => (
            <button key={t.label} type="button" onClick={t.onSelect} disabled={pdfBusy !== null && t.onSelect === handleZip} className="inline-flex min-h-[40px] items-center gap-1.5 text-gray-700 underline-offset-4 hover:text-gray-950 hover:underline disabled:opacity-50">
              {t.onSelect === handleZip && pdfBusy === 'all' && <Loader2 size={13} className="animate-spin" aria-hidden />}
              {t.onSelect === handleZip && zipBusyLabel ? zipBusyLabel : t.label}
            </button>
          ))}
          {toolbar}
        </div>
      ) : (tools.length > 0 || toolbar) ? (
        <div className="flex items-center gap-3">
          {toolbar}
          {tools.length > 0 && <MenuButton label="관리" busyLabel={zipBusyLabel} items={tools.map((t) => ({ label: t.label, onSelect: t.onSelect }))} />}
        </div>
      ) : null}
    </div>
  );

  const capacityEditor = (
    <>
      {canEditSelection && editingSelection && (
        <SelectionDeadlineEditor exhibitionId={exhibitionId} selectionDeadline={selectionDeadline!} deadline={deadline} submissionDeadline={submissionDeadline} onDone={() => setEditingSelection(false)} />
      )}
      {canEditCapacity && editingCapacity && (
        <CapacityEditor exhibitionId={exhibitionId} capacity={capacity ?? null} capacityMask={capacityMask} accepted={accepted} onDone={() => setEditingCapacity(false)} />
      )}
    </>
  );
  // 전시가 끝나 결정이 잠겼다는 한 줄 — 버튼만 사라지면 고장처럼 보인다(모집 중의 이유는 지원서마다 결정 줄이 말한다)
  const lockedLine = endedLocked ? (
    <p className="text-sm text-gray-500" data-decisions-locked>전시가 끝난 공모라 지원 결과를 더 바꿀 수 없어요.</p>
  ) : null;

  if (applicants.length === 0) return (
    <div className="space-y-3" data-applicant-manager>
      {header}
      {capacityEditor}
      <p className="border-t border-gray-200 py-8 text-center text-sm text-gray-500">아직 지원자가 없어요.</p>
      <div id={`join-code-${exhibitionId}`}>{joinCode}</div>
    </div>
  );

  /** 결정 줄 — 지원서를 읽은 자리에서 한다(두 칸의 오른쪽 아래 · 창의 아래) */
  const decisionBar = (app: ApplicantRow, mode: 'pane' | 'sheet' = 'pane') => {
    const name = nameWithNickname(app.user);
    const nav = navOf(app);
    const accept = () => setAcceptTarget({ type: 'single', appId: app.id, name });
    // 휴대폰 창 — 위 머리에 이전·다음이 있으니 아래는 결정만(목업: 정원 한 줄 · 선정 마감 D-n + [수락하기])
    if (mode === 'sheet') {
      if (!decisionsLocked && isPending(app.status)) {
        return (
          <div data-decision-bar>
            <p className="mb-2.5 flex justify-between gap-3 text-[13px] tabular-nums text-gray-600">
              <span>{seatsLine}</span>
              {selectionDday != null && <span className={cn('shrink-0', selectionDday <= SELECTION_REMIND_DAYS && 'font-semibold text-accent')}>선정 마감 {selectionDday === 0 ? '오늘' : `D-${selectionDday}`}</span>}
            </p>
            <button type="button" onClick={accept} disabled={updateStatus.isPending} className="min-h-[50px] w-full rounded-lg bg-gray-900 text-[15px] font-semibold text-white disabled:opacity-40">수락하기</button>
          </div>
        );
      }
      return (
        <div data-decision-bar className="flex min-h-[50px] flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-gray-600">
            {app.status === 'ACCEPTED' ? '✓ 수락한 작가예요' : isPending(app.status) ? lockedPendingText : closedOut(app) ? closedOutBar(app) : '거절한 지원이에요.'}
          </span>
          {app.status === 'ACCEPTED' && allowRevert && (
            <button type="button" onClick={() => setRevertTarget(app.id)} className="min-h-[44px] px-1 text-xs text-gray-500 underline underline-offset-4">거절로 되돌리기</button>
          )}
        </div>
      );
    }
    return (
      <div data-decision-bar className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center text-[13.5px] text-gray-600">
          <button type="button" aria-label="이전 지원자" onClick={nav.prev ?? undefined} disabled={!nav.prev} className="grid h-11 w-11 place-items-center rounded-lg hover:bg-gray-50 disabled:opacity-30"><ChevronLeft size={18} aria-hidden /></button>
          <span className="tabular-nums">{nav.label}</span>
          <button type="button" aria-label="다음 지원자" onClick={nav.next ?? undefined} disabled={!nav.next} className="grid h-11 w-11 place-items-center rounded-lg hover:bg-gray-50 disabled:opacity-30"><ChevronRight size={18} aria-hidden /></button>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {decisionsLocked && isPending(app.status) && (
            <span className="text-sm text-gray-500">{lockedPendingText}</span>
          )}
          {/* 결과가 난 지원은 바꾸지 않는다 — 버튼 없이 까닭만(규칙 90) */}
          {app.status === 'REJECTED' && (
            <span className="text-sm text-gray-500">{closedOut(app) ? closedOutBar(app) : '거절한 지원이에요.'}</span>
          )}
          {!decisionsLocked && isPending(app.status) && (
            <>
              <span className="mr-2 text-[13.5px] tabular-nums text-gray-600">{seatsLine}</span>
              <button type="button" onClick={accept} disabled={updateStatus.isPending} className="min-h-[46px] rounded-lg bg-gray-900 px-6 text-[15px] font-semibold text-white hover:bg-gray-800 disabled:opacity-40">수락하기</button>
            </>
          )}
          {app.status === 'ACCEPTED' && (
            <>
              <span className="text-sm text-gray-600">✓ 수락한 작가예요{recruitOnly ? '' : ' · 출품 자료 탭에서 이 작가의 자료를 봐요'}</span>
              {allowRevert && (
                <button type="button" onClick={() => setRevertTarget(app.id)} className="min-h-[40px] px-1 text-xs text-gray-500 underline-offset-4 hover:text-accent hover:underline">거절로 되돌리기</button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  /** 지원서 한 장 — 작품 사진을 먼저(심사의 근거) */
  const detailOf = (app: ApplicantRow) => {
    const name = nameWithNickname(app.user);
    const images: string[] = app.artworkImages ?? [];
    const meta = [
      new Date(app.createdAt).toLocaleDateString('ko'),
      app.editedAt ? `${shortDate(app.editedAt)} 수정` : null,
      app.isFirstApplication ? '이 갤러리 첫 지원' : app.galleryApplicationOrder ? `이 갤러리 ${app.galleryApplicationOrder}번째 지원` : null,
      app.joinedVia === 'CODE' ? '초대 코드로 참여' : null,
    ].filter(Boolean).join(' · ');
    return (
      <div className="space-y-6" data-applicant-detail={app.id}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <h2 className="break-keep text-[21px] font-semibold tracking-tight text-gray-950 [overflow-wrap:anywhere]">{name}</h2>
            <p className="mt-1 text-[13px] text-gray-500">{meta}</p>
            {(app.user?.phone || app.user?.email) && (
              <p className="mt-0.5 break-all text-[13px] text-gray-500">{[app.user?.phone, app.user?.email].filter(Boolean).join(' · ')}</p>
            )}
            {closedOut(app) && <p data-closed-out className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[13.5px] text-gray-700">{closedOutNote(app)}</p>}
          </div>
          <div className="flex items-center gap-4 text-[13.5px]">
            {app.user?.id && <Link to={`/portfolio/${app.user.id}`} className="min-h-[40px] inline-flex items-center text-gray-700 underline-offset-4 hover:text-gray-950 hover:underline">작가 홈페이지</Link>}
            <button type="button" onClick={() => handlePdf(app)} disabled={pdfBusy !== null} className="inline-flex min-h-[40px] items-center gap-1.5 text-gray-700 underline-offset-4 hover:text-gray-950 hover:underline disabled:opacity-50">
              {pdfBusy === app.id ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <FileText size={13} aria-hidden />}
              {pdfBusy === app.id && progress ? `${progress.label} ${progress.done}/${progress.total}` : '지원서 PDF'}
            </button>
          </div>
        </div>
        <div>
          <p className="mb-2.5 text-[13px] font-semibold text-gray-600">작품 사진 {images.length}장</p>
          {images.length === 0 ? <p className="text-sm text-gray-400">없음</p> : (
            <div className={cn('grid gap-3', twoPane ? 'grid-cols-4' : 'grid-cols-3')}>
              {/* 규칙 18 — 작품은 자르지 않는다(contain), 판(배경)도 깔지 않는다 */}
              {images.map((url, idx) => (
                <button key={idx} type="button" onClick={() => setLightbox({ images, index: idx })} aria-label={`작품 ${idx + 1} 크게 보기`} className={cn('aspect-square w-full cursor-zoom-in', !twoPane && idx === 0 && 'col-span-3')}>
                  <Thumb src={url} size="grid" alt={`작품 ${idx + 1}`} className="h-full w-full object-contain" />
                </button>
              ))}
            </div>
          )}
        </div>
        <ApplicationContent app={app} customFields={customFields} hidePhotos onImageClick={(imgs, index) => setLightbox({ images: imgs, index })} />
      </div>
    );
  };

  const rowOf = (app: ApplicantRow) => {
    const isSelected = selectedIds.has(app.id);
    // 선정이 끝날 때 미선정이 된 줄은 '거절'이 아니라 '미선정' — 갤러리가 거절한 게 아니다(규칙 90)
    const view = closedOut(app) ? { label: '미선정' } : applicationStatusView(app.status, 'gallery');
    const name = nameWithNickname(app.user);
    const thumbs: string[] = (app.artworkImages ?? []).slice(0, 3);
    const current = twoPane && focused?.id === app.id;
    const note = [
      app.isFirstApplication ? '첫 지원' : app.galleryApplicationOrder ? `${app.galleryApplicationOrder}번째 지원` : null,
      app.joinedVia === 'CODE' ? '초대 코드' : null,
    ].filter(Boolean).join(' · ');
    // 상태 아래 작은 한 줄(규칙 90) — 작가가 고친 지원서. 목록 칸이 좁아 이름 줄이 아니라 여기에 짧게(고친 날은 지원서 머리에)
    const subStatus = app.editedAt && isPending(app.status) ? '수정됨' : null;
    return (
      <li key={app.id} className={cn('relative border-b border-gray-100', current && 'bg-gray-100')} aria-current={current || undefined}>
        <div className="flex min-h-[84px] items-center gap-3 pr-3">
          {/* 체크박스는 검토 대기 줄에만. 같은 목록에 섞여 있으면 빈 자리를 둬 이름 줄이 어긋나지 않게 */}
          {/* 누르는 곳은 칸 전체(44px 이상) — 20px 상자만 받으면 휴대폰에서 자꾸 빗나간다 */}
          {isPending(app.status) && !decisionsLocked ? (
            <label className="flex w-11 shrink-0 cursor-pointer items-center justify-center self-stretch">
              <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(app.id)} aria-label={`${name} 선택`} className="h-5 w-5 accent-gray-900" />
            </label>
          ) : <span className="w-11 shrink-0" aria-hidden />}
          <button type="button" onClick={() => openApp(app.id)} className="flex min-h-[72px] min-w-0 flex-1 items-center gap-3 text-left">
            <span className="flex shrink-0 gap-[3px]" aria-hidden>
              {[0, 1, 2].map((k) => thumbs[k]
                ? <Thumb key={k} src={thumbs[k]!} alt="" className="h-11 w-11 bg-white object-contain" />
                : <span key={k} className="h-11 w-11 bg-gray-50" />)}
            </span>
            <span className="min-w-0 flex-1">
              {/* 이름만 든 요소 — E2E applicantRow 가 이 글자로 줄을 찾는다 */}
              <span className="block truncate text-[15px] font-semibold text-gray-950"><span>{name}</span></span>
              <span className="block truncate text-[12.5px] text-gray-500">{note || new Date(app.createdAt).toLocaleDateString('ko')}</span>
            </span>
            <span className={cn('shrink-0 text-right text-[12.5px]', isPending(app.status) ? 'font-semibold text-gray-950' : 'text-gray-500')}>
              <span className="block">{app.status === 'ACCEPTED' ? '✓ ' : ''}{view.label}</span>
              {subStatus && <span className="block text-[11.5px] font-normal text-gray-500">{subStatus}</span>}
            </span>
          </button>
        </div>
      </li>
    );
  };

  const bulkBar = selectedCount > 0 ? (
    <div data-bulk-bar className={cn('flex items-center justify-between gap-2 border-t border-gray-200 bg-white/95 py-3 backdrop-blur', twoPane ? 'sticky bottom-0 z-10 px-3' : 'sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] tabbar-hidden:bottom-0 z-30 -mx-1 px-1 lg:bottom-0')}>
      <span className="text-sm font-semibold text-gray-950">{selectedCount}명 선택</span>
      <span className="flex items-center gap-2">
        <button type="button" onClick={() => setSelectedIds(new Set())} className="min-h-[44px] px-2 text-sm text-gray-500 hover:text-gray-900">해제</button>
        <button type="button" onClick={() => setAcceptTarget({ type: 'batch' })} disabled={batchPending} className="min-h-[44px] rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40">
          {batchPending ? '처리 중…' : '선택 수락'}
        </button>
      </span>
    </div>
  ) : null;

  const list = (
    <>
      {anySelectable && (
        <label className="flex min-h-[48px] cursor-pointer items-center gap-3 border-b border-gray-100 text-sm text-gray-600">
          <span className="flex w-11 shrink-0 justify-center"><input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} className="h-5 w-5 accent-gray-900" /></span>
          {activeFilter === 'SUBMITTED' ? '전체 선택' : `검토 대기 ${selectable.length}명 모두 선택`}
        </label>
      )}
      {filtered.length === 0 ? <p className="py-6 text-sm text-gray-400">이 상태의 지원자가 없어요.</p> : <ul>{filtered.map(rowOf)}</ul>}
    </>
  );

  return (
    <div className="space-y-2" data-applicant-manager>
      {header}
      {capacityEditor}
      {lockedLine}

      {/* 거르기 — 글자 단추(탭 줄 안의 또 탭 줄은 무겁다) */}
      <div role="tablist" aria-label="지원자 상태" className="flex flex-wrap gap-x-5">
        {filterTabs.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={activeFilter === t.id} onClick={() => { setStatusFilter(t.id); setSelectedIds(new Set()); }}
            className={cn('min-h-[44px] text-sm', activeFilter === t.id ? 'font-semibold text-gray-950 underline decoration-2 underline-offset-[10px]' : 'text-gray-500 hover:text-gray-900')}>
            {t.label} <span className="tabular-nums">{t.n}</span>
          </button>
        ))}
      </div>

      {/* 사진 누락 배너 — 토스트와 달리 사라지지 않는다. 다시 받기는 이미 받은 사진을 재사용하므로 금방 끝난다. */}
      <MissingImagesBanner items={missingPhotos} what="지원서에 들어갈 작품 사진" busy={pdfBusy !== null} onRetry={handleZip} onDismiss={() => setMissingPhotos([])} />

      {twoPane ? (
        <div className="grid grid-cols-[340px_minmax(0,1fr)] border-t border-gray-200">
          <div className="flex flex-col border-r border-gray-200">
            <div className="flex-1">{list}</div>
            {bulkBar}
          </div>
          <div className="min-w-0">
            {focused ? (
              <div className="flex h-full flex-col">
                <div className="flex-1 py-6 pl-8">{detailOf(focused)}</div>
                <div className="sticky bottom-0 z-10 border-t border-gray-200 bg-white/95 py-3 pl-6 backdrop-blur">{decisionBar(focused)}</div>
              </div>
            ) : <p className="py-10 pl-8 text-sm text-gray-400">지원자를 고르면 지원서가 여기 보여요.</p>}
          </div>
        </div>
      ) : (
        <div className="border-t border-gray-200">
          {list}
          {bulkBar}
        </div>
      )}

      <div id={`join-code-${exhibitionId}`}>{joinCode}</div>

      {sheetApp && (
        <ApplicantSheet
          title={nameWithNickname(sheetApp.user)}
          nav={navOf(sheetApp)}
          blocked={!!acceptTarget || !!revertTarget || !!lightbox}
          onClose={() => setSheetOpen(false)}
          footer={decisionBar(sheetApp, 'sheet')}
        >
          {detailOf(sheetApp)}
        </ApplicantSheet>
      )}

      {/* 수락 확인 (되돌릴 수 없음) */}
      <ConfirmDialog
        open={acceptTarget !== null}
        title={acceptTarget?.type === 'single' ? `${acceptTarget.name} 님을 수락할까요?` : `${selectedCount}명을 수락할까요?`}
        details={[
          '수락하면 되돌릴 수 없어요.',
          recruitOnly
            ? '작가에게 선정 알림이 가요. 공모만 진행하는 공고라 여기서 절차가 끝나요.'
            : '작가에게 선정 알림이 가고, 작가는 출품 자료를 내기 시작해요.',
          ...(capacity != null ? [`정원 ${capacityWithLimit({ capacity, capacityMask })} 중 지금 ${accepted}명이 수락되어 있어요.`] : []),
        ]}
        confirmText="수락하기"
        onConfirm={() => {
          if (acceptTarget?.type === 'single') updateStatus.mutate({ appId: acceptTarget.appId, status: 'ACCEPTED' });
          else if (acceptTarget?.type === 'batch') batchUpdate('ACCEPTED');
          setAcceptTarget(null);
        }}
        onCancel={() => setAcceptTarget(null)}
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

/**
 * 좁은 화면의 지원서 한 장 — 화면 가득 창. 위 [← 지원자] · '검토 대기 2 / 3' · ‹ ›, 아래 [수락하기].
 * `role="dialog"`(앱 뒤로가기가 Esc 를 보내 이 창만 닫는다, 규칙 79). 뒤 페이지는 잠근다.
 */
function ApplicantSheet({ title, nav, footer, onClose, blocked, children }: {
  title: string;
  nav: { label: string; prev: (() => void) | null; next: (() => void) | null };
  footer: ReactNode;
  onClose: () => void;
  /** 위에 확인창·사진 확대가 떠 있으면 Esc 를 그쪽에 양보 */
  blocked: boolean;
  children: ReactNode;
}) {
  useEscapeKey(onClose, { enabled: !blocked });
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  // 다음 지원자로 넘어가면 맨 위부터
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [title]);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`${title} 지원서`} className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 pl-3 pr-1">
        <button type="button" onClick={onClose} className="inline-flex min-h-[44px] items-center gap-1.5 px-1 text-[14.5px] text-gray-700"><ArrowLeft size={18} aria-hidden /> 지원자</button>
        <div className="flex items-center text-[13.5px] text-gray-600">
          <button type="button" aria-label="이전 지원자" onClick={nav.prev ?? undefined} disabled={!nav.prev} className="grid h-11 w-11 place-items-center disabled:opacity-30"><ChevronLeft size={18} aria-hidden /></button>
          <span className="tabular-nums">{nav.label}</span>
          <button type="button" aria-label="다음 지원자" onClick={nav.next ?? undefined} disabled={!nav.next} className="grid h-11 w-11 place-items-center disabled:opacity-30"><ChevronRight size={18} aria-hidden /></button>
        </div>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">{footer}</div>
    </div>,
    document.body,
  );
}

/**
 * 모집 인원 직접 고치기 (2026-10-03 사용자 결정). 예전엔 정원이 차면 "모집 인원 수정을 요청해 주세요" 라고만 했는데
 * 요청할 화면이 없었다. 날짜는 여전히 1:1 문의다(지원자가 이미 그 날짜를 보고 지원했다).
 * 서버 `PATCH /exhibitions/:id/capacity` 가 권한·하한(수락한 수)·상한(1000)을 다시 본다 — 화면 검사는 헛걸음을 줄일 뿐이다.
 */
function CapacityEditor({ exhibitionId, capacity, capacityMask, accepted, onDone }: { exhibitionId: number; capacity: number | null; capacityMask: CapacityMask | null; accepted: number; onDone: () => void }) {
  const queryClient = useQueryClient();
  // 0명·00명도 고른다(2026-10-14) — 그때 capacity 는 한도(9·99)라 숫자로 바꾸면 그 수가 처음 값으로 남는다
  const [value, setValue] = useState<CapacityValue>({ capacity: capacity ?? 0, capacityMask });
  const min = Math.max(1, accepted);
  const sent = capacityPayload(value);
  const invalid = !Number.isInteger(sent.capacity) || sent.capacity < min || sent.capacity > CAPACITY_MAX;
  const unchanged = sent.capacity === capacity && sent.capacityMask === capacityMask;
  const save = useMutation({
    mutationFn: () => api.patch(`/exhibitions/${exhibitionId}/capacity`, sent),
    onSuccess: () => {
      // 정원을 읽는 곳 — 카드 숫자·할 일 줄(내 공모·주최 공모), 운영 화면(공모 상세 캐시), 초대 코드 상자, 공개 목록
      for (const queryKey of [
        ['exhibition-applicants', exhibitionId], ['my-exhibitions'], ['my-operation-overview'], ['hosted-exhibitions'],
        ['join-code', exhibitionId], ['exhibition', String(exhibitionId)], ['exhibition', exhibitionId], ['exhibitions'],
      ]) queryClient.invalidateQueries({ queryKey });
      toast.success(sent.capacityMask
        ? `모집 인원을 '${capacityText(sent)}'(최대 ${sent.capacity}명)으로 바꿨어요.`
        : `모집 인원을 ${sent.capacity}명으로 바꿨어요.`);
      onDone();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '모집 인원을 바꾸지 못했어요.'),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (!invalid && !unchanged && !save.isPending) save.mutate(); };
  const showError = invalid && value.capacityMask == null && value.capacity !== 0;
  return (
    <form onSubmit={submit} className="rounded-xl border border-gray-200 p-4" data-capacity-editor>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className="flex min-h-[40px] items-center text-sm text-gray-800">모집 인원</span>
        <CapacityPicker value={value} onChange={setValue} min={min} error={showError} autoFocus />
        <div className="flex items-center gap-2">
          <button type="submit" disabled={invalid || unchanged || save.isPending} className="min-h-[40px] rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40">
            {save.isPending ? '저장 중…' : '저장'}
          </button>
          <button type="button" onClick={onDone} className="min-h-[40px] px-2 text-sm text-gray-500 hover:text-gray-900">취소</button>
        </div>
      </div>
      <p className={cn('mt-2 text-xs', showError ? 'text-accent' : 'text-gray-500')}>
        {accepted > 0 ? `이미 수락한 ${accepted}명보다 적게는 줄일 수 없어요. ` : ''}지원은 그대로 받고, 이 인원까지 수락할 수 있어요(최대 {CAPACITY_MAX}명).
      </p>
    </form>
  );
}

/**
 * 선정 마감일 바꾸기 (2026-11-21 사용자 결정 — "고칠 수 있게"). 그날이 지나기 전까지, 접수 마감 다음 날 ~ 출품 자료 마감 전날.
 * 달력이 그 밖의 날을 흐리게 막는다(설명 글은 두지 않는다 — 규칙 77). 서버 `PATCH /exhibitions/:id/selection-deadline` 이 다시 본다.
 */
function SelectionDeadlineEditor({ exhibitionId, selectionDeadline, deadline, submissionDeadline, onDone }: {
  exhibitionId: number; selectionDeadline: string; deadline: string | null; submissionDeadline: string | null; onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const current = toYmd(selectionDeadline);
  const [value, setValue] = useState<Record<string, string>>({ selectionDeadline: current });
  const today = todayKst();
  const afterDeadline = deadline ? addDays(toYmd(deadline), 1) : today;
  const floor = afterDeadline > today ? afterDeadline : today;
  const ceiling = submissionDeadline ? addDays(toYmd(submissionDeadline), -1) : undefined;
  const next = value.selectionDeadline || '';
  const unchanged = !next || next === current;
  const save = useMutation({
    mutationFn: () => api.patch(`/exhibitions/${exhibitionId}/selection-deadline`, { selectionDeadline: next }),
    onSuccess: () => {
      // 선정 마감일을 읽는 곳 — 공모 화면(접근 정보·내 공모·주최 공모), 지원자 줄, 공고 상세 일정 띠, 공개 목록
      for (const queryKey of [
        ['operation-access', exhibitionId], ['my-exhibitions'], ['my-operation-overview'], ['hosted-exhibitions'],
        ['exhibition-applicants', exhibitionId], ['exhibition', String(exhibitionId)], ['exhibition', exhibitionId], ['exhibitions'],
      ]) queryClient.invalidateQueries({ queryKey });
      toast.success(`선정 마감일을 ${shortDate(next)}로 바꿨어요.`);
      onDone();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '선정 마감일을 바꾸지 못했어요.'),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (!unchanged && !save.isPending) save.mutate(); };
  return (
    <form onSubmit={submit} className="rounded-xl border border-gray-200 p-4" data-selection-deadline-editor>
      <SchedulePicker
        steps={[{ key: 'selectionDeadline', label: '선정 마감일', mark: '선정', gap: 0, id: `selection-deadline-${exhibitionId}` }]}
        values={value}
        onChange={(patch) => setValue((prev) => ({ ...prev, ...patch }))}
        floor={floor}
        ceiling={ceiling}
        variant="compact"
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13.5px] tabular-nums text-gray-500">지금 {shortDate(current)}{!unchanged && ` → ${shortDate(next)}`}</p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onDone} className="min-h-[40px] px-2 text-sm text-gray-500 hover:text-gray-900">취소</button>
          <button type="submit" disabled={unchanged || save.isPending} className="min-h-[40px] rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40">
            {save.isPending ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </form>
  );
}
