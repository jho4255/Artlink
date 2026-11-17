import { useState } from 'react';
import { imageSources, sizesFor } from '@/lib/postLayout';
import type { FigureSize, PostImageAttrs } from '@/lib/postDoc';

/**
 * 글 안의 사진 한 장 — 편집기와 읽는 화면이 같이 쓴다.
 * - 글쓰기로 올린 사진(`large`)은 srcset(t800·t1280·원본)으로 화면 폭에 맞는 크기를 받는다.
 * - 썸네일이 없으면(옛 사진·생성 실패) 원본으로 되돌린다 — 후보 하나가 404 여도 사진이 깨지지 않게.
 * - 자리는 부모가 aspect-ratio 로 잡는다(늦게 떠도 글이 밀리지 않는다). 사진은 자르지 않는다.
 */
export default function PostImage({ attrs, size, columns = 1, alt, priority = false, className = '' }: {
  attrs: PostImageAttrs;
  size?: FigureSize;
  columns?: number;
  alt: string;
  priority?: boolean;
  className?: string;
}) {
  const srcs = imageSources(attrs);
  // 주소가 바뀌면(사진 바꾸기) 되돌림 상태를 새로 — key 대신 주소를 함께 기억한다
  const [failed, setFailed] = useState<string | null>(null);
  if (!srcs) return null;
  const fallback = failed === attrs.src;
  return (
    <img
      src={fallback ? srcs.fallback : srcs.src}
      srcSet={fallback ? undefined : srcs.srcSet}
      sizes={!fallback && srcs.srcSet ? sizesFor(size, columns) : undefined}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      draggable={false}
      onError={() => { if (!fallback && attrs.src) setFailed(attrs.src); }}
      className={`block h-full w-full ${className}`}
    />
  );
}
