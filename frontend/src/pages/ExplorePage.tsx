import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Heart, X, User, ChevronDown } from 'lucide-react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import type { ExploreImage } from '@/types';

export default function ExplorePage() {
  const { isAuthenticated } = useAuthStore();
  const [selectedImage, setSelectedImage] = useState<ExploreImage | null>(null);

  // 무한 스크롤 쿼리
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['explore'],
    queryFn: ({ pageParam = 1 }) =>
      api.get(`/explore?page=${pageParam}&limit=30`).then(r => r.data),
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
      <h1 className="text-4xl md:text-5xl font-serif text-gray-900">Explore</h1>
      <p className="text-base text-gray-400 mt-2 mb-10">작가들의 작품을 둘러보세요</p>

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
          <div className="grid grid-cols-3 md:grid-cols-4 gap-1.5">
            {allImages.map((img) => (
              <button
                key={img.id}
                onClick={() => setSelectedImage(img)}
                className="relative aspect-square overflow-hidden group"
              >
                <img
                  src={img.url}
                  alt=""
                  className="w-full h-full object-cover"
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
          <ImageDetailModal
            image={selectedImage}
            onClose={() => setSelectedImage(null)}
            onUpdate={(updated) => setSelectedImage(updated)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ===== 이미지 상세 모달 =====
interface ImageDetailModalProps {
  image: ExploreImage;
  onClose: () => void;
  onUpdate: (img: ExploreImage) => void;
}

function ImageDetailModal({ image, onClose, onUpdate }: ImageDetailModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuthStore();
  const [showLikers, setShowLikers] = useState(false);

  const isOwner = user?.id === image.artist.id;

  // ESC 키 + 스크롤 잠금
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // 좋아요 토글
  const likeMutation = useMutation({
    mutationFn: () => api.post(`/explore/${image.id}/like`),
    onMutate: () => {
      const newLiked = !image.isLiked;
      onUpdate({
        ...image,
        isLiked: newLiked,
        likeCount: image.likeCount + (newLiked ? 1 : -1),
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['explore'] });
    },
  });

  // 좋아요한 사람 목록 (이미지 주인만)
  const { data: likersData } = useQuery({
    queryKey: ['explore-likes', image.id],
    queryFn: () => api.get(`/explore/${image.id}/likes`).then(r => r.data),
    enabled: isOwner && showLikers,
    staleTime: 30000,
  });

  const handleLike = () => {
    if (!isAuthenticated) {
      toast.error('로그인이 필요합니다.');
      return;
    }
    likeMutation.mutate();
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative bg-white max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 닫기 */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-gray-900 z-10"
          aria-label="닫기"
        >
          <X size={20} />
        </button>

        {/* 이미지 */}
        <img src={image.url} alt="" className="w-full" />

        {/* 정보 영역 */}
        <div className="p-4">
          {/* 작가 정보 */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => { onClose(); navigate(`/portfolio/${image.artist.id}`); }}
              className="flex items-center gap-2 hover:opacity-70 transition-opacity"
            >
              {image.artist.avatar ? (
                <img src={image.artist.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                  <User size={14} className="text-gray-400" />
                </div>
              )}
              <span className="text-sm font-medium text-gray-900 hover:underline">
                {image.artist.name}
              </span>
            </button>

            {/* 좋아요 */}
            <div className="flex items-center gap-2">
              <button onClick={handleLike} aria-label={image.isLiked ? '좋아요 취소' : '좋아요'}>
                <Heart
                  size={20}
                  className={image.isLiked ? 'text-[#c4302b] fill-[#c4302b]' : 'text-gray-300 hover:text-gray-500'}
                />
              </button>
              {isOwner ? (
                <button
                  onClick={() => setShowLikers(!showLikers)}
                  className="text-sm text-gray-500 underline underline-offset-2 cursor-pointer"
                >
                  {image.likeCount}
                </button>
              ) : (
                <span className="text-sm text-gray-500">{image.likeCount}</span>
              )}
            </div>
          </div>

          {/* 좋아요한 사람 목록 (이미지 주인만) */}
          <AnimatePresence>
            {isOwner && showLikers && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden mt-3"
              >
                <div className="border-t border-gray-100 pt-3">
                  <p className="text-xs text-gray-400 mb-2">좋아요한 사람</p>
                  {!likersData || likersData.likers.length === 0 ? (
                    <p className="text-xs text-gray-300 py-2">아직 좋아요한 사람이 없습니다.</p>
                  ) : (
                    <div className="space-y-2">
                      {likersData.likers.map((liker: any) => (
                        <button
                          key={liker.id}
                          onClick={() => { onClose(); navigate(`/portfolio/${liker.id}`); }}
                          className="flex items-center gap-2 text-sm text-gray-700 hover:underline"
                        >
                          {liker.avatar ? (
                            <img src={liker.avatar} alt="" className="w-6 h-6 rounded-full object-cover" />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center">
                              <User size={10} className="text-gray-400" />
                            </div>
                          )}
                          {liker.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}
