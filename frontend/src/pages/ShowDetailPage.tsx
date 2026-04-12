import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { Heart, MapPin, Clock, DollarSign, Calendar, Users, ArrowLeft, Trash2, Edit3, Save, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { extractColor } from '@/lib/extractColor';
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
  const [bgColor, setBgColor] = useState('#1a1a2e');

  const { data: show, isLoading } = useQuery<Show>({
    queryKey: ['show', id],
    queryFn: () => api.get(`/shows/${id}`).then(r => r.data),
  });

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

  const descMutation = useMutation({
    mutationFn: (desc: string) => api.patch(`/shows/${id}`, { description: desc }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['show', id] });
      setEditingDesc(false);
      toast.success('소개가 수정되었습니다.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/shows/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shows'] });
      toast.success('전시가 삭제되었습니다.');
      navigate('/shows');
    },
  });

  // 이미지 dominant color 추출
  useEffect(() => {
    if (show?.posterImage) extractColor(show.posterImage).then(setBgColor);
  }, [show?.posterImage]);

  if (isLoading) return <div className="max-w-7xl mx-auto px-6 md:px-12 py-10"><div className="h-64 bg-gray-100 animate-pulse" /></div>;
  if (!show) return <div className="text-center py-20 text-gray-400 text-lg">전시를 찾을 수 없습니다.</div>;

  const status = getShowStatus(show.startDate, show.endDate);
  const isOwner = user?.id === show.gallery?.ownerId;
  const isAdmin = user?.role === 'ADMIN';
  const canEdit = isOwner;
  const canDelete = isOwner || isAdmin;

  const allImages = [show.posterImage, ...(show.images?.map(img => img.url) || [])];

  const formatDate = (d: string) => new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-10 md:py-16">
      {/* 뒤로가기 */}
      <button onClick={() => navigate('/shows')} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-900 mb-8 cursor-pointer">
        <ArrowLeft size={16} /> 전시 목록
      </button>

      {/* 포스터 + glow shadow */}
      <div className="mb-12 md:mb-16">
        <div
          className="max-w-lg mx-auto relative overflow-hidden rounded-lg transition-shadow duration-700"
          style={{ boxShadow: `0 8px 40px ${bgColor}, 0 2px 12px ${bgColor}` }}
        >
            <img
              src={show.posterImage}
              alt={show.title}
              className="w-full block cursor-pointer"
              onClick={() => { setLightboxIndex(0); setLightboxOpen(true); }}
            />
            {/* 추가 이미지 썸네일 */}
            {allImages.length > 1 && (
              <div className="absolute bottom-4 left-4 flex gap-2">
                {allImages.slice(1, 4).map((img, i) => (
                  <img
                    key={i}
                    src={img}
                    alt={`추가 이미지 ${i + 1}`}
                    className="w-12 h-12 object-cover border-2 border-white cursor-pointer hover:opacity-80"
                    onClick={(e) => { e.stopPropagation(); setLightboxIndex(i + 1); setLightboxOpen(true); }}
                  />
                ))}
                {allImages.length > 4 && (
                  <span className="w-12 h-12 bg-black/50 text-white text-xs flex items-center justify-center border-2 border-white cursor-pointer"
                    onClick={() => { setLightboxIndex(4); setLightboxOpen(true); }}>
                    +{allImages.length - 4}
                  </span>
                )}
              </div>
            )}
        </div>
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

      {/* 제목 + 상태 + 찜 */}
      <div className="flex justify-between items-start mb-2">
        <h1 className="text-2xl font-medium text-gray-900">{show.title}</h1>
        <div className="flex items-center gap-3 flex-none">
          <span className={`text-sm font-medium ${
            status === 'ongoing' ? 'text-[#c4302b]' :
            status === 'upcoming' ? 'text-gray-900' :
            'text-gray-400'
          }`}>
            {showStatusLabels[status]}
          </span>
          {isAuthenticated && !isAdmin && (
            <button onClick={() => favMutation.mutate()} className="cursor-pointer">
              <Heart size={20} className={show.isFavorited ? 'text-[#c4302b] fill-[#c4302b]' : 'text-gray-300 hover:text-gray-500'} />
            </button>
          )}
        </div>
      </div>

      {/* 갤러리 */}
      <button onClick={() => navigate(`/galleries/${show.gallery?.id}`)} className="text-base text-gray-500 hover:underline cursor-pointer">
        {show.gallery?.name}
      </button>

      {/* 참여 작가 */}
      {show.artists && show.artists.length > 0 && (
        <p className="text-base text-gray-500 mt-2">
          {show.artists.map((artist, i) => (
            <span key={i}>
              {i > 0 && ', '}
              {artist.userId ? (
                <span onClick={() => navigate(`/portfolio/${artist.userId}`)} className="hover:underline cursor-pointer">{artist.name}</span>
              ) : artist.name}
            </span>
          ))}
        </p>
      )}

      {/* 구분선 */}
      <div className="border-t border-gray-200 mt-8 mb-8" />

      {/* 정보 */}
      <div className="space-y-0">
        <div className="flex items-center gap-3 py-4 border-b border-gray-100">
          <Calendar size={16} className="text-gray-400 flex-none" />
          <div>
            <p className="text-sm text-gray-400">전시 기간</p>
            <p className="text-base">{formatDate(show.startDate)} ~ {formatDate(show.endDate)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 py-4 border-b border-gray-100">
          <Clock size={16} className="text-gray-400 flex-none" />
          <div>
            <p className="text-sm text-gray-400">관람 시간</p>
            <p className="text-base">{show.openingHours}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 py-4 border-b border-gray-100">
          <DollarSign size={16} className="text-gray-400 flex-none" />
          <div>
            <p className="text-sm text-gray-400">입장료</p>
            <p className="text-base">{show.admissionFee}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 py-4 border-b border-gray-100">
          <MapPin size={16} className="text-gray-400 flex-none" />
          <div>
            <p className="text-sm text-gray-400">위치</p>
            <p className="text-base">{show.location} ({regionLabels[show.region]})</p>
          </div>
        </div>
      </div>

      {/* 소개 */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xl font-medium">소개</h3>
          {canEdit && !editingDesc && (
            <button onClick={() => { setEditDesc(show.description); setEditingDesc(true); }}
              className="text-sm text-gray-400 hover:text-gray-900 flex items-center gap-1 cursor-pointer">
              <Edit3 size={14} /> 수정
            </button>
          )}
        </div>
        {editingDesc ? (
          <div className="space-y-3">
            <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)}
              className="w-full p-3 border border-gray-200 text-base min-h-[120px] focus:outline-none focus:ring-1 focus:ring-gray-400" />
            <div className="flex gap-2">
              <button onClick={() => descMutation.mutate(editDesc)}
                className="flex items-center gap-1 px-4 py-2 text-sm bg-gray-900 text-white cursor-pointer">
                <Save size={14} /> 저장
              </button>
              <button onClick={() => setEditingDesc(false)}
                className="flex items-center gap-1 px-4 py-2 text-sm text-gray-500 cursor-pointer">
                <X size={14} /> 취소
              </button>
            </div>
          </div>
        ) : (
          <p className="text-base text-gray-600 whitespace-pre-wrap leading-relaxed">{show.description}</p>
        )}
      </div>

      {/* 삭제 */}
      {canDelete && (
        <div className="border-t border-gray-200 mt-12 pt-6">
          <button
            onClick={() => { if (confirm('전시를 삭제하시겠습니까?')) deleteMutation.mutate(); }}
            className="text-sm text-gray-400 hover:text-[#c4302b] cursor-pointer"
          >
            전시 삭제
          </button>
        </div>
      )}
    </div>
  );
}
