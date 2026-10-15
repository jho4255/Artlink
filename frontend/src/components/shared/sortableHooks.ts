import { createContext, useContext, useEffect, useState, type CSSProperties } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * 끌어서 옮기기의 훅·문맥 — 그리는 쪽은 `SortableTiles.tsx` 의 `SortableArea`(규칙과 이유도 거기).
 * 컴포넌트 파일과 나눈 건 개발 서버의 Fast Refresh 규칙 때문이다(한 파일에서 컴포넌트와 훅을 함께 내보내면 다시 그리기가 통째로 일어난다).
 */

const FINE = '(hover: hover) and (pointer: fine)';
/** 마우스로 쓰는 화면인가 — 안내 문구를 '끌어서' / '길게 눌러 끌어서' 로 가른다 */
export function useFinePointer(): boolean {
  const [fine, setFine] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(FINE).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(FINE);
    if (!mq) return;
    const on = () => setFine(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', on); else mq.addListener?.(on);
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', on); else mq.removeListener?.(on); };
  }, []);
  return fine;
}

export const DropCtx = createContext<() => boolean>(() => false);
/** 방금 끌어서 놓았는가 — 칸의 onClick 이 맨 앞에서 본다 */
export const useJustDropped = () => useContext(DropCtx);


/**
 * 끌 수 있는 칸 하나. `itemRef`·`itemStyle` 은 칸 전체(자리를 비켜 주며 움직인다)에, `handle` 은 **잡는 곳**(작품 사진)에 붙인다.
 * 잡는 곳에는 화면 낭독 안내(aria-describedby)만 붙이고 dnd-kit 의 role·tabIndex 는 붙이지 않는다 — 그 자리는 원래 버튼이다.
 */
export function useSortableTile(id: number) {
  const s = useSortable({ id });
  const itemStyle: CSSProperties = {
    transform: CSS.Translate.toString(s.transform),
    transition: s.transition,
    // 끄는 동안 원래 자리는 흐린 자리표시로 남는다(따라오는 그림은 DragOverlay)
    opacity: s.isDragging ? 0.3 : undefined,
  };
  return {
    itemRef: s.setNodeRef,
    itemStyle,
    handle: { ref: s.setActivatorNodeRef, ...s.listeners, 'aria-describedby': s.attributes['aria-describedby'] },
    isDragging: s.isDragging,
  };
}
