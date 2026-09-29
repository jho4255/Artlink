/**
 * 등록 폼 임시저장 규칙 (`lib/formDraft.ts`, 2026-09-29 개편)
 *
 * 예전 테스트는 localStorage 에 직접 넣고 빼며 '24시간 만료' 산수만 확인해 실제 코드를 한 줄도 안 탔다.
 * 지금은 훅이 감싸는 칸(createDraftSlot)을 그대로 돌려 네 가지 약속을 본다:
 *  ① 만료 없음 ② 정하기 전엔 덮어쓰지 않음 ③ 제출 정리가 정하지 않은 옛 초안을 지우지 않음 ④ 깨진 값은 없던 것으로
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createDraftSlot, readDraft, savedAtLabel } from '@/lib/formDraft';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const KEY = 'draft_exhibition_form';
const DAY = 86_400_000;

describe('임시저장 칸', () => {
  let storage: MemoryStorage;
  beforeEach(() => { storage = new MemoryStorage(); });

  it('저장한 게 없으면 바로 쓸 수 있고, 저장 시각을 기억한다', () => {
    const slot = createDraftSlot<{ title: string }>(KEY, storage);
    expect(slot.pending).toBeNull();
    expect(slot.save({ title: '가을 단체전' }, 1000)).toBe(true);
    expect(slot.savedAt).toBe(1000);
    expect(readDraft<{ title: string }>(storage, KEY)?.data.title).toBe('가을 단체전');
  });

  it('여러 번 저장하면 칸 하나를 덮어쓴다(쌓이지 않는다)', () => {
    const slot = createDraftSlot<{ title: string }>(KEY, storage);
    slot.save({ title: '첫 번째' }, 1);
    slot.save({ title: '두 번째' }, 2);
    expect(storage.length).toBe(1);
    expect(readDraft<{ title: string }>(storage, KEY)).toEqual({ data: { title: '두 번째' }, savedAt: 2 });
  });

  it('① 만료가 없다 — 30일 지난 초안도 이어 쓸 수 있다', () => {
    storage.setItem(KEY, JSON.stringify({ data: { title: '오래된 공고' }, savedAt: Date.now() - 30 * DAY }));
    const slot = createDraftSlot<{ title: string }>(KEY, storage);
    expect(slot.pending?.data.title).toBe('오래된 공고');
  });

  it('② 정하기 전에는 자동저장·[임시저장] 이 옛 초안을 덮어쓰지 않는다', () => {
    storage.setItem(KEY, JSON.stringify({ data: { title: '쓰던 공고' }, savedAt: 5 }));
    const slot = createDraftSlot<{ title: string }>(KEY, storage);
    expect(slot.save({ title: '새로 입력한 것' })).toBe(false);
    expect(readDraft<{ title: string }>(storage, KEY)?.data.title).toBe('쓰던 공고');
  });

  it('[이어서 쓰기] → 초안을 돌려주고, 그 뒤로는 저장된다', () => {
    storage.setItem(KEY, JSON.stringify({ data: { title: '쓰던 공고' }, savedAt: 5 }));
    const slot = createDraftSlot<{ title: string }>(KEY, storage);
    expect(slot.resume()).toEqual({ title: '쓰던 공고' });
    expect(slot.pending).toBeNull();
    expect(slot.savedAt).toBe(5);
    expect(slot.save({ title: '쓰던 공고 — 고침' }, 9)).toBe(true);
    expect(readDraft<{ title: string }>(storage, KEY)?.data.title).toBe('쓰던 공고 — 고침');
  });

  it('[새로 쓰기] → 옛 초안을 지우고 새로 저장된다', () => {
    storage.setItem(KEY, JSON.stringify({ data: { title: '쓰던 공고' }, savedAt: 5 }));
    const slot = createDraftSlot<{ title: string }>(KEY, storage);
    slot.discard();
    expect(slot.pending).toBeNull();
    expect(storage.getItem(KEY)).toBeNull();
    expect(slot.save({ title: '새 공고' })).toBe(true);
  });

  it('③ 제출 뒤 정리는 이어 쓴 초안만 지운다 — 정하지 않은 옛 초안은 남긴다', () => {
    storage.setItem(KEY, JSON.stringify({ data: { title: '쓰던 공고' }, savedAt: 5 }));
    const undecided = createDraftSlot<{ title: string }>(KEY, storage);
    undecided.clear();   // 옛 초안은 건드리지 않고 새로 쓴 것을 제출한 경우
    expect(readDraft<{ title: string }>(storage, KEY)?.data.title).toBe('쓰던 공고');

    const resumed = createDraftSlot<{ title: string }>(KEY, storage);
    resumed.resume();
    resumed.clear();     // 이어 써서 제출한 경우
    expect(storage.getItem(KEY)).toBeNull();
  });

  it('④ 깨진 값·모양이 다른 값은 없던 것으로 치고 치운다', () => {
    storage.setItem(KEY, 'not-json');
    expect(createDraftSlot(KEY, storage).pending).toBeNull();
    expect(storage.getItem(KEY)).toBeNull();
    storage.setItem(KEY, JSON.stringify({ title: '예전 형식' }));
    expect(createDraftSlot(KEY, storage).pending).toBeNull();
  });

  it('저장소가 막힌 환경에서도 죽지 않는다(저장됐다고 하지도 않는다)', () => {
    const slot = createDraftSlot<{ title: string }>(KEY, null);
    expect(slot.pending).toBeNull();
    expect(slot.save({ title: 'x' })).toBe(false);
    const broken = new MemoryStorage();
    broken.setItem = () => { throw new Error('QuotaExceeded'); };
    expect(createDraftSlot<{ title: string }>(KEY, broken).save({ title: 'x' })).toBe(false);
  });
});

describe('저장 시각 표시', () => {
  const now = new Date(2026, 8, 29, 15, 0).getTime();
  it('오늘 · 어제 · 올해 · 지난해', () => {
    expect(savedAtLabel(new Date(2026, 8, 29, 14, 20).getTime(), now)).toBe('오늘 14:20');
    expect(savedAtLabel(new Date(2026, 8, 28, 9, 5).getTime(), now)).toBe('어제 09:05');
    expect(savedAtLabel(new Date(2026, 8, 27, 14, 20).getTime(), now)).toBe('9월 27일 14:20');
    expect(savedAtLabel(new Date(2025, 8, 27, 14, 20).getTime(), now)).toBe('2025년 9월 27일');
  });
});
