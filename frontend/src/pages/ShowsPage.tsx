import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Heart, MapPin, Calendar, X, SlidersHorizontal } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { regionLabels, getShowStatus, showStatusLabels } from '@/lib/utils';
import type { Show } from '@/types';

const regions = ['SEOUL', 'GYEONGGI_NORTH', 'GYEONGGI_SOUTH', 'DAEJEON', 'BUSAN'];
const statusFilters = ['ongoing', 'upcoming', 'ended'] as const;

export default function ShowsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuthStore();
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // 전시 목록 조회
  const { data: shows = [], isLoading } = useQuery<Show[]>({
    queryKey: ['shows', selectedRegion, selectedStatus],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedRegion) params.set('region', selectedRegion);
      if (selectedStatus) params.set('showStatus', selectedStatus);
      return api.get(`/shows?${params}`).then(r => r.data);
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // 찜 토글 - optimistic update
  const currentQueryKey = ['shows', selectedRegion, selectedStatus] as const;
  const favMutation = useMutation({
    mutationFn: (showId: number) => api.post('/favorites/toggle', { showId }),
    onMutate: async (showId: number) => {
      await queryClient.cancelQueries({ queryKey: currentQueryKey });
      const prev = queryClient.getQueryData<Show[]>([...currentQueryKey]);
      if (prev) {
        queryClient.setQueryData([...currentQueryKey],
          prev.map(s => s.id === showId ? { ...s, isFavorited: !s.isFavorited } : s)
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
  if (selectedStatus) {
    activeFilters.push({ label: showStatusLabels[selectedStatus], onRemove: () => setSelectedStatus(null) });
  }

  // 날짜 포맷
  const formatDate = (d: string) => new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">전시</h1>
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
            <p className="text-sm font-medium text-gray-700 mb-2">지역</p>
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
            <p className="text-sm font-medium text-gray-700 mb-2">상태</p>
            <div className="flex flex-wrap gap-2">
              {statusFilters.map(s => (
                <button
                  key={s}
                  onClick={() => setSelectedStatus(selectedStatus === s ? null : s)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                    selectedStatus === s ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {showStatusLabels[s]}
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

      {/* 전시 리스트 */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <div key={i} className="h-48 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : shows.length === 0 ? (
        <div className="text-center py-16 text-gray-400">등록된 전시가 없습니다.</div>
      ) : (
        <div className="space-y-4">
          {shows.map((show, i) => {
            const status = getShowStatus(show.startDate, show.endDate);
            const isAdmin = user?.role === 'ADMIN';

            return (
              <motion.div
                key={show.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="border border-gray-100 rounded-xl shadow-sm overflow-hidden bg-white"
              >
                <div
                  onClick={() => navigate(`/shows/${show.id}`)}
                  className="flex gap-4 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  {/* 포스터 이미지 */}
                  <img
                    src={show.posterImage}
                    alt={show.title}
                    className="w-24 h-32 object-cover rounded-lg flex-none"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                      <h3 className="font-semibold text-gray-900 line-clamp-1">{show.title}</h3>
                      <span className={`text-xs font-bold flex-none px-2 py-0.5 rounded-full ${
                        status === 'ongoing' ? 'bg-green-100 text-green-700' :
                        status === 'upcoming' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-500'
                      }`}>
                        {showStatusLabels[status]}
                      </span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/galleries/${show.gallery?.id}`); }}
                      className="text-sm text-blue-500 hover:underline mt-1"
                    >
                      {show.gallery?.name}
                    </button>
                    <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
                      <Calendar size={11} />
                      <span>{formatDate(show.startDate)} ~ {formatDate(show.endDate)}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-1 text-xs text-gray-500">
                      <span className="flex items-center gap-0.5"><MapPin size={11} /> {regionLabels[show.region]}</span>
                      <span className="px-2 py-0.5 bg-gray-100 rounded">{show.admissionFee}</span>
                    </div>
                  </div>
                  {/* 찜 버튼 */}
                  <div className="flex flex-col items-center gap-2 flex-none">
                    {isAuthenticated && !isAdmin && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isAuthenticated) { toast.error('로그인이 필요합니다.'); return; }
                          favMutation.mutate(show.id);
                        }}
                        className="p-1.5 hover:bg-gray-100 rounded-full"
                      >
                        <Heart size={16} className={show.isFavorited ? 'text-red-500 fill-red-500' : 'text-gray-300'} />
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
