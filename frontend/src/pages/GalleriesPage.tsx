/**
 * GalleriesPage - 갤러리 찾기 페이지
 *
 * 기능:
 *  - 갤러리 목록을 1줄 1개 카드 리스트로 표시
 *  - 지역 필터 (서울/경기북부/경기남부/대전/부산)
 *  - 별점 필터 (3점 이상 / 4점 이상)
 *  - 현재 적용된 필터를 칩으로 표시, X 클릭으로 제거
 *  - 별점순 정렬 토글
 *  - 각 갤러리 카드: 사진, 이름, 주소, 전화번호, 한줄소개, 찜하기, 별점
 *  - 갤러리 클릭 시 상세 페이지(/galleries/:id) 이동
 *
 * API: GET /api/galleries?region=SEOUL&minRating=3&sortBy=rating
 *
 * @see /src/lib/axios.ts - API 인스턴스
 * @see /src/lib/utils.ts - regionLabels, getDday
 * @see /src/types/index.ts - Gallery 타입
 * @see /src/stores/authStore.ts - 인증 상태
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Star, Heart, Phone, MapPin, X, SlidersHorizontal } from 'lucide-react';
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
  const [showFilters, setShowFilters] = useState(false);

  // 갤러리 목록 조회 — 페이지 진입 시 항상 최신 데이터 refetch
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

  // 찜하기 토글 - 낙관적 업데이트로 즉시 반영
  // queryKey를 정확히 맞춰야 다른 갤러리 목록에 영향 없음
  const currentQueryKey = ['galleries', selectedRegion, minRating, sortByRating] as const;
  const favMutation = useMutation({
    mutationFn: (galleryId: number) => api.post('/favorites/toggle', { galleryId }),
    onMutate: async (galleryId: number) => {
      // 현재 필터의 갤러리 목록만 취소/업데이트
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
      // 찜 목록(MyPage)도 갱신
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });

  // 현재 적용된 필터 목록 (칩으로 표시)
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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-4xl mx-auto px-4 py-6">
      {/* 헤더: 페이지 제목 + 필터 토글 버튼 */}
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">갤러리 찾기</h1>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 px-3 py-2 rounded-lg border border-gray-200"
        >
          <SlidersHorizontal size={16} /> 필터
        </button>
      </div>

      {/* 필터 패널 - 토글로 열림/닫힘 */}
      {showFilters && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          className="mb-4 p-4 bg-gray-50 rounded-xl space-y-4"
        >
          {/* 지역 필터 */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">지역</p>
            <div className="flex flex-wrap gap-2">
              {regions.map(r => (
                <button
                  key={r}
                  onClick={() => setSelectedRegion(selectedRegion === r ? null : r)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                    selectedRegion === r
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {regionLabels[r]}
                </button>
              ))}
            </div>
          </div>

          {/* 별점 필터 */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">별점</p>
            <div className="flex gap-2">
              {ratingFilters.map(rf => (
                <button
                  key={rf.value}
                  onClick={() => setMinRating(minRating === rf.value ? null : rf.value)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                    minRating === rf.value
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {rf.label}
                </button>
              ))}
            </div>
          </div>

          {/* 별점순 정렬 토글 */}
          <div>
            <button
              onClick={() => setSortByRating(!sortByRating)}
              className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                sortByRating
                  ? 'bg-yellow-500 text-white border-yellow-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              ★ 별점순 정렬
            </button>
          </div>
        </motion.div>
      )}

      {/* 적용된 필터 칩 - X 클릭으로 제거 가능 */}
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

      {/* 갤러리 리스트 */}
      {isLoading ? (
        // 로딩 스켈레톤
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : galleries.length === 0 ? (
        // 빈 상태
        <div className="text-center py-16 text-gray-400">
          <p>조건에 맞는 갤러리가 없습니다.</p>
        </div>
      ) : (
        // 갤러리 카드 리스트 (1줄 1개)
        <div className="space-y-4">
          {galleries.map((gallery, i) => (
            <motion.div
              key={gallery.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => navigate(`/galleries/${gallery.id}`)}
              className="flex gap-4 p-4 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
            >
              {/* 갤러리 대표 이미지 */}
              <img
                src={
                  gallery.mainImage ||
                  gallery.images?.[0]?.url ||
                  'https://images.unsplash.com/photo-1577720643272-265f09367456?w=200'
                }
                alt={gallery.name}
                className="w-28 h-28 object-cover rounded-lg flex-none"
              />

              {/* 갤러리 정보 */}
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start">
                  <h3 className="font-semibold text-gray-900 truncate">{gallery.name}</h3>
                  {/* 찜하기 버튼 - 로그인 시에만 표시 (Admin 제외) */}
                  {isAuthenticated && user?.role !== 'ADMIN' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation(); // 카드 클릭 이벤트 버블링 방지
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

                {/* 주소, 전화번호, 한줄소개 */}
                <p className="text-sm text-gray-500 mt-1 flex items-center gap-1">
                  <MapPin size={12} /> {gallery.address}
                </p>
                <p className="text-sm text-gray-500 flex items-center gap-1">
                  <Phone size={12} /> {gallery.phone}
                </p>
                <p className="text-sm text-gray-600 mt-1 truncate">{gallery.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
