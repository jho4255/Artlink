import { describe, it, expect } from 'vitest';
import { numberToKorean, koreanWon, formatArtworkPrice } from '../lib/utils';

describe('numberToKorean', () => {
  it('만 단위 변환', () => {
    expect(numberToKorean(230000)).toBe('이십삼만');
    expect(numberToKorean(10000)).toBe('만');
    expect(numberToKorean(50000)).toBe('오만');
  });

  it('천/백/십 단위 변환', () => {
    expect(numberToKorean(1234)).toBe('천이백삼십사');
    expect(numberToKorean(11)).toBe('십일');
    expect(numberToKorean(320000)).toBe('삼십이만');
  });

  it('억 단위는 일 유지', () => {
    expect(numberToKorean(100000000)).toBe('일억');
    expect(numberToKorean(123456789)).toBe('일억이천삼백사십오만육천칠백팔십구');
  });

  it('0 이하·비정상 입력은 빈 문자열', () => {
    expect(numberToKorean(0)).toBe('');
    expect(numberToKorean(-5)).toBe('');
    expect(numberToKorean(NaN)).toBe('');
  });
});

describe('koreanWon', () => {
  it('숫자 → ○○원', () => {
    expect(koreanWon(230000)).toBe('이십삼만원');
    expect(koreanWon('320000')).toBe('삼십이만원');
  });

  it('숫자가 섞인 문자열에서 숫자만 추출', () => {
    expect(koreanWon('₩230,000')).toBe('이십삼만원');
  });

  it('숫자가 없으면 빈 문자열 (비매/협의 등)', () => {
    expect(koreanWon('비매')).toBe('');
    expect(koreanWon('')).toBe('');
    expect(koreanWon(null)).toBe('');
    expect(koreanWon(0)).toBe('');
  });
});

describe('formatArtworkPrice', () => {
  it('순수 숫자 → 콤마+원', () => {
    expect(formatArtworkPrice('500000')).toBe('500,000원');
    expect(formatArtworkPrice('300,000')).toBe('300,000원');
  });

  it('자유 텍스트는 원문 유지 (비매/협의/₩ 표기)', () => {
    expect(formatArtworkPrice('비매')).toBe('비매');
    expect(formatArtworkPrice('협의')).toBe('협의');
    expect(formatArtworkPrice('₩320,000')).toBe('₩320,000');
  });

  it('빈 값/0은 빈 문자열', () => {
    expect(formatArtworkPrice('')).toBe('');
    expect(formatArtworkPrice(null)).toBe('');
    expect(formatArtworkPrice(undefined)).toBe('');
    expect(formatArtworkPrice('0')).toBe('0');
  });
});
