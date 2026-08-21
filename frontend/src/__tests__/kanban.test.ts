/**
 * 할 일 보드의 순수 로직.
 *
 * sortItems 는 백엔드 `lib/kanban.ts` 의 같은 이름 함수와 **결과가 같아야** 한다.
 * 어긋나면 체크한 줄이 한 자리에 있다가 서버 응답이 오는 순간 다른 자리로 튄다.
 *
 * 가장 중요한 규칙: **체크해도 position 은 안 바뀐다.** 정렬로만 뒤로 간다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sortItems, progressOf, isDone, toggleDoneLocal, shiftItem, reorderOpen, applyOrderLocal,
  sortSubtasks, subProgress, toggleSubLocal,
  dueBadge, shortDate, type TodoItem, type TodoSubtask,
} from '@/lib/kanban';


const item = (id: number, position: number, doneAt: string | null = null, extra: Partial<TodoItem> = {}): TodoItem => ({
  id, boardId: 1, position, doneAt, title: `할 일 ${id}`, createdAt: '2026-08-01T00:00:00.000Z', ...extra,
});

const board = (): TodoItem[] => [item(1, 0), item(2, 1), item(3, 2), item(4, 3)];
const ids = (rows: TodoItem[]) => rows.map(r => r.id);

const sub = (id: number, position: number, doneAt: string | null = null): TodoSubtask =>
  ({ id, cardId: 1, position, doneAt, title: `세부 ${id}` });

describe('세부항목', () => {
  it('적은 순서 그대로 — 체크해도 자리가 안 바뀐다', () => {
    // 상위 항목과 다른 점. 서너 줄짜리 목록에서 줄이 튀면 다음 걸 누르기 힘들다.
    const subs = [sub(1, 0, '2026-08-20T00:00:00Z'), sub(2, 1), sub(3, 2)];
    expect(sortSubtasks(subs).map(s => s.id)).toEqual([1, 2, 3]);
  });

  it('position 이 겹쳐도 id 로 결정적으로 갈라진다', () => {
    expect(sortSubtasks([sub(7, 0), sub(3, 0)]).map(s => s.id)).toEqual([3, 7]);
  });

  it('없거나 빈 배열이면 빈 배열', () => {
    expect(sortSubtasks(undefined)).toEqual([]);
    expect(sortSubtasks([])).toEqual([]);
  });

  it('진행은 "완료/전체"', () => {
    const it1 = item(1, 0, null, { subtasks: [sub(1, 0, '2026-08-20T00:00:00Z'), sub(2, 1), sub(3, 2)] });
    expect(subProgress(it1)).toEqual({ done: 1, total: 3 });
  });

  it('세부항목이 없으면 null — 배지를 아예 안 그린다', () => {
    expect(subProgress(item(1, 0))).toBeNull();
    expect(subProgress(item(1, 0, null, { subtasks: [] }))).toBeNull();
  });

  it('체크하면 doneAt 이 생기고, 풀면 지워진다', () => {
    const items = [item(1, 0, null, { subtasks: [sub(10, 0)] })];
    const on = toggleSubLocal(items, 10, true);
    expect(on[0].subtasks![0].doneAt).toBeTruthy();
    expect(toggleSubLocal(on, 10, false)[0].subtasks![0].doneAt).toBeNull();
  });

  it('이미 체크된 걸 또 체크해도 시각이 안 바뀐다 (서버와 같은 규칙)', () => {
    const items = [item(1, 0, null, { subtasks: [sub(10, 0, '2026-08-20T00:00:00Z')] })];
    expect(toggleSubLocal(items, 10, true)[0].subtasks![0].doneAt).toBe('2026-08-20T00:00:00Z');
  });

  it('세부항목을 다 체크해도 상위 항목은 그대로 (자동 완료 없음)', () => {
    const items = [item(1, 0, null, { subtasks: [sub(10, 0), sub(11, 1)] })];
    let next = toggleSubLocal(items, 10, true);
    next = toggleSubLocal(next, 11, true);
    expect(subProgress(next[0])).toEqual({ done: 2, total: 2 });
    expect(next[0].doneAt).toBeNull();
  });

  it('다른 항목의 세부항목은 건드리지 않는다', () => {
    const items = [
      item(1, 0, null, { subtasks: [sub(10, 0)] }),
      item(2, 1, null, { subtasks: [sub(20, 0)] }),
    ];
    const next = toggleSubLocal(items, 10, true);
    expect(next[1].subtasks![0].doneAt).toBeNull();
    expect(next[1]).toBe(items[1]); // 참조까지 그대로 (불필요한 리렌더 방지)
  });

  it('없는 세부항목 id 면 아무것도 안 바뀐다', () => {
    const items = [item(1, 0, null, { subtasks: [sub(10, 0)] })];
    expect(toggleSubLocal(items, 999, true)[0].subtasks![0].doneAt).toBeNull();
  });
});

describe('sortItems — 안 한 일 먼저, 완료는 최근 순으로 뒤에', () => {
  it('완료 항목이 뒤로 간다', () => {
    const items = [item(1, 0, '2026-08-20T00:00:00Z'), item(2, 1), item(3, 2)];
    expect(ids(sortItems(items))).toEqual([2, 3, 1]);
  });

  it('안 한 일끼리는 position 순', () => {
    expect(ids(sortItems([item(3, 2), item(1, 0), item(2, 1)]))).toEqual([1, 2, 3]);
  });

  it('완료끼리는 최근에 체크한 것부터', () => {
    const items = [
      item(1, 0, '2026-08-18T00:00:00Z'),
      item(2, 1, '2026-08-20T00:00:00Z'),
      item(3, 2, '2026-08-19T00:00:00Z'),
    ];
    expect(ids(sortItems(items))).toEqual([2, 3, 1]);
  });

  it('position 이 겹쳐도 id 로 결정적으로 갈라진다', () => {
    expect(ids(sortItems([item(7, 0), item(3, 0), item(9, 0)]))).toEqual([3, 7, 9]);
  });

  it('원본 배열을 건드리지 않는다', () => {
    const items = [item(2, 1), item(1, 0)];
    sortItems(items);
    expect(ids(items)).toEqual([2, 1]);
  });

  it('빈 목록', () => {
    expect(sortItems([])).toEqual([]);
  });
});

describe('isDone / progressOf', () => {
  it('doneAt 이 있으면 완료', () => {
    expect(isDone(item(1, 0))).toBe(false);
    expect(isDone(item(1, 0, '2026-08-20T00:00:00Z'))).toBe(true);
  });

  it('완료/미완료/비율', () => {
    const items = [item(1, 0, '2026-08-20T00:00:00Z'), item(2, 1), item(3, 2), item(4, 3)];
    expect(progressOf(items)).toEqual({ done: 1, open: 3, total: 4, percent: 25 });
  });

  it('빈 보드에서 0으로 나누지 않는다', () => {
    expect(progressOf([])).toEqual({ done: 0, open: 0, total: 0, percent: 0 });
  });
});

describe('toggleDoneLocal — 낙관적 체크', () => {
  it('체크하면 doneAt 이 생긴다', () => {
    const next = toggleDoneLocal(board(), 2, true);
    expect(next.find(i => i.id === 2)!.doneAt).toBeTruthy();
  });

  it('체크를 풀면 doneAt 이 지워진다', () => {
    const items = [item(1, 0, '2026-08-20T00:00:00Z')];
    expect(toggleDoneLocal(items, 1, false)[0].doneAt).toBeNull();
  });

  it('이미 체크된 걸 또 체크해도 시각이 안 바뀐다 (서버와 같은 규칙)', () => {
    const items = [item(1, 0, '2026-08-20T00:00:00Z')];
    expect(toggleDoneLocal(items, 1, true)[0].doneAt).toBe('2026-08-20T00:00:00Z');
  });

  it('position 은 건드리지 않는다 — 체크를 풀면 원래 자리로', () => {
    const next = toggleDoneLocal(board(), 2, true);
    expect(next.find(i => i.id === 2)!.position).toBe(1);
    expect(ids(sortItems(next))).toEqual([1, 3, 4, 2]);
    expect(ids(sortItems(toggleDoneLocal(next, 2, false)))).toEqual([1, 2, 3, 4]);
  });

  it('다른 항목은 그대로', () => {
    const next = toggleDoneLocal(board(), 2, true);
    expect(next.filter(i => i.id !== 2).every(i => i.doneAt === null)).toBe(true);
  });
});

describe('shiftItem — 모바일 ↑↓ (전체 순서를 돌려준다)', () => {
  it('위로 한 칸', () => {
    expect(shiftItem(board(), 3, -1)).toEqual([1, 3, 2, 4]);
  });

  it('아래로 한 칸', () => {
    expect(shiftItem(board(), 1, 1)).toEqual([2, 1, 3, 4]);
  });

  it('맨 위에서 더 올리면 null (버튼이 비활성화된다)', () => {
    expect(shiftItem(board(), 1, -1)).toBeNull();
  });

  it('맨 아래에서 더 내리면 null', () => {
    expect(shiftItem(board(), 4, 1)).toBeNull();
  });

  it('없는 항목이면 null', () => {
    expect(shiftItem(board(), 999, 1)).toBeNull();
  });

  it('완료 항목은 안 한 일 사이를 비집고 들어가지 않는다', () => {
    const items = [item(1, 0), item(2, 1, '2026-08-20T00:00:00Z'), item(3, 2), item(4, 3)];
    // 화면상 안 한 일은 1,3,4 — 3을 위로 올리면 3,1,4 + 완료(2) 는 맨 뒤
    expect(shiftItem(items, 3, -1)).toEqual([3, 1, 4, 2]);
  });

  it('완료 항목은 움직일 수 없다', () => {
    const items = [item(1, 0), item(2, 1, '2026-08-20T00:00:00Z')];
    expect(shiftItem(items, 2, -1)).toBeNull();
  });
});

describe('reorderOpen — 드래그 (전체 순서를 돌려준다)', () => {
  it('맨 뒤를 맨 앞으로', () => {
    expect(reorderOpen(board(), 4, 0)).toEqual([4, 1, 2, 3]);
  });

  it('가운데로', () => {
    expect(reorderOpen(board(), 1, 2)).toEqual([2, 3, 1, 4]);
  });

  it('제자리면 null (쓸데없는 요청을 보내지 않는다)', () => {
    expect(reorderOpen(board(), 2, 1)).toBeNull();
  });

  it('범위를 넘는 index 는 맨 뒤로', () => {
    expect(reorderOpen(board(), 1, 99)).toEqual([2, 3, 4, 1]);
  });

  it('음수 index 는 맨 앞으로', () => {
    expect(reorderOpen(board(), 3, -5)).toEqual([3, 1, 2, 4]);
  });

  it('없는 항목이면 null', () => {
    expect(reorderOpen(board(), 999, 0)).toBeNull();
  });

  it('완료 항목은 항상 뒤에 붙는다', () => {
    const items = [item(1, 0), item(2, 1, '2026-08-20T00:00:00Z'), item(3, 2)];
    expect(reorderOpen(items, 3, 0)).toEqual([3, 1, 2]);
  });
});

describe('applyOrderLocal — 보낸 순서를 화면에 먼저 반영', () => {
  it('position 이 보낸 순서대로 매겨진다', () => {
    const next = applyOrderLocal(board(), [4, 3, 2, 1]);
    expect(ids(sortItems(next))).toEqual([4, 3, 2, 1]);
  });

  it('ids 에 없는 항목은 건드리지 않는다', () => {
    const next = applyOrderLocal(board(), [2, 1]);
    expect(next.find(i => i.id === 4)!.position).toBe(3);
  });
});

describe('dueBadge — KST 달력 날짜 기준', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // KST 2026-08-21 08:00 (= UTC 2026-08-20 23:00). 순수 UTC 비교였다면 아직 '어제'다.
    vi.setSystemTime(new Date('2026-08-20T23:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('마감일이 없으면 배지도 없다', () => {
    expect(dueBadge(null)).toBeNull();
    expect(dueBadge(undefined)).toBeNull();
    expect(dueBadge('')).toBeNull();
  });

  it('오늘이면 "오늘"', () => {
    const b = dueBadge('2026-08-21')!;
    expect(b.tone).toBe('today');
    expect(b.text).toContain('오늘');
  });

  it('마감일 당일 아침에 아직 지나지 않았다 (KST 09시 소멸 버그 방지)', () => {
    expect(dueBadge('2026-08-21')!.tone).not.toBe('overdue');
  });

  it('지났으면 며칠 지났는지 함께 보여준다', () => {
    const b = dueBadge('2026-08-18')!;
    expect(b.tone).toBe('overdue');
    expect(b.text).toContain('3일 지남');
  });

  it('3일 이내면 soon, 그 뒤는 normal', () => {
    expect(dueBadge('2026-08-24')!.tone).toBe('soon');
    expect(dueBadge('2026-08-25')!.tone).toBe('normal');
  });

  it('완료한 항목은 날짜만 담담하게 (지났다고 빨갛게 재촉하지 않는다)', () => {
    const b = dueBadge('2026-08-01', true)!;
    expect(b.tone).toBe('normal');
    expect(b.text).not.toContain('지남');
    expect(b.text).toBe('26.08.01');
  });

  it('ISO 시각이 들어와도 날짜만 쓴다', () => {
    expect(dueBadge('2026-08-25T00:00:00.000Z')!.text).toContain('26.08.25');
  });
});

describe('shortDate', () => {
  it('26.08.20 형식', () => {
    expect(shortDate('2026-08-20T05:00:00.000Z')).toBe('26.08.20');
  });

  it('없으면 빈 문자열', () => {
    expect(shortDate(null)).toBe('');
    expect(shortDate(undefined)).toBe('');
  });
});
