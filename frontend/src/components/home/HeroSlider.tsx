import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/axios';
import type { HeroSlide } from '@/types';

// 히어로 슬라이더 - 3초 자동슬라이드, 수동 조작 시 타이머 리셋
export default function HeroSlider() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);

  const { data: slides = [] } = useQuery<HeroSlide[]>({
    queryKey: ['hero-slides'],
    queryFn: () => api.get('/hero-slides').then((r) => r.data),
  });

  // 3초 자동 슬라이드 (수동 조작 시 리셋)
  const resetAutoSlide = useCallback(() => {
    // current 변경 시 useEffect에서 타이머 재설정됨
  }, []);

  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(() => {
      setCurrent((prev) => (prev + 1) % slides.length);
    }, 3000);
    return () => clearInterval(timer);
  }, [slides.length, current]); // current 의존으로 수동 조작 시 타이머 리셋

  const goTo = (index: number) => {
    setCurrent(index);
    resetAutoSlide();
  };

  const goNext = () => goTo((current + 1) % slides.length);
  const goPrev = () => goTo((current - 1 + slides.length) % slides.length);

  // 링크 핸들러 - 외부 URL은 새 창, 내부는 라우팅
  const handleLink = (url?: string) => {
    if (!url) return;
    if (url.startsWith('http')) {
      window.open(url, '_blank');
    } else {
      navigate(url);
    }
  };

  // 스와이프 지원 (터치)
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);
  const handleTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchMove = (e: React.TouchEvent) => { touchEndX.current = e.touches[0].clientX; };
  const handleTouchEnd = () => {
    const diff = touchStartX.current - touchEndX.current;
    if (Math.abs(diff) > 50) {
      diff > 0 ? goNext() : goPrev();
    }
  };

  if (slides.length === 0) {
    return (
      <div className="relative w-full h-[50vh] md:h-[60vh] bg-gray-100 flex items-center justify-center">
        <p className="text-gray-400">슬라이드를 불러오는 중...</p>
      </div>
    );
  }

  return (
    <div
      className="relative w-full h-[50vh] md:h-[60vh] overflow-hidden bg-gray-900"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={slides[current]?.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
          className="absolute inset-0"
        >
          {/* 배경 이미지 */}
          <img
            src={slides[current]?.imageUrl}
            alt={slides[current]?.title}
            className="w-full h-full object-cover"
          />
          {/* 다크 그라데이션 오버레이 */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

          {/* 텍스트 콘텐츠 - 좌하단 */}
          <div className="absolute bottom-12 left-6 md:left-12 right-24 md:right-auto max-w-lg">
            <h2 className="text-2xl md:text-4xl font-bold text-white mb-2 leading-tight">
              {slides[current]?.title}
            </h2>
            {slides[current]?.description && (
              <p className="text-sm md:text-base text-white/80 mb-4">
                {slides[current]?.description}
              </p>
            )}
          </div>

          {/* 바로가기 버튼 - 우하단 */}
          {slides[current]?.linkUrl && (
            <button
              onClick={() => handleLink(slides[current]?.linkUrl)}
              className="absolute bottom-12 right-6 md:right-12 px-6 py-3 bg-white text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-100 transition-colors"
            >
              바로가기 →
            </button>
          )}
        </motion.div>
      </AnimatePresence>

      {/* 좌우 화살표 */}
      {slides.length > 1 && (
        <>
          <button onClick={goPrev} className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-white/20 backdrop-blur-sm rounded-full text-white hover:bg-white/40 transition">
            <ChevronLeft size={24} />
          </button>
          <button onClick={goNext} className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-white/20 backdrop-blur-sm rounded-full text-white hover:bg-white/40 transition">
            <ChevronRight size={24} />
          </button>
        </>
      )}

      {/* 페이지 인디케이터 */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            className={`w-2 h-2 rounded-full transition-all ${
              i === current ? 'bg-white w-6' : 'bg-white/50'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
