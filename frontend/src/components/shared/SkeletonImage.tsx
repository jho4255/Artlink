import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { thumbUrl, type ThumbSize } from './Thumb';

interface SkeletonImageProps {
  src?: string | null;
  alt?: string;
  /** 래퍼(크기/비율/모양) 클래스 — 예: 'aspect-[4/3]', 'w-full h-48 rounded-lg', 'absolute inset-0' */
  className?: string;
  /** 내부 img 클래스 — object-fit/hover 등. 기본 object-cover */
  imgClassName?: string;
  /** contain 사용 시 레터박스 여백을 동일 이미지 블러로 채움 */
  blurFill?: boolean;
  loading?: 'eager' | 'lazy';
  draggable?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  /** src가 없을 때 '이미지 없음' 플레이스홀더에 표시할 라벨(예: 갤러리명) */
  fallbackLabel?: string;
  /**
   * 썸네일로 그린다(2026-11-15, 모집공고·갤러리 목록) — `Thumb` 와 같은 규칙: 썸네일이 없으면(404) 원본으로 한 번 더.
   * 목록 칸(92~380px)에 2000px 포스터 원본을 받던 것을 줄인다. 확대·상세의 큰 그림에는 넘기지 말 것(원본).
   */
  thumb?: ThumbSize;
}

/**
 * 이미지 파일이 실제로 로드 완료될 때까지 스켈레톤(펄스)을 보여주고,
 * 로드되면 페이드인하는 공용 이미지 컴포넌트.
 * - 래퍼가 크기를 잡으므로 className에 aspect/height 등을 지정한다.
 * - blurFill: object-contain일 때 빈 여백을 같은 이미지 블러로 채움.
 * - src가 비어있으면 가짜 샘플 이미지 대신 '이미지 없음' 플레이스홀더 표시.
 */
export default function SkeletonImage({
  src,
  alt = '',
  className,
  imgClassName = 'object-cover',
  blurFill = false,
  loading,
  draggable,
  onClick,
  fallbackLabel,
  thumb,
}: SkeletonImageProps) {
  const [loaded, setLoaded] = useState(false);
  // 로드 실패(404·URL 유실) 시 깨진 이미지 아이콘 대신 '이미지 없음' 플레이스홀더로 폴백
  const [errored, setErrored] = useState(false);

  // 썸네일이 없어서(404) 원본으로 되돌렸는가
  const [original, setOriginal] = useState(false);

  // 스와이퍼 등에서 src가 교체되면 스켈레톤/에러 상태 초기화 (렌더 중 상태 조정 패턴)
  const [prevSrc, setPrevSrc] = useState(src);
  if (prevSrc !== src) {
    setPrevSrc(src);
    setLoaded(false);
    setErrored(false);
    setOriginal(false);
  }

  const hasImage = !!(src && src.trim()) && !errored;
  const shown = hasImage && thumb && !original ? thumbUrl(src!, thumb) : src;
  const onFail = () => {
    if (shown !== src) { setOriginal(true); return; }   // 썸네일 없음 → 원본
    setLoaded(true);
    setErrored(true);
  };

  return (
    <div className={cn('relative overflow-hidden bg-gray-100', className)} onClick={onClick}>
      {!hasImage ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-gray-300 select-none px-3">
          <ImageOff size={26} strokeWidth={1.5} />
          {fallbackLabel
            ? <span className="text-[11px] text-gray-400 text-center line-clamp-1 max-w-full">{fallbackLabel}</span>
            : <span className="text-[11px] text-gray-400">이미지 없음</span>}
        </div>
      ) : (
        <>
          {!loaded && <div className="absolute inset-0 animate-pulse bg-gray-200/70" />}
          {blurFill && (
            <img
              src={shown!}
              alt=""
              aria-hidden
              draggable={false}
              className={cn(
                'absolute inset-0 w-full h-full object-cover blur-2xl scale-110 pointer-events-none transition-opacity duration-500',
                loaded ? 'opacity-50' : 'opacity-0',
              )}
            />
          )}
          <img
            src={shown!}
            alt={alt}
            loading={loading}
            draggable={draggable}
            onLoad={() => setLoaded(true)}
            onError={onFail}
            className={cn(
              'relative w-full h-full transition-opacity duration-500',
              imgClassName,
              loaded ? 'opacity-100' : 'opacity-0',
            )}
          />
        </>
      )}
    </div>
  );
}
