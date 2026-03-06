/**
 * HeroSlider - 히어로 배너 슬라이더
 *
 * 기능:
 *  - translateX 기반 슬라이딩 (opacity fade → 실제 슬라이드 전환)
 *  - Framer Motion drag="x" 실시간 드래그 추종 (마우스+터치 모두 지원)
 *  - spring 물리 애니메이션 (stiffness:300, damping:30)
 *  - 3초 자동 슬라이드, 수동 조작 시 타이머 리셋
 *  - 화살표 버튼, 점 인디케이터, 링크 핸들러
 *
 * @see CLAUDE.md - Hero Section 스펙
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, useAnimation, useMotionValue, PanInfo } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/axios';
import type { HeroSlide } from '@/types';

const SPRING = { type: 'spring' as const, stiffness: 300, damping: 30 };
const DRAG_THRESHOLD = 0.2; // 20% of container width
const VELOCITY_THRESHOLD = 500; // px/s

export default function HeroSlider() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const controls = useAnimation();
  const dragX = useMotionValue(0);
  const isDragging = useRef(false); // 드래그 중 링크 클릭 방지

  const { data: slides = [] } = useQuery<HeroSlide[]>({
    queryKey: ['hero-slides'],
    queryFn: () => api.get('/hero-slides').then((r) => r.data),
  });

  // 컨테이너 너비 측정 (마운트 + resize)
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) setContainerWidth(containerRef.current.offsetWidth);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // 슬라이드 위치로 애니메이션
  const animateTo = useCallback((index: number) => {
    if (containerWidth === 0) return;
    controls.start({ x: -index * containerWidth, transition: SPRING });
  }, [controls, containerWidth]);

  // current 또는 containerWidth 변경 시 애니메이션
  useEffect(() => {
    animateTo(current);
  }, [current, animateTo]);

  // 3초 자동 슬라이드 (수동 조작 시 타이머 리셋)
  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(() => {
      setCurrent((prev) => (prev + 1) % slides.length);
    }, 3000);
    return () => clearInterval(timer);
  }, [slides.length, current]);

  const goTo = (index: number) => setCurrent(index);
  const goNext = () => goTo((current + 1) % slides.length);
  const goPrev = () => goTo((current - 1 + slides.length) % slides.length);

  // 드래그 시작
  const handleDragStart = () => { isDragging.current = true; };

  // 드래그 종료 판정
  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    // 짧은 지연으로 드래그 직후 click 이벤트 억제
    setTimeout(() => { isDragging.current = false; }, 100);

    const w = containerWidth || 1;
    const offsetRatio = Math.abs(info.offset.x) / w;
    const velocityAbs = Math.abs(info.velocity.x);

    if (offsetRatio > DRAG_THRESHOLD || velocityAbs > VELOCITY_THRESHOLD) {
      if (info.offset.x > 0 && current > 0) {
        goTo(current - 1);
      } else if (info.offset.x < 0 && current < slides.length - 1) {
        goTo(current + 1);
      } else {
        animateTo(current);
      }
    } else {
      animateTo(current);
    }
  };

  // 링크 핸들러 - 드래그 중이면 무시, 외부 URL은 새 창, 내부는 라우팅
  const handleLink = (url?: string) => {
    if (!url || isDragging.current) return;
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
      ref={containerRef}
      className="relative w-full h-[50vh] md:h-[60vh] overflow-hidden bg-gray-900"
    >
      {/* 가로 스트립: 모든 슬라이드 나열 */}
      <motion.div
        className="flex h-full"
        style={{ width: `${slides.length * 100}%`, x: dragX }}
        animate={controls}
        drag={slides.length > 1 ? 'x' : false}
        dragConstraints={containerWidth > 0
          ? { left: -(slides.length - 1) * containerWidth, right: 0 }
          : undefined}
        dragElastic={0.1}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {slides.map((slide) => (
          <div
            key={slide.id}
            className="relative h-full flex-none"
            style={{ width: `${100 / slides.length}%` }}
          >
            {/* 배경 이미지 */}
            <img
              src={slide.imageUrl}
              alt={slide.title}
              className="w-full h-full object-cover pointer-events-none"
              draggable={false}
            />
            {/* 다크 그라데이션 오버레이 */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

            {/* 텍스트 콘텐츠 - 좌하단 */}
            <div className="absolute bottom-12 left-6 md:left-12 right-24 md:right-auto max-w-lg">
              <h2 className="text-2xl md:text-4xl font-bold text-white mb-2 leading-tight">
                {slide.title}
              </h2>
              {slide.description && (
                <p className="text-sm md:text-base text-white/80 mb-4">
                  {slide.description}
                </p>
              )}
            </div>

            {/* 바로가기 버튼 - 우하단 */}
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
      </motion.div>

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
