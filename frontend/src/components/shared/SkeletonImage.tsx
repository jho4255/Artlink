import { useState } from 'react';
import { cn } from '@/lib/utils';

interface SkeletonImageProps {
  src: string;
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
}

/**
 * 이미지 파일이 실제로 로드 완료될 때까지 스켈레톤(펄스)을 보여주고,
 * 로드되면 페이드인하는 공용 이미지 컴포넌트.
 * - 래퍼가 크기를 잡으므로 className에 aspect/height 등을 지정한다.
 * - blurFill: object-contain일 때 빈 여백을 같은 이미지 블러로 채움.
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
}: SkeletonImageProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className={cn('relative overflow-hidden bg-gray-100', className)} onClick={onClick}>
      {!loaded && <div className="absolute inset-0 animate-pulse bg-gray-200/70" />}
      {blurFill && (
        <img
          src={src}
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
        src={src}
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
    </div>
  );
}
