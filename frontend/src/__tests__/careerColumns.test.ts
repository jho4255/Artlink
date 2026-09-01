/**
 * 경력 열 배치 (lib/careerColumns.ts)
 *
 * 실제 데이터가 계기다 — 단체전은 20줄인데 개인전·아트페어는 2~3줄이라,
 * grid 로 그리면 '수상 및 선정'이 개인전에서 한참 떨어져 보였다.
 */
import { describe, it, expect } from 'vitest';
import { splitIntoColumns } from '@/lib/careerColumns';

const CAREER = ['학력', '개인전', '단체전', '아트페어', '수상 및 선정'];

describe('splitIntoColumns', () => {
  it('★ 3열에서 [수상 및 선정]이 [개인전] 바로 아래에 온다', () => {
    const cols = splitIntoColumns(CAREER, 3);
    expect(cols).toEqual([
      ['학력', '아트페어'],
      ['개인전', '수상 및 선정'],
      ['단체전'],
    ]);
    const withSolo = cols.find(c => c.includes('개인전'))!;
    expect(withSolo[withSolo.indexOf('개인전') + 1]).toBe('수상 및 선정');
  });

  it('★ 2열에서 긴 단체전 아래로 다른 항목이 밀리지 않는다 (무게 = 줄 수)', () => {
    // 실측 데이터: 단체전만 20줄, 나머지는 3줄. 단순 라운드로빈이면
    // 열0=[학력,단체전,수상](26줄) / 열1=[개인전,아트페어](6줄) 이 되어
    // 수상이 개인전에서 1180px 떨어지고 오른쪽이 텅 빈다.
    const lines: Record<string, number> = { 학력: 3, 개인전: 3, 단체전: 20, 아트페어: 3, '수상 및 선정': 3 };
    expect(splitIntoColumns(CAREER, 2, (c) => lines[c])).toEqual([
      ['학력', '단체전'],
      ['개인전', '아트페어', '수상 및 선정'],
    ]);
  });

  it('무게를 줘도 3열 결과는 그대로 (수상이 개인전 아래)', () => {
    const lines: Record<string, number> = { 학력: 3, 개인전: 3, 단체전: 20, 아트페어: 3, '수상 및 선정': 3 };
    expect(splitIntoColumns(CAREER, 3, (c) => lines[c])).toEqual([
      ['학력', '아트페어'],
      ['개인전', '수상 및 선정'],
      ['단체전'],
    ]);
  });

  it('무게가 같으면 돌아가며 담는다 (라운드로빈과 동일)', () => {
    expect(splitIntoColumns(CAREER, 2)).toEqual([
      ['학력', '단체전', '수상 및 선정'],
      ['개인전', '아트페어'],
    ]);
  });

  it('한 항목이 아무리 길어도 빈 열을 남기지 않는다', () => {
    const cols = splitIntoColumns(['짧음', '아주긺'], 2, (c) => (c === '아주긺' ? 500 : 1));
    expect(cols.every(c => c.length > 0)).toBe(true);
    expect(cols).toHaveLength(2);
  });

  it('1열이면 원래 순서 그대로 한 덩어리', () => {
    expect(splitIntoColumns(CAREER, 1)).toEqual([CAREER]);
  });

  it('무게가 없으면 읽는 순서(좌→우, 위→아래)가 원래 순서와 같다', () => {
    for (const n of [1, 2, 3, 4]) {
      const cols = splitIntoColumns(CAREER, n);
      const readOrder: string[] = [];
      const depth = Math.max(...cols.map(c => c.length));
      for (let row = 0; row < depth; row++) {
        for (const col of cols) if (col[row]) readOrder.push(col[row]);
      }
      expect(readOrder, `${n}열`).toEqual(CAREER);
    }
  });

  it('항목이 열보다 적으면 빈 열을 만들지 않는다 (오른쪽 빈 공간 방지)', () => {
    expect(splitIntoColumns(['학력', '개인전'], 3)).toEqual([['학력'], ['개인전']]);
    expect(splitIntoColumns(['학력'], 3)).toEqual([['학력']]);
  });

  it('빈 목록이면 빈 배열', () => {
    expect(splitIntoColumns([], 3)).toEqual([]);
  });

  it('열 수가 0·음수·소수여도 최소 1열로 동작한다', () => {
    for (const n of [0, -3, 0.5, NaN]) {
      expect(splitIntoColumns(CAREER, n), `columns=${n}`).toEqual([CAREER]);
    }
  });

  it('모든 항목이 정확히 한 번씩만 들어간다 (누락·중복 없음)', () => {
    for (const n of [1, 2, 3, 5, 7]) {
      expect(splitIntoColumns(CAREER, n).flat().sort()).toEqual([...CAREER].sort());
    }
  });
});
