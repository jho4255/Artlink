/**
 * InstagramFeed - 갤러리 상세 페이지 Instagram 피드 컴포넌트
 *
 * - GET /api/galleries/:id/instagram-feed 로 최근 9개 게시물 조회
 * - 3x3 그리드 썸네일, 클릭 시 앱 내 ImageLightbox 확대
 * - 모든 이미지 로드 완료 전까지 스켈레톤 표시
 * - "Instagram에서 전체 보기" 외부 링크 (유일한 외부 이동)
 */
import { useState, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { ExternalLink } from 'lucide-react';
import api from '@/lib/axios';
import ImageLightbox from '@/components/shared/ImageLightbox';
import type { InstagramPost } from '@/types';

interface InstagramFeedProps {
  galleryId: number;
  instagramUrl?: string;
}

export default function InstagramFeed({ galleryId, instagramUrl }: InstagramFeedProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [allImagesLoaded, setAllImagesLoaded] = useState(false);
  const loadedCountRef = useRef(0);
  const totalRef = useRef(0);

  const { data: posts = [], isLoading } = useQuery<InstagramPost[]>({
    queryKey: ['instagram-feed', galleryId],
    queryFn: () => api.get(`/galleries/${galleryId}/instagram-feed`).then(r => r.data),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // 이미지 로드 완료 콜백
  const handleImageLoad = useCallback(() => {
    loadedCountRef.current += 1;
    if (loadedCountRef.current >= totalRef.current) {
      setAllImagesLoaded(true);
    }
  }, []);

  // posts가 바뀌면 카운터 리셋
  if (posts.length > 0 && totalRef.current !== posts.length) {
    totalRef.current = posts.length;
    loadedCountRef.current = 0;
    setAllImagesLoaded(false);
  }

  // Instagram 프로필 URL 생성
  const profileUrl = instagramUrl
    ? `https://instagram.com/${instagramUrl.replace('@', '')}`
    : undefined;

  // Lightbox용 이미지 URL 배열
  const imageUrls = posts.map(p =>
    p.mediaType === 'VIDEO' ? (p.thumbnailUrl || p.mediaUrl) : p.mediaUrl
  );

  // 스켈레톤 (API 로딩 또는 이미지 로딩 중)
  const showSkeleton = isLoading || (posts.length > 0 && !allImagesLoaded);

  // 게시물 없음 (API 완료 후)
  if (!isLoading && posts.length === 0) return null;

  return (
    <div>
      {/* 헤더: Instagram에서 전체 보기 링크 */}
      {profileUrl && (
        <div className="flex justify-end mb-2">
          <a
            href={profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-pink-500 flex items-center gap-1"
          >
            Instagram에서 전체 보기 <ExternalLink size={12} />
          </a>
        </div>
      )}

      {/* 스켈레톤 (API 로딩 + 이미지 로딩 중 표시) */}
      {showSkeleton && (
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: posts.length || 9 }).map((_, i) => (
            <div key={i} className="aspect-square bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {/* 실제 그리드 (이미지 로드 중엔 숨김, 로드 완료 후 표시) */}
      {posts.length > 0 && (
        <div
          className="grid grid-cols-3 gap-1.5"
          style={{ display: allImagesLoaded ? undefined : 'none' }}
        >
          {posts.map((post, i) => (
            <button
              key={post.id}
              onClick={() => setLightboxIndex(i)}
              className="relative aspect-square overflow-hidden rounded-lg group"
            >
              <img
                src={post.mediaType === 'VIDEO' ? (post.thumbnailUrl || post.mediaUrl) : post.mediaUrl}
                alt=""
                className="w-full h-full object-cover transition-opacity group-hover:opacity-75"
                onLoad={handleImageLoad}
                onError={handleImageLoad}
              />
            </button>
          ))}
        </div>
      )}

      {/* ImageLightbox (앱 내 확대) */}
      <AnimatePresence>
        {lightboxIndex !== null && (
          <ImageLightbox
            images={imageUrls}
            initialIndex={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
