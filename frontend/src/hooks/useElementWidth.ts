import { useLayoutEffect, useRef, useState } from 'react';

/**
 * 요소의 폭을 따라간다 (2026-10-03, 포트폴리오 만들기 화면).
 * 쪽 미리보기는 판형 크기(px) 그대로 그린 뒤 `transform: scale` 로 줄이므로, 배율을 정하려면 칸의 폭을 알아야 한다 —
 * CSS 만으로는 못 맞춘다. 첫 그리기 전에 한 번 재서(useLayoutEffect) 잘못된 크기로 번쩍이지 않게 한다.
 */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}
