/**
 * 마이페이지(Admin) > 주최 공모.
 *
 * ## 이 화면이 하는 일
 * 아트링크가 **직접 주최**하는 공모를 등록한다. 갤러리가 등록하는 공모와 다른 점은 두 가지뿐이다.
 *   1. 승인 절차가 없다 — 주최자가 관리자이므로 등록 즉시 게시된다.
 *   2. **운영 갤러리**를 여러 곳 지정한다. 지정된 갤러리 오너는 자기 공모처럼 지원자 관리 · 작가 초대 ·
 *      전시 확정 · 정산까지 할 수 있다(마이페이지 > 내 공모에 그대로 나타난다).
 *
 * ## 주관 갤러리
 * 목록 카드의 갤러리명, 지원 통계, 정산 등 기존 코드 전부가 공모에 갤러리 1곳이 붙어 있다고 전제한다.
 * 그래서 선택한 갤러리 중 **첫 번째가 주관 갤러리**가 되고, 화면에는 "아트링크 주최" 배지를 함께 보여준다.
 * (자세한 배경: `backend/src/lib/exhibitionAccess.ts` 주석)
 *
 * ## 관련 API
 *   GET    /exhibitions/hosted          목록
 *   POST   /exhibitions/hosted          등록 (galleryIds[0] = 주관)
 *   PATCH  /exhibitions/:id/managers    운영 갤러리 변경 (전체 교체)
 *   DELETE /exhibitions/:id             삭제 (주최자인 Admin만)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, X, Search, Trash2, Building2, Users, AlertTriangle, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { regionLabels, exhibitionTypeLabels, getDday, validateExhibitionDates, capacityError, CAPACITY_MAX, REGION_CODES, capacityPayload, capacityText, type CapacityMask } from '@/lib/utils';
import CapacityPicker from '@/components/shared/CapacityPicker';
import { HeroImageEdit } from '@/components/shared/EditableField';
import LazyRichTextEditor from '@/components/shared/LazyRichTextEditor';
import { richTextLength } from '@/lib/richText';
import { CustomQuestionBuilder, sanitizeCustomFields } from '@/components/shared/CustomQuestionsEditor';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import ApplicantManager from '@/components/shared/ApplicantManager';
import CustomQuestionsEditModal from '@/components/shared/CustomQuestionsEditor';
import HostedContentEditModal from '@/components/admin/HostedContentEditModal';
import ExhibitionScopePicker from '@/components/shared/ExhibitionScopePicker';
import SchedulePicker from '@/components/shared/SchedulePicker';
import ProgressSteps from '@/components/flow/ProgressSteps';
import { FormSection, FormField } from '@/components/flow/FormParts';
import { formInputCls } from '@/lib/formStyles';
import { scheduleSummary } from '@/lib/scheduleSummary';
import { exhibitionSchedule } from '@/lib/scheduleCalendar';
import { AttachmentEditor } from '@/components/shared/ExhibitionAttachments';
import { ATTACHMENT_TYPES_TEXT, type ExhibitionAttachment } from '@/lib/attachments';
import type { CustomField } from '@/types';

const regions = REGION_CODES;   // 지역 목록은 lib/utils.ts 한 곳(서버 lib/regions.ts 와 같다)

interface PickedGallery { id: number; name: string; region?: string }

const emptyForm = {
  title: '',
  type: 'GROUP',
  deadlineStart: '',
  deadline: '',
  exhibitStartDate: '',
  exhibitDate: '',
  submissionDeadline: '',
  recruitOnly: false,
  capacity: 1,
  /** 공고에 0명·00명으로만 적기(2026-10-14) — null = 숫자 그대로 */
  capacityMask: null as CapacityMask | null,
  region: 'SEOUL',
  description: '',
  imageUrl: '',
  customFields: [] as CustomField[],
  /** 첨부파일(2026-10-08) — 모집 요강·지원서 양식. 공고 상세에서 누구나 내려받는다 */
  attachments: [] as ExhibitionAttachment[],
};

// ────────────────────────────────────────────────────────────────────────────
// 운영 갤러리 선택기 — 검색해서 추가하고, 순서를 바꿔 주관 갤러리를 정한다.
// ────────────────────────────────────────────────────────────────────────────
function GalleryPicker({
  selected,
  onChange,
  error,
  bare = false,
}: {
  selected: PickedGallery[];
  onChange: (next: PickedGallery[]) => void;
  error?: boolean;
  /** 등록 폼의 구역(FormSection) 안 — 테두리 상자와 머리말을 빼고 구역 제목을 쓴다(갤러리 공모 등록 폼과 같은 모양, 2026-10-28) */
  bare?: boolean;
}) {
  const [keyword, setKeyword] = useState('');

  // 승인된 갤러리 전체를 한 번만 받아 화면에서 거른다 (갤러리 수가 많지 않아 검색 요청을 매번 보낼 이유가 없다)
  const { data: galleries = [], isLoading } = useQuery<any[]>({
    queryKey: ['galleries', 'picker'],
    queryFn: () => api.get('/galleries').then(r => r.data).catch(() => []),
    staleTime: 5 * 60 * 1000,
  });

  const selectedIds = useMemo(() => new Set(selected.map(g => g.id)), [selected]);
  const matches = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return galleries
      .filter((g: any) => !selectedIds.has(g.id))
      .filter((g: any) => !k || g.name?.toLowerCase().includes(k) || g.address?.toLowerCase().includes(k))
      .slice(0, 8);
  }, [galleries, keyword, selectedIds]);

  const add = (g: any) => onChange([...selected, { id: g.id, name: g.name, region: g.region }]);
  const remove = (id: number) => onChange(selected.filter(g => g.id !== id));
  // 주관 갤러리 지정 = 목록 맨 앞으로 이동
  const makeHost = (id: number) => {
    const target = selected.find(g => g.id === id);
    if (!target) return;
    onChange([target, ...selected.filter(g => g.id !== id)]);
  };

  return (
    <div className={bare ? '' : `rounded-xl border p-3 ${error ? 'border-accent bg-accent/5' : 'border-gray-200 bg-white'}`}>
      {!bare && (
        <div className="flex items-center justify-between">
          <p className={`text-xs font-medium ${error ? 'text-accent' : 'text-gray-500'}`}>운영 갤러리 <span className="font-normal text-gray-400">(선택)</span></p>
          <p className="text-[11px] text-gray-400">{selected.length}곳 선택</p>
        </div>
      )}
      {/* 폼 구역(bare)에서는 구역 설명이 같은 말을 한다 — 두 번 쓰지 않는다 */}
      {!bare && <p className="mt-1 text-[11px] text-gray-400">
        지정된 갤러리는 이 공모를 자기 공모처럼 운영합니다 (지원자 관리 · 작가 초대 · 전시 확정 · 정산).
        맨 앞 갤러리가 <b>주관</b>이 되어 목록 카드에 표시됩니다.
      </p>}
      {/* 갤러리를 안 끼는 것도 정상적인 선택이다(2026-09-10) — 비워 두면 아무 일도 안 일어나는 게 아니라
          '아트링크가 직접 운영' 이라는 뜻이라는 걸 여기서 말해 준다. */}
      {selected.length === 0 && (
        <p className={bare ? 'text-sm text-gray-700' : 'mt-1 text-[11px] text-gray-500'}>
          비워 두면 <b>아트링크(관리자)가 직접 운영</b>합니다. 지원 알림도 관리자에게 갑니다.
        </p>
      )}

      {/* 선택된 갤러리 */}
      {selected.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {selected.map((g, i) => (
            <li key={g.id} className="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5">
              {i === 0 ? (
                <span className="rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-medium text-white">주관</span>
              ) : (
                <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600">운영</span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{g.name}</span>
              {g.region && <span className="text-[11px] text-gray-400">{regionLabels[g.region] ?? g.region}</span>}
              {i !== 0 && (
                <button type="button" onClick={() => makeHost(g.id)} className="text-[11px] text-gray-500 hover:text-gray-900">
                  주관으로
                </button>
              )}
              <button type="button" onClick={() => remove(g.id)} className="text-gray-400 hover:text-accent" aria-label={`${g.name} 제외`}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 검색 + 추가 */}
      <div className={`mt-3 flex items-center gap-2 rounded-lg border px-2.5 ${bare ? 'min-h-[44px] border-gray-200 bg-white' : 'border-gray-200 py-1.5'}`}>
        <Search size={14} className="text-gray-400" />
        <input
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          placeholder="갤러리 이름 또는 주소로 검색"
          className="min-w-0 flex-1 text-sm outline-none"
        />
      </div>
      {isLoading ? (
        <p className="mt-2 text-xs text-gray-400">갤러리 목록 불러오는 중...</p>
      ) : matches.length === 0 ? (
        <p className="mt-2 text-xs text-gray-400">
          {keyword ? '검색 결과가 없습니다.' : '추가할 갤러리가 없습니다.'}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-100">
          {matches.map((g: any) => (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => add(g)}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-gray-50"
              >
                <Building2 size={14} className="shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{g.name}</span>
                {/* 별점 칩은 2026-09-10 에 뺐다 — 별점 자체를 없앴다 */}
                <span className="text-[11px] text-gray-400">{regionLabels[g.region] ?? g.region}</span>
                <Plus size={14} className="shrink-0 text-gray-400" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 운영 갤러리 변경 모달 (등록 후)
// ────────────────────────────────────────────────────────────────────────────
function ManagerEditModal({
  exhibition,
  onClose,
}: {
  exhibition: any;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<PickedGallery[]>(exhibition.managerGalleries ?? []);

  const mutation = useMutation({
    mutationFn: () => api.patch(`/exhibitions/${exhibition.id}/managers`, { galleryIds: selected.map(g => g.id) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hosted-exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['exhibition', String(exhibition.id)] });   // 상세는 useParams 문자열 키 — 숫자로 넣으면 무효화가 안 된다(2026-09-19)
      queryClient.invalidateQueries({ queryKey: ['exhibition', exhibition.id] });
      toast.success('운영 갤러리를 변경했습니다.');
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '변경 실패'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-gray-900">운영 갤러리 변경</h3>
            <p className="truncate text-sm text-gray-400">{exhibition.title}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900"><X size={20} /></button>
        </div>

        <GalleryPicker selected={selected} onChange={setSelected} />

        <p className="mt-3 flex items-start gap-1.5 text-xs text-gray-500">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          제외된 갤러리는 이 공모의 지원자 정보와 운영 페이지에 더 이상 접근할 수 없습니다.
          이미 접수된 지원서와 작가 제출자료는 그대로 남습니다.
        </p>

        {/* 전부 떼는 것도 정상 경로다 — 서버가 빈 배열을 받아 아트링크 직접 운영으로 되돌린다(규칙 22). 예전엔 여기서 [저장]이 막혀 있었다(2026-09-19) */}
        {selected.length === 0 && (
          <p className="mt-2 text-xs text-gray-500">운영 갤러리를 두지 않으면 아트링크(관리자)가 직접 운영하게 됩니다.</p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {mutation.isPending ? '저장 중...' : '저장'}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500">취소</button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
export default function HostedExhibitionsSection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [managerGalleries, setManagerGalleries] = useState<PickedGallery[]>([]);
  const [formErrors, setFormErrors] = useState<Set<string>>(new Set());
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  // 첨부파일을 올리는 중 — 다 올라가기 전에 등록하면 그 파일이 빠진다
  const [attachBusy, setAttachBusy] = useState(false);
  const [editManagersFor, setEditManagersFor] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  // 지원자 관리 — 갤러리 마이페이지와 같은 인라인 <ApplicantManager /> 를 그대로 쓴다(창 이동 없음).
  // Admin 도 수락/거절을 해야 해서 백엔드 라우트가 GALLERY+ADMIN 으로 열려 있다.
  const [manageAppsExId, setManageAppsExId] = useState<number | null>(null);
  // 추가 질문 수정 — 갤러리 마이페이지와 같은 공용 모달. 주최자가 자기 공고 질문을 못 고치면 안 된다.
  const [editQuestionsEx, setEditQuestionsEx] = useState<any>(null);
  const [editContentEx, setEditContentEx] = useState<{ id: number; title: string; description?: string | null } | null>(null);

  const clearError = (key: string) =>
    setFormErrors(prev => { const n = new Set(prev); n.delete(key); return n; });

  const dateError = useMemo(() => validateExhibitionDates({
    deadlineStart: form.deadlineStart || undefined,
    deadline: form.deadline,
    exhibitStartDate: form.recruitOnly ? undefined : (form.exhibitStartDate || undefined),
    // 공모만 진행하면 자료제출 단계가 없다 — 남아 있는 입력값으로 순서 검사를 하면 안 된다
    submissionDeadline: form.recruitOnly ? undefined : (form.submissionDeadline || undefined),
    exhibitDate: form.recruitOnly ? undefined : (form.exhibitDate || undefined),
  }), [form.deadlineStart, form.deadline, form.exhibitStartDate, form.exhibitDate, form.submissionDeadline, form.recruitOnly]);

  const { data: exhibitions = [], isLoading } = useQuery<any[]>({
    queryKey: ['hosted-exhibitions'],
    queryFn: () => api.get('/exhibitions/hosted').then(r => r.data).catch(() => []),
  });

  /*
    운영 화면의 [← 주최 공모]·[지원자 보기] 가 `?ex=<id>&panel=applicants` 로 이 카드를 가리켜 들어온다(lib/operationLinks.ts, 2026-10-02).
    그 전엔 관리자도 갤러리의 [내 공모] 주소로 보내져 프로필이 떴다. 딱 한 번만 — refetch 때마다 걸리면 닫아도 다시 열린다.
  */
  const [searchParams] = useSearchParams();
  const deepLinkDone = useRef(false);
  useEffect(() => {
    const exId = Number(searchParams.get('ex')) || null;
    if (!exId || deepLinkDone.current || !exhibitions.some((e: any) => e.id === exId)) return;
    // ⚠️ '했다' 표시는 타이머 안에서 세운다 — 먼저 세우면 개발 모드(StrictMode)의 두 번째 effect 가 그냥 나가서
    //    목록이 캐시에 있을 때(주최 공모 → 운영 페이지 → 돌아옴) 카드로 내려가지 않는다.
    const t = window.setTimeout(() => {
      deepLinkDone.current = true;
      if (searchParams.get('panel') === 'applicants') setManageAppsExId(exId);
      document.getElementById(`hosted-ex-${exId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
    return () => window.clearTimeout(t);
  }, [exhibitions, searchParams]);

  const resetForm = () => {
    setForm(emptyForm);
    setManagerGalleries([]);
    setFormErrors(new Set());
    setShowForm(false);
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/exhibitions/hosted', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hosted-exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      resetForm();
      toast.success('주최 공모가 등록되었습니다. 승인 없이 바로 게시됩니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '등록 실패'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/exhibitions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hosted-exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      setDeleteTarget(null);
      toast.success('삭제되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '삭제 실패'),
  });

  const submit = () => {
    if (attachBusy) {
      toast.error('첨부파일을 올리는 중이에요. 다 올라간 뒤에 눌러 주세요.');
      return;
    }
    const missing: string[] = [];
    const errorFields = new Set<string>();
    // ⚠️ 운영 갤러리는 **필수가 아니다**(2026-09-10) — 아트링크가 갤러리를 안 끼고 직접 열 수 있다
    if (!form.title) { missing.push('제목'); errorFields.add('title'); }
    if (!form.deadlineStart) { missing.push('공모 시작일'); errorFields.add('deadlineStart'); }
    if (!form.deadline) { missing.push('공모 마감일'); errorFields.add('deadline'); }
    // ⚠️ 공모만 진행하면 전시 자체가 없다 — 전시 일자를 요구하지 않는다(2026-09-19)
    if (!form.recruitOnly && !form.exhibitStartDate) { missing.push('전시 시작일'); errorFields.add('exhibitStartDate'); }
    if (!form.recruitOnly && !form.submissionDeadline) { missing.push('출품 자료 제출 마감일'); errorFields.add('submissionDeadline'); }
    if (!form.recruitOnly && !form.exhibitDate) { missing.push('전시 종료일'); errorFields.add('exhibitDate'); }
    if (richTextLength(form.description) === 0) { missing.push('소개'); errorFields.add('description'); }
    if (!form.capacityMask && capacityError(form.capacity)) { missing.push(`모집 작가 수(1~${CAPACITY_MAX}명)`); errorFields.add('capacity'); }
    setFormErrors(errorFields);
    if (missing.length > 0) {
      toast.error(`다음 항목을 입력해주세요: ${missing.join(', ')}`, { duration: 4000 });
      return;
    }
    const cleaned = sanitizeCustomFields(form.customFields);
    if (cleaned.find(f => (f.type === 'select' || f.type === 'multiselect') && (f.options ?? []).length < 2)) {
      toast.error('객관식 질문은 선택지를 2개 이상 입력해주세요.');
      return;
    }
    setForm({ ...form, customFields: cleaned });
    setConfirmSubmit(true);
  };

  const summary = scheduleSummary(form);
  // 아트링크 주최는 승인 단계가 없다 — 갤러리 폼의 순서에서 '관리자 승인'만 빠진다
  const flowSteps = form.recruitOnly
    ? ['등록', '지원 모집', '작가 선정']
    : ['등록', '지원 모집', '작가 선정', '자료 출품', '전시', '정산'];

  const statusColors: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-700',
    APPROVED: 'bg-green-100 text-green-700',
    REJECTED: 'bg-accent/10 text-accent',
  };

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm text-gray-500">아트링크가 주최하고, 지정한 갤러리들이 실제 운영을 맡습니다.</p>
          <p className="text-xs text-gray-400">관리자가 등록하므로 승인 절차 없이 바로 공고에 노출됩니다.</p>
        </div>
        <button
          onClick={() => (showForm ? resetForm() : setShowForm(true))}
          className="flex items-center gap-1 self-start rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white"
        >
          <Plus size={14} /> 주최 공모 등록
        </button>
      </div>

      {/*
        주최 공모 등록 — 갤러리 공모 등록 폼(MyPage)과 **같은 틀**(2026-10-28 사용자 지적: "갤러리 유저 것은 딱 좋은데 admin 주최 공모 등록은 이렇게 안 돼 있다").
        번호 붙은 구역 · 왼쪽 포스터(목록 카드 모양) · 칸 이름과 설명 · 일정 달력. 다른 점은 셋뿐 — 갤러리 선택 대신 운영 갤러리(선택, 여러 곳),
        승인 없이 바로 게시, 약관 없음. 예전엔 '상세 페이지 미리보기 카드'에 칸을 얹은 모양이라 같은 일을 하는 두 폼이 딴판이었다.
      */}
      {showForm && (
        <div className="mb-8 space-y-8">
          <div>
            <h3 className="text-lg font-semibold text-gray-950">주최 공모 등록</h3>
            <p className="mt-1 text-sm text-gray-500">관리자가 등록하므로 승인 절차 없이 바로 모집공고에 올라가요.</p>
          </div>
          <div className="rounded-xl bg-gray-50 px-4 py-3">
            <p className="text-xs font-medium text-gray-500">공모는 이렇게 진행돼요</p>
            <ProgressSteps variant="inline" steps={flowSteps} current={0} label="공모 진행 순서" className="mt-1.5" />
          </div>

          <FormSection n={1} title="진행 범위" description="어디까지 이 페이지에서 진행할지 골라 주세요. 등록한 뒤에는 바꿀 수 없어요.">
            <ExhibitionScopePicker
              bare
              recruitOnly={form.recruitOnly}
              onChange={(next) => {
                setForm({ ...form, recruitOnly: next, ...(next ? { submissionDeadline: '', exhibitStartDate: '', exhibitDate: '' } : {}) });
                ['submissionDeadline', 'exhibitStartDate', 'exhibitDate'].forEach(clearError);
              }}
            />
          </FormSection>

          <FormSection n={2} title="운영 갤러리 (선택)" description="지정한 갤러리는 이 공모를 자기 공모처럼 운영해요(지원자 관리 · 작가 초대 · 전시 확정 · 정산). 맨 앞 갤러리가 주관이 되어 목록 카드에 표시돼요.">
            <GalleryPicker bare selected={managerGalleries} onChange={(next) => { setManagerGalleries(next); clearError('galleries'); }} error={formErrors.has('galleries')} />
          </FormSection>

          <FormSection n={3} title="공고 내용">
            <div className="grid gap-5 sm:grid-cols-[168px_minmax(0,1fr)]">
              <div>
                <p className="mb-1.5 text-sm font-medium text-gray-800">포스터</p>
                {/* 목록 카드와 같은 모양(210:297) — 자르지 않고 남는 자리는 흐린 배경 */}
                <HeroImageEdit fit="contain" value={form.imageUrl} onChange={(url) => setForm({ ...form, imageUrl: url })} onRemove={() => setForm({ ...form, imageUrl: '' })} className="aspect-[210/297] w-full max-w-[168px]" label="포스터" />
              </div>
              <div className="min-w-0 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="구분" htmlFor="hosted-type">
                    <select id="hosted-type" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className={formInputCls()}>
                      <option value="SOLO">개인전</option>
                      <option value="GROUP">단체전</option>
                      <option value="ART_FAIR">아트페어</option>
                    </select>
                  </FormField>
                  <FormField label="지역" htmlFor="hosted-region">
                    <select id="hosted-region" value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} className={formInputCls()}>
                      {regions.map(r => <option key={r} value={r}>{regionLabels[r]}</option>)}
                    </select>
                  </FormField>
                </div>
                <FormField label="공모 제목 *" error={formErrors.has('title')} htmlFor="hosted-title">
                  <input id="hosted-title" data-form-error={formErrors.has('title') || undefined} value={form.title} onChange={e => { setForm({ ...form, title: e.target.value }); clearError('title'); }} placeholder="공모 제목" className={formInputCls(formErrors.has('title'))} />
                </FormField>
                {/* 정원 = 선정 인원(2026-09-27) · 0명·00명(2026-10-14) — 갤러리 등록 폼과 같은 칸 */}
                <FormField label="모집 작가 수 *" error={formErrors.has('capacity')} htmlFor="hosted-capacity">
                  <CapacityPicker
                    inputId="hosted-capacity"
                    error={formErrors.has('capacity')}
                    value={{ capacity: form.capacity, capacityMask: form.capacityMask ?? null }}
                    onChange={(v) => { setForm(prev => ({ ...prev, ...v })); clearError('capacity'); }}
                  />
                </FormField>
              </div>
            </div>
            {/* 서식 있는 글(2026-10-03). 함수형 갱신 — 편집기가 처음 받은 콜백을 붙들 수 있다 */}
            <FormField label="공모 소개 *" error={formErrors.has('description')} className="mt-5">
              <div data-form-error={formErrors.has('description') || undefined} className={formErrors.has('description') ? 'rounded-lg ring-1 ring-accent' : 'rounded-lg'}>
                <LazyRichTextEditor
                  value={form.description}
                  onChange={(v) => { setForm(prev => ({ ...prev, description: v })); clearError('description'); }}
                  placeholder="공모 소개"
                  maxLength={20000}
                  minHeight={200}
                />
              </div>
            </FormField>
            <FormField
              label="첨부파일 (선택)"
              className="mt-5"
              hint={`첨부 가능 형식: ${ATTACHMENT_TYPES_TEXT}`}
            >
              <AttachmentEditor
                value={form.attachments}
                onChange={(update) => setForm(prev => ({ ...prev, attachments: update(prev.attachments) }))}
                onBusyChange={setAttachBusy}
              />
            </FormField>
          </FormSection>

          <FormSection n={4} title="일정">
            {/* 달력 하나를 칸들이 나눠 쓴다(2026-10-28, 갤러리 공모 등록과 같은 부품 · lib/scheduleCalendar.ts).
                ⚠️ 공모만 진행하면 전시·자료 제출 칸을 그리지 않는다(2026-09-19) */}
            <SchedulePicker
              {...exhibitionSchedule(!!form.recruitOnly, 'hosted')}
              values={form}
              errors={formErrors}
              onChange={(patch) => { setForm(prev => ({ ...prev, ...patch })); Object.keys(patch).forEach(clearError); }}
            />
            {summary && <p className="mt-5 text-sm text-gray-700"><span className="text-gray-400">한눈에 · </span>{summary}</p>}
            {dateError && (
              <p className="mt-2 flex items-center gap-1 text-xs text-accent"><AlertTriangle size={12} aria-hidden /> {dateError}</p>
            )}
          </FormSection>

          <FormSection n={5} title="추가 질문 (선택)">
            <CustomQuestionBuilder
              bare
              fields={form.customFields}
              onChange={(update) => setForm(prev => ({ ...prev, customFields: update(prev.customFields) }))}
            />
          </FormSection>

          <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-6">
            <button
              type="button"
              disabled={createMutation.isPending || !!dateError}
              onClick={submit}
              className="min-h-[44px] rounded-lg bg-gray-900 px-5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createMutation.isPending ? '등록 중...' : '등록'}
            </button>
            <button type="button" onClick={resetForm} className="min-h-[44px] px-3 text-sm text-gray-500 hover:text-gray-900">취소</button>
            <p className="w-full text-xs text-gray-500">등록하면 바로 모집공고에 등록돼요.</p>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmSubmit}
        title="주최 공모 등록"
        message={[
          '이 내용으로 등록하시겠습니까?',
          '승인 절차 없이 바로 공고에 노출됩니다.',
          managerGalleries.length > 0
            ? `선택한 갤러리 ${managerGalleries.length}곳이 운영 권한을 갖습니다.`
            : '운영 갤러리를 지정하지 않았습니다 — 아트링크(관리자)가 직접 운영합니다.',
          form.recruitOnly
            ? '진행 범위: 공모만 진행 (지원자 수락까지, 출품 자료·전시·정산 없음)'
            : '진행 범위: 전시까지 진행',
          ...(form.attachments.length ? [`첨부파일 ${form.attachments.length}개 — 공고 상세에서 누구나 내려받아요.`] : []),
        ].join('\n')}
        confirmText="등록"
        onConfirm={() => {
          setConfirmSubmit(false);
          createMutation.mutate({
            ...form,
            ...capacityPayload({ capacity: form.capacity, capacityMask: form.capacityMask ?? null }),
            customFields: sanitizeCustomFields(form.customFields),
            galleryIds: managerGalleries.map(g => g.id),
          });
        }}
        onCancel={() => setConfirmSubmit(false)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="주최 공모 삭제"
        message={`"${deleteTarget?.title}" 공모를 삭제합니다.\n지원 내역·작가 제출자료가 함께 삭제되며 되돌릴 수 없습니다.`}
        confirmText="삭제"
        variant="danger"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />

      {editManagersFor && (
        <ManagerEditModal exhibition={editManagersFor} onClose={() => setEditManagersFor(null)} />
      )}

      {editContentEx && <HostedContentEditModal exhibition={editContentEx} onClose={() => setEditContentEx(null)} />}
      {editQuestionsEx && (
        <CustomQuestionsEditModal
          exhibitionId={editQuestionsEx.id}
          exhibitionTitle={editQuestionsEx.title}
          initialFields={editQuestionsEx.customFields}
          onClose={() => setEditQuestionsEx(null)}
        />
      )}

      {/* 목록 */}
      {isLoading ? (
        <div className="grid gap-3">{[0, 1].map(i => <div key={i} className="h-32 animate-pulse rounded-2xl bg-gray-100" />)}</div>
      ) : exhibitions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 py-14 text-center">
          <p className="text-sm text-gray-400">아직 아트링크가 주최한 공모가 없습니다.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {exhibitions.map((ex: any) => {
            const dday = ex.deadline ? getDday(ex.deadline) : null;
            return (
              <article key={ex.id} id={`hosted-ex-${ex.id}`} className="scroll-mt-24 overflow-hidden rounded-2xl border border-gray-200 bg-white">
                <div className="grid gap-0 sm:grid-cols-[160px_1fr]">
                  <button type="button" onClick={() => navigate(`/exhibitions/${ex.id}`)} className="relative min-h-[120px] bg-gray-100 text-left">
                    {ex.imageUrl ? (
                      <img src={ex.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-gray-300"><Building2 size={28} /></div>
                    )}
                    <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                      D{dday !== null ? (dday >= 0 ? `-${dday}` : `+${Math.abs(dday)}`) : '-'}
                    </span>
                  </button>

                  <div className="min-w-0 p-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${statusColors[ex.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {ex.status === 'APPROVED' ? '게시 중' : ex.status}
                      </span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{exhibitionTypeLabels[ex.type] ?? ex.type}</span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{regionLabels[ex.region] ?? ex.region}</span>
                      <span className="flex items-center gap-1 text-[11px] text-gray-500"><Users size={11} /> 지원 {ex.applicationCount ?? 0}명 / 모집 {capacityText(ex)}</span>
                    </div>

                    <h4 className="mt-1.5 truncate text-lg font-medium text-gray-900">{ex.title}</h4>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-gray-400">운영</span>
                      {(ex.managerGalleries ?? []).length === 0 && (
                        <span className="rounded-full bg-gray-900 px-2 py-0.5 text-[11px] text-white">아트링크 직접 운영</span>
                      )}
                      {(ex.managerGalleries ?? []).map((g: any, i: number) => (
                        <span key={g.id} className={`rounded-full px-2 py-0.5 text-[11px] ${i === 0 ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}>
                          {g.name}{i === 0 ? ' (주관)' : ''}
                        </span>
                      ))}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => setManageAppsExId(manageAppsExId === ex.id ? null : ex.id)}
                        className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs text-white"
                      >
                        {manageAppsExId === ex.id ? '지원자 관리 닫기' : '지원자 관리'}
                      </button>
                      <button onClick={() => setEditContentEx(ex)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                        제목·소개 수정
                      </button>
                      <button onClick={() => setEditQuestionsEx(ex)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                        추가 질문
                      </button>
                      <button onClick={() => setEditManagersFor(ex)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                        운영 갤러리 변경
                      </button>
                      <button onClick={() => navigate(`/exhibitions/${ex.id}`)} className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                        <ExternalLink size={12} /> 공고 보기
                      </button>
                      <button onClick={() => navigate(`/exhibitions/${ex.id}/operation/new`)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                        운영 페이지
                      </button>
                      <button onClick={() => setDeleteTarget(ex)} className="flex items-center gap-1 rounded-lg border border-accent/30 px-3 py-1.5 text-xs text-accent hover:bg-accent/5">
                        <Trash2 size={12} /> 삭제
                      </button>
                    </div>
                  </div>
                </div>

                {manageAppsExId === ex.id && (
                  <div className="border-t border-gray-100 p-4">
                    <ApplicantManager
                      exhibitionId={ex.id}
                      exhibitionTitle={ex.title}
                      customFields={ex.customFields}
                      capacity={ex.capacity}
                      capacityMask={ex.capacityMask ?? null}
                      recruitOnly={!!ex.recruitOnly}
                      ended={!!ex.ended || !!ex.settledAt}
                      capacityEditable
                    />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
