/**
 * ExhibitionDetailPage - 공모 상세 페이지
 *
 * 기능:
 *  - 전시 상세 정보 (제목, 갤러리, 타입, 날짜, 인원, 지역, D-day, 설명)
 *  - 홍보 사진 표시 (종료된 전시)
 *  - Artist: "지원하기" 버튼
 *  - Gallery 오너 / Admin: 삭제 버튼
 *
 * API:
 *  - GET /api/exhibitions/:id - 공모 상세 조회
 *  - POST /api/exhibitions/:id/apply - 지원하기
 *  - DELETE /api/exhibitions/:id - 공모 삭제
 *
 * @see /src/types/index.ts - Exhibition 타입
 * @see /src/stores/authStore.ts - 인증 상태
 */
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, Clock, Users, MapPin, Send, Trash2, ArrowLeft, Heart, Edit3 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { getDday, regionLabels, exhibitionTypeLabels } from '@/lib/utils';
import ImageLightbox from '@/components/shared/ImageLightbox';
import type { Exhibition, PromoPhoto } from '@/types';

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

  const { data: exhibition, isLoading } = useQuery<ExhibitionDetail>({
    queryKey: ['exhibition', id],
    queryFn: () => api.get(`/exhibitions/${id}`).then(r => r.data),
    enabled: !!id,
  });

  // 지원하기
  const applyMutation = useMutation({
    mutationFn: () => api.post(`/exhibitions/${id}/apply`),
    onSuccess: () => {
      toast.success('지원이 완료되었습니다! 포트폴리오가 갤러리에 전송됩니다.');
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['my-applications'] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || '지원 중 오류가 발생했습니다.');
    },
  });

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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-4xl mx-auto pb-12">
      {/* 상단 이미지 */}
      <div className="relative w-full h-48 md:h-64 bg-gray-100">
        <img
          src={exhibition.imageUrl || exhibition.gallery?.mainImage || 'https://images.unsplash.com/photo-1577720643272-265f09367456?w=800'}
          alt={exhibition.title}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
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
            <Heart size={20} className={exhibition.isFavorited ? 'text-red-500 fill-red-500' : 'text-gray-400'} />
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
            className="text-blue-500 hover:underline text-sm mt-1 flex items-center gap-1"
          >
            {exhibition.gallery?.name}
            <div className="flex items-center gap-0.5 ml-2">
              <Star size={12} className="text-yellow-400 fill-yellow-400" />
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
            <h2 className="text-lg font-bold">공모 소개</h2>
            {isGalleryOwner && !isEditingDesc && (
              <button
                onClick={() => { setEditDesc(exhibition.description); setIsEditingDesc(true); }}
                className="text-sm text-blue-500 hover:text-blue-600 flex items-center gap-1"
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
                className="w-full h-32 p-3 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            <h2 className="text-lg font-bold mb-3">홍보 사진</h2>
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
              onClick={() => applyMutation.mutate()}
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
      </div>

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
