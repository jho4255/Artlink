/**
 * HeroSlider - 히어로 배너 캐러셀
 *
 * CSS scroll-snap 기반 네이티브 캐러셀
 * - 마우스 드래그 + 터치 스와이프로 좌우 슬라이드
 * - IntersectionObserver로 현재 슬라이드 추적
 * - 3초 자동 슬라이드, current 변경 시 타이머 리셋
 * - 화살표, 인디케이터, 바로가기 링크
 *
 * @see CLAUDE.md - Hero Section 스펙
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/axios';
import type { HeroSlide } from '@/types';

export default function HeroSlider() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  // 프로그래밍 스크롤 중 observer 이벤트 무시용
  const isScrolling = useRef(false);
  // 마우스 드래그 상태
  const dragState = useRef({ isDragging: false, startX: 0, scrollLeft: 0, didDrag: false });

  const { data: slides = [] } = useQuery<HeroSlide[]>({
    queryKey: ['hero-slides'],
    queryFn: () => api.get('/hero-slides').then((r) => r.data),
  });

  // 특정 슬라이드로 스크롤
  const scrollToSlide = useCallback((index: number) => {
    const container = containerRef.current;
    if (!container) return;
    isScrolling.current = true;
    container.scrollTo({ left: index * container.offsetWidth, behavior: 'smooth' });
    setCurrent(index);
    setTimeout(() => { isScrolling.current = false; }, 500);
  }, []);

  // IntersectionObserver로 현재 슬라이드 감지
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

  // 3초 자동 슬라이드 (current 변경 시 타이머 리셋)
  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(() => {
      scrollToSlide((current + 1) % slides.length);
    }, 3000);
    return () => clearInterval(timer);
  }, [slides.length, current, scrollToSlide]);

  // ── 마우스 드래그 핸들러 (데스크톱) ──
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
    container.style.scrollSnapType = 'none'; // 드래그 중 snap 비활성화
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
    container.style.scrollSnapType = 'x mandatory'; // snap 복원 → 가장 가까운 슬라이드로 정렬
  };

  const handleMouseLeave = () => {
    if (dragState.current.isDragging) handleMouseUp();
  };

  // 링크 핸들러 (드래그 후 클릭 방지)
  const handleLink = (url?: string) => {
    if (!url || dragState.current.didDrag) return;
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
    <div className="relative w-full h-[50vh] md:h-[60vh] bg-gray-900">
      {/* scroll-snap 컨테이너 + 마우스 드래그 */}
      <div
        ref={containerRef}
        className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scrollbar-hide cursor-grab select-none"
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
            {/* 그래디언트 오버레이 */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent pointer-events-none" />

            {/* 텍스트 */}
            <div className="absolute bottom-12 left-6 md:left-12 right-24 md:right-auto max-w-lg pointer-events-none">
              <h2 className="text-2xl md:text-4xl font-bold text-white mb-2 leading-tight">
                {slide.title}
              </h2>
              {slide.description && (
                <p className="text-sm md:text-base text-white/80 mb-4">
                  {slide.description}
                </p>
              )}
            </div>

            {/* 바로가기 버튼 */}
            {slide.linkUrl && (
              <button
                onClick={() => handleLink(slide.linkUrl)}
                className="absolute bottom-12 right-6 md:right-12 px-6 py-3 bg-white text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-100 transition-colors"
              >
                바로가기 →
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
            className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-white/20 backdrop-blur-sm rounded-full text-white hover:bg-white/40 transition z-10"
          >
            <ChevronLeft size={24} />
          </button>
          <button
            onClick={() => scrollToSlide((current + 1) % slides.length)}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-white/20 backdrop-blur-sm rounded-full text-white hover:bg-white/40 transition z-10"
          >
            <ChevronRight size={24} />
          </button>
        </>
      )}

      {/* 페이지 인디케이터 */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => scrollToSlide(i)}
            className={`w-2 h-2 rounded-full transition-all ${
              i === current ? 'bg-white w-6' : 'bg-white/50'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
