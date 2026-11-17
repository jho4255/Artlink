/**
 * [전체 보기] 무작위 순서 (2026-11-14, `lib/storyOrder.ts`) — 순수 함수.
 */
import { describe, it, expect } from 'vitest';
import { storyRank, shuffledStoryIds, parseSeed, parseIdList } from '../storyOrder';

const DAY = 864e5;
const now = Date.UTC(2026, 10, 14, 12);
const head = (id: number, authorId: number, ageMs: number) => ({ id, authorId, createdAt: new Date(now - ageMs) });

describe('storyRank', () => {
  it('같은 (시드, id) 면 늘 같고, 시드가 다르면 다르다', () => {
    expect(storyRank(7, 42)).toBe(storyRank(7, 42));
    expect(storyRank(7, 42)).not.toBe(storyRank(8, 42));
    expect(storyRank(7, 42)).toBeGreaterThanOrEqual(0);
  });
});

describe('shuffledStoryIds', () => {
  const heads = [head(9, 1, 1000), head(8, 2, 2000), head(7, 3, 3000), head(6, 2, 4000), head(5, 3, 5000), head(4, 1, 2 * DAY)];
  const opts = (o: Partial<Parameters<typeof shuffledStoryIds>[1]> = {}) => ({ seed: 1, seen: new Set<number>(), now, mineFrontMs: DAY, ...o });

  it('하루 안 된 내 소식 → 안 본 남의 소식(섞음) → 본 소식·하루 지난 내 소식(최신순)', () => {
    const order = shuffledStoryIds(heads, opts({ me: 1, seen: new Set([7]) }));
    expect(order[0]).toBe(9);                       // 내 새것
    expect(order.slice(-2)).toEqual([7, 4]);        // 본 것(7) · 하루 지난 내 것(4) — 최신순
    expect(new Set(order.slice(1, 4))).toEqual(new Set([8, 6, 5]));
  });
  it('로그인 안 했으면 내 소식이 없다 — 본 것만 뒤로', () => {
    const order = shuffledStoryIds(heads, opts({ seen: new Set([9]) }));
    expect(order[order.length - 1]).toBe(9);
    expect(order).toHaveLength(6);
  });
  it('하나가 빠져도 나머지 순서는 그대로(소식마다 정한 값으로 정렬)', () => {
    const full = shuffledStoryIds(heads, opts({ seed: 99 }));
    const less = shuffledStoryIds(heads.filter((h) => h.id !== full[2]), opts({ seed: 99 }));
    expect(less).toEqual(full.filter((id) => id !== full[2]));
  });
});

describe('주소 값 읽기', () => {
  it('parseSeed — 1 이상 정수만', () => {
    expect(parseSeed('123')).toBe(123);
    for (const bad of [undefined, '', '0', '-3', '1.5', 'abc', '99999999999']) expect(parseSeed(bad), String(bad)).toBeNull();
  });
  it('parseIdList — 양의 정수만, 상한까지', () => {
    expect([...parseIdList('3,x,5,-1,5,7', 10)]).toEqual([3, 5, 7]);
    expect(parseIdList('1,2,3,4', 2).size).toBe(2);
    expect(parseIdList(undefined, 5).size).toBe(0);
  });
});
