import { useEffect, useState } from 'react';

/**
 * 경력 블록을 몇 열로 나눌지 — 1024px↑ 3열, 640px↑ 2열, 그 아래 1열.
 * Tailwind 의 `sm`(640) / `lg`(1024) 와 **같은 경계**를 쓴다. 바꾸려면 양쪽을 같이 바꿀 것.
 *
 * CSS 만으로는 라운드로빈 배치를 못 한다(`lib/careerColumns.ts` 주석 참고) — 열 수를 알아야
 * 어느 항목이 어느 열에 갈지 정해지므로 폭을 JS 로 읽는다.
 */
export const columnsFor = (width: number) => (width >= 1024 ? 3 : width >= 640 ? 2 : 1);

export function useCareerColumns(): number {
  const [cols, setCols] = useState(() =>
    typeof window === 'undefined' ? 3 : columnsFor(window.innerWidth),
  );

  useEffect(() => {
    const update = () => setCols(columnsFor(window.innerWidth));
    update(); // 첫 렌더가 SSR/테스트 기본값(3)으로 잡혔을 수 있다
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return cols;
}
