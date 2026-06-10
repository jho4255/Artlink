import { describe, it, expect } from 'vitest';
import { toManWon } from '../format';

describe('toManWon (캡션 만원 단위 표기)', () => {
  it('만원 단위 정확 변환', () => {
    expect(toManWon(230000)).toBe('23만원');
    expect(toManWon('230000')).toBe('23만원');
    expect(toManWon(320000)).toBe('32만원');
    expect(toManWon(10000)).toBe('1만원');
  });

  it('만원 + 나머지 원', () => {
    expect(toManWon(235000)).toBe('23만 5,000원');
    expect(toManWon(5000)).toBe('5,000원');
  });

  it('억 단위', () => {
    expect(toManWon(100000000)).toBe('1억원');
    expect(toManWon(123000000)).toBe('1억 2,300만원');
  });

  it('숫자 섞인 문자열에서 숫자만 추출', () => {
    expect(toManWon('₩230,000')).toBe('23만원');
  });

  it('숫자 없으면 원문 유지 (비매/협의)', () => {
    expect(toManWon('비매')).toBe('비매');
    expect(toManWon('협의')).toBe('협의');
    expect(toManWon('')).toBe('');
    expect(toManWon(null)).toBe('');
  });
});
