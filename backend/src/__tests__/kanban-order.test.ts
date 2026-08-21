/**
 * 할 일 보드의 정렬·순서 계산 (순수 함수) — DB 없이.
 *
 * 여기서 지키려는 것 둘:
 *   ① position 은 언제나 "보드 안에서 0부터 연속"
 *   ② **체크해도 position 은 안 바뀐다** — 정렬로만 뒤로 간다.
 *      실제로 줄을 옮겨버리면 체크를 푸는 순간 원래 자리로 돌아올 수 없다.
 */
import { describe, it, expect } from 'vitest';
import { sortItems, reorderItems, moveInList, type OrderedItem } from '../lib/kanban';

const item = (id: number, position: number, doneAt: string | null = null): OrderedItem => ({ id, position, doneAt });

const board = (): OrderedItem[] => [
  item(1, 0), item(2, 1), item(3, 2), item(4, 3),
];

const ids = (rows: OrderedItem[]) => rows.map(r => r.id);

/** 재정렬 결과를 실제로 반영해 본다 (라우트가 하는 일과 동일). */
function apply(items: OrderedItem[], updates: { id: number; position: number }[]): OrderedItem[] {
  const byId = new Map(updates.map(u => [u.id, u]));
  return items.map(i => (byId.has(i.id) ? { ...i, position: byId.get(i.id)!.position } : i));
}

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

  it('체크 시각이 같아도 순서가 흔들리지 않는다', () => {
    const t = '2026-08-20T00:00:00Z';
    expect(ids(sortItems([item(9, 0, t), item(2, 1, t), item(5, 2, t)]))).toEqual([2, 5, 9]);
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

describe('reorderItems — 클라이언트가 보낸 전체 순서대로', () => {
  it('0..n-1 로 다시 매긴다', () => {
    const next = apply(board(), reorderItems(board(), [4, 3, 2, 1]));
    expect(sortItems(next).map(r => r.position)).toEqual([0, 1, 2, 3]);
    expect(ids(sortItems(next))).toEqual([4, 3, 2, 1]);
  });

  it('바뀐 항목만 돌려준다', () => {
    // 1 과 2 만 자리를 바꾸면 3,4 는 그대로
    expect(reorderItems(board(), [2, 1, 3, 4]).map(u => u.id).sort()).toEqual([1, 2]);
  });

  it('순서가 같으면 빈 배열', () => {
    expect(reorderItems(board(), [1, 2, 3, 4])).toEqual([]);
  });

  it('빠진 항목은 원래 순서대로 뒤에 붙는다 (다른 Admin 이 그 사이 추가한 경우)', () => {
    const next = apply(board(), reorderItems(board(), [3, 1]));
    expect(ids(sortItems(next))).toEqual([3, 1, 2, 4]);
  });

  it('보드에 없는 id 는 조용히 무시한다', () => {
    const next = apply(board(), reorderItems(board(), [999, 4, 3, 2, 1]));
    expect(ids(sortItems(next))).toEqual([4, 3, 2, 1]);
  });

  it('같은 id 가 두 번 와도 한 번만 센다', () => {
    const next = apply(board(), reorderItems(board(), [2, 2, 1, 3, 4]));
    expect(ids(sortItems(next))).toEqual([2, 1, 3, 4]);
  });

  it('빈 ids 면 원래 순서가 유지된다', () => {
    expect(reorderItems(board(), [])).toEqual([]);
  });

  it('완료 항목의 position 도 함께 정리된다 (구멍이 남지 않음)', () => {
    const items = [item(1, 0, '2026-08-20T00:00:00Z'), item(2, 1), item(3, 2)];
    const next = apply(items, reorderItems(items, [3, 2, 1]));
    expect(next.map(r => r.position).sort()).toEqual([0, 1, 2]);
  });
});

describe('moveInList — 보드 순서', () => {
  it('뒤에서 앞으로', () => {
    expect(moveInList([1, 2, 3], 3, 0)).toEqual([
      { id: 3, position: 0 }, { id: 1, position: 1 }, { id: 2, position: 2 },
    ]);
  });

  it('제자리면 빈 배열', () => {
    expect(moveInList([1, 2, 3], 2, 1)).toEqual([]);
  });

  it('없는 id 면 빈 배열', () => {
    expect(moveInList([1, 2, 3], 99, 0)).toEqual([]);
  });

  it('범위를 넘는 index 는 맨 뒤로', () => {
    expect(moveInList([1, 2, 3], 1, 99)).toEqual([
      { id: 2, position: 0 }, { id: 3, position: 1 }, { id: 1, position: 2 },
    ]);
  });

  it('음수 index 는 맨 앞으로', () => {
    expect(moveInList([1, 2, 3], 3, -5)).toEqual([
      { id: 3, position: 0 }, { id: 1, position: 1 }, { id: 2, position: 2 },
    ]);
  });
});
