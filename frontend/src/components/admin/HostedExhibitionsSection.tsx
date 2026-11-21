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
 * ## 화면(2026-11-21 개편, 규칙 89)
 *   줄 목록 → 줄을 누르면 갤러리 [내 공모]와 같은 **공모 한 건 화면**(ExhibitionWorkspace) · 등록은 전용 화면(`&new=1`).
 *   예전 큰 카드(포스터를 잘라 그리고 버튼 7개가 늘 펼쳐져 있던)는 없앴다 — 드문 동작은 줄 끝 [⋯].
 *
 * ## 관련 API
 *   GET    /exhibitions/hosted          목록(검토 대기 · 수락 · 첨부 받음 포함)
 *   POST   /exhibitions/hosted          등록 (galleryIds[0] = 주관)
 *   PATCH  /exhibitions/:id/managers    운영 갤러리 변경 (전체 교체)
 *   DELETE /exhibitions/:id             삭제 (주최자인 Admin만)
 */
import { useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, X, Search, AlertTriangle, ArrowLeft, MoreHorizontal, Building2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { rememberListScroll, takeListScroll } from '@/lib/listScroll';
import { normalizeAttachments } from '@/lib/attachments';
import { WORKSPACE_VIEWS, type WorkspaceView } from '@/lib/flowLabels';
import { hasUnsavedChanges } from '@/hooks/useUnsavedChanges';
import ExhibitionWorkspace from '@/components/workspace/ExhibitionWorkspace';
import MenuButton, { type MenuItem } from '@/components/flow/MenuButton';
import PageTabBar from '@/components/shared/PageTabBar';
import { AdminHead, ChoiceLinks, Dot, EmptyLine, SearchBox, Th } from '@/components/admin/AdminUi';
import { shortDate } from '@/lib/adminFormat';
import { cn, regionLabels, exhibitionTypeLabels, getDday, capacityPayload, capacityText, type CapacityMask } from '@/lib/utils';
import { sanitizeCustomFields } from '@/components/shared/CustomQuestionsEditor';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import CustomQuestionsEditModal from '@/components/shared/CustomQuestionsEditor';
import HostedContentEditModal from '@/components/admin/HostedContentEditModal';
import { scheduleSummary } from '@/lib/scheduleSummary';
import { type ExhibitionAttachment } from '@/lib/attachments';
import { ExhibitionFormBody } from '@/components/exhibition-form/ExhibitionFormBody';
import { exhibitionMissing, exhibitionDateError, exhibitionPreview } from '@/components/exhibition-form/exhibitionForm';
import { jumpToField } from '@/lib/formJump';
import StickySubmitBar from '@/components/form/StickySubmitBar';
import SubmitSheet from '@/components/form/SubmitSheet';
import { PreviewAside, PreviewSheet } from '@/components/form/PreviewPane';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { CustomField } from '@/types';

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

// ─────────────────────────────────────────────────────────────────
// 주최 공모 — 줄 목록 · 공모 한 건 화면 · 등록 화면 (2026-11-21 개편, 규칙 89)
//   주소 `?tab=hosted-exhibitions`            줄 목록 [모집 중 · 마감 · 전체] · 정렬 · 찾기
//        `?tab=hosted-exhibitions&ex=<id>`   공모 한 건 화면(갤러리 [내 공모]와 같은 ExhibitionWorkspace)
//        `?tab=hosted-exhibitions&new=1`     등록 화면(목록 위에 폼을 펼치지 않는다)
//   옛 `&panel=applicants`(운영 화면의 [지원자 보기]·옛 알림)는 지원자 탭으로 연다.
// ─────────────────────────────────────────────────────────────────
type HostedTab = 'open' | 'closed' | 'all';
type HostedSort = 'deadline' | 'views' | 'recent';

const isOpenCall = (ex: any) => ex.status === 'APPROVED' && !ex.recruitmentClosed && !ex.ended && ex.deadline && getDday(ex.deadline) >= 0;

function ddayCell(ex: any): { main: string; sub: string; hot: boolean } {
  if (!isOpenCall(ex)) return { main: '마감', sub: ex.deadline ? shortDate(ex.deadline) : '', hot: false };
  const d = getDday(ex.deadline);
  return { main: d === 0 ? '오늘 마감' : `D-${d}`, sub: `${shortDate(ex.deadline)}까지`, hot: d <= 7 };
}
function opsText(ex: any): string {
  const m = ex.managerGalleries ?? [];
  return m.length === 0 ? '아트링크 직접 운영' : `${m[0].name}${m.length > 1 ? ` 외 ${m.length - 1}곳` : ''}`;
}
function metaText(ex: any): string {
  return [exhibitionTypeLabels[ex.type] ?? ex.type, regionLabels[ex.region] ?? ex.region, capacityText(ex), ex.recruitOnly ? '공모만 진행' : null].filter(Boolean).join(' · ');
}

export default function HostedExhibitionsSection() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const tableWide = useMediaQuery('(min-width: 900px)');
  const creating = searchParams.get('new') === '1';
  const workspaceId = Number(searchParams.get('ex')) || null;
  const navState = (location.state ?? {}) as { fromList?: boolean; view?: string };
  const viewParam = searchParams.get('view') ?? navState.view ?? (searchParams.get('panel') === 'applicants' ? 'applicants' : null);
  const workspaceView = viewParam && (WORKSPACE_VIEWS as string[]).includes(viewParam) ? viewParam as WorkspaceView : null;

  const [tab, setTab] = useState<HostedTab>('open');
  const [sort, setSort] = useState<HostedSort>('deadline');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [managerGalleries, setManagerGalleries] = useState<PickedGallery[]>([]);
  const [formErrors, setFormErrors] = useState<Set<string>>(new Set());
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  // 첨부파일을 올리는 중 — 다 올라가기 전에 등록하면 그 파일이 빠진다
  const [attachBusy, setAttachBusy] = useState(false);
  const [editManagersFor, setEditManagersFor] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  // 추가 질문 수정 — 갤러리 마이페이지와 같은 공용 모달. 주최자가 자기 공고 질문을 못 고치면 안 된다.
  const [editQuestionsEx, setEditQuestionsEx] = useState<any>(null);
  const [editContentEx, setEditContentEx] = useState<{ id: number; title: string; description?: string | null } | null>(null);

  const clearError = (key: string) =>
    setFormErrors(prev => { const n = new Set(prev); n.delete(key); return n; });

  // 날짜 순서 · 남은 필수 칸 — 갤러리 공모 등록과 같은 함수(components/exhibition-form).
  // ⚠️ 운영 갤러리는 필수가 아니다(2026-09-10) — 아트링크가 갤러리를 안 끼고 직접 열 수 있다
  const dateError = exhibitionDateError(form);
  const missingFields = exhibitionMissing(form, { needGallery: false });
  const [previewOpen, setPreviewOpen] = useState(false);
  const wideForm = useMediaQuery('(min-width: 1280px)');

  // 목록은 들어올 때마다 새로 — 공모 화면에서 수락·마감하고 돌아오면 숫자가 바뀌어 있어야 한다
  const { data: exhibitions = [], isLoading } = useQuery<any[]>({
    queryKey: ['hosted-exhibitions'],
    queryFn: () => api.get('/exhibitions/hosted').then(r => r.data).catch(() => []),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const listHref = '/mypage?tab=hosted-exhibitions';
  const resetForm = () => {
    setForm(emptyForm);
    setManagerGalleries([]);
    setFormErrors(new Set());
    if (creating) navigate(listHref, { replace: true });
  };
  const openExhibition = (id: number, view?: WorkspaceView) => {
    rememberListScroll('hosted-exhibitions');
    navigate(`${listHref}&ex=${id}`, { state: { fromList: true, view } });
  };
  const closeExhibition = () => {
    if (navState.fromList && !hasUnsavedChanges()) navigate(-1);
    else navigate(listHref, { replace: true });
  };
  useLayoutEffect(() => {
    if (workspaceId || creating) return;
    const y = takeListScroll('hosted-exhibitions');
    if (y != null) window.scrollTo({ top: y, left: 0, behavior: 'instant' });
  }, [workspaceId, creating]);

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/exhibitions/hosted', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hosted-exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      resetForm();
      toast.success('주최 공모를 등록했어요. 바로 모집공고에 올라가요.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '등록 실패'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/exhibitions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hosted-exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['ov-exhibitions'] });
      setDeleteTarget(null);
      toast.success('삭제했어요.');
      if (workspaceId) navigate(listHref, { replace: true });
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '삭제 실패'),
  });

  /** [등록] — 남은 필수 칸이 있으면 그 칸으로(하단 줄과 같은 목록), 다 채웠으면 확인 창 */
  const submit = () => {
    if (attachBusy) {
      toast.error('첨부파일을 올리는 중이에요. 다 올라간 뒤에 눌러 주세요.');
      return;
    }
    if (missingFields.length > 0) {
      setFormErrors(new Set(missingFields.map((m) => m.key)));
      jumpToField(missingFields[0].key);
      return;
    }
    if (dateError) {
      toast.error(dateError);
      jumpToField('deadlineStart');
      return;
    }
    const cleaned = sanitizeCustomFields(form.customFields);
    if (cleaned.find(f => (f.type === 'select' || f.type === 'multiselect') && (f.options ?? []).length < 2)) {
      toast.error('객관식 질문은 선택지를 2개 이상 입력해주세요.');
      return;
    }
    setForm(prev => ({ ...prev, customFields: cleaned }));
    setConfirmSubmit(true);
  };

  const summary = scheduleSummary(form);
  const host = {
    adminHosted: true,
    managers: managerGalleries.map(g => g.name),
    gallery: managerGalleries[0] ? { id: managerGalleries[0].id, name: managerGalleries[0].name, region: managerGalleries[0].region } : null,
  };
  const previewOf = () => exhibitionPreview(form, host);

  const menuFor = (ex: any): MenuItem[] => [
    { id: 'detail', label: '공고 보기', onSelect: () => navigate(`/exhibitions/${ex.id}`) },
    { id: 'content', label: '제목·소개 수정', onSelect: () => setEditContentEx(ex) },
    { id: 'questions', label: '추가 질문 수정', onSelect: () => setEditQuestionsEx(ex) },
    { id: 'managers', label: '운영 갤러리 변경', onSelect: () => setEditManagersFor(ex) },
    { id: 'delete', label: '공모 삭제', onSelect: () => setDeleteTarget(ex) },
  ];

  const openCount = exhibitions.filter(isOpenCall).length;
  const shown = exhibitions
    .filter((ex) => (tab === 'all' ? true : tab === 'open' ? isOpenCall(ex) : !isOpenCall(ex)))
    .filter((ex) => !q || String(ex.title).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      if (sort === 'views') return (b.viewCount ?? 0) - (a.viewCount ?? 0);
      if (sort === 'recent') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      // 마감 가까운 순 — 모집 중은 남은 날 적은 것부터, 마감은 최근에 마감한 것부터
      const ao = isOpenCall(a), bo = isOpenCall(b);
      if (ao !== bo) return ao ? -1 : 1;
      const da = new Date(a.deadline).getTime(), db = new Date(b.deadline).getTime();
      return ao ? da - db : db - da;
    });
  const workspaceEx = workspaceId ? exhibitions.find((e) => e.id === workspaceId) : null;

  const modals = (
    <>
      {confirmSubmit && (
        <SubmitSheet
          title="주최 공모를 등록할까요?"
          rows={[
            ['공모', form.title],
            ...(summary ? [['일정', summary] as [string, ReactNode]] : []),
            ['모집', `${exhibitionTypeLabels[form.type] ?? form.type} · ${capacityText(form)} · ${regionLabels[form.region] ?? form.region}`],
            ['운영', managerGalleries.length > 0 ? managerGalleries.map(g => g.name).join(', ') : '아트링크가 직접 운영'],
            ['범위', form.recruitOnly ? '공모만 진행 — 지원자 선정까지' : '전시까지 진행'],
            ...(form.attachments.length ? [['첨부', `${form.attachments.length}개`] as [string, ReactNode]] : []),
          ]}
          note="승인 절차 없이 바로 모집공고에 올라가요."
          confirmLabel="등록"
          pending={createMutation.isPending}
          onConfirm={() => {
            setConfirmSubmit(false);
            createMutation.mutate({
              ...form,
              ...capacityPayload({ capacity: form.capacity, capacityMask: form.capacityMask ?? null }),
              customFields: sanitizeCustomFields(form.customFields),
              galleryIds: managerGalleries.map(g => g.id),
            });
          }}
          onClose={() => setConfirmSubmit(false)}
        />
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        title="주최 공모를 지울까요?"
        details={[
          `「${deleteTarget?.title ?? ''}」을 지워요.`,
          `지원 ${deleteTarget?.applicationCount ?? 0}건 · 수락한 작가 ${deleteTarget?.acceptedCount ?? 0}명의 기록과 출품 자료가 함께 사라져요.`,
          '되돌릴 수 없어요.',
        ]}
        confirmText="삭제"
        variant="danger"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
      {editManagersFor && <ManagerEditModal exhibition={editManagersFor} onClose={() => setEditManagersFor(null)} />}
      {editContentEx && <HostedContentEditModal exhibition={editContentEx} onClose={() => setEditContentEx(null)} />}
      {editQuestionsEx && (
        <CustomQuestionsEditModal
          exhibitionId={editQuestionsEx.id}
          exhibitionTitle={editQuestionsEx.title}
          initialFields={editQuestionsEx.customFields}
          onClose={() => setEditQuestionsEx(null)}
        />
      )}
    </>
  );

  // ── 등록 화면 ──
  if (creating) {
    return (
      <div>
        <button type="button" onClick={() => navigate(listHref)} className="-ml-1 inline-flex min-h-[44px] items-center gap-1.5 px-1 text-sm text-gray-600 hover:text-gray-950">
          <ArrowLeft size={16} aria-hidden /> 주최 공모
        </button>
        <h2 className="mt-2 text-[22px] font-semibold tracking-tight text-gray-950">주최 공모 등록</h2>
        {/*
          갤러리 공모 등록과 **같은 폼**(components/exhibition-form/ExhibitionFormBody, 2026-11-15).
          다른 점은 셋뿐 — 갤러리 선택 대신 '운영 갤러리(선택, 여러 곳)' 구역 · 승인 없이 바로 게시 · 약관 없음.
        */}
        <div className="mt-6 xl:grid xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-10">
          <div className="min-w-0 max-w-[720px]">
            <ExhibitionFormBody
              form={form}
              setForm={setForm}
              errors={formErrors}
              clearError={clearError}
              onAttachBusy={setAttachBusy}
              idPrefix="hosted"
              extraSection={{
                title: '운영 갤러리 (선택)',
                node: (
                  <GalleryPicker
                    bare
                    selected={managerGalleries}
                    onChange={(next) => {
                      // 처음 고른 갤러리의 지역으로 미리 채운다(갤러리 공모와 같다) — 바꿀 수 있다
                      if (managerGalleries.length === 0 && next[0]?.region) setForm(prev => ({ ...prev, region: next[0].region! }));
                      setManagerGalleries(next);
                      clearError('galleries');
                    }}
                    error={formErrors.has('galleries')}
                  />
                ),
              }}
            />
          </div>
          {wideForm && <PreviewAside preview={previewOf()} />}
        </div>
        <StickySubmitBar
          missing={missingFields}
          onJump={jumpToField}
          onPreview={wideForm ? undefined : () => setPreviewOpen(true)}
          onCancel={resetForm}
          submitLabel="등록"
          onSubmit={submit}
          pending={createMutation.isPending}
        />
        {previewOpen && !wideForm && <PreviewSheet preview={previewOf()} onClose={() => setPreviewOpen(false)} />}
        {modals}
      </div>
    );
  }

  // ── 공모 한 건 화면 ──
  if (workspaceId) {
    return (
      <>
        <ExhibitionWorkspace
          key={workspaceId}
          exhibitionId={workspaceId}
          initialView={workspaceView}
          onClose={closeExhibition}
          backLabel="주최 공모"
          extraMenu={workspaceEx ? menuFor(workspaceEx).filter((m) => m.id !== 'detail' && m.id !== 'delete') : []}
        />
        {modals}
      </>
    );
  }

  // ── 줄 목록 ──
  return (
    <div>
      <AdminHead title="주최 공모">
        <button type="button" onClick={() => navigate(`${listHref}&new=1`)}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-gray-900 px-[18px] text-sm font-semibold text-white hover:bg-gray-800">
          <Plus size={16} aria-hidden /> 주최 공모 등록
        </button>
      </AdminHead>

      <div className="mt-3">
        <PageTabBar<HostedTab>
          sticky={false}
          idPrefix="hosted"
          label="공모 범위"
          active={tab}
          onSelect={setTab}
          tabs={[
            { id: 'open', label: '모집 중', count: openCount },
            { id: 'closed', label: '마감', count: exhibitions.length - openCount },
            { id: 'all', label: '전체', count: exhibitions.length },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1 py-2">
        <ChoiceLinks<HostedSort> label="정렬" value={sort} onChange={setSort} options={[
          { id: 'deadline', label: '마감 가까운 순' }, { id: 'views', label: '조회 많은 순' }, { id: 'recent', label: '최근 등록 순' },
        ]} />
        <SearchBox label="공모 제목 찾기" value={q} onChange={setQ} className="w-full sm:w-[240px]" />
      </div>

      {isLoading ? (
        <div className="grid gap-2">{[0, 1, 2].map(i => <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-100" />)}</div>
      ) : exhibitions.length === 0 ? (
        <EmptyLine>아직 아트링크가 주최한 공모가 없어요.</EmptyLine>
      ) : shown.length === 0 ? (
        <EmptyLine>{q ? '찾는 공모가 없어요.' : tab === 'open' ? '모집 중인 주최 공모가 없어요.' : '마감한 주최 공모가 없어요.'}</EmptyLine>
      ) : tableWide ? (
        <div role="table" aria-label="주최 공모" className="border-t border-gray-900">
          <div role="row" className="grid grid-cols-[minmax(0,1fr)_128px_150px_56px_120px_64px_44px] items-center gap-3.5 border-b border-gray-200 py-2.5">
            <Th>공모</Th><Th>마감</Th><Th>운영</Th><Th className="text-right">조회</Th><Th>지원</Th><Th>수락</Th><Th />
          </div>
          {shown.map((ex: any) => {
            const dd = ddayCell(ex);
            const hasAttach = normalizeAttachments(ex.attachments).length > 0;
            return (
              <div role="row" key={ex.id} id={`hosted-ex-${ex.id}`} data-hosted-row={ex.id}
                className="relative -mx-3 grid grid-cols-[minmax(0,1fr)_128px_150px_56px_120px_64px_44px] items-center gap-3.5 border-b border-gray-100 px-3 py-2 hover:bg-gray-50">
                <span role="cell" className="flex min-w-0 items-center gap-3">
                  <span className="h-12 w-[34px] shrink-0 bg-gray-100">{ex.imageUrl && <img src={ex.imageUrl} alt="" loading="lazy" className="h-12 w-[34px] object-contain" />}</span>
                  <span className="min-w-0">
                    <button type="button" onClick={() => openExhibition(ex.id, ex.pendingCount > 0 ? 'applicants' : undefined)}
                      data-hosted-title className="block max-w-full truncate text-left text-[14.5px] font-semibold text-gray-950 after:absolute after:inset-0 after:content-['']">{ex.title}</button>
                    <span className="block truncate text-[12.5px] text-gray-500">{metaText(ex)}</span>
                  </span>
                </span>
                <span role="cell" className="whitespace-nowrap text-[13.5px] tabular-nums">
                  <strong className={cn('font-semibold', dd.hot ? 'text-accent' : 'text-gray-950')}>{dd.main}</strong>
                  <span className="ml-1.5 text-gray-500">{dd.sub}</span>
                </span>
                <span role="cell" className="truncate text-[13.5px] text-gray-700">{opsText(ex)}</span>
                <span role="cell" className="text-right text-[13.5px] tabular-nums">{(ex.viewCount ?? 0).toLocaleString('ko-KR')}</span>
                <span role="cell" className="min-w-0 text-[13.5px] tabular-nums">
                  <strong className="font-semibold">{ex.applicationCount ?? 0}</strong>
                  {ex.pendingCount > 0 && <span className="ml-2 font-semibold text-accent"><Dot className="mr-1" />검토 대기 {ex.pendingCount}</span>}
                  {hasAttach && <span className="block text-[12px] text-gray-500">첨부 받음 {ex.attachmentDownloads ?? 0}</span>}
                </span>
                <span role="cell" className="whitespace-nowrap text-[13.5px] tabular-nums text-gray-700">{ex.acceptedCount ? `${ex.acceptedCount}${ex.capacityMask ? '' : ` / ${ex.capacity}`}` : '—'}</span>
                <span role="cell" className="relative z-10"><MenuButton label={`${ex.title} 더 보기`} iconOnly icon={<MoreHorizontal size={18} aria-hidden />} items={menuFor(ex)} /></span>
              </div>
            );
          })}
        </div>
      ) : (
        <ul className="border-t border-gray-900" aria-label="주최 공모">
          {shown.map((ex: any) => {
            const dd = ddayCell(ex);
            return (
              <li key={ex.id} id={`hosted-ex-${ex.id}`} data-hosted-row={ex.id} className="flex items-start gap-1 border-b border-gray-100">
                <button type="button" onClick={() => openExhibition(ex.id, ex.pendingCount > 0 ? 'applicants' : undefined)} className="flex min-w-0 flex-1 gap-3 py-3 text-left">
                  <span className="h-[62px] w-11 shrink-0 bg-gray-100">{ex.imageUrl && <img src={ex.imageUrl} alt="" loading="lazy" className="h-[62px] w-11 object-contain" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] tabular-nums text-gray-600">
                      <strong className={cn('font-bold', dd.hot ? 'text-accent' : 'text-gray-950')}>{dd.main}</strong>
                      <span className="ml-1.5">{dd.sub} · {opsText(ex)}</span>
                    </span>
                    <span data-hosted-title className="mt-0.5 block truncate text-[15px] font-semibold text-gray-950">{ex.title}</span>
                    <span className="mt-0.5 block text-[12.5px] tabular-nums text-gray-600">
                      {regionLabels[ex.region] ?? ex.region} · 조회 {(ex.viewCount ?? 0).toLocaleString('ko-KR')} · 지원 {ex.applicationCount ?? 0}
                      {ex.pendingCount > 0 && <span className="ml-2 font-semibold text-accent"><Dot className="mr-1" />검토 대기 {ex.pendingCount}</span>}
                    </span>
                  </span>
                </button>
                <span className="pt-2"><MenuButton label={`${ex.title} 더 보기`} iconOnly icon={<MoreHorizontal size={18} aria-hidden />} items={menuFor(ex)} /></span>
              </li>
            );
          })}
        </ul>
      )}
      {modals}
    </div>
  );
}
