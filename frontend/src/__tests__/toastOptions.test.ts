/**
 * 전역 토스트 설정 회귀 테스트
 *
 * `toastOptions.duration`은 **모든 타입에 일괄 적용**되어 로딩 토스트의 기본값(Infinity)까지 덮어쓴다.
 * 그래서 운영페이지의 "N/M장 모으는 중" 진행률이 3초마다 사라졌다 다시 생기는 깜빡임이 있었다(2026-08 신고).
 * 진행률은 작업이 끝날 때까지 유지되어야 하므로 loading은 반드시 Infinity.
 */
import { describe, it, expect } from 'vitest';
import { TOAST_OPTIONS } from '@/lib/toastOptions';

describe('전역 토스트 설정', () => {
  it('★ 로딩 토스트는 자동으로 닫히지 않는다 (진행률 깜빡임 방지)', () => {
    expect(TOAST_OPTIONS.loading?.duration).toBe(Infinity);
  });

  it('일반 토스트는 자동으로 닫힌다', () => {
    expect(TOAST_OPTIONS.duration).toBeGreaterThan(0);
    expect(Number.isFinite(TOAST_OPTIONS.duration as number)).toBe(true);
  });
});
