import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Heart, Users, MapPin, X, SlidersHorizontal, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { getDday, regionLabels, exhibitionTypeLabels } from '@/lib/utils';
import type { Exhibition } from '@/types';

const regions = ['SEOUL', 'GYEONGGI_NORTH', 'GYEONGGI_SOUTH', 'DAEJEON', 'BUSAN'];

export default function ExhibitionsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuthStore();
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [minGalleryRating, setMinGalleryRating] = useState<number | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const exhibitionTypes = ['SOLO', 'GROUP', 'ART_FAIR'];

  // 공모 목록 조회
  const { data: exhibitions = [], isLoading } = useQuery<Exhibition[]>({
    queryKey: ['exhibitions', selectedRegion, minGalleryRating, selectedType],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedRegion) params.set('region', selectedRegion);
      if (minGalleryRating) params.set('minGalleryRating', String(minGalleryRating));
      if (selectedType) params.set('type', selectedType);
      return api.get(`/exhibitions?${params}`).then(r => r.data);
    },
  });

  // 지원하기
  const applyMutation = useMutation({
    mutationFn: (exhibitionId: number) => api.post(`/exhibitions/${exhibitionId}/apply`),
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
  const currentQueryKey = ['exhibitions', selectedRegion, minGalleryRating, selectedType] as const;
  const favMutation = useMutation({
    mutationFn: (exhibitionId: number) => api.post('/favorites/toggle', { exhibitionId }),
    onMutate: async (exhibitionId: number) => {
      await queryClient.cancelQueries({ queryKey: currentQueryKey });
      const prev = queryClient.getQueryData<Exhibition[]>([...currentQueryKey]);
      if (prev) {
        queryClient.setQueryData([...currentQueryKey],
          prev.map(ex => ex.id === exhibitionId ? { ...ex, isFavorited: !ex.isFavorited } : ex)
        );
      }
      return { prev };
    },
    onError: (_err, _id, context) => {
      if (context?.prev) queryClient.setQueryData([...currentQueryKey], context.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: currentQueryKey });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });

  // 필터 칩
  const activeFilters: { label: string; onRemove: () => void }[] = [];
  if (selectedRegion) {
    activeFilters.push({ label: regionLabels[selectedRegion], onRemove: () => setSelectedRegion(null) });
  }
  if (minGalleryRating) {
    activeFilters.push({ label: `갤러리 ${minGalleryRating}점+`, onRemove: () => setMinGalleryRating(null) });
  }
  if (selectedType) {
    activeFilters.push({ label: exhibitionTypeLabels[selectedType], onRemove: () => setSelectedType(null) });
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">모집 공고</h1>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 px-3 py-2 rounded-lg border border-gray-200"
        >
          <SlidersHorizontal size={16} /> 필터
        </button>
      </div>

      {/* 필터 패널 */}
      {showFilters && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="mb-4 p-4 bg-gray-50 rounded-xl space-y-4">
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">전시 지역</p>
            <div className="flex flex-wrap gap-2">
              {regions.map(r => (
                <button
                  key={r}
                  onClick={() => setSelectedRegion(selectedRegion === r ? null : r)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                    selectedRegion === r ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {regionLabels[r]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">공모 유형</p>
            <div className="flex flex-wrap gap-2">
              {exhibitionTypes.map(t => (
                <button
                  key={t}
                  onClick={() => setSelectedType(selectedType === t ? null : t)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                    selectedType === t ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {exhibitionTypeLabels[t]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">갤러리 별점</p>
            <div className="flex gap-2">
              {[3, 4].map(v => (
                <button
                  key={v}
                  onClick={() => setMinGalleryRating(minGalleryRating === v ? null : v)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                    minGalleryRating === v ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {v}점 이상
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* 적용된 필터 칩 */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {activeFilters.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-full">
              {f.label}
              <button onClick={f.onRemove} className="hover:text-red-500"><X size={14} /></button>
            </span>
          ))}
        </div>
      )}

      {/* 공모 리스트 */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <div key={i} className="h-40 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : exhibitions.length === 0 ? (
        <div className="text-center py-16 text-gray-400">진행중인 공고가 없습니다.</div>
      ) : (
        <div className="space-y-4">
          {exhibitions.map((ex, i) => {
            const dday = getDday(ex.deadline);
            const isAdmin = user?.role === 'ADMIN';

            return (
              <motion.div
                key={ex.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="border border-gray-100 rounded-xl shadow-sm overflow-hidden bg-white"
              >
                {/* 카드 - 클릭 시 상세 페이지 이동 */}
                <div
                  onClick={() => navigate(`/exhibitions/${ex.id}`)}
                  className="flex gap-4 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <img
                    src={ex.imageUrl || ex.gallery?.mainImage || 'https://images.unsplash.com/photo-1577720643272-265f09367456?w=200'}
                    alt={ex.title}
                    className="w-24 h-24 object-cover rounded-lg flex-none"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                      <h3 className="font-semibold text-gray-900">{ex.title}</h3>
                      <span className={`text-sm font-bold flex-none ${dday <= 7 ? 'text-red-500' : 'text-gray-500'}`}>
                        D-{dday}
                      </span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/galleries/${ex.gallery?.id}`); }}
                      className="text-sm text-blue-500 hover:underline mt-1"
                    >
                      {ex.gallery?.name}
                    </button>
                    <div className="flex flex-wrap gap-2 mt-2 text-xs text-gray-500">
                      <span className="px-2 py-0.5 bg-gray-100 rounded">{exhibitionTypeLabels[ex.type]}</span>
                      <span className="flex items-center gap-0.5"><Users size={11} /> {ex.capacity}명</span>
                      <span className="flex items-center gap-0.5"><MapPin size={11} /> {regionLabels[ex.region]}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-center gap-2 flex-none">
                    {/* Admin이 아닌 로그인 유저만 찜 버튼 표시 */}
                    {isAuthenticated && !isAdmin && (
                      <button
                        onClick={(e) => { e.stopPropagation(); favMutation.mutate(ex.id); }}
                        className="p-1.5 hover:bg-gray-100 rounded-full"
                      >
                        <Heart size={16} className={ex.isFavorited ? 'text-red-500 fill-red-500' : 'text-gray-300'} />
                      </button>
                    )}
                    {/* Artist 빠른 지원 버튼 (커스텀 필드 있으면 상세페이지 이동) */}
                    {user?.role === 'ARTIST' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (ex.customFields && ex.customFields.length > 0) {
                            toast('추가 정보 입력이 필요합니다. 상세페이지로 이동합니다.', { icon: '📝' });
                            navigate(`/exhibitions/${ex.id}`);
                          } else {
                            applyMutation.mutate(ex.id);
                          }
                        }}
                        disabled={applyMutation.isPending}
                        className="p-1.5 hover:bg-gray-100 rounded-full"
                        title="지원하기"
                      >
                        <Send size={16} className="text-gray-400" />
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
