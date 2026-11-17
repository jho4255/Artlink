/**
 * 소식 사진 한 장 + 사진 위 글 (2026-11-14, 규칙 81) — 카드·보기 화면·올리기 화면이 **같은 부품**을 쓴다.
 * 그래야 올릴 때 놓은 글이 홈 카드에서도 보기 화면에서도 같은 자리·같은 비율로 보인다.
 *
 * - 사진은 자르지 않는다(contain, 규칙 18). 글은 사진이 **실제로 그려진 자리**(`containBox`) 안에 얹는다 —
 *   상자 전체 기준으로 얹으면 세로 사진 옆 빈 자리에 글이 떠 버린다.
 * - 글자 크기는 사진 폭에 비례(`overlayFontPx`) — 148px 카드와 화면 가득한 보기 화면이 같은 모양.
 * - 글은 진짜 글자(DOM)라 화면 낭독기가 읽고, 사진 원본은 그대로 남는다(작품 사진에 글을 구워 넣지 않는다).
 */
import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import Thumb from '@/components/shared/Thumb';
import { containBox, overlayFontPx, type StoryOverlay } from '@/lib/story';

export type PhotoBox = { left: number; top: number; width: number; height: number };

/** 사진 위 글 한 줄 — 가운데가 (x, y). `w-max` 라야 오른쪽 끝 가까이 놓아도 좁게 꺾이지 않는다(폭 상한은 사진의 88%) */
export function OverlayText({ o, boxWidth, className = '', ...rest }: { o: Pick<StoryOverlay, 'text' | 'x' | 'y' | 'size' | 'style'>; boxWidth: number; className?: string } & HTMLAttributes<HTMLSpanElement>) {
  const look = o.style === 'dark'
    ? 'rounded-[0.3em] bg-black/75 px-[0.5em] py-[0.22em] text-white'
    : o.style === 'light'
      ? 'rounded-[0.3em] bg-white/90 px-[0.5em] py-[0.22em] text-gray-900'
      : 'text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.7)]';
  return (
    <span
      {...rest}
      data-story-overlay
      style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, fontSize: overlayFontPx(o.size, boxWidth) }}
      className={`absolute w-max max-w-[88%] -translate-x-1/2 -translate-y-1/2 whitespace-pre-wrap break-keep text-center font-bold leading-[1.35] [overflow-wrap:anywhere] ${look} ${className}`}
    >
      {o.text}
    </span>
  );
}

export default function StoryPhoto({ src, size = 'orig', overlay, alt, className = '', imgClassName = '', loading, onLoad, onError, children }: {
  src: string;
  /** 'grid' = t800 썸네일(카드), 'orig' = 원본(보기·올리기 화면) */
  size?: 'orig' | 'grid';
  overlay?: Pick<StoryOverlay, 'text' | 'x' | 'y' | 'size' | 'style'>;
  alt: string;
  className?: string;
  imgClassName?: string;
  loading?: 'lazy' | 'eager';
  onLoad?: () => void;
  onError?: () => void;
  /** 사진이 그려진 자리 위에 더 얹을 것(올리기 화면의 끌어 옮기기) — 그 자리를 받는다 */
  children?: (box: PhotoBox) => ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [cont, setCont] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setCont((c) => (c.w === el.clientWidth && c.h === el.clientHeight ? c : { w: el.clientWidth, h: el.clientHeight })));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const box = nat && cont.w ? containBox(nat.w, nat.h, cont.w, cont.h) : null;
  const loaded = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const im = e.currentTarget;
    if (im.naturalWidth) setNat({ w: im.naturalWidth, h: im.naturalHeight });
    onLoad?.();
  };
  const imgCls = `h-full w-full object-contain ${imgClassName}`;
  return (
    <div ref={wrap} className={`absolute inset-0 ${className}`}>
      {size === 'grid'
        ? <Thumb src={src} size="grid" alt={alt} loading={loading} draggable={false} onLoad={loaded} className={imgCls} />
        : <img src={src} alt={alt} loading={loading} draggable={false} onLoad={loaded} onError={onError} className={imgCls} />}
      {box && (overlay || children) && (
        <div className="pointer-events-none absolute" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
          {overlay && <OverlayText o={overlay} boxWidth={box.width} />}
          {children?.(box)}
        </div>
      )}
    </div>
  );
}
