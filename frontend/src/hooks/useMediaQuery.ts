import { useSyncExternalStore } from 'react';

/**
 * 미디어 쿼리가 맞는가 — 화면 폭이 바뀌면 다시 그린다.
 * (HeroSlider 에는 같은 일을 하는 지역 함수가 따로 있다 — 그쪽은 건드리지 않았다)
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !('matchMedia' in window)) return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => typeof window !== 'undefined' && 'matchMedia' in window && window.matchMedia(query).matches,
    () => false,
  );
}
