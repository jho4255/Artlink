/**
 * Admin 할 일 보드의 순수 로직 (컴포넌트 없이 테스트 가능).
 *
 * 이름이 kanban 인 이유: 처음엔 3열 칸반이었다가 목록형 체크리스트로 바뀌었다.
 * 열 개념은 없다 — 완료 여부는 `doneAt` 하나뿐이다.
 *
 * 정렬 규칙은 백엔드 `backend/src/lib/kanban.ts` 의 sortItems 와 **같아야** 한다.
 * 낙관적 업데이트로 화면을 먼저 바꾸고 서버 응답으로 확정하는데, 규칙이 다르면
 * 체크한 줄이 잠깐 한 자리에 있다가 다른 자리로 튄다.
 */
import { getDday } from './utils';

export interface KanbanMember {
  id: number;
  name: string;
  nickname?: string | null;
  avatar?: string | null;
}

/**
 * 항목 안의 세부항목(체크리스트).
 * 상위 항목과 달리 **체크해도 자리가 안 바뀐다** — 서너 줄짜리 목록에서 체크할 때마다
 * 줄이 튀어 다니면 다음 걸 누르기가 힘들다. 언제나 position 순 그대로다.
 */
export interface TodoSubtask {
  id: number;
  cardId: number;
  title: string;
  doneAt?: string | null;
  position: number;
}

export interface TodoItem {
  id: number;
  boardId: number;
  title: string;
  body?: string | null;
  assigneeId?: number | null;
  assignee?: KanbanMember | null;
  dueDate?: string | null;
  position: number;
  doneAt?: string | null;
  createdBy?: KanbanMember | null;
  createdAt: string;
  subtasks?: TodoSubtask[];
  _count?: { comments: number };
}

/**
 * 보드는 **항목까지 통째로** 실려 온다 (GET /kanban/boards).
 * 화면이 한 장뿐이고 모든 보드를 그 자리에서 펼치기 때문 — 보드별로 따로 부르면 N+1 이 된다.
 */
export interface TodoBoard {
  id: number;
  title: string;
  description?: string | null;
  position: number;
  createdBy?: KanbanMember | null;
  createdAt: string;
  cards: TodoItem[];
  counts: { done: number; open: number; total: number };
}

export interface TodoComment {
  id: number;
  cardId: number;
  authorId?: number | null;
  author?: KanbanMember | null;
  body: string;
  createdAt: string;
}

export const isDone = (item: { doneAt?: string | null }): boolean => !!item.doneAt;

/** 세부항목은 적은 순서 그대로 (완료해도 자리 유지). */
export function sortSubtasks(subtasks?: TodoSubtask[]): TodoSubtask[] {
  return [...(subtasks ?? [])].sort((a, b) => a.position - b.position || a.id - b.id);
}

/**
 * 세부항목 진행 — "2/3".
 * 세부항목이 없으면 null 을 돌려준다(배지를 아예 안 그리기 위함).
 */
export function subProgress(item: TodoItem): { done: number; total: number } | null {
  const subs = item.subtasks ?? [];
  if (subs.length === 0) return null;
  return { done: subs.filter(isDone).length, total: subs.length };
}

/**
 * 세부항목 체크를 화면에 먼저 반영 (낙관적 업데이트).
 * 상위 항목은 **건드리지 않는다** — 세부를 다 끝냈다고 자동 완료시키지 않는다(라우트 주석 참고).
 */
export function toggleSubLocal(items: TodoItem[], subtaskId: number, done: boolean): TodoItem[] {
  return items.map(item => {
    if (!item.subtasks?.some(s => s.id === subtaskId)) return item;
    return {
      ...item,
      subtasks: item.subtasks.map(s =>
        s.id === subtaskId ? { ...s, doneAt: done ? (s.doneAt ?? new Date().toISOString()) : null } : s),
    };
  });
}

/**
 * 화면 순서: 안 한 일(position 순) → 완료한 일(최근 체크 순).
 * 체크해도 position 은 건드리지 않으므로, 체크를 풀면 원래 자리로 돌아온다.
 */
export function sortItems(items: TodoItem[]): TodoItem[] {
  const time = (v?: string | null) => (v ? new Date(v).getTime() : 0);
  return [...items].sort((a, b) => {
    const ad = isDone(a), bd = isDone(b);
    if (ad !== bd) return ad ? 1 : -1;
    if (ad && bd) return time(b.doneAt) - time(a.doneAt) || a.id - b.id;
    return a.position - b.position || a.id - b.id;
  });
}

/** 완료/미완료 개수 — 보드 목록 카드와 진행 표시줄에 쓴다. */
export function progressOf(items: TodoItem[]): { done: number; open: number; total: number; percent: number } {
  const done = items.filter(isDone).length;
  const total = items.length;
  return { done, open: total - done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

/**
 * 체크/해제를 화면에 먼저 반영한다 (낙관적 업데이트).
 * 서버와 같은 규칙: 이미 체크된 걸 또 체크해도 시각을 덮어쓰지 않는다.
 */
export function toggleDoneLocal(items: TodoItem[], id: number, done: boolean): TodoItem[] {
  return items.map(i => (i.id === id ? { ...i, doneAt: done ? (i.doneAt ?? new Date().toISOString()) : null } : i));
}

/**
 * 안 한 일 목록 안에서 한 칸 위/아래로 (모바일 ↑↓ 버튼).
 * @returns 서버로 보낼 **전체 순서** id 배열. 옮길 수 없으면 null.
 */
export function shiftItem(items: TodoItem[], id: number, dir: -1 | 1): number[] | null {
  const open = sortItems(items).filter(i => !isDone(i));
  const from = open.findIndex(i => i.id === id);
  if (from === -1) return null;
  const to = from + dir;
  if (to < 0 || to >= open.length) return null;
  const next = [...open];
  [next[from], next[to]] = [next[to], next[from]];
  // 완료 항목은 position 순서를 그대로 유지한 채 뒤에 붙인다
  const doneIds = [...items].filter(isDone).sort((a, b) => a.position - b.position || a.id - b.id).map(i => i.id);
  return [...next.map(i => i.id), ...doneIds];
}

/**
 * 드래그로 끌어다 놓았을 때의 **전체 순서** id 배열.
 * @param toIndex 안 한 일 목록 기준 목표 위치
 */
export function reorderOpen(items: TodoItem[], id: number, toIndex: number): number[] | null {
  const open = sortItems(items).filter(i => !isDone(i));
  const from = open.findIndex(i => i.id === id);
  if (from === -1) return null;
  const rest = open.filter(i => i.id !== id);
  const index = Math.max(0, Math.min(Math.trunc(toIndex) || 0, rest.length));
  rest.splice(index, 0, open[from]);
  if (rest.every((i, k) => i.id === open[k].id)) return null; // 제자리
  const doneIds = [...items].filter(isDone).sort((a, b) => a.position - b.position || a.id - b.id).map(i => i.id);
  return [...rest.map(i => i.id), ...doneIds];
}

/** 서버로 보낸 순서를 화면에 먼저 반영 (낙관적 업데이트). */
export function applyOrderLocal(items: TodoItem[], ids: number[]): TodoItem[] {
  const rank = new Map(ids.map((id, i) => [id, i]));
  return items.map(i => (rank.has(i.id) ? { ...i, position: rank.get(i.id)! } : i));
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'normal';

/**
 * 마감일 배지 문구. KST 달력 날짜 기준(getDday) — 순수 new Date() 비교를 쓰면
 * 마감일 당일 오전 9시에 '지남'으로 바뀐다.
 */
export function dueBadge(dueDate?: string | null, done = false): { text: string; tone: DueTone } | null {
  if (!dueDate) return null;
  const d = getDday(dueDate);
  const date = String(dueDate).slice(0, 10).replace(/-/g, '.').slice(2);
  if (done) return { text: date, tone: 'normal' };
  if (d < 0) return { text: `${date} · ${-d}일 지남`, tone: 'overdue' };
  if (d === 0) return { text: `${date} · 오늘`, tone: 'today' };
  if (d <= 3) return { text: `${date} · D-${d}`, tone: 'soon' };
  return { text: `${date} · D-${d}`, tone: 'normal' };
}

export const dueToneClass: Record<DueTone, string> = {
  overdue: 'bg-red-50 text-red-600 border-red-200',
  today: 'bg-red-50 text-red-600 border-red-200',
  soon: 'bg-amber-50 text-amber-700 border-amber-200',
  normal: 'bg-gray-50 text-gray-500 border-gray-200',
};

/** 완료 시각 표기 — "26.08.20" */
export const shortDate = (v?: string | null): string =>
  v ? String(v).slice(0, 10).replace(/-/g, '.').slice(2) : '';
