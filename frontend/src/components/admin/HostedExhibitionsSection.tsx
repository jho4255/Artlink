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
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, X, Search, Trash2, Building2, Users, Star, AlertTriangle, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { regionLabels, exhibitionTypeLabels, getDday, validateExhibitionDates } from '@/lib/utils';
import { EditableText, HeroImageEdit } from '@/components/shared/EditableField';
import { CustomQuestionBuilder, sanitizeCustomFields } from '@/components/shared/CustomQuestionsEditor';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import ApplicantManager from '@/components/shared/ApplicantManager';
import CustomQuestionsEditModal from '@/components/shared/CustomQuestionsEditor';
import type { CustomField } from '@/types';

const regions = ['SEOUL', 'INCHEON', 'GYEONGGI_NORTH', 'GYEONGGI_SOUTH', 'DAEJEON', 'DAEGU', 'BUSAN', 'ULSAN'];

interface PickedGallery { id: number; name: string; region?: string; rating?: number }

const emptyForm = {
  title: '',
  type: 'GROUP',
  deadlineStart: '',
  deadline: '',
  exhibitStartDate: '',
  exhibitDate: '',
  capacity: 1,
  region: 'SEOUL',
  description: '',
  imageUrl: '',
  customFields: [] as CustomField[],
};

// ────────────────────────────────────────────────────────────────────────────
// 운영 갤러리 선택기 — 검색해서 추가하고, 순서를 바꿔 주관 갤러리를 정한다.
// ────────────────────────────────────────────────────────────────────────────
function GalleryPicker({
  selected,
  onChange,
  error,
}: {
  selected: PickedGallery[];
  onChange: (next: PickedGallery[]) => void;
  error?: boolean;
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

  const add = (g: any) => onChange([...selected, { id: g.id, name: g.name, region: g.region, rating: g.rating }]);
  const remove = (id: number) => onChange(selected.filter(g => g.id !== id));
  // 주관 갤러리 지정 = 목록 맨 앞으로 이동
  const makeHost = (id: number) => {
    const target = selected.find(g => g.id === id);
    if (!target) return;
    onChange([target, ...selected.filter(g => g.id !== id)]);
  };

  return (
    <div className={`rounded-xl border p-3 ${error ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center justify-between">
        <p className={`text-xs font-medium ${error ? 'text-red-600' : 'text-gray-500'}`}>운영 갤러리 *</p>
        <p className="text-[11px] text-gray-400">{selected.length}곳 선택</p>
      </div>
      <p className="mt-1 text-[11px] text-gray-400">
        지정된 갤러리는 이 공모를 자기 공모처럼 운영합니다 (지원자 관리 · 작가 초대 · 전시 확정 · 정산).
        맨 앞 갤러리가 <b>주관</b>이 되어 목록 카드에 표시됩니다.
      </p>

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
              <button type="button" onClick={() => remove(g.id)} className="text-gray-400 hover:text-red-500" aria-label={`${g.name} 제외`}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 검색 + 추가 */}
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-1.5">
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
                {g.rating > 0 && (
                  <span className="flex items-center gap-0.5 text-[11px] text-gray-400">
                    <Star size={10} className="fill-current" />{g.rating.toFixed(1)}
                  </span>
                )}
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

        <div className="mt-4 flex gap-2">
          <button
            disabled={selected.length === 0 || mutation.isPending}
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
  const [editManagersFor, setEditManagersFor] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  // 지원자 관리 — 갤러리 마이페이지와 같은 인라인 <ApplicantManager /> 를 그대로 쓴다(창 이동 없음).
  // Admin 도 수락/거절을 해야 해서 백엔드 라우트가 GALLERY+ADMIN 으로 열려 있다.
  const [manageAppsExId, setManageAppsExId] = useState<number | null>(null);
  // 추가 질문 수정 — 갤러리 마이페이지와 같은 공용 모달. 주최자가 자기 공고 질문을 못 고치면 안 된다.
  const [editQuestionsEx, setEditQuestionsEx] = useState<any>(null);

  const clearError = (key: string) =>
    setFormErrors(prev => { const n = new Set(prev); n.delete(key); return n; });

  const dateError = useMemo(() => validateExhibitionDates({
    deadlineStart: form.deadlineStart || undefined,
    deadline: form.deadline,
    exhibitStartDate: form.exhibitStartDate || undefined,
    exhibitDate: form.exhibitDate,
  }), [form.deadlineStart, form.deadline, form.exhibitStartDate, form.exhibitDate]);

  const { data: exhibitions = [], isLoading } = useQuery<any[]>({
    queryKey: ['hosted-exhibitions'],
    queryFn: () => api.get('/exhibitions/hosted').then(r => r.data).catch(() => []),
  });

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
    const missing: string[] = [];
    const errorFields = new Set<string>();
    if (managerGalleries.length === 0) { missing.push('운영 갤러리'); errorFields.add('galleries'); }
    if (!form.title) { missing.push('제목'); errorFields.add('title'); }
    if (!form.deadlineStart) { missing.push('공모 시작일'); errorFields.add('deadlineStart'); }
    if (!form.deadline) { missing.push('공모 마감일'); errorFields.add('deadline'); }
    if (!form.exhibitStartDate) { missing.push('전시 시작일'); errorFields.add('exhibitStartDate'); }
    if (!form.exhibitDate) { missing.push('전시 종료일'); errorFields.add('exhibitDate'); }
    if (!form.description) { missing.push('소개'); errorFields.add('description'); }
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

  const statusColors: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-700',
    APPROVED: 'bg-green-100 text-green-700',
    REJECTED: 'bg-red-100 text-red-700',
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

      {showForm && (
        <div className="mb-6 space-y-3 rounded-xl bg-gray-50 p-4">
          <h4 className="text-sm font-medium">주최 공모 등록</h4>
          <p className="text-xs text-gray-400">실제 모집공고 상세 페이지에 보일 모습입니다. 칸을 눌러 바로 입력하세요.</p>

          <GalleryPicker selected={managerGalleries} onChange={(next) => { setManagerGalleries(next); clearError('galleries'); }} error={formErrors.has('galleries')} />

          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <HeroImageEdit
              value={form.imageUrl}
              onChange={(url) => setForm({ ...form, imageUrl: url })}
              onRemove={() => setForm({ ...form, imageUrl: '' })}
              className="w-full aspect-[16/9]"
              label="공모 대표 이미지"
            />
            <div className="space-y-3 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-gray-900 px-2.5 py-1 text-xs text-white">아트링크 주최</span>
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="cursor-pointer rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600 focus:outline-none">
                  <option value="SOLO">개인전</option>
                  <option value="GROUP">단체전</option>
                  <option value="ART_FAIR">아트페어</option>
                </select>
                <select value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} className="cursor-pointer rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600 focus:outline-none">
                  {regions.map(r => <option key={r} value={r}>{regionLabels[r]}</option>)}
                </select>
              </div>

              <EditableText
                value={form.title}
                onChange={v => { setForm({ ...form, title: v }); clearError('title'); }}
                placeholder="공모 제목"
                className="font-serif text-2xl text-gray-900"
                error={formErrors.has('title')}
              />

              <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-2">
                <div>
                  <label className="text-xs text-gray-500">모집 작가 수</label>
                  <input type="number" min={1} value={form.capacity} onChange={e => setForm({ ...form, capacity: Number(e.target.value) })} className="mt-0.5 w-full rounded-lg border border-gray-200 p-2 text-sm" />
                </div>
                <div />
                {([
                  ['deadlineStart', '공모 시작일'],
                  ['deadline', '공모 마감일'],
                  ['exhibitStartDate', '전시 시작일'],
                  ['exhibitDate', '전시 종료일'],
                ] as const).map(([key, label]) => (
                  <div key={key}>
                    <label className={`text-xs ${formErrors.has(key) ? 'font-medium text-red-500' : 'text-gray-500'}`}>{label} *</label>
                    <input
                      type="date"
                      value={form[key]}
                      onChange={e => { setForm({ ...form, [key]: e.target.value }); clearError(key); }}
                      className={`mt-0.5 w-full rounded-lg border p-2 text-sm ${formErrors.has(key) ? 'border-red-400 bg-red-50' : 'border-gray-200'}`}
                    />
                  </div>
                ))}
              </div>
              {dateError && (
                <p className="flex items-center gap-1 text-xs text-red-500"><AlertTriangle size={12} /> {dateError}</p>
              )}

              <div className="border-t border-gray-100 pt-3">
                <p className="mb-1 text-xs font-medium text-gray-400">공모 소개</p>
                <EditableText
                  multiline
                  rows={3}
                  value={form.description}
                  onChange={v => { setForm({ ...form, description: v }); clearError('description'); }}
                  placeholder="공모 소개"
                  className="text-sm text-gray-700"
                  error={formErrors.has('description')}
                />
              </div>

              <CustomQuestionBuilder
                fields={form.customFields}
                onChange={(update) => setForm(prev => ({ ...prev, customFields: update(prev.customFields) }))}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              disabled={createMutation.isPending || !!dateError}
              onClick={submit}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createMutation.isPending ? '등록 중...' : '등록'}
            </button>
            <button onClick={resetForm} className="px-4 py-2 text-sm text-gray-500">취소</button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmSubmit}
        title="주최 공모 등록"
        message={`이 내용으로 등록하시겠습니까?\n승인 절차 없이 바로 공고에 노출되며, 선택한 갤러리 ${managerGalleries.length}곳이 운영 권한을 갖습니다.`}
        confirmText="등록"
        onConfirm={() => {
          setConfirmSubmit(false);
          createMutation.mutate({
            ...form,
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
              <article key={ex.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
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
                      <span className="flex items-center gap-1 text-[11px] text-gray-500"><Users size={11} /> 지원 {ex.applicationCount ?? 0}명 / 모집 {ex.capacity}명</span>
                    </div>

                    <h4 className="mt-1.5 truncate text-lg font-medium text-gray-900">{ex.title}</h4>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-gray-400">운영</span>
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
                      <button onClick={() => setDeleteTarget(ex)} className="flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50">
                        <Trash2 size={12} /> 삭제
                      </button>
                    </div>
                  </div>
                </div>

                {manageAppsExId === ex.id && (
                  <div className="border-t border-gray-100 p-4">
                    <ApplicantManager exhibitionId={ex.id} exhibitionTitle={ex.title} customFields={ex.customFields} />
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
