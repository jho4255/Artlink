import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SkeletonImageProps {
  src?: string | null;
  alt?: string;
  /** 래퍼(크기/비율/모양) 클래스 — 예: 'aspect-[4/3]', 'w-full h-48 rounded-lg', 'absolute inset-0' */
  className?: string;
  /** 내부 img 클래스 — object-fit/hover 등. 기본 object-cover */
  imgClassName?: string;
  /** contain 사용 시 레터박스 여백을 동일 이미지 블러로 채움 */
  blurFill?: boolean;
  /** contain 사용 시 여백을 흰색으로 두고, 사진 가장자리를 흰색으로 부드럽게 그라데이션 블렌딩 */
  whiteFade?: boolean;
  loading?: 'eager' | 'lazy';
  draggable?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  /** src가 없을 때 '이미지 없음' 플레이스홀더에 표시할 라벨(예: 갤러리명) */
  fallbackLabel?: string;
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
  whiteFade = false,
  loading,
  draggable,
  onClick,
  fallbackLabel,
}: SkeletonImageProps) {
  const [loaded, setLoaded] = useState(false);
  const hasImage = !!(src && src.trim());

  return (
    <div className={cn('relative overflow-hidden', whiteFade ? 'bg-white' : 'bg-gray-100', className)} onClick={onClick}>
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
              src={src!}
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
            src={src!}
            alt={alt}
            loading={loading}
            draggable={draggable}
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
            className={cn(
              'relative w-full h-full transition-opacity duration-500',
              imgClassName,
              loaded ? 'opacity-100' : 'opacity-0',
            )}
          />
          {whiteFade && loaded && (
            /* 사진 가장자리를 흰색으로 부드럽게 그라데이션 블렌딩 (레터박스 여백 = 흰색) */
            <div
              className="absolute inset-0 pointer-events-none z-[1]"
              style={{ background: 'radial-gradient(130% 130% at 50% 50%, rgba(255,255,255,0) 58%, #ffffff 100%)' }}
            />
          )}
        </>
      )}
    </div>
  );
}
