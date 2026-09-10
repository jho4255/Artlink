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

  /**
   * 배너 높이는 **사진의 원래 비율**을 따른다 (2026-09-10).
   *
   * 예전엔 `aspect-[4/3] sm:aspect-[16/9]` 로 틀을 고정해 놓고 `object-cover` 라,
   * 창이 좁아지면 사진이 **잘렸다**. 실서버 배너는 2000×667(**3:1**)인데 모바일 틀이 4/3(1.33)이라
   * **가로의 56% 가 잘려 나갔다**(보이는 건 44%). 창을 줄이면 사진도 같이 작아져야지 잘리면 안 된다.
   *
   * ⚠️ 슬라이드는 한 트랙을 공유하므로 높이도 하나뿐이다. **가장 세로로 긴 사진**(=비율 최소)에 맞춘다 —
   *    그래야 나머지가 위아래로 넘치지 않는다. 남는 자리는 `object-contain` + 띠 배경색(dominant color)이 먹는다.
   * ⚠️ 극단적인 업로드를 대비해 [1.2, 3.4] 로 묶는다. 세로 사진 한 장 때문에 배너가 화면을 삼키면 안 된다.
   */
  const [ratio, setRatio] = useState<number | null>(null);
  const noteRatio = useCallback((w: number, h: number) => {
    if (!w || !h) return;
    const r = Math.min(3.4, Math.max(1.2, w / h));
    setRatio((prev) => (prev === null ? r : Math.min(prev, r)));
  }, []);
  // 아직 한 장도 못 쟀으면 실서버 배너 비율(3:1)로 시작한다 — 뜨자마자 튀는 걸 줄인다
  const trackRatio = ratio ?? 3;

  /**
   * 띠가 얇으면 **글씨를 사진 위에 얹지 않는다** (2026-09-10).
   *
   * 사진을 안 자르게 되니 3:1 배너는 375px 화면에서 높이가 **125px** 밖에 안 된다.
   * 거기에 흰 제목을 얹으면 배너가 이미 갖고 있는 디자인·글씨와 겹쳐 둘 다 안 읽힌다
   * (2026-08-15 에 하단 그래디언트를 뺀 것과 같은 이유 — 배너엔 이미 디자인이 다 들어 있다).
   * 그럴 땐 제목·바로가기를 **사진 아래 띠 색 위로** 내린다.
   *
   * ⚠️ 화면 폭이 아니라 **실제 높이**로 판정할 것 — 같은 폭이라도 배너 비율에 따라 높이가 다르다.
   */
  const [trackH, setTrackH] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setTrackH(entry!.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [slides.length]);
  const compact = trackH > 0 && trackH < 200;
  const currentSlide = slides[current];

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
          {/* 스켈레톤도 본체와 같은 규칙으로 — 다르면 뜨는 순간 높이가 튄다 */}
          <div
            style={{ aspectRatio: String(trackRatio) }}
            className="max-h-[70vh] md:max-h-[46vh] bg-gray-100 animate-pulse"
          />
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
          {/* 높이는 `aspectRatio`(사진 원래 비율)가 정한다. min/max 는 극단만 막는 안전선이고,
              그 구간에 걸려 틀이 사진보다 넓어져도 `object-contain` 이라 **잘리지는 않는다**(띠 배경이 채운다). */}
          <div
            ref={containerRef}
            style={{ aspectRatio: String(trackRatio) }}
            className="flex w-full max-h-[70vh] md:max-h-[46vh] overflow-x-auto snap-x snap-mandatory scrollbar-hide cursor-grab select-none"
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
                {/* ⚠️ `object-cover` 로 되돌리지 말 것 — 창이 좁아지면 사진이 잘린다(위 `ratio` 주석 참고) */}
                <img
                  src={slide.imageUrl}
                  alt={slide.title}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    noteRatio(img.naturalWidth, img.naturalHeight);
                    markLoaded(i);
                  }}
                  onError={() => markLoaded(i)}
                  className={`w-full h-full object-contain pointer-events-none transition-opacity duration-500 ${loadedImages.has(i) ? 'opacity-100' : 'opacity-0'}`}
                  draggable={false}
                  loading={i === 0 ? 'eager' : 'lazy'}
                />
                {/* 텍스트
                    하단 그래디언트는 뺐다(2026-08-15) — 배너 이미지에 이미 디자인이 다 들어 있는데
                    어둡게 덮어서 아래쪽이 안 보였다. 대신 **글자에만** 그림자를 줘서 밝은 이미지 위에서도
                    읽히게 한다. 배경을 덮지 않으니 같은 문제가 다시 생기지 않는다. */}
                <div className={`absolute bottom-12 md:bottom-16 left-5 md:left-10 right-5 md:right-auto max-w-xl pointer-events-none [text-shadow:0_1px_4px_rgba(0,0,0,0.55)] ${compact ? 'hidden' : ''}`}>
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
                {slide.linkUrl && !compact && (
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

          {/* 인디케이터 — 시각은 2px 라인 유지, 버튼 패딩으로 터치 히트영역만 확대.
              얇은 배너에서는 사진 위에 점이 얹히면 그림을 가리므로 아래 캡션 줄로 옮긴다. */}
          <div className={`absolute bottom-1.5 left-1/2 -translate-x-1/2 flex z-10 ${compact ? 'hidden' : ''}`}>
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

        {/*
          얇은 배너의 캡션 줄 — 사진 **아래**, 띠 색 위에 놓는다.
          사진 위에 얹으면 배너 자체 디자인과 겹쳐 둘 다 안 읽힌다(위 `compact` 주석 참고).
          ⚠️ 여기 글씨는 띠 색(dominant color) 위에 놓이므로 흰색 + 그림자로 고정한다 —
             띠 색이 밝을 수도 있어 그림자를 빼면 대비가 무너진다.
        */}
        {compact && currentSlide && (
          <div className="flex items-center gap-3 px-5 pb-2.5 pt-2 [text-shadow:0_1px_3px_rgba(0,0,0,0.5)]">
            <div className="min-w-0 flex-1">
              {currentSlide.description && (
                <p className="truncate text-[10px] uppercase tracking-[0.14em] text-white/75">{currentSlide.description}</p>
              )}
              <h2 className="truncate text-sm font-semibold text-white">{currentSlide.title}</h2>
            </div>
            {slides.length > 1 && (
              <div className="flex shrink-0 items-center">
                {slides.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => scrollToSlide(i)}
                    aria-label={`${i + 1}번째 슬라이드로 이동`}
                    className="flex min-h-[44px] cursor-pointer items-center px-1 py-4"
                  >
                    <span className={`block h-[2px] rounded-full transition-all ${i === current ? 'w-5 bg-white' : 'w-2.5 bg-white/40'}`} />
                  </button>
                ))}
              </div>
            )}
            {currentSlide.linkUrl && (
              <button
                onClick={() => handleLink(currentSlide.linkUrl)}
                className="-m-2 shrink-0 cursor-pointer p-2 text-xs tracking-wide text-white underline decoration-white/60 underline-offset-4 hover:decoration-white"
              >
                자세히 보기 →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
