/**
 * HeroSlider - 히어로 배너 슬라이더
 *
 * AnimatePresence + direction 기반 translateX 전환
 * - drag 미사용 (Framer Motion drag+animate 충돌 문제 해결)
 * - 터치 스와이프는 수동 onTouchStart/End로 처리
 * - 3초 자동 슬라이드, 수동 조작 시 타이머 리셋
 * - 화살표, 인디케이터, 바로가기 링크
 *
 * @see CLAUDE.md - Hero Section 스펙
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/axios';
import type { HeroSlide } from '@/types';

// direction: 1=오른쪽으로 진행(다음), -1=왼쪽으로 진행(이전)
const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? '100%' : '-100%', opacity: 0.3 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? '-100%' : '100%', opacity: 0.3 }),
};
const TRANSITION = { type: 'spring' as const, stiffness: 300, damping: 30 };

export default function HeroSlider() {
  const navigate = useNavigate();
  const [[current, direction], setSlide] = useState([0, 0]);
  const touchStartX = useRef(0);

  const { data: slides = [] } = useQuery<HeroSlide[]>({
    queryKey: ['hero-slides'],
    queryFn: () => api.get('/hero-slides').then((r) => r.data),
  });

  const goTo = useCallback((index: number, dir: number) => {
    setSlide([index, dir]);
  }, []);

  const goNext = useCallback(() => {
    if (slides.length <= 1) return;
    setSlide(([prev]) => [(prev + 1) % slides.length, 1]);
  }, [slides.length]);

  const goPrev = useCallback(() => {
    if (slides.length <= 1) return;
    setSlide(([prev]) => [(prev - 1 + slides.length) % slides.length, -1]);
  }, [slides.length]);

  // 3초 자동 슬라이드 (current 변경 시 타이머 리셋)
  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(goNext, 3000);
    return () => clearInterval(timer);
  }, [slides.length, current, goNext]);

  // 터치 스와이프
  const handleTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      diff > 0 ? goNext() : goPrev();
    }
  };

  // 링크 핸들러
  const handleLink = (url?: string) => {
    if (!url) return;
    if (url.startsWith('http')) {
      window.open(url, '_blank');
    } else {
      navigate(url);
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
      onTouchEnd={handleTouchEnd}
    >
      <AnimatePresence initial={false} custom={direction} mode="popLayout">
        <motion.div
          key={current}
          custom={direction}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={TRANSITION}
          className="absolute inset-0"
        >
          <img
            src={slides[current]?.imageUrl}
            alt={slides[current]?.title}
            className="w-full h-full object-cover"
            draggable={false}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

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
          <button onClick={goPrev} className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-white/20 backdrop-blur-sm rounded-full text-white hover:bg-white/40 transition z-10">
            <ChevronLeft size={24} />
          </button>
          <button onClick={goNext} className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-white/20 backdrop-blur-sm rounded-full text-white hover:bg-white/40 transition z-10">
            <ChevronRight size={24} />
          </button>
        </>
      )}

      {/* 페이지 인디케이터 */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i, i > current ? 1 : -1)}
            className={`w-2 h-2 rounded-full transition-all ${
              i === current ? 'bg-white w-6' : 'bg-white/50'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
