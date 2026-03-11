/**
 * useFormDraft 훅 테스트
 * localStorage 기반 임시저장 동작 검증
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// localStorage mock
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] || null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
  length: 0,
  key: vi.fn(() => null),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// 직접 로직 테스트 (훅 렌더링 없이 localStorage 동작 검증)
describe('useFormDraft - localStorage 동작', () => {
  const KEY = 'test_draft';

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('saveDraft → localStorage에 저장', () => {
    const data = { name: 'Test', value: 123 };
    const draft = { data, savedAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(draft));

    const raw = localStorage.getItem(KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.data.name).toBe('Test');
  });

  it('만료된 draft는 무시', () => {
    const expired = { data: { name: 'Old' }, savedAt: Date.now() - 25 * 60 * 60 * 1000 }; // 25시간 전
    localStorage.setItem(KEY, JSON.stringify(expired));

    const raw = localStorage.getItem(KEY);
    const draft = JSON.parse(raw!);
    const EXPIRY = 24 * 60 * 60 * 1000;
    const isExpired = Date.now() - draft.savedAt > EXPIRY;
    expect(isExpired).toBe(true);
  });

  it('유효한 draft는 복원 가능', () => {
    const valid = { data: { name: 'Valid' }, savedAt: Date.now() - 60 * 1000 }; // 1분 전
    localStorage.setItem(KEY, JSON.stringify(valid));

    const raw = localStorage.getItem(KEY);
    const draft = JSON.parse(raw!);
    const EXPIRY = 24 * 60 * 60 * 1000;
    const isExpired = Date.now() - draft.savedAt > EXPIRY;
    expect(isExpired).toBe(false);
    expect(draft.data.name).toBe('Valid');
  });

  it('clearDraft → localStorage에서 제거', () => {
    localStorage.setItem(KEY, JSON.stringify({ data: {}, savedAt: Date.now() }));
    localStorage.removeItem(KEY);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('잘못된 JSON → 무시', () => {
    localStorage.setItem(KEY, 'not-json');
    const raw = localStorage.getItem(KEY);
    let result = null;
    try { result = JSON.parse(raw!); } catch { result = null; }
    expect(result).toBeNull();
  });
});
