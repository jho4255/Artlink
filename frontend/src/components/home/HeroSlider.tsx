/**
 * HeroSlider - 히어로 배너 캐러셀
 *
 * CSS scroll-snap 기반 네이티브 캐러셀
 * - 마우스 드래그 + 터치 스와이프로 좌우 슬라이드
 * - IntersectionObserver로 현재 슬라이드 추적
 * - 3초 자동 슬라이드, current 변경 시 타이머 리셋
 * - 이미지 dominant color 추출 → 배경 그라데이션 적용
 *
 * @see CLAUDE.md - Hero Section 스펙
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/axios';
import { extractColor } from '@/lib/extractColor';
import type { HeroSlide } from '@/types';

export default function HeroSlider() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [bgColors, setBgColors] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const isScrolling = useRef(false);
  const dragState = useRef({ isDragging: false, startX: 0, scrollLeft: 0, didDrag: false });

  const { data: slides = [] } = useQuery<HeroSlide[]>({
    queryKey: ['hero-slides'],
    queryFn: () => api.get('/hero-slides').then((r) => r.data),
  });

  // 슬라이드 이미지에서 색상 추출
  useEffect(() => {
    if (slides.length === 0) return;
    Promise.all(slides.map((s) => extractColor(s.imageUrl))).then(setBgColors);
  }, [slides]);

  const scrollToSlide = useCallback((index: number) => {
    const container = containerRef.current;
    if (!container) return;
    isScrolling.current = true;
    container.scrollTo({ left: index * container.offsetWidth, behavior: 'smooth' });
    setCurrent(index);
    setTimeout(() => { isScrolling.current = false; }, 500);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || slides.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (isScrolling.current) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const index = Number((entry.target as HTMLElement).dataset.index);
            if (!isNaN(index)) setCurrent(index);
          }
        }
      },
      { root: container, threshold: 0.5 }
    );
    const children = container.querySelectorAll('[data-index]');
    children.forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [slides.length]);

  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(() => {
      scrollToSlide((current + 1) % slides.length);
    }, 3000);
    return () => clearInterval(timer);
  }, [slides.length, current, scrollToSlide]);

  const handleMouseDown = (e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;
    dragState.current = {
      isDragging: true,
      startX: e.pageX - container.offsetLeft,
      scrollLeft: container.scrollLeft,
      didDrag: false,
    };
    container.style.cursor = 'grabbing';
    container.style.scrollSnapType = 'none';
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragState.current.isDragging) return;
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const x = e.pageX - container.offsetLeft;
    const walk = x - dragState.current.startX;
    if (Math.abs(walk) > 5) dragState.current.didDrag = true;
    container.scrollLeft = dragState.current.scrollLeft - walk;
  };

  const handleMouseUp = () => {
    if (!dragState.current.isDragging) return;
    dragState.current.isDragging = false;
    const container = containerRef.current;
    if (!container) return;
    container.style.cursor = '';
    container.style.scrollSnapType = 'x mandatory';
  };

  const handleMouseLeave = () => {
    if (dragState.current.isDragging) handleMouseUp();
  };

  const handleLink = (url?: string) => {
    if (!url || dragState.current.didDrag) return;
    if (url.startsWith('http')) {
      window.open(url, '_blank');
    } else {
      navigate(url);
    }
  };

  const currentBg = bgColors[current] || '#1a1a2e';

  if (slides.length === 0) {
    return (
      <div className="relative w-full h-[60vh] md:h-[70vh] bg-neutral-900 flex items-center justify-center">
        <p className="text-gray-400 text-sm tracking-wide">Loading...</p>
      </div>
    );
  }

  return (
    <div className="relative w-full bg-white">
      {/* 배경색 레이어 — 상단만 채우고 하단은 흰색으로 fade */}
      <div
        className="absolute inset-0 transition-colors duration-700"
        style={{ backgroundColor: currentBg }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white" />

      {/* 콘텐츠 */}
      <div className="relative z-10 pt-6 md:pt-10 pb-12 md:pb-16">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="relative overflow-hidden rounded-lg shadow-2xl">
          <div
            ref={containerRef}
            className="flex w-full h-[50vh] md:h-[60vh] overflow-x-auto snap-x snap-mandatory scrollbar-hide cursor-grab select-none"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
          >
            {slides.map((slide, i) => (
              <div
                key={slide.id ?? i}
                data-index={i}
                className="relative w-full h-full flex-shrink-0 snap-start"
              >
                <img
                  src={slide.imageUrl}
                  alt={slide.title}
                  className="w-full h-full object-cover pointer-events-none"
                  draggable={false}
                />
                {/* 하단 그래디언트 */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />

                {/* 텍스트 */}
                <div className="absolute bottom-14 md:bottom-16 left-6 md:left-10 right-6 md:right-auto max-w-xl pointer-events-none">
                  {slide.description && (
                    <p className="text-[11px] md:text-xs tracking-[0.15em] uppercase text-white/60 mb-2">
                      {slide.description}
                    </p>
                  )}
                  <h2 className="text-xl md:text-3xl font-semibold text-white leading-snug">
                    {slide.title}
                  </h2>
                </div>

                {/* 바로가기 */}
                {slide.linkUrl && (
                  <button
                    onClick={() => handleLink(slide.linkUrl)}
                    className="absolute bottom-14 md:bottom-16 right-6 md:right-10 text-white/80 text-sm md:text-base tracking-wide hover:text-white transition-colors cursor-pointer underline underline-offset-4 decoration-white/40 hover:decoration-white"
                  >
                    자세히 보기 →
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* 좌우 화살표 */}
          {slides.length > 1 && (
            <>
              <button
                onClick={() => scrollToSlide((current - 1 + slides.length) % slides.length)}
                className="absolute left-3 top-1/2 -translate-y-1/2 p-2 bg-black/20 backdrop-blur-sm rounded-full text-white/70 hover:text-white hover:bg-black/40 transition-all z-10 cursor-pointer"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={() => scrollToSlide((current + 1) % slides.length)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-black/20 backdrop-blur-sm rounded-full text-white/70 hover:text-white hover:bg-black/40 transition-all z-10 cursor-pointer"
              >
                <ChevronRight size={18} />
              </button>
            </>
          )}

          {/* 인디케이터 */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => scrollToSlide(i)}
                className={`h-[2px] rounded-full transition-all cursor-pointer ${
                  i === current ? 'bg-white w-6' : 'bg-white/40 w-3'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      </div>
    </div>
  );
}
