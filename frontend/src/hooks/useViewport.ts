import { useEffect, useState } from 'react';

/** 창 크기(px)를 따라간다 — 넓은 화면이냐 좁은 화면이냐로 **다른 부품**을 그려야 할 때(패널 ↔ 시트). CSS 로 가를 수 있으면 CSS 를 쓸 것 */
export function useViewport() {
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return vp;
}
