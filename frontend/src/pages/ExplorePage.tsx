import { useState, useEffect, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { Heart, RefreshCw, Shuffle } from 'lucide-react';
import SkeletonImage from '@/components/shared/SkeletonImage';
import ArtworkDetailModal from '@/components/shared/ArtworkDetailModal';
import api from '@/lib/axios';
import { displayName } from '@/lib/utils';
import type { ExploreImage } from '@/types';

const PERIODS = [
  { key: 'day', label: '하루' },
  { key: 'week', label: '일주일' },
  { key: 'month', label: '한달' },
  { key: 'year', label: '1년' },
  { key: 'all', label: '전체' },
] as const;
type SortMode = 'random' | 'popular';
type Period = typeof PERIODS[number]['key'];

export default function ExplorePage() {
  const [selectedImage, setSelectedImage] = useState<ExploreImage | null>(null);

  // 정렬 상태: 진입 시 랜덤 시드 생성(매번 다른 순서), 새로고침 버튼으로 재셔플
  const [sort, setSort] = useState<SortMode>('random');
  const [period, setPeriod] = useState<Period>('all');
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000_000));
  const reshuffle = () => setSeed(Math.floor(Math.random() * 1_000_000_000));

  // 무한 스크롤 쿼리 (정렬/기간/시드가 키에 포함 → 바뀌면 1페이지부터 새로)
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isFetching,
  } = useInfiniteQuery({
    queryKey: ['explore', sort, period, seed],
    queryFn: ({ pageParam = 1 }) =>
      api.get('/explore', { params: { page: pageParam, limit: 30, sort, seed, period } }).then(r => r.data),
    getNextPageParam: (lastPage) => {
      const nextPage = lastPage.page + 1;
      return nextPage <= Math.ceil(lastPage.total / lastPage.limit) ? nextPage : undefined;
    },
    initialPageParam: 1,
  });

  // IntersectionObserver로 무한 스크롤
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sentinelRef.current || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const allImages = data?.pages.flatMap(p => p.images) || [];

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-10 md:py-16">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl md:text-5xl font-serif text-gray-900">Explore</h1>
          <p className="text-base text-gray-400 mt-2">작가들의 작품을 둘러보세요</p>
        </div>
        {/* 우측 상단 새로고침 — 랜덤 재정렬(같은 작가 연속 방지) */}
        <button
          onClick={reshuffle}
          title="새로고침 (랜덤 재정렬)"
          aria-label="새로고침"
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-full border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw size={16} className={isFetching && !isFetchingNextPage ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">새로고침</span>
        </button>
      </div>

      {/* 정렬 컨트롤 */}
      <div className="flex flex-wrap items-center gap-2 mt-6 mb-10">
        <button
          onClick={() => setSort('random')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full transition-colors ${sort === 'random' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          <Shuffle size={14} /> 랜덤
        </button>
        <button
          onClick={() => setSort('popular')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full transition-colors ${sort === 'popular' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          <Heart size={14} /> 좋아요순
        </button>
        {sort === 'popular' && (
          <div className="flex flex-wrap items-center gap-1 sm:ml-2">
            <span className="text-xs text-gray-400 mr-1">기간</span>
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-2.5 py-1 text-xs rounded-full transition-colors ${period === p.key ? 'bg-[#c4302b] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 md:grid-cols-4 gap-1.5">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-square bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : allImages.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg">아직 공개된 작품이 없습니다.</p>
        </div>
      ) : (
        <>
          {/* 그리드는 정사각 썸네일(object-cover), 클릭해 확대(모달)하면 원본 비율로 표시 */}
          <div className="grid grid-cols-3 md:grid-cols-4 gap-1.5">
            {allImages.map((img) => (
              <button
                key={img.id}
                onClick={() => setSelectedImage(img)}
                className="relative aspect-square overflow-hidden group"
                aria-label={`${displayName(img.artist)} 작가의 작품 — 크게 보기`}
              >
                <SkeletonImage
                  src={img.url}
                  className="absolute inset-0"
                  imgClassName="object-cover"
                  loading="lazy"
                />
                {/* 호버 오버레이 */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                  <Heart size={16} className="text-white fill-white" />
                  <span className="text-white text-sm font-medium">{img.likeCount}</span>
                </div>
              </button>
            ))}
          </div>

          {/* 무한 스크롤 sentinel */}
          <div ref={sentinelRef} className="h-10" />
          {isFetchingNextPage && (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
            </div>
          )}
        </>
      )}

      {/* 이미지 상세 모달 */}
      <AnimatePresence>
        {selectedImage && (
          <ArtworkDetailModal
            image={selectedImage}
            onClose={() => setSelectedImage(null)}
            onUpdate={(updated) => setSelectedImage(updated)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
