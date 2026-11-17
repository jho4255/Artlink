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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, X, Search, Trash2, Building2, Users, AlertTriangle, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { scrollToTarget } from '@/lib/scrollToTarget';
import { regionLabels, exhibitionTypeLabels, getDday, capacityPayload, capacityText, type CapacityMask } from '@/lib/utils';
import { sanitizeCustomFields } from '@/components/shared/CustomQuestionsEditor';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import ApplicantManager from '@/components/shared/ApplicantManager';
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

  // 날짜 순서 · 남은 필수 칸 — 갤러리 공모 등록과 같은 함수(components/exhibition-form).
  // ⚠️ 운영 갤러리는 필수가 아니다(2026-09-10) — 아트링크가 갤러리를 안 끼고 직접 열 수 있다
  const dateError = exhibitionDateError(form);
  const missingFields = exhibitionMissing(form, { needGallery: false });
  const [previewOpen, setPreviewOpen] = useState(false);
  const wideForm = useMediaQuery('(min-width: 1280px)');

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
      scrollToTarget(document.getElementById(`hosted-ex-${exId}`));
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
        주최 공모 등록 — 갤러리 공모 등록과 **같은 폼**(components/exhibition-form/ExhibitionFormBody, 2026-11-15).
        다른 점은 셋뿐 — 갤러리 선택 대신 '운영 갤러리(선택, 여러 곳)' 구역 · 승인 없이 바로 게시 · 약관 없음.
      */}
      {showForm && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-gray-950">주최 공모 등록</h3>
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
        </div>
      )}

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
