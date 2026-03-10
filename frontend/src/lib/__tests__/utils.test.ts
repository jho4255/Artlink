import { describe, it, expect } from 'vitest';
import { cn, getDday, regionLabels, exhibitionTypeLabels } from '../utils';

describe('cn (클래스 병합)', () => {
  it('단일 클래스', () => {
    expect(cn('text-red-500')).toBe('text-red-500');
  });

  it('조건부 클래스 병합', () => {
    expect(cn('p-4', false && 'hidden', 'flex')).toBe('p-4 flex');
  });

  it('Tailwind 충돌 해결 (twMerge)', () => {
    // p-4와 p-2가 충돌 시 마지막 것이 승리
    expect(cn('p-4', 'p-2')).toBe('p-2');
  });
});

describe('getDday', () => {
  it('미래 날짜 → 양수', () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const dday = getDday(future);
    expect(dday).toBeGreaterThan(0);
    expect(dday).toBeLessThanOrEqual(4); // ceil이므로 3 또는 4
  });

  it('과거 날짜 → 음수', () => {
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect(getDday(past)).toBeLessThan(0);
  });
});

describe('regionLabels', () => {
  it('모든 지역 라벨이 존재', () => {
    expect(regionLabels['SEOUL']).toBe('서울');
    expect(regionLabels['GYEONGGI_NORTH']).toBe('경기 북부');
    expect(regionLabels['BUSAN']).toBe('부산');
  });
});

describe('exhibitionTypeLabels', () => {
  it('모든 전시 타입 라벨이 존재', () => {
    expect(exhibitionTypeLabels['SOLO']).toBe('개인전');
    expect(exhibitionTypeLabels['GROUP']).toBe('단체전');
    expect(exhibitionTypeLabels['ART_FAIR']).toBe('아트페어');
  });
});
