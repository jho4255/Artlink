/**
 * ExhibitionDetailPage - 공모 상세 페이지
 *
 * 기능:
 *  - 전시 상세 정보 (제목, 갤러리, 타입, 날짜, 인원, 지역, D-day, 설명)
 *  - 홍보 사진 표시 (종료된 전시)
 *  - Artist: "지원하기" 버튼 (커스텀 필드 검증 강화)
 *  - Gallery 오너: 지원자 관리 (목록/상태변경/CSV)
 *  - Gallery 오너 / Admin: 삭제 버튼
 *
 * API:
 *  - GET /api/exhibitions/:id - 공모 상세 조회
 *  - POST /api/exhibitions/:id/apply - 지원하기
 *  - GET /api/exhibitions/:id/applications - 지원자 목록 (Gallery 오너)
 *  - PATCH /api/exhibitions/:id/applications/:appId - 지원 상태 변경
 *  - DELETE /api/exhibitions/:id - 공모 삭제
 *
 * @see /src/types/index.ts - Exhibition 타입
 * @see /src/stores/authStore.ts - 인증 상태
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, Clock, Users, MapPin, Send, Trash2, ArrowLeft, Heart, Edit3, X, Plus, Upload, Check, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { getDday, regionLabels, exhibitionTypeLabels } from '@/lib/utils';
import ImageLightbox from '@/components/shared/ImageLightbox';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import type { Exhibition, PromoPhoto, CustomField, CustomAnswer } from '@/types';

type ExhibitionDetail = Exhibition & {
  gallery: {
    id: number;
    name: string;
    rating: number;
    mainImage?: string;
    region: string;
    ownerId?: number;
  };
  promoPhotos?: PromoPhoto[];
  customFields?: CustomField[] | null;
};

export default function ExhibitionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuthStore();

  // 소개 수정 상태
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState('');
  // 이미지 확대 Lightbox 상태
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  // 지원 모달 상태 (커스텀 필드 입력)
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [customAnswers, setCustomAnswers] = useState<CustomAnswer[]>([]);
  const [applyConfirm, setApplyConfirm] = useState(false);
  const [applyTerms, setApplyTerms] = useState('');
  const [pendingAnswers, setPendingAnswers] = useState<CustomAnswer[] | undefined>(undefined);
  // 미입력 필드 하이라이트 상태
  const [applyFieldErrors, setApplyFieldErrors] = useState<Set<string>>(new Set());
  // 커스텀 필드 오너 수정 상태
  const [isEditingCf, setIsEditingCf] = useState(false);
  const [editCfFields, setEditCfFields] = useState<CustomField[]>([]);
  // 지원자 관리 상태 (Gallery 오너용)
  const [showApplicants, setShowApplicants] = useState(false);
  const [appStatusFilter, setAppStatusFilter] = useState<string>('ALL');
  const [expandedAppId, setExpandedAppId] = useState<number | null>(null);
  const [selectedAppIds, setSelectedAppIds] = useState<Set<number>>(new Set());
  const [batchStatus, setBatchStatus] = useState<string>('');

  // 지원 약관 텍스트 로드
  useEffect(() => {
    fetch('/terms/artist_apply_real.txt')
      .then(r => {
        if (!r.ok || r.headers.get('content-type')?.includes('text/html')) {
          throw new Error('not text');
        }
        return r.text();
      })
      .then(text => {
        if (!text.trimStart().startsWith('<!') && !text.trimStart().startsWith('<html')) {
          setApplyTerms(text);
        }
      })
      .catch(() => setApplyTerms('이 공모에 지원하시겠습니까? 포트폴리오가 갤러리에 전송됩니다.'));
  }, []);

  const { data: exhibition, isLoading } = useQuery<ExhibitionDetail>({
    queryKey: ['exhibition', id],
    queryFn: () => api.get(`/exhibitions/${id}`).then(r => r.data),
    enabled: !!id,
  });

  // 지원하기 (customAnswers 포함)
  const applyMutation = useMutation({
    mutationFn: (answers?: CustomAnswer[]) => api.post(`/exhibitions/${id}/apply`, {
      customAnswers: answers && answers.length > 0 ? answers : undefined,
    }),
    onSuccess: () => {
      toast.success('지원이 완료되었습니다! 포트폴리오가 갤러리에 전송됩니다.');
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['my-applications'] });
      setShowApplyModal(false);
      setCustomAnswers([]);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || '지원 중 오류가 발생했습니다.');
    },
  });

  // 커스텀 필드 수정 mutation (Gallery 오너)
  const updateCfMutation = useMutation({
    mutationFn: (fields: CustomField[] | null) => api.patch(`/exhibitions/${id}/custom-fields`, { customFields: fields }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exhibition', id] });
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      setIsEditingCf(false);
      toast.success('요청 정보가 수정되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '수정 실패'),
  });

  // 지원자 목록 조회 (Gallery 오너)
  const { data: applicants = [], isLoading: appsLoading } = useQuery<any[]>({
    queryKey: ['exhibition-applicants', id],
    queryFn: () => api.get(`/exhibitions/${id}/applications`).then(r => r.data),
    enabled: showApplicants && !!id,
  });

  // 지원자 상태 변경
  const updateAppStatusMutation = useMutation({
    mutationFn: ({ appId, status }: { appId: number; status: string }) =>
      api.patch(`/exhibitions/${id}/applications/${appId}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exhibition-applicants', id] });
      toast.success('상태가 변경되었습니다.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '상태 변경 실패'),
  });

  // 일괄 상태 변경
  const batchUpdateStatus = async (status: string) => {
    if (selectedAppIds.size === 0) return;
    try {
      await Promise.all(Array.from(selectedAppIds).map(appId =>
        api.patch(`/exhibitions/${id}/applications/${appId}`, { status })
      ));
      queryClient.invalidateQueries({ queryKey: ['exhibition-applicants', id] });
      setSelectedAppIds(new Set());
      setBatchStatus('');
      toast.success(`${selectedAppIds.size}명의 상태를 변경했습니다.`);
    } catch { toast.error('일괄 상태 변경 중 오류 발생'); }
  };

  // 지원자 CSV 다운로드
  const exportCSV = (apps: any[]) => {
    if (!apps.length || !exhibition) return;
    const fields: CustomField[] = exhibition.customFields || [];
    const headers = ['이름', '이메일', '지원일', '상태', ...fields.map(f => f.label)];
    const statusLabelsMap: Record<string, string> = { SUBMITTED: '접수', REVIEWED: '검토중', ACCEPTED: '수락', REJECTED: '거절' };
    const rows = apps.map(app => {
      let answers: any[] = [];
      try {
        if (Array.isArray(app.customAnswers)) answers = app.customAnswers;
        else if (typeof app.customAnswers === 'string') answers = JSON.parse(app.customAnswers);
      } catch { /* pass */ }
      const fieldValues = fields.map(f => {
        const ans = answers.find((a: any) => a.fieldId === f.id);
        if (!ans?.value) return '';
        if ((f.type as string) === 'multiselect' || (f.type === 'select' && f.maxSelect !== undefined && f.maxSelect !== 1)) { try { const parsed = JSON.parse(ans.value); if (Array.isArray(parsed)) return parsed.join(' / '); return ans.value; } catch { return ans.value; } }
        return ans.value;
      });
      return [app.user?.name || '', app.user?.email || '', new Date(app.createdAt).toLocaleDateString('ko'), statusLabelsMap[app.status] || app.status, ...fieldValues];
    });
    const csvContent = '\uFEFF' + [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exhibition.title}_지원자목록.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 찜하기 토글 - 낙관적 업데이트로 즉시 반영
  const favMutation = useMutation({
    mutationFn: () => api.post('/favorites/toggle', { exhibitionId: parseInt(id!) }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['exhibition', id] });
      const prev = queryClient.getQueryData<ExhibitionDetail>(['exhibition', id]);
      if (prev) {
        queryClient.setQueryData(['exhibition', id], { ...prev, isFavorited: !prev.isFavorited });
      }
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(['exhibition', id], context.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['exhibition', id] });
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });

  // 삭제
  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/exhibitions/${id}`),
    onSuccess: () => {
      toast.success('공모가 삭제되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['my-exhibitions'] });
      navigate('/exhibitions');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || '삭제 중 오류가 발생했습니다.');
    },
  });

  // 소개 수정 mutation (Gallery 오너 전용)
  const descMutation = useMutation({
    mutationFn: (desc: string) => api.patch(`/exhibitions/${id}/description`, { description: desc }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exhibition', id] });
      setIsEditingDesc(false);
      toast.success('공모 소개가 수정되었습니다.');
    },
    onError: () => toast.error('수정에 실패했습니다.'),
  });

  const handleDelete = () => {
    if (window.confirm('정말 이 공모를 삭제하시겠습니까? 관련 지원 내역도 모두 삭제됩니다.')) {
      deleteMutation.mutate();
    }
  };

  if (isLoading || !exhibition) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="h-48 bg-gray-100 rounded-xl animate-pulse mb-4" />
        <div className="h-8 bg-gray-100 rounded w-1/3 animate-pulse mb-2" />
        <div className="h-4 bg-gray-100 rounded w-2/3 animate-pulse" />
      </div>
    );
  }

  const dday = getDday(exhibition.deadline);
  const isExpired = dday < 0;
  const isArtist = user?.role === 'ARTIST';
  const isAdmin = user?.role === 'ADMIN';
  const isGalleryOwner = user?.role === 'GALLERY' && exhibition.gallery?.ownerId === user.id;
  const canDelete = isAdmin || isGalleryOwner;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-4xl mx-auto pb-12">
      {/* 상단 이미지 */}
      <div className="relative w-full h-48 md:h-64 bg-gray-100">
        <img
          src={exhibition.imageUrl || exhibition.gallery?.mainImage || 'https://images.unsplash.com/photo-1577720643272-265f09367456?w=800'}
          alt={exhibition.title}
          className="w-full h-full object-cover cursor-pointer"
          onClick={() => {
            const img = exhibition.imageUrl || exhibition.gallery?.mainImage || 'https://images.unsplash.com/photo-1577720643272-265f09367456?w=800';
            setLightbox({ images: [img], index: 0 });
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
        <button
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 p-2 bg-white/80 backdrop-blur rounded-full shadow"
        >
          <ArrowLeft size={20} />
        </button>
        {/* 찜 버튼 (Admin 제외 로그인 유저) */}
        {isAuthenticated && user?.role !== 'ADMIN' && (
          <button
            onClick={() => favMutation.mutate()}
            className="absolute top-4 right-4 p-2 bg-white/80 backdrop-blur rounded-full shadow"
          >
            <Heart size={20} className={exhibition.isFavorited ? 'text-[#c4302b] fill-[#c4302b]' : 'text-gray-400'} />
          </button>
        )}
        <div className="absolute bottom-4 left-4">
          <span className={`text-sm font-bold px-3 py-1 rounded-full ${
            isExpired ? 'bg-gray-500 text-white' : dday <= 7 ? 'bg-red-500 text-white' : 'bg-white text-gray-900'
          }`}>
            {isExpired ? '마감' : `D-${dday}`}
          </span>
        </div>
      </div>

      <div className="px-4 py-6 space-y-6">
        {/* 제목 & 갤러리 */}
        <div>
          <h1 className="text-2xl font-bold">{exhibition.title}</h1>
          <button
            onClick={() => navigate(`/galleries/${exhibition.gallery?.id}`)}
            className="text-gray-500 hover:underline text-sm mt-1 flex items-center gap-1"
          >
            {exhibition.gallery?.name}
            <div className="flex items-center gap-0.5 ml-2">
              <Star size={12} className="text-[#c4302b] fill-[#c4302b]" />
              <span className="text-xs text-gray-500">{exhibition.gallery?.rating?.toFixed(1)}</span>
            </div>
          </button>
        </div>

        {/* 정보 카드 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-gray-50 rounded-xl">
            <p className="text-xs text-gray-500 mb-1">공모 유형</p>
            <p className="text-sm font-medium">{exhibitionTypeLabels[exhibition.type]}</p>
          </div>
          <div className="p-3 bg-gray-50 rounded-xl">
            <p className="text-xs text-gray-500 mb-1">모집 인원</p>
            <p className="text-sm font-medium flex items-center gap-1"><Users size={14} /> {exhibition.capacity}명</p>
          </div>
          <div className="p-3 bg-gray-50 rounded-xl">
            <p className="text-xs text-gray-500 mb-1">지역</p>
            <p className="text-sm font-medium flex items-center gap-1"><MapPin size={14} /> {regionLabels[exhibition.region]}</p>
          </div>
          <div className="p-3 bg-gray-50 rounded-xl">
            <p className="text-xs text-gray-500 mb-1">공모 기간</p>
            <p className="text-sm font-medium flex items-center gap-1">
              <Clock size={14} />
              {exhibition.deadlineStart ? `${new Date(exhibition.deadlineStart).toLocaleDateString('ko')} ~ ` : ''}
              {new Date(exhibition.deadline).toLocaleDateString('ko')}
            </p>
          </div>
          <div className="p-3 bg-gray-50 rounded-xl">
            <p className="text-xs text-gray-500 mb-1">전시 기간</p>
            <p className="text-sm font-medium">
              {exhibition.exhibitStartDate ? `${new Date(exhibition.exhibitStartDate).toLocaleDateString('ko')} ~ ` : ''}
              {new Date(exhibition.exhibitDate).toLocaleDateString('ko')}
            </p>
          </div>
        </div>

        {/* 설명 (갤러리 오너만 수정 가능) */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-xl font-medium">공모 소개</h2>
            {isGalleryOwner && !isEditingDesc && (
              <button
                onClick={() => { setEditDesc(exhibition.description); setIsEditingDesc(true); }}
                className="text-sm text-gray-400 hover:text-gray-900 flex items-center gap-1"
              >
                <Edit3 size={14} /> 수정
              </button>
            )}
          </div>
          {isEditingDesc ? (
            <div className="space-y-2">
              <textarea
                value={editDesc}
                onChange={e => setEditDesc(e.target.value)}
                className="w-full h-32 p-3 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => descMutation.mutate(editDesc)}
                  disabled={descMutation.isPending}
                  className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50"
                >저장</button>
                <button onClick={() => setIsEditingDesc(false)} className="px-4 py-2 text-sm text-gray-500">취소</button>
              </div>
            </div>
          ) : (
            <p className="text-gray-700 whitespace-pre-wrap">{exhibition.description}</p>
          )}
        </div>

        {/* 요청 정보 (커스텀 필드) */}
        {exhibition.customFields && exhibition.customFields.length > 0 && (
          <div>
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-xl font-medium">요청 정보</h2>
              {isGalleryOwner && !isEditingCf && (
                <button
                  onClick={() => { setEditCfFields([...exhibition.customFields!]); setIsEditingCf(true); }}
                  className="text-sm text-gray-400 hover:text-gray-900 flex items-center gap-1"
                >
                  <Edit3 size={14} /> 수정
                </button>
              )}
            </div>
            {isEditingCf ? (
              <div className="space-y-2">
                {editCfFields.map((cf, idx) => (
                  <div key={cf.id} className="space-y-1.5 bg-gray-50 p-2 rounded">
                    <div className="flex gap-2 items-center">
                      <input value={cf.label} onChange={e => { const u = [...editCfFields]; u[idx] = { ...u[idx], label: e.target.value }; setEditCfFields(u); }} className="flex-1 p-1.5 border border-gray-200 rounded text-sm" />
                      <select value={(cf.type as string) === 'multiselect' ? 'select' : cf.type} onChange={e => { const u = [...editCfFields]; u[idx] = { ...u[idx], type: e.target.value as CustomField['type'], ...(e.target.value === 'select' && !cf.options?.length ? { options: [], maxSelect: cf.maxSelect ?? 1 } : {}) }; setEditCfFields(u); }} className="p-1.5 border border-gray-200 rounded text-sm">
                        <option value="text">텍스트</option>
                        <option value="select">선택형</option>
                        <option value="file">파일</option>
                      </select>
                      <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                        <input type="checkbox" checked={cf.required} onChange={e => { const u = [...editCfFields]; u[idx] = { ...u[idx], required: e.target.checked }; setEditCfFields(u); }} className="rounded" />
                        필수
                      </label>
                      <button onClick={() => setEditCfFields(editCfFields.filter((_, i) => i !== idx))} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                    </div>
                    {/* 텍스트: 글자수 제한 */}
                    {cf.type === 'text' && (
                      <div className="flex items-center gap-2 pl-1">
                        <label className="text-xs text-gray-500">글자수 제한</label>
                        <input type="number" min={0} placeholder="0 = 무제한" value={cf.maxLength || ''} onChange={e => { const u = [...editCfFields]; u[idx] = { ...u[idx], maxLength: parseInt(e.target.value) || 0 }; setEditCfFields(u); }} className="w-20 p-1 border border-gray-200 rounded text-xs" />
                        <span className="text-xs text-gray-400">{cf.maxLength ? `최대 ${cf.maxLength}자` : '무제한'}</span>
                      </div>
                    )}
                    {/* 선택형: 최대 선택 수 */}
                    {cf.type === 'select' && (
                      <div className="flex items-center gap-2 pl-1">
                        <label className="text-xs text-gray-500">최대 선택 수</label>
                        <input type="number" min={0} placeholder="1 = 단일선택" value={cf.maxSelect ?? ''} onChange={e => { const u = [...editCfFields]; u[idx] = { ...u[idx], maxSelect: parseInt(e.target.value) || 0 }; setEditCfFields(u); }} className="w-20 p-1 border border-gray-200 rounded text-xs" />
                        <span className="text-xs text-gray-400">{cf.maxSelect === 1 ? '단일선택' : cf.maxSelect && cf.maxSelect > 1 ? `최대 ${cf.maxSelect}개` : '무제한'}</span>
                      </div>
                    )}
                    {(cf.type === 'select' || (cf.type as string) === 'multiselect') && (
                      <div className="space-y-1 pl-1">
                        <div className="flex flex-wrap gap-1">
                          {(cf.options || []).map((opt, optIdx) => (
                            <span key={optIdx} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white border text-xs rounded">
                              {opt}
                              <button onClick={() => { const u = [...editCfFields]; u[idx] = { ...u[idx], options: cf.options!.filter((_, i) => i !== optIdx) }; setEditCfFields(u); }} className="text-gray-400 hover:text-red-500"><X size={10} /></button>
                            </span>
                          ))}
                        </div>
                        <div className="flex gap-1">
                          <input placeholder="옵션명 입력" className="flex-1 p-1 border border-gray-200 rounded text-xs"
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const val = (e.target as HTMLInputElement).value.trim();
                                if (val) { const u = [...editCfFields]; u[idx] = { ...u[idx], options: [...(cf.options || []), val] }; setEditCfFields(u); (e.target as HTMLInputElement).value = ''; }
                              }
                            }}
                          />
                          <button onClick={e => { const input = (e.target as HTMLElement).parentElement?.querySelector('input') as HTMLInputElement; const val = input?.value.trim(); if (val) { const u = [...editCfFields]; u[idx] = { ...u[idx], options: [...(cf.options || []), val] }; setEditCfFields(u); input.value = ''; } }} className="px-1.5 py-0.5 text-xs bg-gray-200 rounded hover:bg-gray-300">추가</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <button onClick={() => setEditCfFields([...editCfFields, { id: `cf_${Date.now()}`, label: '', type: 'text', required: false }])} className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1 cursor-pointer"><Plus size={12} /> 추가</button>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => {
                    // maxSelect vs 옵션 수 경고
                    const warnings: string[] = [];
                    for (const cf of editCfFields) {
                      if (cf.type === 'select' && cf.maxSelect && cf.maxSelect > 1 && cf.options) {
                        if (cf.options.length < cf.maxSelect) {
                          warnings.push(`"${cf.label}" — 최대 선택 수(${cf.maxSelect})가 옵션 수(${cf.options.length})보다 많습니다.`);
                        }
                      }
                    }
                    if (warnings.length > 0) { warnings.forEach(w => toast.error(w, { duration: 4000 })); return; }
                    updateCfMutation.mutate(editCfFields.length > 0 ? editCfFields : null);
                  }} disabled={updateCfMutation.isPending} className="px-3 py-1.5 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50">저장</button>
                  <button onClick={() => setIsEditingCf(false)} className="px-3 py-1.5 text-sm text-gray-500">취소</button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {exhibition.customFields.map(cf => {
                  const typeLabel: Record<string, string> = { text: '텍스트', textarea: '텍스트', select: '선택형', multiselect: '선택형', file: '파일' };
                  const maxSelectLabel = (cf.type === 'select' || (cf.type as string) === 'multiselect') && cf.maxSelect
                    ? cf.maxSelect === 1 ? '(단일선택)' : `(최대 ${cf.maxSelect}개)`
                    : null;
                  return (
                    <div key={cf.id} className="flex items-center gap-2 text-sm">
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{typeLabel[cf.type] || cf.type}</span>
                      <span>{cf.label}</span>
                      {cf.required && <span className="text-red-500 text-xs">*필수</span>}
                      {cf.type === 'text' && cf.maxLength ? <span className="text-xs text-gray-400">(최대 {cf.maxLength}자)</span> : null}
                      {maxSelectLabel && <span className="text-xs text-gray-400">{maxSelectLabel}</span>}
                      {(cf.type === 'select' || (cf.type as string) === 'multiselect') && cf.options && cf.options.length > 0 && (
                        <span className="text-xs text-gray-400">({cf.options.join(', ')})</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 홍보 사진 (종료된 전시) */}
        {exhibition.promoPhotos && exhibition.promoPhotos.length > 0 && (
          <div>
            <h2 className="text-xl font-medium mb-3">홍보 사진</h2>
            <div className="grid grid-cols-3 gap-2">
              {exhibition.promoPhotos.map((photo, idx) => (
                <div key={photo.id}>
                  <img
                    src={photo.url}
                    alt={photo.caption || '홍보 사진'}
                    className="w-full h-24 object-cover rounded-lg cursor-pointer"
                    onClick={() => setLightbox({
                      images: exhibition.promoPhotos!.map(p => p.url),
                      index: idx,
                    })}
                  />
                  {photo.caption && <p className="text-xs text-gray-500 mt-1 truncate">{photo.caption}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 액션 버튼 */}
        <div className="space-y-3 pt-2">
          {/* Artist 지원하기 */}
          {isArtist && !isExpired && (
            <button
              onClick={() => {
                if (exhibition.customFields && exhibition.customFields.length > 0) {
                  setCustomAnswers(exhibition.customFields.map(f => ({ fieldId: f.id, value: '' })));
                  setShowApplyModal(true);
                } else {
                  setApplyConfirm(true);
                }
              }}
              disabled={applyMutation.isPending}
              className="w-full flex items-center justify-center gap-2 py-3 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
            >
              <Send size={16} /> 지원하기
            </button>
          )}

          {/* 비로그인 안내 */}
          {!isAuthenticated && !isExpired && (
            <p className="text-center text-sm text-gray-400">지원하려면 로그인이 필요합니다.</p>
          )}

          {/* Gallery 오너 / Admin 삭제 */}
          {canDelete && (
            <button
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="w-full flex items-center justify-center gap-2 py-3 border border-red-200 text-red-500 rounded-xl text-sm font-medium hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 size={16} /> 공모 삭제
            </button>
          )}
        </div>

        {/* ====== 지원자 관리 (Gallery 오너 전용) ====== */}
        {isGalleryOwner && (
          <div className="mt-6 border-t pt-6">
            <button
              onClick={() => setShowApplicants(!showApplicants)}
              className="w-full flex items-center justify-between py-3 px-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <Users size={16} /> 지원자 관리
              </div>
              {showApplicants ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {showApplicants && (
              <div className="mt-4 space-y-4">
                {appsLoading ? (
                  <div className="h-20 bg-gray-100 rounded-xl animate-pulse" />
                ) : applicants.length === 0 ? (
                  <p className="text-gray-400 text-center py-6 text-sm">아직 지원자가 없습니다.</p>
                ) : (() => {
                  const filteredApps = appStatusFilter === 'ALL' ? applicants : applicants.filter((a: any) => a.status === appStatusFilter);
                  const allFilteredSelected = filteredApps.length > 0 && filteredApps.every((a: any) => selectedAppIds.has(a.id));
                  const toggleSelectAll = () => {
                    if (allFilteredSelected) {
                      const next = new Set(selectedAppIds);
                      filteredApps.forEach((a: any) => next.delete(a.id));
                      setSelectedAppIds(next);
                    } else {
                      const next = new Set(selectedAppIds);
                      filteredApps.forEach((a: any) => next.add(a.id));
                      setSelectedAppIds(next);
                    }
                  };
                  const toggleSelect = (appId: number) => {
                    const next = new Set(selectedAppIds);
                    next.has(appId) ? next.delete(appId) : next.add(appId);
                    setSelectedAppIds(next);
                  };

                  return (
                    <>
                      {/* 상태 필터 */}
                      <div className="flex gap-1.5 flex-wrap">
                        {[{ key: 'ALL', label: '전체' }, { key: 'SUBMITTED', label: '접수' }, { key: 'REVIEWED', label: '검토중' }, { key: 'ACCEPTED', label: '수락' }, { key: 'REJECTED', label: '거절' }].map(f => {
                          const count = f.key === 'ALL' ? applicants.length : applicants.filter((a: any) => a.status === f.key).length;
                          return (
                            <button
                              key={f.key}
                              onClick={() => { setAppStatusFilter(f.key); setSelectedAppIds(new Set()); }}
                              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${appStatusFilter === f.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                            >
                              {f.label} {count > 0 ? `(${count})` : ''}
                            </button>
                          );
                        })}
                      </div>

                      {/* 일괄 액션 바 */}
                      <div className="flex items-center justify-between flex-wrap gap-2 bg-gray-50 rounded-xl px-3 py-2">
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} className="rounded" />
                          전체 선택 {selectedAppIds.size > 0 && <span className="text-gray-900 font-medium">({selectedAppIds.size}명 선택)</span>}
                        </label>
                        <div className="flex items-center gap-2">
                          {selectedAppIds.size > 0 && (
                            <>
                              <select
                                value={batchStatus}
                                onChange={e => setBatchStatus(e.target.value)}
                                className="text-xs p-1.5 border border-gray-200 rounded-lg"
                              >
                                <option value="">상태 변경</option>
                                <option value="SUBMITTED">접수</option>
                                <option value="REVIEWED">검토중</option>
                                <option value="ACCEPTED">수락</option>
                                <option value="REJECTED">거절</option>
                              </select>
                              <button
                                onClick={() => batchStatus && batchUpdateStatus(batchStatus)}
                                disabled={!batchStatus}
                                className="px-2.5 py-1.5 text-xs bg-gray-900 text-white rounded-lg disabled:opacity-30"
                              >
                                적용
                              </button>
                              <button
                                onClick={() => exportCSV(applicants.filter((a: any) => selectedAppIds.has(a.id)))}
                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-green-600 border border-green-200 rounded-lg hover:bg-green-50"
                              >
                                <FileText size={12} /> 선택 다운로드
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => exportCSV(applicants)}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-green-600 border border-green-200 rounded-lg hover:bg-green-50"
                          >
                            <FileText size={12} /> 전체 다운로드
                          </button>
                        </div>
                      </div>

                      {/* 지원자 목록 */}
                      <div className="space-y-2">
                        {filteredApps.map((app: any) => {
                          const isExpanded = expandedAppId === app.id;
                          const isSelected = selectedAppIds.has(app.id);
                          const statusColors: Record<string, string> = { SUBMITTED: 'bg-gray-100 text-gray-600', REVIEWED: 'bg-blue-100 text-blue-600', ACCEPTED: 'bg-green-100 text-green-600', REJECTED: 'bg-red-100 text-red-600' };
                          const answers: { fieldId: string; value: string }[] = Array.isArray(app.customAnswers) ? app.customAnswers : [];
                          const cfFields: CustomField[] = exhibition.customFields || [];
                          const portfolio = app.user?.portfolio;

                          return (
                            <div key={app.id} className={`border rounded-xl overflow-hidden transition-colors ${isSelected ? 'border-blue-300 bg-blue-50/30' : 'border-gray-100'}`}>
                              <div className="p-3 flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleSelect(app.id)}
                                  className="rounded shrink-0"
                                />
                                <div
                                  className="flex-1 flex justify-between items-center cursor-pointer"
                                  onClick={() => setExpandedAppId(isExpanded ? null : app.id)}
                                >
                                  <div className="flex items-center gap-2">
                                    {app.user?.avatar && <img src={app.user.avatar} alt="" className="w-6 h-6 rounded-full object-cover" />}
                                    <span
                                      className="text-sm font-medium text-gray-900 hover:underline cursor-pointer"
                                      onClick={e => { e.stopPropagation(); navigate(`/portfolio/${app.user?.id}`); }}
                                    >
                                      {app.user?.name}
                                    </span>
                                    <span className="text-xs text-gray-400">{new Date(app.createdAt).toLocaleDateString('ko')}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <select
                                      value={app.status}
                                      onClick={e => e.stopPropagation()}
                                      onChange={e => { e.stopPropagation(); updateAppStatusMutation.mutate({ appId: app.id, status: e.target.value }); }}
                                      className={`text-xs px-2 py-1 rounded-lg border-0 cursor-pointer ${statusColors[app.status] || ''}`}
                                    >
                                      <option value="SUBMITTED">접수</option>
                                      <option value="REVIEWED">검토중</option>
                                      <option value="ACCEPTED">수락</option>
                                      <option value="REJECTED">거절</option>
                                    </select>
                                    {isExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                                  </div>
                                </div>
                              </div>

                              {isExpanded && (
                                <div className="px-3 pb-3 pt-0 border-t border-gray-100 space-y-3 ml-7">
                                  {app.user?.email && (
                                    <p className="text-xs text-gray-500 pt-2">📧 {app.user.email}</p>
                                  )}
                                  {portfolio && (
                                    <div className="space-y-2 bg-gray-50 rounded-lg p-3">
                                      <p className="text-xs font-medium text-gray-600">📋 포트폴리오</p>
                                      {portfolio.biography && (
                                        <div>
                                          <p className="text-xs text-gray-400 mb-0.5">작가 약력</p>
                                          <p className="text-xs text-gray-700 whitespace-pre-wrap">{portfolio.biography}</p>
                                        </div>
                                      )}
                                      {portfolio.exhibitionHistory && (
                                        <div>
                                          <p className="text-xs text-gray-400 mb-0.5">전시 이력</p>
                                          <p className="text-xs text-gray-700 whitespace-pre-wrap">{portfolio.exhibitionHistory}</p>
                                        </div>
                                      )}
                                      {portfolio.images && portfolio.images.length > 0 && (
                                        <div>
                                          <p className="text-xs text-gray-400 mb-1">작품 사진 ({portfolio.images.length}장)</p>
                                          <div className="grid grid-cols-5 gap-1">
                                            {portfolio.images.map((img: any, imgIdx: number) => (
                                              <img
                                                key={img.id || imgIdx}
                                                src={img.url}
                                                alt={`작품 ${imgIdx + 1}`}
                                                className="w-full aspect-square object-cover rounded cursor-pointer hover:opacity-80"
                                                onClick={() => setLightbox({ images: portfolio.images.map((i: any) => i.url), index: imgIdx })}
                                              />
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                      {!portfolio.biography && !portfolio.exhibitionHistory && (!portfolio.images || portfolio.images.length === 0) && (
                                        <p className="text-xs text-gray-400">포트폴리오가 비어있습니다.</p>
                                      )}
                                    </div>
                                  )}
                                  {answers.length > 0 && (
                                    <div className="space-y-1.5">
                                      <p className="text-xs font-medium text-gray-600">📝 추가 정보</p>
                                      {answers.map((ans, idx) => {
                                        const field = cfFields.find(f => f.id === ans.fieldId);
                                        let displayValue = ans.value;
                                        if (((field?.type as string) === 'multiselect' || (field?.type === 'select' && field?.maxSelect !== 1)) && ans.value) {
                                          try { const parsed = JSON.parse(ans.value); if (Array.isArray(parsed)) displayValue = parsed.join(', '); } catch { /* keep */ }
                                        }
                                        if (field?.type === 'file' && ans.value) {
                                          return (
                                            <div key={idx} className="flex gap-2 text-xs">
                                              <span className="text-gray-400 shrink-0">{field?.label || ans.fieldId}:</span>
                                              <a href={ans.value} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:underline">📎 파일 보기</a>
                                            </div>
                                          );
                                        }
                                        return (
                                          <div key={idx} className="text-xs">
                                            <span className="text-gray-400">{field?.label || ans.fieldId}:</span>
                                            <p className="text-gray-700 mt-0.5 whitespace-pre-wrap break-all bg-gray-50 rounded px-2 py-1">{displayValue || '-'}</p>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                  {!portfolio && answers.length === 0 && (
                                    <p className="text-xs text-gray-400 pt-2">추가 정보 없음</p>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 지원 확인 모달 (커스텀 필드 없을 때) */}
      <ConfirmDialog
        open={applyConfirm}
        title="지원하기"
        message={applyTerms || '지원하시겠습니까?'}
        confirmText="지원하기"
        onConfirm={() => { setApplyConfirm(false); applyMutation.mutate(pendingAnswers); setPendingAnswers(undefined); }}
        onCancel={() => { setApplyConfirm(false); setPendingAnswers(undefined); }}
      />

      {/* 지원 모달 (커스텀 필드 입력) — 검증 강화 */}
      <AnimatePresence>
        {showApplyModal && exhibition.customFields && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={() => setShowApplyModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-xl p-6 mx-4 max-w-md w-full max-h-[80vh] overflow-y-auto shadow-xl"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-xl font-medium mb-4">지원 정보 입력</h3>
              <div className="space-y-4">
                {exhibition.customFields.map(cf => {
                  const answer = customAnswers.find(a => a.fieldId === cf.id);
                  const value = answer?.value || '';
                  const updateAnswer = (val: string) => {
                    setCustomAnswers(prev => prev.map(a => a.fieldId === cf.id ? { ...a, value: val } : a));
                    // 입력 시 해당 필드 에러 해제
                    setApplyFieldErrors(prev => { const n = new Set(prev); n.delete(cf.id); return n; });
                  };
                  // 텍스트: maxLength > 200이면 textarea, 아니면 input
                  const isLongText = cf.type === 'text' && cf.maxLength && cf.maxLength > 200;
                  const hasError = applyFieldErrors.has(cf.id);
                  return (
                    <div key={cf.id} className={hasError ? 'rounded-lg ring-2 ring-red-300 p-2 bg-red-50/30' : ''}>
                      <label className={`text-sm font-medium ${hasError ? 'text-red-600' : 'text-gray-700'}`}>
                        {cf.label} {cf.required && <span className="text-red-500">*</span>}
                        {cf.type === 'text' && cf.maxLength ? <span className="text-xs text-gray-400 ml-1">(최대 {cf.maxLength}자)</span> : null}
                        {(cf.type === 'select' || (cf.type as string) === 'multiselect') && cf.maxSelect && cf.maxSelect > 1 ? <span className="text-xs text-gray-400 ml-1">(최대 {cf.maxSelect}개 선택)</span> : null}
                      </label>
                      {cf.type === 'text' && !isLongText && (
                        <div>
                          <input
                            value={value}
                            onChange={e => {
                              const v = e.target.value;
                              if (cf.maxLength && v.length > cf.maxLength) return;
                              updateAnswer(v);
                            }}
                            className="w-full mt-1 p-2.5 border border-gray-200 rounded-lg text-sm"
                            placeholder="입력해주세요"
                            maxLength={cf.maxLength || undefined}
                          />
                          {cf.maxLength ? <p className="text-xs text-gray-400 text-right mt-0.5">{value.length}/{cf.maxLength}</p> : null}
                        </div>
                      )}
                      {cf.type === 'text' && isLongText && (
                        <div>
                          <textarea
                            value={value}
                            onChange={e => {
                              const v = e.target.value;
                              if (cf.maxLength && v.length > cf.maxLength) return;
                              updateAnswer(v);
                            }}
                            className="w-full mt-1 p-2.5 border border-gray-200 rounded-lg text-sm h-24 resize-none"
                            placeholder="입력해주세요"
                            maxLength={cf.maxLength || undefined}
                          />
                          {cf.maxLength ? <p className="text-xs text-gray-400 text-right mt-0.5">{value.length}/{cf.maxLength}</p> : null}
                        </div>
                      )}
                      {(cf.type as string) === 'textarea' && (
                        <div>
                          <textarea
                            value={value}
                            onChange={e => updateAnswer(e.target.value)}
                            className="w-full mt-1 p-2.5 border border-gray-200 rounded-lg text-sm h-24 resize-none"
                            placeholder="입력해주세요"
                          />
                        </div>
                      )}
                      {/* 선택형: maxSelect===1 → 라디오 버튼, 그 외(0, 2+) → 체크박스 다중선택 */}
                      {cf.type === 'select' && cf.options && (cf.maxSelect === 1 || cf.maxSelect === undefined) && (
                        <div className="mt-1 space-y-1.5 p-2.5 border border-gray-200 rounded-lg">
                          {cf.options.map(opt => (
                            <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
                              <input
                                type="radio"
                                name={`cf-radio-${cf.id}`}
                                checked={value === opt}
                                onChange={() => updateAnswer(opt)}
                                className="accent-gray-900"
                              />
                              {opt}
                            </label>
                          ))}
                        </div>
                      )}
                      {cf.type === 'select' && cf.options && cf.maxSelect !== undefined && cf.maxSelect !== 1 && (
                        <div className="mt-1 space-y-1.5 p-2.5 border border-gray-200 rounded-lg">
                          {(() => {
                            const selected: string[] = (() => { try { return JSON.parse(value || '[]'); } catch { return []; } })();
                            const maxReached = cf.maxSelect && cf.maxSelect > 1 ? selected.length >= cf.maxSelect : false;
                            return cf.options!.map(opt => {
                              const isChecked = selected.includes(opt);
                              const disabled = !isChecked && maxReached;
                              return (
                                <label key={opt} className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    disabled={disabled}
                                    onChange={() => {
                                      const newSelected = isChecked ? selected.filter(s => s !== opt) : [...selected, opt];
                                      updateAnswer(JSON.stringify(newSelected));
                                    }}
                                    className="rounded"
                                  />
                                  {opt}
                                </label>
                              );
                            });
                          })()}
                          {cf.maxSelect && cf.maxSelect > 1 ? (
                            <p className="text-xs text-gray-400 mt-1">
                              {(() => { try { return JSON.parse(value || '[]').length; } catch { return 0; } })()}/{cf.maxSelect}개 선택
                            </p>
                          ) : null}
                        </div>
                      )}
                      {/* 하위호환: 기존 multiselect 타입 데이터 처리 */}
                      {(cf.type as string) === 'multiselect' && cf.options && (
                        <div className="mt-1 space-y-1.5 p-2.5 border border-gray-200 rounded-lg">
                          {(() => {
                            const selected: string[] = (() => { try { return JSON.parse(value || '[]'); } catch { return []; } })();
                            const maxReached = cf.maxSelect ? selected.length >= cf.maxSelect : false;
                            return cf.options!.map(opt => {
                              const isChecked = selected.includes(opt);
                              const disabled = !isChecked && maxReached;
                              return (
                                <label key={opt} className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    disabled={disabled}
                                    onChange={() => {
                                      const newSelected = isChecked ? selected.filter(s => s !== opt) : [...selected, opt];
                                      updateAnswer(JSON.stringify(newSelected));
                                    }}
                                    className="rounded"
                                  />
                                  {opt}
                                </label>
                              );
                            });
                          })()}
                          {cf.maxSelect ? (
                            <p className="text-xs text-gray-400 mt-1">
                              {(() => { try { return JSON.parse(value || '[]').length; } catch { return 0; } })()}/{cf.maxSelect}개 선택
                            </p>
                          ) : null}
                        </div>
                      )}
                      {cf.type === 'file' && (
                        <div className="mt-1">
                          {value ? (
                            <div className="flex items-center gap-2 text-sm text-green-600">
                              <Check size={14} /> 파일 업로드 완료
                              <button onClick={() => updateAnswer('')} className="text-xs text-red-500 hover:underline">삭제</button>
                            </div>
                          ) : (
                            <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm text-gray-500">
                              <Upload size={14} /> 파일 선택 (PDF, DOC, HWP, ZIP)
                              <input type="file" className="hidden" accept=".pdf,.doc,.docx,.hwp,.hwpx,.zip" onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const formData = new FormData();
                                formData.append('file', file);
                                try {
                                  const res = await api.post('/upload/file', formData);
                                  updateAnswer(res.data.url);
                                  toast.success('파일이 업로드되었습니다.');
                                } catch {
                                  toast.error('파일 업로드에 실패했습니다.');
                                }
                              }} />
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-2 mt-6 justify-end">
                <button onClick={() => { setShowApplyModal(false); setApplyFieldErrors(new Set()); }} className="px-4 py-2 text-sm text-gray-500">취소</button>
                <button
                  onClick={() => {
                    // 모든 검증 오류를 수집하여 한번에 표시 + 빨간 하이라이트
                    const errors: string[] = [];
                    const errorFieldIds = new Set<string>();
                    for (const cf of exhibition.customFields!) {
                      const ans = customAnswers.find(a => a.fieldId === cf.id);
                      const isMultiSelect = (cf.type as string) === 'multiselect' || (cf.type === 'select' && cf.maxSelect !== undefined && cf.maxSelect !== 1);
                      // 필수 항목 검증
                      if (cf.required) {
                        if (cf.type === 'file') {
                          if (!ans?.value) { errors.push(`"${cf.label}" — 파일을 업로드해주세요.`); errorFieldIds.add(cf.id); }
                        } else if (isMultiSelect) {
                          let empty = true;
                          if (ans?.value) { try { const arr = JSON.parse(ans.value); if (Array.isArray(arr) && arr.length > 0) empty = false; } catch { /* pass */ } }
                          if (empty) { errors.push(`"${cf.label}" — 최소 1개를 선택해주세요.`); errorFieldIds.add(cf.id); }
                        } else if (cf.type === 'select') {
                          if (!ans?.value) { errors.push(`"${cf.label}" — 항목을 선택해주세요.`); errorFieldIds.add(cf.id); }
                        } else {
                          if (!ans?.value?.trim()) { errors.push(`"${cf.label}" — 입력해주세요.`); errorFieldIds.add(cf.id); }
                        }
                      }
                      // 글자수 제한 검증
                      if (cf.type === 'text' && cf.maxLength && ans?.value && ans.value.length > cf.maxLength) {
                        errors.push(`"${cf.label}" — 최대 ${cf.maxLength}자 초과 (현재 ${ans.value.length}자)`); errorFieldIds.add(cf.id);
                      }
                      // 다중선택 최대 개수 검증
                      if (isMultiSelect && cf.maxSelect && cf.maxSelect > 1 && ans?.value) {
                        try {
                          const arr = JSON.parse(ans.value);
                          if (Array.isArray(arr) && arr.length > cf.maxSelect) {
                            errors.push(`"${cf.label}" — 최대 ${cf.maxSelect}개 선택 가능 (현재 ${arr.length}개)`); errorFieldIds.add(cf.id);
                          }
                        } catch { /* pass */ }
                      }
                    }
                    setApplyFieldErrors(errorFieldIds);
                    if (errors.length > 0) {
                      toast.error(
                        (t) => (
                          <div className="text-sm">
                            <p className="font-medium mb-1">다음 항목을 확인해주세요:</p>
                            {errors.map((e, i) => <p key={i} className="text-red-400">• {e}</p>)}
                          </div>
                        ),
                        { duration: 5000 }
                      );
                      return;
                    }
                    setPendingAnswers(customAnswers);
                    setShowApplyModal(false);
                    setApplyConfirm(true);
                  }}
                  disabled={applyMutation.isPending}
                  className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50"
                >
                  {applyMutation.isPending ? '지원 중...' : '지원하기'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 이미지 확대 Lightbox (AnimatePresence로 exit 애니메이션 지원) */}
      <AnimatePresence>
        {lightbox && (
          <ImageLightbox
            images={lightbox.images}
            initialIndex={lightbox.index}
            onClose={() => setLightbox(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
