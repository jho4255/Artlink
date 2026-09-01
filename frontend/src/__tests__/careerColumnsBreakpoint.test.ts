/**
 * 경력 열 수의 화면 폭 경계 — `hooks/useCareerColumns.ts` 의 `columnsFor`
 *
 * CSS 만으로는 이 배치를 못 한다(열 수를 알아야 어느 항목이 어느 열에 갈지 정해진다 —
 * `lib/careerColumns.ts` 참고). 그래서 폭을 JS 로 읽는데, 그러면 **Tailwind 의 경계와
 * 조용히 어긋날 수 있다.** 어긋나면 CSS 는 2열인데 JS 는 3열로 나눠 담아
 * 마지막 열이 통째로 빈 자리가 된다 — 에러는 안 난다.
 */
import { describe, it, expect } from 'vitest';
import { columnsFor } from '@/hooks/useCareerColumns';

describe('columnsFor — Tailwind sm(640)/lg(1024) 와 같은 경계', () => {
  it('lg(1024) 이상은 3열', () => {
    expect(columnsFor(1024)).toBe(3);
    expect(columnsFor(1440)).toBe(3);
    expect(columnsFor(1920)).toBe(3);
  });

  it('sm(640)~lg 사이는 2열', () => {
    expect(columnsFor(640)).toBe(2);
    expect(columnsFor(768)).toBe(2);
    expect(columnsFor(1023)).toBe(2);
  });

  it('sm 미만(휴대폰)은 1열', () => {
    expect(columnsFor(375)).toBe(1);   // iPhone SE / 기본 모바일 기준
    expect(columnsFor(414)).toBe(1);
    expect(columnsFor(639)).toBe(1);
  });

  it('★ 경계값이 Tailwind 와 정확히 같다 (경계에서 한 칸 어긋나면 빈 열이 생긴다)', () => {
    expect(columnsFor(639)).toBe(1);
    expect(columnsFor(640)).toBe(2);
    expect(columnsFor(1023)).toBe(2);
    expect(columnsFor(1024)).toBe(3);
  });

  it('폭이 커질수록 열이 줄지 않는다 (단조 증가)', () => {
    let prev = 0;
    for (let w = 300; w <= 2000; w += 17) {
      const c = columnsFor(w);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });

  it('이상한 폭(0·음수)에도 최소 1열은 준다 — 0열이면 경력이 통째로 사라진다', () => {
    expect(columnsFor(0)).toBe(1);
    expect(columnsFor(-100)).toBe(1);
  });
});
