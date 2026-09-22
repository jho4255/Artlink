/**
 * 같은 크기의 정사각 칸 격자 (lib/columnGrid.ts) — 작가 홈페이지 작품 격자.
 * 정렬 격자에서 되돌린 이유가 "이음매·오른쪽 끝이 행마다 다르다"였으므로, 여기서는 이음매·행 높이가 **항상 같은 자리**인지를 본다.
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

  it('칸은 정사각(높이 = 열 폭) — 그림 비율이 어떻든 행 높이가 변하지 않는다', () => {
    const [row] = columnGrid([{ item: 'sq', aspect: 1 }, { item: 'wide', aspect: 1.6 }, { item: 'tall', aspect: 0.9 }], { containerWidth: W, columns: COLS, gap: GAP });
    expect(row.height).toBeCloseTo(colW, 5);
    expect(row.cells[0].width).toBeCloseTo(colW, 5);          // 정사각: 칸 꽉
    expect(row.cells[0].height).toBeCloseTo(colW, 5);
    expect(row.cells[1].width).toBeCloseTo(colW, 5);          // 가로: 폭 꽉, 위아래가 빈다
    expect(row.cells[1].height).toBeCloseTo(colW / 1.6, 5);
    expect(row.cells[2].height).toBeCloseTo(colW, 5);         // 세로: 높이에서 걸려 좌우가 빈다
    expect(row.cells[2].width).toBeCloseTo(colW * 0.9, 5);
    expect(row.cells[2].width / row.cells[2].height).toBeCloseTo(0.9, 5); // 비율은 그대로(자르지도 늘리지도 않는다)
  });

  it('여러 행의 높이가 전부 같다 — 윗선·아랫선·캡션 줄이 맞는 근거', () => {
    const rows = columnGrid([0.5, 1, 2, 1.3, 0.8, 3, 1].map((a, i) => ({ item: i, aspect: a })), { containerWidth: W, columns: COLS, gap: GAP });
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.height).toBeCloseTo(colW, 5);
  });

  it('maxRowRatio 를 열면(첫 번째 안) 행에서 가장 높은 그림까지, 그 상한까지만 커진다', () => {
    const [row] = columnGrid([{ item: 'pillar', aspect: 0.4 }, { item: 'sq', aspect: 1 }], { containerWidth: W, columns: COLS, gap: GAP, maxRowRatio: 1.3 });
    expect(row.height).toBeCloseTo(colW * 1.3, 5);
    expect(row.cells[0].width).toBeCloseTo(colW * 1.3 * 0.4, 5);
    expect(row.cells[1].height).toBeCloseTo(colW, 5);         // 정사각은 여전히 열 폭
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
