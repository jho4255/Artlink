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
import { Star, Clock, Users, MapPin, Send, Trash2, ArrowLeft, Heart, Edit3, X, FileText, ChevronDown, ChevronUp, Calendar, Mail, ImageOff, ClipboardList } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { extractColor } from '@/lib/extractColor';
import { useAuthStore } from '@/stores/authStore';
import { getDday, regionLabels, exhibitionTypeLabels, displayName } from '@/lib/utils';
import ImageLightbox from '@/components/shared/ImageLightbox';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import CareerEditor from '@/components/shared/CareerEditor';
import PortfolioFileInput from '@/components/shared/PortfolioFileInput';
import ApplicationContent from '@/components/shared/ApplicationContent';
import { MultiImageUpload } from '@/components/shared/ImageUpload';
import type { Exhibition, PromoPhoto, Career } from '@/types';
import { EMPTY_CAREER } from '@/types';

// 경력 표시용 라벨
const APP_CAREER_LABELS: { key: keyof Career; label: string }[] = [
  { key: 'artFair', label: '아트페어' },
  { key: 'solo', label: '개인전' },
  { key: 'group', label: '단체전' },
];

function normalizeCareer(c?: Career | null): Career {
  return { artFair: c?.artFair ?? [], solo: c?.solo ?? [], group: c?.group ?? [] };
}

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
  // 지원 모달 상태 (고정 양식: 약력/경력/작품사진/포트폴리오 파일)
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [applyConfirm, setApplyConfirm] = useState(false);
  const [applyTerms, setApplyTerms] = useState('');
  const [applyBiography, setApplyBiography] = useState('');
  const [applyCareer, setApplyCareer] = useState<Career>(EMPTY_CAREER);
  const [applyCareerNone, setApplyCareerNone] = useState({ artFair: false, solo: false, group: false });
  const [applyImages, setApplyImages] = useState<string[]>([]);
  const [applyFile, setApplyFile] = useState<string | null>(null);
  const [applyFileNone, setApplyFileNone] = useState(false);
  const [loadingPortfolio, setLoadingPortfolio] = useState(false);
  const [bioError, setBioError] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [careerErrorKeys, setCareerErrorKeys] = useState<Set<string>>(new Set());
  const [pendingApply, setPendingApply] = useState<any>(undefined);
  // 지원자 관리 상태 (Gallery 오너용)
  const [showApplicants, setShowApplicants] = useState(false);
  const [appStatusFilter, setAppStatusFilter] = useState<string>('ALL');
  const [expandedAppId, setExpandedAppId] = useState<number | null>(null);
  const [selectedAppIds, setSelectedAppIds] = useState<Set<number>>(new Set());
  const [batchStatus, setBatchStatus] = useState<string>('');
  const [bgColor, setBgColor] = useState('#1a1a2e');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  // 인라인 쪽지 모달
  const [showMsgModal, setShowMsgModal] = useState(false);
  const [msgSubject, setMsgSubject] = useState('');
  const [msgContent, setMsgContent] = useState('');

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
    retry: (count, err: any) => (err?.response?.status ?? 500) >= 500 && count < 2,
  });

  // 이미지 dominant color 추출
  useEffect(() => {
    const imgSrc = exhibition?.imageUrl || exhibition?.gallery?.mainImage;
    if (imgSrc) extractColor(imgSrc).then(setBgColor);
  }, [exhibition?.imageUrl, exhibition?.gallery?.mainImage]);

  // 지원하기 (고정 양식 payload)
  const applyMutation = useMutation({
    mutationFn: (payload: { biography: string; career: Career; artworkImages: string[]; portfolioFileUrl: string | null }) =>
      api.post(`/exhibitions/${id}/apply`, payload),
    onSuccess: () => {
      toast.success('지원이 완료되었습니다! 지원서가 갤러리에 전송됩니다.');
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['my-applications'] });
      setShowApplyModal(false);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || '지원 중 오류가 발생했습니다.');
    },
  });

  // 지원 모달 열기 — 폼 초기화
  const openApplyModal = () => {
    setApplyBiography('');
    setApplyCareer(EMPTY_CAREER);
    setApplyCareerNone({ artFair: false, solo: false, group: false });
    setApplyImages([]);
    setApplyFile(null);
    setApplyFileNone(false);
    setBioError(false);
    setImgError(false);
    setCareerErrorKeys(new Set());
    setShowApplyModal(true);
  };

  // 포트폴리오 불러오기 — 내 포트폴리오를 지원서 폼에 채움
  const loadMyPortfolio = async () => {
    setLoadingPortfolio(true);
    try {
      const { data } = await api.get('/portfolio');
      setApplyBiography(data.biography || '');
      const c = normalizeCareer(data.career);
      setApplyCareer(c);
      setApplyCareerNone({ artFair: false, solo: false, group: false });
      setApplyImages((data.images || []).map((img: any) => img.url).slice(0, 10));
      setApplyFile(data.portfolioFileUrl || null);
      setApplyFileNone(false);
      setBioError(false);
      setImgError(false);
      setCareerErrorKeys(new Set());
      toast.success('포트폴리오를 불러왔습니다. 필요하면 수정 후 지원하세요.');
    } catch {
      toast.error('포트폴리오를 불러오지 못했습니다.');
    } finally {
      setLoadingPortfolio(false);
    }
  };

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

  // 지원자 CSV 다운로드 — 고정 양식(약력/경력/작품사진수/포트폴리오 파일)
  const careerToCsvText = (career: Career | null | undefined) => {
    const c = normalizeCareer(career);
    const parts: string[] = [];
    for (const { key, label } of APP_CAREER_LABELS) {
      if (c[key].length > 0) {
        parts.push(`[${label}] ` + c[key].map(e => [e.year, e.content].filter(Boolean).join(' ')).join(' / '));
      }
    }
    return parts.join(' || ');
  };
  const exportCSV = (apps: any[]) => {
    if (!apps.length || !exhibition) return;
    const headers = ['이름', '이메일', '지원일', '상태', '작가 약력', '경력', '작품 사진 수', '포트폴리오 파일'];
    const statusLabelsMap: Record<string, string> = { SUBMITTED: '접수', REVIEWED: '검토중', ACCEPTED: '수락', REJECTED: '거절' };
    const rows = apps.map(app => {
      const images: string[] = Array.isArray(app.artworkImages) ? app.artworkImages : [];
      return [
        app.user?.name || '',
        app.user?.email || '',
        new Date(app.createdAt).toLocaleDateString('ko'),
        statusLabelsMap[app.status] || app.status,
        app.biography || '',
        careerToCsvText(app.career),
        String(images.length),
        app.portfolioFileUrl || '',
      ];
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

  // 인라인 쪽지 전송
  const sendMsgMutation = useMutation({
    mutationFn: (data: { receiverId: number; subject: string; content: string; exhibitionId?: number }) =>
      api.post('/messages', data),
    onSuccess: () => {
      toast.success('쪽지가 전송되었습니다.');
      setShowMsgModal(false);
      setMsgSubject('');
      setMsgContent('');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '쪽지 전송에 실패했습니다.'),
  });

  const handleDelete = () => {
    setDeleteConfirm(true);
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-6 md:px-12 py-10">
        <div className="h-48 bg-gray-100 animate-pulse mb-4" />
        <div className="h-8 bg-gray-100 rounded w-1/3 animate-pulse mb-2" />
        <div className="h-4 bg-gray-100 rounded w-2/3 animate-pulse" />
      </div>
    );
  }
  if (!exhibition) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center text-center px-6 py-20">
        <h1 className="text-xl font-semibold text-gray-900">공모를 찾을 수 없습니다</h1>
        <p className="mt-2 text-sm text-gray-500">삭제되었거나 마감된 공모일 수 있습니다.</p>
        <button onClick={() => navigate('/exhibitions')} className="mt-8 px-6 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors cursor-pointer">
          모집공고 목록으로
        </button>
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
    <div className="max-w-7xl mx-auto pb-12">
      {/* 상단 이미지 + glow shadow */}
      <div className="px-6 md:px-12 pt-6 md:pt-10 pb-12 md:pb-16">
        <div
          className="max-w-lg mx-auto relative overflow-hidden rounded-lg transition-shadow duration-700"
          style={{ boxShadow: `0 8px 40px ${bgColor}, 0 2px 12px ${bgColor}` }}
        >
            {(() => {
              const heroImg = exhibition.imageUrl || exhibition.gallery?.mainImage || '';
              return heroImg ? (
                <img
                  src={heroImg}
                  alt={exhibition.title}
                  className="w-full block cursor-pointer"
                  onClick={() => setLightbox({ images: [heroImg], index: 0 })}
                />
              ) : (
                <div className="w-full aspect-[4/3] bg-gray-100 flex flex-col items-center justify-center gap-1.5 text-gray-300">
                  <ImageOff size={30} strokeWidth={1.5} />
                  <span className="text-xs text-gray-400 px-3 text-center line-clamp-1">{exhibition.title}</span>
                </div>
              );
            })()}
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent pointer-events-none" />
            <button
              onClick={() => navigate(-1)}
              className="absolute top-4 left-4 p-2 bg-white/80 backdrop-blur-sm rounded-full cursor-pointer"
              aria-label="뒤로가기"
            >
              <ArrowLeft size={20} />
            </button>
            {isAuthenticated && user?.role !== 'ADMIN' && (
              <button
                onClick={() => favMutation.mutate()}
                className="absolute top-4 right-4 p-2 bg-white/80 backdrop-blur-sm rounded-full cursor-pointer"
                aria-label="찜하기"
              >
                <Heart size={20} className={exhibition.isFavorited ? 'text-[#c4302b] fill-[#c4302b]' : 'text-gray-400'} />
              </button>
            )}
            <div className="absolute bottom-4 left-4">
              <span className={`text-sm font-medium ${
                isExpired ? 'text-white/60' : dday <= 7 ? 'text-white' : 'text-white'
              }`}>
                {isExpired ? '마감' : `D-${dday}`}
              </span>
            </div>
        </div>
      </div>

      <div className="px-6 md:px-12 py-6 space-y-6 max-w-4xl mx-auto">
        {/* 제목 & 갤러리 */}
        <div>
          <h1 className="text-2xl font-medium">{exhibition.title}</h1>
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
          {/* 쪽지 문의 (Artist 전용) */}
          {isArtist && exhibition.gallery?.ownerId && (
            <button
              onClick={() => { setMsgSubject(`[${exhibition.title}] `); setShowMsgModal(true); }}
              className="mt-2 flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-900 cursor-pointer"
            >
              <Mail size={14} /> 쪽지 보내기
            </button>
          )}
        </div>

        {/* 정보 카드 */}
        <div className="space-y-0">
          <div className="flex items-center gap-3 py-4 border-b border-gray-100">
            <FileText size={16} className="text-gray-400 flex-none" />
            <div>
              <p className="text-sm text-gray-400">공모 유형</p>
              <p className="text-base">{exhibitionTypeLabels[exhibition.type]}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 py-4 border-b border-gray-100">
            <Users size={16} className="text-gray-400 flex-none" />
            <div>
              <p className="text-sm text-gray-400">모집 인원</p>
              <p className="text-base">{exhibition.capacity}명</p>
            </div>
          </div>
          <div className="flex items-center gap-3 py-4 border-b border-gray-100">
            <MapPin size={16} className="text-gray-400 flex-none" />
            <div>
              <p className="text-sm text-gray-400">지역</p>
              <p className="text-base">{regionLabels[exhibition.region]}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 py-4 border-b border-gray-100">
            <Clock size={16} className="text-gray-400 flex-none" />
            <div>
              <p className="text-sm text-gray-400">공모 기간</p>
              <p className="text-base">
                {exhibition.deadlineStart ? `${new Date(exhibition.deadlineStart).toLocaleDateString('ko')} ~ ` : ''}
                {new Date(exhibition.deadline).toLocaleDateString('ko')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 py-4 border-b border-gray-100">
            <Calendar size={16} className="text-gray-400 flex-none" />
            <div>
              <p className="text-sm text-gray-400">전시 기간</p>
              <p className="text-base">
                {exhibition.exhibitStartDate ? `${new Date(exhibition.exhibitStartDate).toLocaleDateString('ko')} ~ ` : ''}
                {new Date(exhibition.exhibitDate).toLocaleDateString('ko')}
              </p>
            </div>
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
                aria-label="수정"
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
              onClick={openApplyModal}
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

          {/* Gallery 오너 / Admin 운영 페이지 */}
          {(isGalleryOwner || isAdmin) && (
            <button
              onClick={() => navigate(`/exhibitions/${id}/operation`)}
              className="w-full flex items-center justify-center gap-2 py-3 border border-gray-300 text-gray-800 rounded-xl text-sm font-medium hover:bg-gray-50"
            >
              <ClipboardList size={16} /> 운영 페이지
            </button>
          )}

          {/* Gallery 오너 / Admin 삭제 */}
          {canDelete && (
            <button
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="w-full flex items-center justify-center gap-2 py-3 border border-red-200 text-red-500 rounded-xl text-sm font-medium hover:bg-red-50 disabled:opacity-50"
              aria-label="삭제"
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
              aria-label={showApplicants ? '접기' : '펼치기'}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <Users size={16} /> 지원자 관리
              </div>
              {showApplicants ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {showApplicants && (
              <div className="mt-4 space-y-4">
                {appsLoading ? (
                  <div className="h-20 bg-gray-100 animate-pulse" />
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

                          return (
                            <div key={app.id} className={`border rounded-xl overflow-hidden transition-colors ${isSelected ? 'border-blue-300 bg-blue-50/30' : app.isFirstApplication ? 'border-amber-200 bg-amber-50/40' : 'border-gray-100'}`}>
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
                                      {displayName(app.user)}
                                    </span>
                                    <span className="text-xs text-gray-400">{new Date(app.createdAt).toLocaleDateString('ko')}</span>
                                    {app.isFirstApplication ? (
                                      <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap">★ 첫 지원</span>
                                    ) : (
                                      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 whitespace-nowrap">이 갤러리 {app.galleryApplicationOrder}번째</span>
                                    )}
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
                                  {(app.user?.email || app.user?.phone) ? (
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs text-gray-600">
                                      {app.user?.email && <span>📧 {app.user.email}</span>}
                                      {app.user?.phone && <span>📞 {app.user.phone}</span>}
                                    </div>
                                  ) : (
                                    app.status !== 'ACCEPTED' && (
                                      <p className="text-xs text-gray-400 pt-2">📇 연락처(이메일·전화)는 '수락' 시 표시됩니다.</p>
                                    )
                                  )}
                                  <ApplicationContent
                                    app={app}
                                    onImageClick={(images, index) => setLightbox({ images, index })}
                                  />
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

      {/* 지원 확인 모달 (약관 동의 후 최종 제출) */}
      <ConfirmDialog
        open={applyConfirm}
        title="지원하기"
        message={`📌 지원이 수락되면 갤러리에 회원님의 이메일과 전화번호가 전달됩니다.\n동의하시면 [지원하기]를 눌러주세요.\n\n${applyTerms || '지원하시겠습니까?'}`}
        confirmText="동의하고 지원하기"
        onConfirm={() => { setApplyConfirm(false); if (pendingApply) applyMutation.mutate(pendingApply); setPendingApply(undefined); }}
        onCancel={() => { setApplyConfirm(false); setPendingApply(undefined); }}
      />

      {/* 삭제 확인 모달 */}
      <ConfirmDialog
        open={deleteConfirm}
        title="공모 삭제"
        message="정말 이 공모를 삭제하시겠습니까? 관련 지원 내역도 모두 삭제됩니다."
        variant="danger"
        confirmText="삭제"
        onConfirm={() => { setDeleteConfirm(false); deleteMutation.mutate(); }}
        onCancel={() => setDeleteConfirm(false)}
      />

      {/* 인라인 쪽지 모달 */}
      <AnimatePresence>
        {showMsgModal && exhibition.gallery?.ownerId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={() => setShowMsgModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white p-6 mx-4 max-w-md w-full max-h-[80vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium">갤러리에 문의</h3>
                <button onClick={() => setShowMsgModal(false)} aria-label="닫기"><X size={18} className="text-gray-400" /></button>
              </div>
              <p className="text-sm text-gray-400 mb-4">{exhibition.gallery.name}</p>
              <input
                value={msgSubject}
                onChange={e => setMsgSubject(e.target.value)}
                maxLength={200}
                placeholder="제목"
                className="w-full px-3 py-2 border-b border-gray-200 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 mb-3"
              />
              <textarea
                value={msgContent}
                onChange={e => setMsgContent(e.target.value)}
                maxLength={5000}
                placeholder="내용을 입력해주세요"
                className="w-full px-3 py-2 border border-gray-200 text-sm h-32 resize-none focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
              <div className="flex justify-end mt-4">
                <button
                  onClick={() => {
                    if (!msgSubject.trim()) { toast.error('제목을 입력해주세요.'); return; }
                    if (!msgContent.trim()) { toast.error('내용을 입력해주세요.'); return; }
                    sendMsgMutation.mutate({
                      receiverId: exhibition.gallery!.ownerId!,
                      subject: msgSubject.trim(),
                      content: msgContent.trim(),
                      exhibitionId: exhibition.id,
                    });
                  }}
                  disabled={sendMsgMutation.isPending}
                  className="px-4 py-2 bg-gray-900 text-white text-sm disabled:opacity-50"
                >
                  전송
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 지원 모달 (고정 양식: 약력/경력/작품사진/포트폴리오 파일) */}
      <AnimatePresence>
        {showApplyModal && (
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
              className="bg-white rounded-xl p-6 mx-4 max-w-md w-full max-h-[85vh] overflow-y-auto shadow-xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xl font-medium">지원서 작성</h3>
                <button
                  onClick={loadMyPortfolio}
                  disabled={loadingPortfolio}
                  className="text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
                >
                  {loadingPortfolio ? '불러오는 중...' : '포트폴리오 불러오기'}
                </button>
              </div>
              <p className="text-xs text-gray-400 mb-4">내 포트폴리오를 불러온 뒤 수정해서 지원할 수 있어요.</p>

              <div className="space-y-5">
                {/* 작가 약력 (필수) */}
                <div>
                  <label className={`text-sm font-medium ${bioError ? 'text-red-600' : 'text-gray-700'}`}>
                    작가 약력 <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={applyBiography}
                    onChange={e => { setApplyBiography(e.target.value); if (e.target.value.trim()) setBioError(false); }}
                    placeholder="작가 소개·약력을 입력하세요."
                    className={`w-full mt-1 p-2.5 border rounded-lg text-sm h-24 resize-none focus:outline-none focus:ring-1 focus:ring-gray-400 ${bioError ? 'border-red-400 ring-1 ring-red-300' : 'border-gray-200'}`}
                  />
                </div>

                {/* 경력 */}
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-2">경력</label>
                  <CareerEditor
                    value={applyCareer}
                    onChange={(c) => { setApplyCareer(c); setCareerErrorKeys(new Set()); }}
                    none={applyCareerNone}
                    onNoneChange={(n) => { setApplyCareerNone(n); setCareerErrorKeys(new Set()); }}
                    errorKeys={careerErrorKeys}
                  />
                </div>

                {/* 작품 사진 (1장 이상 필수) */}
                <div>
                  <label className={`text-sm font-medium block mb-2 ${imgError ? 'text-red-600' : 'text-gray-700'}`}>
                    작품 사진 <span className="text-red-500">*</span>
                    <span className="text-xs text-gray-400 ml-1">({applyImages.length}/10, 1장 이상)</span>
                  </label>
                  <div className={imgError ? 'rounded-lg ring-1 ring-red-300 p-1' : ''}>
                    <MultiImageUpload
                      images={applyImages.map(url => ({ url }))}
                      onAdd={(url) => { setApplyImages(prev => [...prev, url].slice(0, 10)); setImgError(false); }}
                      onRemove={(index) => setApplyImages(prev => prev.filter((_, i) => i !== index))}
                      maxCount={10}
                    />
                  </div>
                </div>

                {/* 포트폴리오 파일 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-700">포트폴리오 파일 (PDF / DOC / HWP)</label>
                    <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={applyFileNone}
                        onChange={e => { setApplyFileNone(e.target.checked); if (e.target.checked) setApplyFile(null); }}
                      />
                      없음
                    </label>
                  </div>
                  {applyFileNone ? (
                    <p className="text-xs text-gray-400">없음으로 표시됩니다.</p>
                  ) : (
                    <PortfolioFileInput value={applyFile} onChange={setApplyFile} />
                  )}
                </div>
              </div>

              <div className="flex gap-2 mt-6 justify-end">
                <button onClick={() => setShowApplyModal(false)} className="px-4 py-2 text-sm text-gray-500">취소</button>
                <button
                  onClick={() => {
                    const errors: string[] = [];
                    if (!applyBiography.trim()) { errors.push('작가 약력을 입력해주세요.'); setBioError(true); }
                    if (applyImages.length < 1) { errors.push('작품 사진을 1장 이상 첨부해주세요.'); setImgError(true); }
                    const careerErr = new Set<string>();
                    for (const { key, label } of APP_CAREER_LABELS) {
                      if (applyCareer[key].length === 0 && !applyCareerNone[key as keyof typeof applyCareerNone]) {
                        errors.push(`${label} 경력을 입력하거나 '없음'을 체크해주세요.`);
                        careerErr.add(key as string);
                      }
                    }
                    setCareerErrorKeys(careerErr);
                    if (!applyFile && !applyFileNone) {
                      errors.push("포트폴리오 파일을 첨부하거나 '없음'을 체크해주세요.");
                    }
                    if (errors.length > 0) {
                      toast.error(
                        () => (
                          <div className="text-sm">
                            <p className="font-medium mb-1">다음 항목을 확인해주세요:</p>
                            {errors.map((e, i) => <p key={i} className="text-red-400">• {e}</p>)}
                          </div>
                        ),
                        { duration: 5000 }
                      );
                      return;
                    }
                    const cleanedCareer: Career = {
                      artFair: applyCareerNone.artFair ? [] : applyCareer.artFair.filter(e => e.year.trim() || e.content.trim()),
                      solo: applyCareerNone.solo ? [] : applyCareer.solo.filter(e => e.year.trim() || e.content.trim()),
                      group: applyCareerNone.group ? [] : applyCareer.group.filter(e => e.year.trim() || e.content.trim()),
                    };
                    setPendingApply({
                      biography: applyBiography.trim(),
                      career: cleanedCareer,
                      artworkImages: applyImages,
                      portfolioFileUrl: applyFileNone ? null : applyFile,
                    });
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
    </div>
  );
}
