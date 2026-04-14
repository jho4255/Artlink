/**
 * ImageLightbox - 이미지 확대 모달
 *
 * 기능:
 *  - Portal로 렌더링 (z-index 문제 방지)
 *  - Framer Motion 애니메이션 (scale + opacity)
 *  - 좌우 화살표 탐색, 터치 스와이프
 *  - Escape 키 / 배경 클릭으로 닫기
 *  - 스크롤 잠금
 *
 * 주의: 부모에서 AnimatePresence로 감싸야 exit 애니메이션 동작
 * @usage
 *   <AnimatePresence>
 *     {lightbox && <ImageLightbox images={urls} initialIndex={0} onClose={() => set(null)} />}
 *   </AnimatePresence>
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

interface ImageLightboxProps {
  images: string[];
  initialIndex: number;
  onClose: () => void;
}

export default function ImageLightbox({ images, initialIndex, onClose }: ImageLightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const touchStartX = useRef(0);
  const didSwipe = useRef(false); // 스와이프 vs 탭 구분

  // 스크롤 잠금
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // 키보드 이벤트
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowLeft' && images.length > 1) setIndex(i => (i - 1 + images.length) % images.length);
    if (e.key === 'ArrowRight' && images.length > 1) setIndex(i => (i + 1) % images.length);
  }, [onClose, images.length]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // 터치 스와이프 (스와이프 시 onClick close 방지)
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    didSwipe.current = false;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50 && images.length > 1) {
      didSwipe.current = true;
      diff > 0
        ? setIndex(i => (i + 1) % images.length)
        : setIndex(i => (i - 1 + images.length) % images.length);
    }
  };

  // 배경 클릭 닫기 (스와이프가 아닌 경우만)
  const handleBackdropClick = () => {
    if (!didSwipe.current) onClose();
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90"
      onClick={handleBackdropClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* 닫기 버튼 */}
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="닫기"
        className="absolute top-4 right-4 p-2 text-white/80 hover:text-white z-10"
      >
        <X size={28} />
      </button>

      {/* 카운터 */}
      {images.length > 1 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/70 text-sm z-10">
          {index + 1} / {images.length}
        </div>
      )}

      {/* 이미지 */}
      <motion.img
        key={index}
        src={images[index]}
        alt=""
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg"
        onClick={e => e.stopPropagation()}
      />

      {/* 좌우 화살표 */}
      {images.length > 1 && (
        <>
          <button
            onClick={e => { e.stopPropagation(); setIndex(i => (i - 1 + images.length) % images.length); }}
            aria-label="이전 이미지"
            className="absolute left-3 top-1/2 -translate-y-1/2 p-2 bg-white/20 backdrop-blur-sm rounded-full text-white hover:bg-white/40 z-10"
          >
            <ChevronLeft size={24} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); setIndex(i => (i + 1) % images.length); }}
            aria-label="다음 이미지"
            className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-white/20 backdrop-blur-sm rounded-full text-white hover:bg-white/40 z-10"
          >
            <ChevronRight size={24} />
          </button>
        </>
      )}
    </motion.div>,
    document.body
  );
}
