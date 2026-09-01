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
  const isHovered = useRef(false);

  const { data: slides = [], isLoading } = useQuery<HeroSlide[]>({
    queryKey: ['hero-slides'],
    queryFn: () => api.get('/hero-slides').then((r) => r.data),
  });

  // 이미지 파일이 실제로 로드 완료됐는지 추적 (CDN 다운로드 동안 스켈레톤 유지)
  const [loadedImages, setLoadedImages] = useState<Set<number>>(new Set());
  const markLoaded = useCallback((i: number) => {
    setLoadedImages((prev) => {
      if (prev.has(i)) return prev;
      const next = new Set(prev);
      next.add(i);
      return next;
    });
  }, []);

  // 슬라이드 이미지에서 색상 추출
  useEffect(() => {
    if (slides.length === 0) return;
    Promise.all(slides.map((s) => extractColor(s.imageUrl))).then(setBgColors);
  }, [slides]);

  // 슬라이드 전환은 **직접 애니메이션**한다 — 브라우저 기본 smooth 는 속도를 못 정한다.
  // 900ms ease-in-out 으로 천천히·부드럽게 넘긴다(그림을 홱 넘기지 않게).
  const animRef = useRef<number | null>(null);
  const SLIDE_MS = 900;
  const scrollToSlide = useCallback((index: number) => {
    const container = containerRef.current;
    if (!container) return;
    isScrolling.current = true;
    setCurrent(index);
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const start = container.scrollLeft;
    const target = index * container.offsetWidth;
    const dist = target - start;
    if (Math.abs(dist) < 1) { isScrolling.current = false; return; }
    let startTs: number | null = null;
    const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const step = (ts: number) => {
      if (startTs === null) startTs = ts;
      const p = Math.min(1, (ts - startTs) / SLIDE_MS);
      container.scrollLeft = start + dist * easeInOut(p);
      if (p < 1) { animRef.current = requestAnimationFrame(step); }
      else { isScrolling.current = false; animRef.current = null; }
    };
    animRef.current = requestAnimationFrame(step);
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
    // 10초마다 자동 전환 (예전 3초는 그림을 볼 새도 없이 넘어갔다)
    const timer = setInterval(() => {
      if (!isHovered.current) scrollToSlide((current + 1) % slides.length);
    }, 10000);
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

  // 데이터 로딩 중이거나 슬라이드가 없으면 전체 스켈레톤
  if (isLoading || slides.length === 0) {
    return (
      <div className="w-full bg-gray-100">
        <div className="max-w-7xl mx-auto">
          <div className="aspect-[4/3] sm:aspect-[16/9] md:aspect-auto md:h-[46vh] bg-gray-100 animate-pulse" />
        </div>
      </div>
    );
  }

  /*
    배너는 **화면 전체 폭을 채우는 색 띠**(currentBg) 위에 컨텐츠를 가운데(max-w-7xl)로 둔다.
    화면이 넓어지면 컨텐츠 좌우는 이 배경색이 자동으로 채운다("좌우 자동확장").
    그라데이션·글로우는 없앴다 — 배너 이미지에 이미 디자인이 다 들어 있어서 덮을 이유가 없다.
    색은 슬라이드 이미지의 dominant color 라 이미지와 띠가 자연스럽게 이어진다.
  */
  return (
    <div className="w-full transition-colors duration-700" style={{ backgroundColor: currentBg }}>
      <div className="max-w-7xl mx-auto">
        <div
          className="group relative overflow-hidden"
          onMouseEnter={() => { isHovered.current = true; }}
          onMouseLeave={() => { isHovered.current = false; }}
        >
          <div
            ref={containerRef}
            className="flex w-full aspect-[4/3] sm:aspect-[16/9] md:aspect-auto md:h-[46vh] overflow-x-auto snap-x snap-mandatory scrollbar-hide cursor-grab select-none"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
          >
            {slides.map((slide, i) => (
              <div
                key={slide.id ?? i}
                data-index={i}
                className="relative w-full h-full flex-shrink-0 snap-start bg-gray-100"
              >
                {/* 이미지 다운로드 동안 스켈레톤 유지 */}
                {!loadedImages.has(i) && (
                  <div className="absolute inset-0 bg-gray-100 animate-pulse" />
                )}
                <img
                  src={slide.imageUrl}
                  alt={slide.title}
                  onLoad={() => markLoaded(i)}
                  onError={() => markLoaded(i)}
                  className={`w-full h-full object-cover pointer-events-none transition-opacity duration-500 ${loadedImages.has(i) ? 'opacity-100' : 'opacity-0'}`}
                  draggable={false}
                  loading={i === 0 ? 'eager' : 'lazy'}
                />
                {/* 텍스트
                    하단 그래디언트는 뺐다(2026-08-15) — 배너 이미지에 이미 디자인이 다 들어 있는데
                    어둡게 덮어서 아래쪽이 안 보였다. 대신 **글자에만** 그림자를 줘서 밝은 이미지 위에서도
                    읽히게 한다. 배경을 덮지 않으니 같은 문제가 다시 생기지 않는다. */}
                <div className="absolute bottom-12 md:bottom-16 left-5 md:left-10 right-5 md:right-auto max-w-xl pointer-events-none [text-shadow:0_1px_4px_rgba(0,0,0,0.55)]">
                  {slide.description && (
                    <p className="hidden sm:block text-[11px] md:text-xs tracking-[0.15em] uppercase text-white/80 mb-2">
                      {slide.description}
                    </p>
                  )}
                  <h2 className="text-lg md:text-3xl font-semibold text-white leading-snug pr-20 md:pr-0">
                    {slide.title}
                  </h2>
                </div>

                {/* 바로가기 */}
                {slide.linkUrl && (
                  <button
                    onClick={() => handleLink(slide.linkUrl)}
                    // p-3 + 네거티브 마진: 시각 위치는 유지하면서 터치 히트영역만 확대
                    className="absolute bottom-5 md:bottom-16 right-5 md:right-10 p-3 -m-3 text-white text-xs md:text-base tracking-wide hover:text-white transition-colors cursor-pointer underline underline-offset-4 decoration-white/60 hover:decoration-white [text-shadow:0_1px_4px_rgba(0,0,0,0.55)]"
                  >
                    자세히 보기 →
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* 좌우 화살표 — 세련되게. 평소엔 옅게, 호버 때만 또렷이(그림을 가리지 않게).
              44px 히트영역은 유지하되 보이는 원은 작게(28px), 채움 대신 얇은 아웃라인.
              데스크톱은 호버로 드러나고(opacity-0→100), 터치기기는 스와이프가 있어 아주 옅게만 둔다. */}
          {slides.length > 1 && (
            <>
              <button
                onClick={() => scrollToSlide((current - 1 + slides.length) % slides.length)}
                aria-label="이전 슬라이드"
                className="group/nav absolute left-2 md:left-4 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center z-10 cursor-pointer opacity-0 max-md:opacity-40 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-300"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/40 backdrop-blur-sm text-white/90 group-hover/nav:bg-white/30 transition-colors">
                  <ChevronLeft size={16} strokeWidth={2.2} />
                </span>
              </button>
              <button
                onClick={() => scrollToSlide((current + 1) % slides.length)}
                aria-label="다음 슬라이드"
                className="group/nav absolute right-2 md:right-4 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center z-10 cursor-pointer opacity-0 max-md:opacity-40 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-300"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/40 backdrop-blur-sm text-white/90 group-hover/nav:bg-white/30 transition-colors">
                  <ChevronRight size={16} strokeWidth={2.2} />
                </span>
              </button>
            </>
          )}

          {/* 인디케이터 — 시각은 2px 라인 유지, 버튼 패딩으로 터치 히트영역만 확대 */}
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex z-10">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => scrollToSlide(i)}
                aria-label={`${i + 1}번째 슬라이드로 이동`}
                className="py-4 px-1 min-h-[44px] flex items-center cursor-pointer"
              >
                <span
                  className={`block h-[2px] rounded-full transition-all ${
                    i === current ? 'bg-white w-6' : 'bg-white/40 w-3'
                  }`}
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
