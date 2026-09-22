/**
 * 같은 폭의 열 격자 (lib/columnGrid.ts) — 작가 홈페이지 작품 격자.
 * 정렬 격자에서 되돌린 이유가 "이음매·오른콽 끝이 행마다 다르다"였으므로, 여기서는 그 둘이 **항상 같은 자리**인지를 본다.
 */
import { describe, it, expect } from 'vitest';
import { columnGrid, columnWidth, aspectOf } from '@/lib/columnGrid';

const W = 1184, GAP = 24, COLS = 3;
const colW = (W - GAP * 2) / 3; // 378.67

describe('columnGrid — 같은 폭의 열', () => {
  it('열 폭은 컨테이너에서 한 번 정해지고 모든 행이 같은 값을 쓴다', () => {
    expect(columnWidth({ containerWidth: W, columns: COLS, gap: GAP })).toBeCloseTo(colW, 5);
    const rows = columnGrid([1, 1.3, 0.8, 2, 1, 0.7, 1].map((a, i) => ({ item: i, aspect: a })), { containerWidth: W, columns: COLS, gap: GAP });
    expect(rows.map((r) => r.cells.length)).toEqual([3, 3, 1]);
    // 어느 행이든 그림 폭은 열 폭을 넘지 않는다 → 이음매(열 경계)가 전 행에서 같은 x 에 온다
    for (const r of rows) for (const c of r.cells) expect(c.width).toBeLessThanOrEqual(colW + 1e-6);
  });

  it('칸 높이는 그 행에서 가장 높은 그림에 맞고, 정사각·가로 그림은 열 폭을 꽉 채운다', () => {
    const [row] = columnGrid([{ item: 'sq', aspect: 1 }, { item: 'wide', aspect: 1.6 }, { item: 'tall', aspect: 0.9 }], { containerWidth: W, columns: COLS, gap: GAP });
    expect(row.height).toBeCloseTo(colW / 0.9, 5);           // 가장 높은 것(세로 0.9)
    expect(row.cells[0].width).toBeCloseTo(colW, 5);          // 정사각: 폭 꽉
    expect(row.cells[0].height).toBeCloseTo(colW, 5);
    expect(row.cells[1].width).toBeCloseTo(colW, 5);          // 가로: 폭 꽉, 높이는 낮다
    expect(row.cells[1].height).toBeCloseTo(colW / 1.6, 5);
    expect(row.cells[2].height).toBeCloseTo(row.height, 5);   // 세로: 행 높이 = 자기 높이
  });

  it('아주 세로로 긴 그림은 행 높이 상한(열 폭 × 1.3)에 걸려 폭이 줄어든다 — 행을 통째로 키우지 않는다', () => {
    const [row] = columnGrid([{ item: 'pillar', aspect: 0.4 }, { item: 'sq', aspect: 1 }], { containerWidth: W, columns: COLS, gap: GAP });
    expect(row.height).toBeCloseTo(colW * 1.3, 5);
    const pillar = row.cells[0];
    expect(pillar.height).toBeCloseTo(colW * 1.3, 5);
    expect(pillar.width).toBeCloseTo(colW * 1.3 * 0.4, 5);   // 비율은 그대로(자르지도 늘리지도 않는다)
    expect(pillar.width / pillar.height).toBeCloseTo(0.4, 5);
  });

  it('비율을 모르거나 이상한 값은 정사각으로 본다', () => {
    const [row] = columnGrid([{ item: 1 }, { item: 2, aspect: 0 }, { item: 3, aspect: NaN }], { containerWidth: W, columns: COLS, gap: GAP });
    for (const c of row.cells) { expect(c.aspect).toBe(1); expect(c.width).toBeCloseTo(colW, 5); }
  });

  it('열 수만큼 끊는다 — 모바일 2열', () => {
    const rows = columnGrid([1, 2, 3, 4, 5].map((i) => ({ item: i, aspect: 1 })), { containerWidth: 360, columns: 2, gap: 12 });
    expect(rows.map((r) => r.cells.length)).toEqual([2, 2, 1]);
    expect(rows[0].cells[0].width).toBeCloseTo(174, 5);
  });

  it('빈 입력·폭 0 이면 빈 배열', () => {
    expect(columnGrid([], { containerWidth: W, columns: COLS, gap: GAP })).toEqual([]);
    expect(columnGrid([{ item: 1 }], { containerWidth: 0, columns: COLS, gap: GAP })).toEqual([]);
  });

  it('aspectOf — 서버 실측이 있으면 그것, 없으면 화면이 잰 값, 둘 다 없으면 undefined', () => {
    expect(aspectOf({ width: 800, height: 400 })).toBe(2);
    expect(aspectOf({ width: null, height: null }, 1.5)).toBe(1.5);
    expect(aspectOf({})).toBeUndefined();
  });
});
