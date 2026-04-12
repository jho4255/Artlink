/**
 * GalleriesPage - 갤러리 찾기 페이지
 *
 * 기능:
 *  - 갤러리 목록을 반응형 그리드로 표시
 *  - 지역 필터 (서울/경기북부/경기남부/대전/부산)
 *  - 별점 필터 (3점 이상 / 4점 이상)
 *  - 별점순 정렬 토글
 *  - 각 갤러리 카드: 사진, 이름, 주소, 전화번호, 한줄소개, 찜하기, 별점
 *  - 갤러리 클릭 시 상세 페이지(/galleries/:id) 이동
 *
 * API: GET /api/galleries?region=SEOUL&minRating=3&sortBy=rating
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
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
  const [sortBy, setSortBy] = useState<string | null>(null);

  // 갤러리 목록 조회
  const { data: galleries = [], isLoading } = useQuery<Gallery[]>({
    queryKey: ['galleries', selectedRegion, minRating, sortBy],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedRegion) params.set('region', selectedRegion);
      if (minRating) params.set('minRating', String(minRating));
      if (sortBy) params.set('sortBy', sortBy);
      return api.get(`/galleries?${params}`).then(r => r.data);
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // 찜하기 토글 - 낙관적 업데이트
  const currentQueryKey = ['galleries', selectedRegion, minRating, sortBy] as const;
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
    onSettled: (_data, _err, galleryId) => {
      queryClient.invalidateQueries({ queryKey: currentQueryKey });
      queryClient.invalidateQueries({ queryKey: ['gallery', String(galleryId)] });
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
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-10 md:py-16">
      {/* 헤더 */}
      <h1 className="text-4xl md:text-5xl font-serif text-gray-900">Galleries</h1>
      <p className="text-base text-gray-400 mt-2 mb-10">Find your next partner</p>

      {/* 필터 — 행 구분 */}
      <div className="space-y-3 mb-4 text-base">
        {/* 지역 */}
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-gray-700 text-sm font-medium w-10">지역</span>
          {regions.map(r => (
            <button
              key={r}
              onClick={() => setSelectedRegion(selectedRegion === r ? null : r)}
              className={`cursor-pointer transition-colors ${
                selectedRegion === r
                  ? 'text-gray-900 underline underline-offset-4 decoration-1'
                  : 'text-gray-400 hover:text-gray-900'
              }`}
            >
              {regionLabels[r]}
            </button>
          ))}
        </div>

        {/* 별점 */}
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-gray-700 text-sm font-medium w-10">별점</span>
          {ratingFilters.map(rf => (
            <button
              key={rf.value}
              onClick={() => setMinRating(minRating === rf.value ? null : rf.value)}
              className={`cursor-pointer transition-colors ${
                minRating === rf.value
                  ? 'text-gray-900 underline underline-offset-4 decoration-1'
                  : 'text-gray-400 hover:text-gray-900'
              }`}
            >
              {rf.label}
            </button>
          ))}
        </div>

      </div>

      {/* 적용된 필터 */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-8">
          {activeFilters.map((f, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 text-sm text-gray-600"
            >
              {f.label}
              <button onClick={f.onRemove} className="text-gray-400 hover:text-gray-900 cursor-pointer">
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 구분선 */}
      <div className="border-t border-gray-200 mb-6" />

      {/* 정렬 — 우측 정렬 */}
      <div className="flex justify-end items-center gap-4 mb-8 text-sm">
        <button
          onClick={() => setSortBy(sortBy === 'rating' ? null : 'rating')}
          className={`cursor-pointer transition-colors ${
            sortBy === 'rating'
              ? 'text-gray-900 underline underline-offset-4 decoration-1'
              : 'text-gray-400 hover:text-gray-900'
          }`}
        >
          별점순
        </button>
        <button
          onClick={() => setSortBy(sortBy === 'reviewCount' ? null : 'reviewCount')}
          className={`cursor-pointer transition-colors ${
            sortBy === 'reviewCount'
              ? 'text-gray-900 underline underline-offset-4 decoration-1'
              : 'text-gray-400 hover:text-gray-900'
          }`}
        >
          리뷰순
        </button>
      </div>

      {/* 갤러리 그리드 */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-64 bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : galleries.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg">조건에 맞는 갤러리가 없습니다.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {galleries.map((gallery) => (
            <article
              key={gallery.id}
              onClick={() => navigate(`/galleries/${gallery.id}`)}
              className="group cursor-pointer"
            >
              {/* 갤러리 대표 이미지 */}
              <div className="overflow-hidden">
                <img
                  src={
                    gallery.mainImage ||
                    gallery.images?.[0]?.url ||
                    '/images/gallery-sculpture.webp'
                  }
                  alt={gallery.name}
                  className="w-full aspect-[4/3] object-cover group-hover:opacity-80 transition-opacity duration-300"
                />
              </div>

              {/* 갤러리 정보 */}
              <div className="mt-3">
                <div className="flex justify-between items-start">
                  <h3 className="text-xl font-medium text-gray-900 hover:underline underline-offset-2 decoration-1">
                    {gallery.name}
                  </h3>
                  {isAuthenticated && user?.role !== 'ADMIN' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        favMutation.mutate(gallery.id);
                      }}
                      className="p-1.5 flex-none cursor-pointer"
                    >
                      <Heart
                        size={18}
                        className={gallery.isFavorited ? 'text-[#c4302b] fill-[#c4302b]' : 'text-gray-300 hover:text-gray-500'}
                      />
                    </button>
                  )}
                </div>

                {/* 별점 */}
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Star size={15} className="text-[#c4302b] fill-[#c4302b]" />
                  <span className="text-base font-medium text-[#c4302b]">{gallery.rating.toFixed(1)}</span>
                  <span className="text-sm text-gray-400">({gallery.reviewCount})</span>
                </div>

                {/* 주소, 전화번호 */}
                <p className="text-base text-gray-400 mt-2 flex items-center gap-1.5">
                  <MapPin size={14} /> {gallery.address}
                </p>
                <p className="text-base text-gray-400 flex items-center gap-1.5">
                  <Phone size={14} /> {gallery.phone}
                </p>
                <p className="text-base text-gray-500 mt-1.5 line-clamp-2">{gallery.description}</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
