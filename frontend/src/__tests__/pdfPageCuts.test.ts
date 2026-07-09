import { describe, it, expect } from 'vitest';
import { computePageCuts } from '../lib/operationPdf';

type Block = { top: number; bottom: number };

// 컷이 어떤 원자 블록 내부도 가로지르지 않는지 검사 (핵심 보장: 이미지/행이 안 잘림)
function noCutInsideBlock(cuts: number[], blocks: Block[]) {
  const inner = cuts.slice(1, -1); // 0 과 totalCss(마지막) 제외
  for (const c of inner) {
    for (const b of blocks) {
      if (c > b.top && c < b.bottom) return false;
    }
  }
  return true;
}

describe('computePageCuts - PDF 페이지 분할', () => {
  const PAGE = 1000;

  it('한 페이지에 들어가면 컷 없이 [0, total]', () => {
    const cuts = computePageCuts([{ top: 0, bottom: 500 }], 500, PAGE);
    expect(cuts).toEqual([0, 500]);
  });

  it('페이지 경계에 걸친 이미지 행을 자르지 않고 다음 페이지로 넘긴다', () => {
    // 950~1100 위치의 블록이 1000 경계를 가로지름 → 컷은 950으로 당겨져야 함
    const blocks: Block[] = [
      { top: 0, bottom: 100 },
      { top: 900, bottom: 950 },
      { top: 950, bottom: 1100 }, // 경계(1000)를 가로지르는 블록
      { top: 1100, bottom: 1200 },
    ];
    const cuts = computePageCuts(blocks, 1300, PAGE);
    expect(cuts[0]).toBe(0);
    expect(cuts).toContain(950);          // 블록 top으로 컷을 당김
    expect(cuts[cuts.length - 1]).toBe(1300);
    expect(noCutInsideBlock(cuts, blocks)).toBe(true);
    // 모든 페이지 높이 ≤ PAGE
    for (let i = 1; i < cuts.length; i++) expect(cuts[i] - cuts[i - 1]).toBeLessThanOrEqual(PAGE);
  });

  it('여러 페이지에 걸쳐도 모든 컷이 블록 내부를 피한다', () => {
    // 120px 이미지 행을 60px 간격으로 20개 (총 3600px) → 여러 페이지
    const blocks: Block[] = [];
    let y = 0;
    for (let i = 0; i < 20; i++) { blocks.push({ top: y, bottom: y + 120 }); y += 180; }
    const total = y;
    const cuts = computePageCuts(blocks, total, PAGE);
    expect(noCutInsideBlock(cuts, blocks)).toBe(true);
    for (let i = 1; i < cuts.length; i++) expect(cuts[i] - cuts[i - 1]).toBeLessThanOrEqual(PAGE);
    expect(cuts[cuts.length - 1]).toBe(total);
  });

  it('페이지보다 큰 블록은 불가피하게 분할하되 내용 유실은 없다(각 페이지 ≤ PAGE)', () => {
    const blocks: Block[] = [{ top: 0, bottom: 2500 }]; // 페이지(1000)보다 큼
    const cuts = computePageCuts(blocks, 2500, PAGE);
    for (let i = 1; i < cuts.length; i++) expect(cuts[i] - cuts[i - 1]).toBeLessThanOrEqual(PAGE);
    expect(cuts[cuts.length - 1]).toBe(2500);
  });

  it('원자 블록이 없으면 페이지 높이 단위로 균등 분할', () => {
    const cuts = computePageCuts([], 2500, PAGE);
    expect(cuts).toEqual([0, 1000, 2000, 2500]);
  });

  it('guard: 위에 여백이 있는 블록은 여백 안쪽으로 컷을 올려 얇은 잘림을 방지한다', () => {
    // 940에서 끝나는 블록 위, 990~1100 블록이 1000 경계를 가로지름 → 여백(990-940=50) 안쪽으로 6px 올림
    const blocks: Block[] = [
      { top: 900, bottom: 940 },
      { top: 990, bottom: 1100 },
      { top: 1100, bottom: 1200 },
    ];
    const cuts = computePageCuts(blocks, 1300, PAGE, 6);
    expect(cuts).toContain(984); // 990 - 6, 여백(940~990) 안쪽
    expect(noCutInsideBlock(cuts, blocks)).toBe(true);
  });

  it('guard: 여백이 없는(맞닿은) 블록은 경계 그대로 컷(표 행 보호)', () => {
    // 950에서 맞닿음 → 여백 0 → guard 미적용, 950에서 컷
    const blocks: Block[] = [
      { top: 900, bottom: 950 },
      { top: 950, bottom: 1100 },
    ];
    const cuts = computePageCuts(blocks, 1200, PAGE, 6);
    expect(cuts).toContain(950);
    expect(noCutInsideBlock(cuts, blocks)).toBe(true);
  });

  it('강제 나눔: 한 페이지에 다 들어가도 forcedBreak 위치에서 무조건 새 페이지', () => {
    // 전체 600(한 페이지 1000에 다 들어감)이지만 500에서 강제 나눔 → [0,500,600]
    const cuts = computePageCuts([], 600, PAGE, 0, [500]);
    expect(cuts).toEqual([0, 500, 600]);
  });

  it('강제 나눔: 여러 페이지 문서에서도 강제 위치를 항상 페이지 시작으로', () => {
    // 총 2600, 페이지 1000, 작품 섹션이 520에서 시작(강제) → 520이 컷에 포함, 이후 정상 분할
    const cuts = computePageCuts([], 2600, PAGE, 0, [520]);
    expect(cuts[0]).toBe(0);
    expect(cuts).toContain(520);          // 작품은 520부터 새 페이지
    expect(cuts[cuts.length - 1]).toBe(2600);
    for (let i = 1; i < cuts.length; i++) expect(cuts[i] - cuts[i - 1]).toBeLessThanOrEqual(PAGE);
  });

  it('강제 나눔이 없으면 기존과 동일(균등 분할)', () => {
    expect(computePageCuts([], 2500, PAGE, 0, [])).toEqual([0, 1000, 2000, 2500]);
  });
});
