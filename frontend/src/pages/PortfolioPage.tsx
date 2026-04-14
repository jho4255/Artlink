import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { ArrowLeft, User, FileText, Calendar } from 'lucide-react';
import api from '@/lib/axios';
import ImageLightbox from '@/components/shared/ImageLightbox';
import type { PublicPortfolio } from '@/types';

export default function PortfolioPage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [imagesReady, setImagesReady] = useState(false);
  const loadedCountRef = useRef(0);

  const { data: portfolio, isLoading, error } = useQuery<PublicPortfolio>({
    queryKey: ['portfolio', userId],
    queryFn: () => api.get(`/portfolio/${userId}`).then(r => r.data),
  });

  // 이미지 프리로드: 모든 이미지 로드 완료 후 한번에 표시 (스켈레톤 → 실제 이미지)
  useEffect(() => {
    if (!portfolio || portfolio.images.length === 0) return;
    setImagesReady(false);
    loadedCountRef.current = 0;
    const total = portfolio.images.length;
    const onComplete = () => {
      loadedCountRef.current += 1;
      if (loadedCountRef.current >= total) setImagesReady(true);
    };
    portfolio.images.forEach(img => {
      const i = new Image();
      i.onload = onComplete;
      i.onerror = onComplete;
      i.src = img.url;
    });
  }, [portfolio]);

  if (isLoading) return <div className="max-w-7xl mx-auto px-6 md:px-12 py-10"><div className="h-64 bg-gray-100 animate-pulse" /></div>;
  if (error || !portfolio) return <div className="text-center py-16 text-gray-400">포트폴리오를 찾을 수 없습니다.</div>;

  const imageUrls = portfolio.images.map(img => img.url);

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-10 md:py-16">
      {/* 뒤로가기 */}
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-6">
        <ArrowLeft size={16} /> 뒤로가기
      </button>

      {/* 작가 프로필 */}
      <div className="flex items-center gap-4 mb-8">
        {portfolio.user.avatar ? (
          <img src={portfolio.user.avatar} alt={portfolio.user.name} className="w-16 h-16 rounded-full object-cover" />
        ) : (
          <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center">
            <User size={24} className="text-gray-400" />
          </div>
        )}
        <div>
          <h1 className="text-2xl font-medium">{portfolio.user.name}</h1>
          <p className="text-sm text-gray-500">아티스트 포트폴리오</p>
        </div>
      </div>

      {/* 약력 */}
      {portfolio.biography && (
        <div className="mb-6">
          <h3 className="text-base font-medium text-gray-700 mb-2 flex items-center gap-1">
            <FileText size={14} /> 작가 약력
          </h3>
          <div className="border-l-2 border-gray-200 pl-4 py-2 text-sm text-gray-600 whitespace-pre-wrap">{portfolio.biography}</div>
        </div>
      )}

      {/* 전시 이력 */}
      {portfolio.exhibitionHistory && (
        <div className="mb-6">
          <h3 className="text-base font-medium text-gray-700 mb-2 flex items-center gap-1">
            <Calendar size={14} /> 전시 이력
          </h3>
          <div className="border-l-2 border-gray-200 pl-4 py-2 text-sm text-gray-600 whitespace-pre-wrap">{portfolio.exhibitionHistory}</div>
        </div>
      )}

      {/* 작품 이미지 그리드 (스켈레톤 → 프리로드 완료 후 표시) */}
      {imageUrls.length > 0 && (
        <div className="mb-6">
          <h3 className="text-base font-medium text-gray-700 mb-3">작품 ({imageUrls.length})</h3>
          {!imagesReady ? (
            <div className="grid grid-cols-3 gap-2">
              {imageUrls.map((_, i) => (
                <div key={i} className="aspect-square bg-gray-100 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {imageUrls.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`작품 ${i + 1}`}
                  className="w-full aspect-square object-cover cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => { setLightboxIndex(i); setLightboxOpen(true); }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 빈 포트폴리오 */}
      {!portfolio.biography && !portfolio.exhibitionHistory && imageUrls.length === 0 && (
        <div className="text-center py-16 text-gray-400">아직 포트폴리오가 등록되지 않았습니다.</div>
      )}

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxOpen && (
          <ImageLightbox
            images={imageUrls}
            initialIndex={lightboxIndex}
            onClose={() => setLightboxOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
