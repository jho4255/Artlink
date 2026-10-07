/**
 * 회원가입의 역할 (2026-10-08 사용자 결정, lib/signupRole.ts) — 로그인 화면은 역할을 묻지 않고, [회원가입]에서 고른다.
 * 카카오 가입 정보 입력에 넘기는 역할(30분) · 지원·초대 코드로 오면 아티스트 · 저장소가 막혀도 던지지 않기.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearSignupRole, contextSignupRole, isSignupRole, peekSignupRole, stashSignupRole } from '@/lib/signupRole';

beforeEach(() => localStorage.clear());

describe('미리 골라 둘 역할', () => {
  it('공모 지원·초대 코드로 왔으면 아티스트 — 광고 → 공모 → 지원 흐름에 한 번 더 누르게 하지 않는다', () => {
    expect(contextSignupRole('/exhibitions/12/apply')).toBe('ARTIST');
    expect(contextSignupRole('/join/ABCD2345')).toBe('ARTIST');
    expect(contextSignupRole('/exhibitions/12')).toBeNull();
    expect(contextSignupRole(null)).toBeNull();
  });
  it('역할은 셋뿐 — 관리자는 고를 수 없다', () => {
    expect(isSignupRole('GALLERY')).toBe(true);
    expect(isSignupRole('ADMIN')).toBe(false);
  });
});

describe('카카오 가입 정보 입력으로 넘기는 역할', () => {
  it('30분 동안 남고, 지우지 않고 본다(StrictMode 가 두 번 읽어도 같은 답)', () => {
    stashSignupRole('GALLERY', 1_000);
    expect(peekSignupRole(1_000 + 60_000)).toBe('GALLERY');
    expect(peekSignupRole(1_000 + 60_000)).toBe('GALLERY');
    expect(peekSignupRole(1_000 + 31 * 60_000)).toBeNull();
    clearSignupRole();
    expect(peekSignupRole(1_000 + 60_000)).toBeNull();
  });
  it('저장된 값이 이상하면 없는 것으로', () => {
    localStorage.setItem('artlink-signup-role', JSON.stringify({ role: 'ADMIN', at: Date.now() }));
    expect(peekSignupRole()).toBeNull();
    localStorage.setItem('artlink-signup-role', '{깨진');
    expect(peekSignupRole()).toBeNull();
  });
  it('저장소가 막혀도 던지지 않는다', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const spy2 = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => stashSignupRole('ARTIST')).not.toThrow();
    expect(peekSignupRole()).toBeNull();
    spy.mockRestore();
    spy2.mockRestore();
  });
});
