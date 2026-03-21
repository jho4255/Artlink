/**
 * GalleriesPage - 갤러리 찾기 페이지
 *
 * 기능:
 *  - 갤러리 목록을 반응형 masonry 그리드로 표시
 *  - 지역 필터 (서울/경기북부/경기남부/대전/부산)
 *  - 별점 필터 (3점 이상 / 4점 이상)
 *  - 가로 스크롤 필터 칩 + 적용된 필터 표시
 *  - 별점순 정렬 토글
 *  - 각 갤러리 카드: 사진, 이름, 주소, 전화번호, 한줄소개, 찜하기, 별점
 *  - 갤러리 클릭 시 상세 페이지(/galleries/:id) 이동
 *
 * API: GET /api/galleries?region=SEOUL&minRating=3&sortBy=rating
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Star, Heart, Phone, MapPin, X } from 'lucide-react';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { regionLabels } from '@/lib/utils';
import type { Gallery } from '@/types';

// 지역 필터 옵션
const regions = ['SEOUL', 'GYEONGGI_NORTH', 'GYEONGGI_SOUTH', 'DAEJEON', 'BUSAN'];

// 별점 필터 옵션
const ratingFilters = [
  { label: '3점 이상', value: 3 },
  { label: '4점 이상', value: 4 },
];

export default function GalleriesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuthStore();

  // 필터 상태
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [minRating, setMinRating] = useState<number | null>(null);
  const [sortByRating, setSortByRating] = useState(false);

  // 갤러리 목록 조회
  const { data: galleries = [], isLoading } = useQuery<Gallery[]>({
    queryKey: ['galleries', selectedRegion, minRating, sortByRating],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedRegion) params.set('region', selectedRegion);
      if (minRating) params.set('minRating', String(minRating));
      if (sortByRating) params.set('sortBy', 'rating');
      return api.get(`/galleries?${params}`).then(r => r.data);
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // 찜하기 토글 - 낙관적 업데이트
  const currentQueryKey = ['galleries', selectedRegion, minRating, sortByRating] as const;
  const favMutation = useMutation({
    mutationFn: (galleryId: number) => api.post('/favorites/toggle', { galleryId }),
    onMutate: async (galleryId: number) => {
      await queryClient.cancelQueries({ queryKey: currentQueryKey });
      const prevGalleries = queryClient.getQueryData<Gallery[]>([...currentQueryKey]);
      if (prevGalleries) {
        queryClient.setQueryData([...currentQueryKey],
          prevGalleries.map(g => g.id === galleryId ? { ...g, isFavorited: !g.isFavorited } : g)
        );
      }
      return { prevGalleries };
    },
    onError: (_err, _galleryId, context) => {
      if (context?.prevGalleries) {
        queryClient.setQueryData([...currentQueryKey], context.prevGalleries);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: currentQueryKey });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });

  // 현재 적용된 필터 목록
  const activeFilters: { label: string; onRemove: () => void }[] = [];
  if (selectedRegion) {
    activeFilters.push({
      label: regionLabels[selectedRegion] || selectedRegion,
      onRemove: () => setSelectedRegion(null),
    });
  }
  if (minRating) {
    activeFilters.push({
      label: `${minRating}점 이상`,
      onRemove: () => setMinRating(null),
    });
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-6xl mx-auto px-4 py-6">
      {/* 헤더 */}
      <h1 className="text-2xl font-bold mb-4 font-serif">갤러리 찾기</h1>

      {/* 가로 스크롤 필터 칩 */}
      <div className="flex items-center gap-2 overflow-x-auto pb-3 scrollbar-hide">
        {/* 지역 필터 */}
        <span className="text-xs text-gray-400 flex-none font-medium">지역</span>
        {regions.map(r => (
          <button
            key={r}
            onClick={() => setSelectedRegion(selectedRegion === r ? null : r)}
            className={`px-3 py-2 text-sm rounded-full flex-none min-h-[44px] transition-colors ${
              selectedRegion === r
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {regionLabels[r]}
          </button>
        ))}

        <div className="w-px h-6 bg-gray-200 flex-none" />

        {/* 별점 필터 */}
        <span className="text-xs text-gray-400 flex-none font-medium">별점</span>
        {ratingFilters.map(rf => (
          <button
            key={rf.value}
            onClick={() => setMinRating(minRating === rf.value ? null : rf.value)}
            className={`px-3 py-2 text-sm rounded-full flex-none min-h-[44px] transition-colors ${
              minRating === rf.value
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {rf.label}
          </button>
        ))}

        <div className="w-px h-6 bg-gray-200 flex-none" />

        {/* 별점순 정렬 */}
        <button
          onClick={() => setSortByRating(!sortByRating)}
          className={`px-3 py-2 text-sm rounded-full flex-none min-h-[44px] transition-colors ${
            sortByRating
              ? 'bg-yellow-500 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          ★ 별점순
        </button>
      </div>

      {/* 적용된 필터 칩 */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {activeFilters.map((f, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-full"
            >
              {f.label}
              <button onClick={f.onRemove} className="hover:text-red-500">
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 갤러리 그리드 (masonry) */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-64 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : galleries.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p>조건에 맞는 갤러리가 없습니다.</p>
        </div>
      ) : (
        <div className="columns-1 md:columns-2 lg:columns-3 gap-4 space-y-4">
          {galleries.map((gallery, i) => (
            <motion.div
              key={gallery.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => navigate(`/galleries/${gallery.id}`)}
              className="break-inside-avoid bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden cursor-pointer hover:-translate-y-1 hover:shadow-md transition-all"
            >
              {/* 갤러리 대표 이미지 */}
              <img
                src={
                  gallery.mainImage ||
                  gallery.images?.[0]?.url ||
                  'https://images.unsplash.com/photo-1577720643272-265f09367456?w=400'
                }
                alt={gallery.name}
                className="w-full aspect-[4/3] object-cover"
              />

              {/* 갤러리 정보 */}
              <div className="p-4">
                <div className="flex justify-between items-start">
                  <h3 className="font-semibold text-gray-900 truncate">{gallery.name}</h3>
                  {isAuthenticated && user?.role !== 'ADMIN' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        favMutation.mutate(gallery.id);
                      }}
                      className="p-1.5 hover:bg-gray-100 rounded-full flex-none"
                    >
                      <Heart
                        size={18}
                        className={gallery.isFavorited ? 'text-red-500 fill-red-500' : 'text-gray-300'}
                      />
                    </button>
                  )}
                </div>

                {/* 별점 */}
                <div className="flex items-center gap-1 mt-1">
                  <Star size={14} className="text-yellow-400 fill-yellow-400" />
                  <span className="text-sm font-medium">{gallery.rating.toFixed(1)}</span>
                  <span className="text-xs text-gray-400">({gallery.reviewCount})</span>
                </div>

                {/* 주소, 전화번호 */}
                <p className="text-sm text-gray-500 mt-2 flex items-center gap-1">
                  <MapPin size={12} /> {gallery.address}
                </p>
                <p className="text-sm text-gray-500 flex items-center gap-1">
                  <Phone size={12} /> {gallery.phone}
                </p>
                <p className="text-sm text-gray-600 mt-1 line-clamp-2">{gallery.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
