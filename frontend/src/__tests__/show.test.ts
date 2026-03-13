import { describe, it, expect } from 'vitest';
import { getShowStatus, validateExhibitionDates, getDday, showStatusLabels } from '../lib/utils';

describe('getShowStatus', () => {
  it('진행중 전시 판별', () => {
    const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(getShowStatus(past, future)).toBe('ongoing');
  });

  it('예정 전시 판별', () => {
    const future1 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const future2 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    expect(getShowStatus(future1, future2)).toBe('upcoming');
  });

  it('종료 전시 판별', () => {
    const past1 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const past2 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(getShowStatus(past1, past2)).toBe('ended');
  });
});

describe('showStatusLabels', () => {
  it('모든 상태에 대한 라벨 존재', () => {
    expect(showStatusLabels.upcoming).toBe('예정');
    expect(showStatusLabels.ongoing).toBe('진행중');
    expect(showStatusLabels.ended).toBe('종료');
  });
});

describe('validateExhibitionDates', () => {
  it('유효한 날짜 순서 → null 반환', () => {
    expect(validateExhibitionDates({
      deadlineStart: '2026-03-01',
      deadline: '2026-03-10',
      exhibitStartDate: '2026-03-15',
      exhibitDate: '2026-03-30',
    })).toBeNull();
  });

  it('공모 시작일 > 마감일 → 에러', () => {
    expect(validateExhibitionDates({
      deadlineStart: '2026-03-15',
      deadline: '2026-03-10',
      exhibitDate: '2026-03-30',
    })).toBe('공모 시작일은 마감일 이전이어야 합니다.');
  });

  it('마감일 > 전시 시작일 → 에러', () => {
    expect(validateExhibitionDates({
      deadline: '2026-03-20',
      exhibitStartDate: '2026-03-15',
      exhibitDate: '2026-03-30',
    })).toBe('공모 마감일은 전시 시작일 이전이어야 합니다.');
  });

  it('전시 시작일 > 종료일 → 에러', () => {
    expect(validateExhibitionDates({
      deadline: '2026-03-10',
      exhibitStartDate: '2026-04-01',
      exhibitDate: '2026-03-30',
    })).toBe('전시 시작일은 종료일 이전이어야 합니다.');
  });

  it('exhibitStartDate 없이 마감일 > 전시일 → 에러', () => {
    expect(validateExhibitionDates({
      deadline: '2026-04-01',
      exhibitDate: '2026-03-30',
    })).toBe('공모 마감일은 전시 종료일 이전이어야 합니다.');
  });
});

describe('getDday', () => {
  it('미래 날짜 → 양수', () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    expect(getDday(future)).toBeGreaterThan(0);
  });

  it('과거 날짜 → 음수', () => {
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(getDday(past)).toBeLessThan(0);
  });
});
