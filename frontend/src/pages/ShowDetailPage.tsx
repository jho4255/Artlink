import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, MapPin, Clock, DollarSign, Calendar, Users, ArrowLeft, Trash2, Edit3, Save, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { regionLabels, getShowStatus, showStatusLabels } from '@/lib/utils';
import ImageLightbox from '@/components/shared/ImageLightbox';
import type { Show } from '@/types';

export default function ShowDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuthStore();

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [editingDesc, setEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState('');

  const { data: show, isLoading } = useQuery<Show>({
    queryKey: ['show', id],
    queryFn: () => api.get(`/shows/${id}`).then(r => r.data),
  });

  // 찜 토글
  const favMutation = useMutation({
    mutationFn: () => api.post('/favorites/toggle', { showId: Number(id) }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['show', id] });
      const prev = queryClient.getQueryData<Show>(['show', id]);
      if (prev) queryClient.setQueryData(['show', id], { ...prev, isFavorited: !prev.isFavorited });
      return { prev };
    },
    onError: (_err, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['show', id], ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['show', id] });
      queryClient.invalidateQueries({ queryKey: ['shows'] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });

  // 소개 수정
  const descMutation = useMutation({
    mutationFn: (desc: string) => api.patch(`/shows/${id}`, { description: desc }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['show', id] });
      setEditingDesc(false);
      toast.success('소개가 수정되었습니다.');
    },
  });

  // 삭제
  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/shows/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shows'] });
      toast.success('전시가 삭제되었습니다.');
      navigate('/shows');
    },
  });

  if (isLoading) return <div className="max-w-4xl mx-auto px-4 py-6"><div className="h-64 bg-gray-100 rounded-xl animate-pulse" /></div>;
  if (!show) return <div className="text-center py-16 text-gray-400">전시를 찾을 수 없습니다.</div>;

  const status = getShowStatus(show.startDate, show.endDate);
  const isOwner = user?.id === show.gallery?.ownerId;
  const isAdmin = user?.role === 'ADMIN';
  const canEdit = isOwner;
  const canDelete = isOwner || isAdmin;

  // 모든 이미지 (포스터 + 추가 이미지)
  const allImages = [show.posterImage, ...(show.images?.map(img => img.url) || [])];

  const formatDate = (d: string) => new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-4xl mx-auto px-4 py-6">
      {/* 뒤로가기 */}
      <button onClick={() => navigate('/shows')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-4">
        <ArrowLeft size={16} /> 전시 목록
      </button>

      {/* 포스터 + 이미지 캐러셀 */}
      <div className="relative rounded-xl overflow-hidden mb-6">
        <img
          src={show.posterImage}
          alt={show.title}
          className="w-full h-64 sm:h-80 object-cover cursor-pointer"
          onClick={() => { setLightboxIndex(0); setLightboxOpen(true); }}
        />
        {/* 상태 뱃지 */}
        <span className={`absolute top-4 left-4 px-3 py-1 text-sm font-bold rounded-full ${
          status === 'ongoing' ? 'bg-green-500 text-white' :
          status === 'upcoming' ? 'bg-blue-500 text-white' :
          'bg-gray-500 text-white'
        }`}>
          {showStatusLabels[status]}
        </span>
        {/* 찜 하트 */}
        {isAuthenticated && !isAdmin && (
          <button
            onClick={() => favMutation.mutate()}
            className="absolute top-4 right-4 p-2 bg-white/80 rounded-full hover:bg-white"
          >
            <Heart size={20} className={show.isFavorited ? 'text-red-500 fill-red-500' : 'text-gray-400'} />
          </button>
        )}
        {/* 추가 이미지 썸네일 */}
        {allImages.length > 1 && (
          <div className="absolute bottom-4 left-4 flex gap-2">
            {allImages.slice(1, 4).map((img, i) => (
              <img
                key={i}
                src={img}
                alt={`추가 이미지 ${i + 1}`}
                className="w-12 h-12 object-cover rounded-lg border-2 border-white cursor-pointer"
                onClick={(e) => { e.stopPropagation(); setLightboxIndex(i + 1); setLightboxOpen(true); }}
              />
            ))}
            {allImages.length > 4 && (
              <span className="w-12 h-12 bg-black/50 text-white text-xs flex items-center justify-center rounded-lg border-2 border-white cursor-pointer"
                onClick={() => { setLightboxIndex(4); setLightboxOpen(true); }}>
                +{allImages.length - 4}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxOpen && (
          <ImageLightbox
            images={allImages}
            initialIndex={lightboxIndex}
            onClose={() => setLightboxOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* 제목 + 갤러리 */}
      <h1 className="text-2xl font-bold mb-2">{show.title}</h1>
      <button onClick={() => navigate(`/galleries/${show.gallery?.id}`)} className="text-blue-500 hover:underline text-sm mb-4 block">
        {show.gallery?.name}
      </button>

      {/* 정보 그리드 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
          <Calendar size={16} className="text-gray-400" />
          <div>
            <p className="text-xs text-gray-500">전시 기간</p>
            <p className="text-sm font-medium">{formatDate(show.startDate)} ~ {formatDate(show.endDate)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
          <Clock size={16} className="text-gray-400" />
          <div>
            <p className="text-xs text-gray-500">관람 시간</p>
            <p className="text-sm font-medium">{show.openingHours}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
          <DollarSign size={16} className="text-gray-400" />
          <div>
            <p className="text-xs text-gray-500">입장료</p>
            <p className="text-sm font-medium">{show.admissionFee}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
          <MapPin size={16} className="text-gray-400" />
          <div>
            <p className="text-xs text-gray-500">위치</p>
            <p className="text-sm font-medium">{show.location}</p>
          </div>
        </div>
      </div>

      {/* 참여 작가 */}
      {show.artists && show.artists.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1"><Users size={14} /> 참여 작가</h3>
          <div className="flex flex-wrap gap-2">
            {show.artists.map((artist, i) => (
              artist.userId ? (
                <button
                  key={i}
                  onClick={() => navigate(`/portfolio/${artist.userId}`)}
                  className="px-3 py-1 text-sm bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition-colors"
                >
                  {artist.name}
                </button>
              ) : (
                <span key={i} className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-full">{artist.name}</span>
              )
            ))}
          </div>
        </div>
      )}

      {/* 소개 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-700">소개</h3>
          {canEdit && !editingDesc && (
            <button onClick={() => { setEditDesc(show.description); setEditingDesc(true); }}
              className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
              <Edit3 size={12} /> 수정
            </button>
          )}
        </div>
        {editingDesc ? (
          <div className="space-y-2">
            <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)}
              className="w-full p-3 border border-gray-200 rounded-lg text-sm min-h-[100px]" />
            <div className="flex gap-2">
              <button onClick={() => descMutation.mutate(editDesc)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg">
                <Save size={14} /> 저장
              </button>
              <button onClick={() => setEditingDesc(false)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 border border-gray-200 rounded-lg">
                <X size={14} /> 취소
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-600 whitespace-pre-wrap">{show.description}</p>
        )}
      </div>

      {/* 삭제 버튼 */}
      {canDelete && (
        <button
          onClick={() => { if (confirm('전시를 삭제하시겠습니까?')) deleteMutation.mutate(); }}
          className="flex items-center gap-1 text-sm text-red-500 hover:text-red-600 mt-4"
        >
          <Trash2 size={14} /> 전시 삭제
        </button>
      )}
    </motion.div>
  );
}
