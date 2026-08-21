/**
 * 마이페이지(Admin) > 할 일 보드 — 회의 내용·할 일 정리.
 *
 * ## 이 화면이 하는 일
 * Admin 계정끼리만 보이는 체크리스트다. **화면은 이 한 장뿐이다.**
 * 보드를 여러 개 만들고(회의별·주제별), 각 보드의 할 일 목록이 그 자리에 그대로 펼쳐진다.
 * 보드를 클릭해 안으로 들어가는 단계는 없다 — 추가·체크·순서·세부항목까지 전부 여기서 끝낸다.
 * (보드가 많아지면 헤더를 눌러 접을 수 있고, 접어 둔 보드는 브라우저에 기억된다.)
 *
 * ## 3단 구조
 *   보드(KanbanBoard) → 항목(KanbanCard) → 세부항목(KanbanSubtask)
 * 세부항목도 마찬가지로 목록에 그대로 펼쳐지고 거기서 바로 추가·체크·이름수정한다.
 *
 * ## 완료는 doneAt 하나로만 판정한다
 * 상태 필드를 따로 두지 않는다. 두 곳에 두면 반드시 어긋나고, 어긋난 쪽이 화면이면
 * "체크했는데 안 된 것처럼 보이는" 상태가 된다.
 *
 * ## 체크해도 줄을 옮기지 않는다
 * 완료 항목은 **정렬로만** 아래로 내려간다(`sortItems`). 실제로 position 을 바꿔버리면
 * 체크를 푸는 순간 원래 자리로 돌아올 수 없다.
 * 단 **세부항목은 정렬조차 안 바뀐다** — 서너 줄에서 줄이 튀면 다음 걸 누르기 힘들다.
 * 세부를 다 체크해도 상위 항목을 자동 완료시키지 않는다(확인·보고가 남아 있을 수 있다).
 *
 * ## 순서 바꾸기 두 가지
 *   1. 드래그앤드롭 — HTML5 네이티브 DnD. 데스크톱 전용이다(터치에선 이벤트가 안 뜬다).
 *   2. 항목의 ↑ ↓ 버튼 — 모바일에서 쓰는 길. 이 사이트는 모바일웹이 기본이라 **둘 다 필요하다**.
 *   ※ Framer Motion 의 drag 는 쓰지 않는다(CLAUDE.md 제약 9 — drag + animate 이중 제어 충돌).
 *   ※ 순서 변경은 **전체 순서 id 배열**을 통째로 보낸다. "몇 번째 앞으로" 를 주고받으면
 *     완료 항목이 뒤로 밀려 보이는 화면과 실제 position 이 어긋나 계산이 틀어진다.
 *   ※ 드래그는 **같은 보드 안에서만** — 보드를 건너뛰면 그 항목이 어느 보드 소속인지가 흔들린다.
 *
 * ## 데이터
 * `GET /kanban/boards` 하나가 보드·항목·세부항목을 통째로 준다. 쿼리 키도 `['todo-boards']` 하나뿐이라
 * 모든 변경은 이 키만 무효화하면 된다.
 *
 * ## 관련 API (전부 Admin 전용)
 *   GET/POST         /kanban/boards                보드 목록(항목 포함)·생성
 *   PATCH/DELETE     /kanban/boards/:id            이름 수정·삭제
 *   PATCH            /kanban/boards/:id/reorder    항목 순서 { ids: 전체 순서 }
 *   POST             /kanban/boards/:id/cards      항목 추가
 *   PATCH/DELETE     /kanban/cards/:id             항목 수정(완료 체크 포함)·삭제
 *   POST             /kanban/cards/:id/subtasks    세부항목 추가
 *   PATCH/DELETE     /kanban/subtasks/:id          세부항목 수정(체크·이름)·삭제
 *   GET/POST         /kanban/cards/:id/comments    댓글
 *   DELETE           /kanban/comments/:id          댓글 삭제(작성자 본인만)
 *   GET              /kanban/members               담당자 후보(Admin 목록)
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, X, Trash2, ChevronUp, ChevronDown, ChevronRight, MessageSquare, Calendar,
  User as UserIcon, GripVertical, Pencil, Check, ListChecks,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { displayName } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import {
  sortItems, progressOf, isDone, toggleDoneLocal, shiftItem, reorderOpen, applyOrderLocal,
  sortSubtasks, subProgress, toggleSubLocal,
  dueBadge, dueToneClass, shortDate,
  type TodoItem, type TodoSubtask, type TodoBoard, type TodoComment, type KanbanMember,
} from '@/lib/kanban';

const errMsg = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

/** "YYYY-MM-DD" — <input type="date"> 값으로 쓰기 위해 앞 10자만. */
const dateInputValue = (v?: string | null) => (v ? String(v).slice(0, 10) : '');

const BOARDS_KEY = ['todo-boards'];

/**
 * 접어 둔 보드 기억하기.
 * 사람마다 다르고 잃어도 그만인 값이라 localStorage 로 충분하다.
 * 시크릿 창·사이트 데이터 차단에서 접근 자체가 튈 수 있어 읽기·쓰기 모두 try/catch 로 감싼다.
 */
const COLLAPSED_KEY = 'artlink-todo-collapsed';
function loadCollapsed(): number[] {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === 'number') : [];
  } catch { return []; }
}
function saveCollapsed(ids: number[]) {
  try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(ids)); } catch { /* 저장 못 해도 화면은 정상 동작 */ }
}

export default function KanbanSection() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [editing, setEditing] = useState<TodoBoard | null>(null);
  const [deleting, setDeleting] = useState<TodoBoard | null>(null);
  const [collapsed, setCollapsed] = useState<number[]>(loadCollapsed);

  const toggleCollapse = (id: number) => setCollapsed(prev => {
    const next = prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id];
    saveCollapsed(next);
    return next;
  });

  const { data: boards = [], isLoading } = useQuery<TodoBoard[]>({
    queryKey: BOARDS_KEY,
    queryFn: () => api.get('/kanban/boards').then(r => r.data),
  });

  const { data: members = [] } = useQuery<KanbanMember[]>({
    queryKey: ['todo-members'],
    queryFn: () => api.get('/kanban/members').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: (body: { title: string; description?: string }) => api.post('/kanban/boards', body).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BOARDS_KEY });
      setCreating(false); setTitle(''); setDescription('');
    },
    onError: (e) => toast.error(errMsg(e, '보드 생성에 실패했습니다.')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: number; title: string; description?: string }) =>
      api.patch(`/kanban/boards/${id}`, body).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BOARDS_KEY });
      setEditing(null);
      toast.success('보드를 수정했습니다.');
    },
    onError: (e) => toast.error(errMsg(e, '수정에 실패했습니다.')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/kanban/boards/${id}`).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BOARDS_KEY });
      setDeleting(null);
      toast.success('보드를 삭제했습니다.');
    },
    onError: (e) => toast.error(errMsg(e, '삭제에 실패했습니다.')),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-serif text-gray-900">할 일 보드</h2>
          <p className="text-sm text-gray-500 mt-0.5">회의 내용과 할 일을 보드로 나눠 정리합니다. 관리자만 볼 수 있습니다.</p>
        </div>
        <button
          onClick={() => setCreating(v => !v)}
          className="shrink-0 flex items-center gap-1 px-3 py-2 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-700 transition-colors cursor-pointer"
        >
          <Plus size={15} /> 새 보드
        </button>
      </div>

      {creating && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (!title.trim()) return toast.error('보드 이름을 입력해주세요.'); createMutation.mutate({ title: title.trim(), description: description.trim() }); }}
          className="border border-gray-200 rounded-2xl p-4 space-y-3"
        >
          <input
            autoFocus value={title} onChange={e => setTitle(e.target.value)} maxLength={100}
            placeholder="보드 이름 (예: 2026 상반기 운영 회의)"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900"
          />
          <input
            value={description} onChange={e => setDescription(e.target.value)} maxLength={300}
            placeholder="설명 (선택)"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setCreating(false); setTitle(''); setDescription(''); }} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-900 cursor-pointer">취소</button>
            <button type="submit" disabled={createMutation.isPending} className="px-3 py-1.5 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50 cursor-pointer">만들기</button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1].map(i => <div key={i} className="h-40 rounded-2xl bg-gray-100 animate-pulse" />)}
        </div>
      ) : boards.length === 0 ? (
        <div className="border border-dashed border-gray-200 rounded-2xl py-14 text-center">
          <ListChecks size={28} className="mx-auto text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">아직 보드가 없습니다. [새 보드]로 시작하세요.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {boards.map(board => (
            <BoardSection
              key={board.id}
              board={board}
              members={members}
              collapsed={collapsed.includes(board.id)}
              onToggleCollapse={() => toggleCollapse(board.id)}
              onEdit={() => setEditing(board)}
              onDelete={() => setDeleting(board)}
            />
          ))}
        </div>
      )}

      {editing && (
        <BoardEditModal
          board={editing}
          pending={updateMutation.isPending}
          onClose={() => setEditing(null)}
          onSave={(body) => updateMutation.mutate({ id: editing.id, ...body })}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="보드를 삭제할까요?"
        message={`"${deleting?.title ?? ''}" 보드의 항목 ${deleting?.counts.total ?? 0}개와 세부항목·댓글이 모두 함께 삭제됩니다. 되돌릴 수 없습니다.`}
        confirmText="삭제"
        variant="danger"
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function BoardEditModal({ board, pending, onClose, onSave }: {
  board: TodoBoard;
  pending: boolean;
  onClose: () => void;
  onSave: (body: { title: string; description: string }) => void;
}) {
  const [title, setTitle] = useState(board.title);
  const [description, setDescription] = useState(board.description ?? '');
  return (
    <Modal onClose={onClose} title="보드 수정">
      <form
        onSubmit={e => { e.preventDefault(); if (!title.trim()) return toast.error('보드 이름을 입력해주세요.'); onSave({ title: title.trim(), description: description.trim() }); }}
        className="space-y-3"
      >
        <input autoFocus value={title} onChange={e => setTitle(e.target.value)} maxLength={100} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900" />
        <input value={description} onChange={e => setDescription(e.target.value)} maxLength={300} placeholder="설명 (선택)" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900" />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-900 cursor-pointer">취소</button>
          <button type="submit" disabled={pending} className="px-3 py-1.5 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50 cursor-pointer">저장</button>
        </div>
      </form>
    </Modal>
  );
}

// ========== 보드 한 덩어리 (제목 + 그 보드의 할 일 목록) ==========

function BoardSection({ board, members, collapsed, onToggleCollapse, onEdit, onDelete }: {
  board: TodoBoard;
  members: KanbanMember[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const [openItemId, setOpenItemId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: BOARDS_KEY });

  /** 낙관적 업데이트 — 이 보드의 항목만 갈아끼운다 (다른 보드는 그대로 둔다). */
  const patchBoard = (change: (cards: TodoItem[]) => TodoItem[]) => {
    const prev = queryClient.getQueryData<TodoBoard[]>(BOARDS_KEY);
    if (prev) {
      queryClient.setQueryData<TodoBoard[]>(BOARDS_KEY,
        prev.map(b => (b.id === board.id ? { ...b, cards: change(b.cards) } : b)));
    }
    return prev;
  };

  const toggleMutation = useMutation({
    mutationFn: ({ id, done }: { id: number; done: boolean }) => api.patch(`/kanban/cards/${id}`, { done }).then(r => r.data),
    // 체크는 즉각 반응해야 한다 — 서버를 기다리면 두 번 누르게 된다
    onMutate: async ({ id, done }) => {
      await queryClient.cancelQueries({ queryKey: BOARDS_KEY });
      return { prev: patchBoard(cards => toggleDoneLocal(cards, id, done)) };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(BOARDS_KEY, ctx.prev);
      toast.error(errMsg(e, '상태 변경에 실패했습니다.'));
    },
    onSettled: invalidate,
  });

  const reorderMutation = useMutation({
    mutationFn: (ids: number[]) => api.patch(`/kanban/boards/${board.id}/reorder`, { ids }).then(r => r.data),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: BOARDS_KEY });
      return { prev: patchBoard(cards => applyOrderLocal(cards, ids)) };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(BOARDS_KEY, ctx.prev);
      toast.error(errMsg(e, '순서 변경에 실패했습니다.'));
    },
    onSettled: invalidate,
  });

  const createMutation = useMutation({
    mutationFn: (title: string) => api.post(`/kanban/boards/${board.id}/cards`, { title }).then(r => r.data),
    onSuccess: invalidate,
    onError: (e) => toast.error(errMsg(e, '추가에 실패했습니다.')),
  });

  const subAddMutation = useMutation({
    mutationFn: ({ cardId, title }: { cardId: number; title: string }) =>
      api.post(`/kanban/cards/${cardId}/subtasks`, { title }).then(r => r.data),
    onSuccess: invalidate,
    onError: (e) => toast.error(errMsg(e, '세부항목 추가에 실패했습니다.')),
  });

  const subToggleMutation = useMutation({
    mutationFn: ({ id, done }: { id: number; done: boolean }) =>
      api.patch(`/kanban/subtasks/${id}`, { done }).then(r => r.data),
    // 여러 개를 연달아 누르는 자리라 즉각 반응이 더 중요하다
    onMutate: async ({ id, done }) => {
      await queryClient.cancelQueries({ queryKey: BOARDS_KEY });
      return { prev: patchBoard(cards => toggleSubLocal(cards, id, done)) };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(BOARDS_KEY, ctx.prev);
      toast.error(errMsg(e, '상태 변경에 실패했습니다.'));
    },
    onSettled: invalidate,
  });

  const subRenameMutation = useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) =>
      api.patch(`/kanban/subtasks/${id}`, { title }).then(r => r.data),
    onSuccess: invalidate,
    onError: (e) => toast.error(errMsg(e, '수정에 실패했습니다.')),
  });

  const subDeleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/kanban/subtasks/${id}`).then(r => r.data),
    onSuccess: invalidate,
    onError: (e) => toast.error(errMsg(e, '삭제에 실패했습니다.')),
  });

  const subHandlers = {
    onSubAdd: (cardId: number, title: string) => subAddMutation.mutate({ cardId, title }),
    onSubToggle: (id: number, done: boolean) => subToggleMutation.mutate({ id, done }),
    onSubRename: (id: number, title: string) => subRenameMutation.mutate({ id, title }),
    onSubDelete: (id: number) => subDeleteMutation.mutate(id),
  };

  const endDrag = () => { setDraggingId(null); setDropIndex(null); };
  const submitReorder = (ids: number[] | null) => { if (ids) reorderMutation.mutate(ids); };

  const items = sortItems(board.cards);
  const openItems = items.filter(i => !isDone(i));
  const doneItems = items.filter(isDone);
  const stat = progressOf(board.cards);
  const openItem = board.cards.find(i => i.id === openItemId) ?? null;

  return (
    <section className="border border-gray-200 rounded-2xl overflow-hidden" data-board={board.id}>
      {/* 보드 머리말 */}
      <div className="flex items-start gap-2 px-4 py-3 bg-gray-50/70 border-b border-gray-200">
        <button
          onClick={onToggleCollapse}
          aria-label={collapsed ? `${board.title} 펼치기` : `${board.title} 접기`}
          aria-expanded={!collapsed}
          className="shrink-0 mt-0.5 p-0.5 rounded text-gray-400 hover:text-gray-900 hover:bg-gray-200 transition-colors cursor-pointer"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>

        <button onClick={onToggleCollapse} className="min-w-0 flex-1 text-left cursor-pointer focus:outline-none">
          <p className="text-base font-medium text-gray-900 truncate">{board.title}</p>
          {board.description && <p className="text-xs text-gray-500 mt-0.5 truncate">{board.description}</p>}
        </button>

        {stat.total > 0 && (
          <div className="shrink-0 flex items-center gap-2 mt-1">
            <div className="hidden sm:block w-20 h-1.5 rounded-full bg-gray-200 overflow-hidden">
              <div className="h-full rounded-full bg-gray-900 transition-all" style={{ width: `${stat.percent}%` }} />
            </div>
            <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">{stat.done}/{stat.total}</span>
          </div>
        )}

        <div className="shrink-0 flex gap-0.5 mt-0.5">
          <button onClick={onEdit} aria-label={`${board.title} 수정`} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-900 hover:bg-gray-200 cursor-pointer"><Pencil size={14} /></button>
          <button onClick={onDelete} aria-label={`${board.title} 삭제`} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"><Trash2 size={14} /></button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-3 space-y-1.5">
          {/* 안 한 일 */}
          <div
            // 여기서는 놓을 수 있게만 하고 **위치는 건드리지 않는다.**
            // 줄 사이 여백에서도 이 핸들러가 뜨는데, 그때마다 목표를 '맨 끝'으로 덮어쓰면
            // 마지막 순간이 하필 여백이었을 때 항목이 엉뚱하게 맨 아래로 간다(2026-08-21 E2E 에서 잡음).
            onDragOver={e => { if (draggingId !== null) e.preventDefault(); }}
            onDrop={e => { e.preventDefault(); if (draggingId !== null) { submitReorder(reorderOpen(board.cards, draggingId, dropIndex ?? openItems.length)); endDrag(); } }}
            className="space-y-1.5"
          >
            {openItems.length === 0 && doneItems.length === 0 && (
              <p className="py-6 text-center text-sm text-gray-400">할 일이 없습니다. 아래 [+ 항목]으로 추가하세요.</p>
            )}
            {openItems.length === 0 && doneItems.length > 0 && (
              <p className="py-4 text-center text-sm text-gray-400">남은 할 일이 없습니다.</p>
            )}

            {openItems.map((item, i) => (
              <div key={item.id}>
                {draggingId !== null && dropIndex === i && <DropLine />}
                <ItemRow
                  item={item}
                  dragging={draggingId === item.id}
                  canUp={i > 0}
                  canDown={i < openItems.length - 1}
                  onOpen={() => setOpenItemId(item.id)}
                  onToggle={(done) => toggleMutation.mutate({ id: item.id, done })}
                  onShift={(dir) => submitReorder(shiftItem(board.cards, item.id, dir))}
                  onDragStart={() => setDraggingId(item.id)}
                  onDragEnd={endDrag}
                  onDragOverRow={(before) => {
                    if (draggingId === null) return;
                    const rest = openItems.filter(x => x.id !== draggingId);
                    const pos = rest.findIndex(x => x.id === item.id);
                    setDropIndex(pos === -1 ? rest.length : pos + (before ? 0 : 1));
                  }}
                  {...subHandlers}
                />
              </div>
            ))}
            {draggingId !== null && dropIndex !== null && dropIndex >= openItems.filter(i => i.id !== draggingId).length && <DropLine />}
          </div>

          {/* 항목 추가 */}
          {adding ? (
            <QuickAdd
              pending={createMutation.isPending}
              onCancel={() => setAdding(false)}
              onSubmit={(title) => createMutation.mutate(title)}
            />
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1 w-full px-3 py-2 text-sm text-gray-400 hover:text-gray-900 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
            >
              <Plus size={14} /> 항목
            </button>
          )}

          {/* 완료한 일 */}
          {doneItems.length > 0 && (
            <div className="space-y-1.5">
              <button
                onClick={() => setHideDone(v => !v)}
                className="flex items-center gap-2 w-full pt-1 text-xs text-gray-400 hover:text-gray-700 cursor-pointer"
              >
                <span className="h-px flex-1 bg-gray-200" />
                <span className="shrink-0 whitespace-nowrap">
                  {hideDone ? `완료한 항목 ${doneItems.length}개 보기` : `완료한 항목 ${doneItems.length}개 숨기기`}
                </span>
                <span className="h-px flex-1 bg-gray-200" />
              </button>
              {!hideDone && doneItems.map(item => (
                <ItemRow
                  key={item.id}
                  item={item}
                  dragging={false}
                  canUp={false}
                  canDown={false}
                  onOpen={() => setOpenItemId(item.id)}
                  onToggle={(done) => toggleMutation.mutate({ id: item.id, done })}
                  onShift={() => {}}
                  onDragStart={() => {}}
                  onDragEnd={() => {}}
                  onDragOverRow={() => {}}
                  {...subHandlers}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {openItem && (
        <ItemModal item={openItem} members={members} onClose={() => setOpenItemId(null)} />
      )}
    </section>
  );
}

const DropLine = () => <div className="h-0.5 my-1 rounded-full bg-gray-900" />;

function QuickAdd({ pending, onCancel, onSubmit }: { pending: boolean; onCancel: () => void; onSubmit: (title: string) => void }) {
  const [title, setTitle] = useState('');
  return (
    <form
      onSubmit={e => { e.preventDefault(); const t = title.trim(); if (!t) return; onSubmit(t); setTitle(''); }}
      className="flex items-start gap-2"
    >
      <textarea
        autoFocus value={title} onChange={e => setTitle(e.target.value)} rows={1} maxLength={200}
        placeholder="할 일을 적고 Enter"
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } if (e.key === 'Escape') onCancel(); }}
        className="min-w-0 flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:border-gray-900"
      />
      <button type="submit" disabled={pending} className="shrink-0 px-3 py-2 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50 cursor-pointer">추가</button>
      <button type="button" onClick={onCancel} className="shrink-0 p-2 text-gray-400 hover:text-gray-900 cursor-pointer" aria-label="닫기"><X size={16} /></button>
    </form>
  );
}

// ========== 목록 한 줄 (+ 세부항목) ==========

function ItemRow({ item, dragging, canUp, canDown, onOpen, onToggle, onShift, onDragStart, onDragEnd, onDragOverRow,
  onSubAdd, onSubToggle, onSubRename, onSubDelete }: {
  item: TodoItem;
  dragging: boolean;
  canUp: boolean;
  canDown: boolean;
  onOpen: () => void;
  onToggle: (done: boolean) => void;
  onShift: (dir: -1 | 1) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverRow: (before: boolean) => void;
  onSubAdd: (cardId: number, title: string) => void;
  onSubToggle: (id: number, done: boolean) => void;
  onSubRename: (id: number, title: string) => void;
  onSubDelete: (id: number) => void;
}) {
  const done = isDone(item);
  const due = dueBadge(item.dueDate, done);
  const comments = item._count?.comments ?? 0;
  const subs = sortSubtasks(item.subtasks);
  const sub = subProgress(item);
  const [addingSub, setAddingSub] = useState(false);

  return (
    <div
      draggable={!done}
      onDragStart={e => { if (done) return; e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragEnd={onDragEnd}
      onDragOver={e => {
        if (done) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        onDragOverRow(e.clientY < rect.top + rect.height / 2);
      }}
      className={`rounded-xl border px-3 py-2.5 transition-colors focus-within:ring-2 focus-within:ring-gray-900/15 ${dragging ? 'opacity-40' : ''} ${done ? 'border-transparent bg-gray-50/60' : 'border-gray-200 bg-white hover:border-gray-400'}`}
    >
      <div className="flex items-start gap-2">
        <button
          onClick={() => onToggle(!done)}
          aria-label={done ? '완료 해제' : '완료로 표시'}
          aria-pressed={done}
          className={`mt-0.5 shrink-0 w-[18px] h-[18px] rounded border flex items-center justify-center transition-colors cursor-pointer ${done ? 'bg-gray-900 border-gray-900 text-white' : 'border-gray-300 hover:border-gray-900'}`}
        >
          {done && <Check size={12} strokeWidth={3} />}
        </button>

        <button onClick={onOpen} className="min-w-0 flex-1 text-left cursor-pointer focus:outline-none">
          <p className={`text-sm leading-snug break-words ${done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{item.title}</p>
          {(item.assignee || due || comments > 0 || sub) && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
              {item.assignee && (
                <span className={`shrink-0 whitespace-nowrap inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${done ? 'border-gray-200 bg-white text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                  <UserIcon size={11} /> {displayName(item.assignee)}
                </span>
              )}
              {due && (
                <span className={`shrink-0 whitespace-nowrap inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${dueToneClass[due.tone]}`}>
                  <Calendar size={11} /> {due.text}
                </span>
              )}
              {sub && (
                <span className={`shrink-0 whitespace-nowrap inline-flex items-center gap-1 px-2 py-0.5 rounded-full border tabular-nums ${
                  sub.done === sub.total ? 'border-gray-300 bg-gray-100 text-gray-600' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                  <ListChecks size={11} /> {sub.done}/{sub.total}
                </span>
              )}
              {comments > 0 && (
                <span className="shrink-0 whitespace-nowrap inline-flex items-center gap-1 text-gray-400">
                  <MessageSquare size={11} /> {comments}
                </span>
              )}
            </div>
          )}
        </button>

        {done ? (
          <span className="shrink-0 mt-0.5 text-xs text-gray-400 tabular-nums whitespace-nowrap">{shortDate(item.doneAt)}</span>
        ) : (
          <div className="shrink-0 flex items-center">
            {/* 모바일용 순서 이동 — 드래그가 안 되는 터치 환경의 유일한 경로라 항상 노출한다 */}
            <button
              onClick={() => onShift(-1)} disabled={!canUp} aria-label="위로"
              className="p-1 rounded text-gray-300 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-300 cursor-pointer disabled:cursor-default"
            ><ChevronUp size={14} /></button>
            <button
              onClick={() => onShift(1)} disabled={!canDown} aria-label="아래로"
              className="p-1 rounded text-gray-300 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-300 cursor-pointer disabled:cursor-default"
            ><ChevronDown size={14} /></button>
            {/* 손잡이는 데스크톱에서만 — 터치에선 드래그가 아예 안 되므로 보이면 거짓말이 된다 */}
            <GripVertical size={14} className="hidden md:block ml-0.5 text-gray-300 cursor-grab" aria-hidden />
          </div>
        )}
      </div>

      {/*
        세부항목 — 모달을 열지 않고 이 자리에서 바로 보고 체크한다.
        완료된 상위 항목은 목록을 접고 개수만 남긴다(다 끝난 일까지 펼쳐 두면 화면이 길어진다).
      */}
      {!done && (
        <div className="mt-1.5 ml-[26px] space-y-0.5">
          {subs.map(st => (
            <SubtaskRow
              key={st.id}
              subtask={st}
              onToggle={(d) => onSubToggle(st.id, d)}
              onRename={(t) => onSubRename(st.id, t)}
              onDelete={() => onSubDelete(st.id)}
            />
          ))}
          {addingSub ? (
            <SubtaskAdd
              onCancel={() => setAddingSub(false)}
              onSubmit={(t) => onSubAdd(item.id, t)}
            />
          ) : (
            <button
              onClick={() => setAddingSub(true)}
              className="flex items-center gap-1 py-0.5 text-xs text-gray-400 hover:text-gray-900 cursor-pointer"
            >
              <Plus size={12} /> 세부항목
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 세부항목 한 줄 — 체크 / 이름 클릭해 수정 / 삭제 */
function SubtaskRow({ subtask, onToggle, onRename, onDelete }: {
  subtask: TodoSubtask;
  onToggle: (done: boolean) => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const done = isDone(subtask);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(subtask.title);

  const commit = () => {
    const t = text.trim();
    setEditing(false);
    if (!t) { setText(subtask.title); return toast.error('세부항목을 입력해주세요.'); }
    if (t !== subtask.title) onRename(t);
  };

  return (
    <div className="group flex items-center gap-2">
      <button
        onClick={() => onToggle(!done)}
        aria-label={done ? `${subtask.title} 완료 해제` : `${subtask.title} 완료로 표시`}
        aria-pressed={done}
        className={`shrink-0 w-[15px] h-[15px] rounded-[4px] border flex items-center justify-center transition-colors cursor-pointer ${done ? 'bg-gray-500 border-gray-500 text-white' : 'border-gray-300 hover:border-gray-900'}`}
      >
        {done && <Check size={10} strokeWidth={3} />}
      </button>

      {editing ? (
        <input
          autoFocus value={text} onChange={e => setText(e.target.value)} maxLength={200}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
            if (e.key === 'Escape') { setText(subtask.title); setEditing(false); }
          }}
          className="min-w-0 flex-1 px-1.5 py-0.5 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-gray-900"
        />
      ) : (
        <button
          onClick={() => { setText(subtask.title); setEditing(true); }}
          className={`min-w-0 flex-1 text-left text-[13px] leading-snug break-words cursor-text ${done ? 'text-gray-400 line-through' : 'text-gray-700'}`}
        >
          {subtask.title}
        </button>
      )}

      <button
        onClick={onDelete}
        aria-label={`${subtask.title} 삭제`}
        className="shrink-0 p-0.5 rounded text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer"
      ><X size={12} /></button>
    </div>
  );
}

/** 세부항목 입력칸 — Enter 로 계속 이어서 적을 수 있게 열어 둔다 */
function SubtaskAdd({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (title: string) => void }) {
  const [text, setText] = useState('');
  return (
    <form
      onSubmit={e => { e.preventDefault(); const t = text.trim(); if (!t) return onCancel(); onSubmit(t); setText(''); }}
      className="flex items-center gap-2"
    >
      <span className="shrink-0 w-[15px] h-[15px] rounded-[4px] border border-dashed border-gray-300" aria-hidden />
      <input
        autoFocus value={text} onChange={e => setText(e.target.value)} maxLength={200}
        placeholder="세부항목을 적고 Enter"
        onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
        onBlur={() => { if (!text.trim()) onCancel(); }}
        className="min-w-0 flex-1 px-1.5 py-0.5 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-gray-900"
      />
    </form>
  );
}

// ========== 항목 상세 모달 ==========

function ItemModal({ item, members, onClose }: {
  item: TodoItem;
  members: KanbanMember[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body ?? '');
  const [assigneeId, setAssigneeId] = useState<string>(item.assigneeId ? String(item.assigneeId) : '');
  const [dueDate, setDueDate] = useState(dateInputValue(item.dueDate));
  const [comment, setComment] = useState('');
  const [deleting, setDeleting] = useState(false);

  const dirty = title !== item.title
    || body !== (item.body ?? '')
    || assigneeId !== (item.assigneeId ? String(item.assigneeId) : '')
    || dueDate !== dateInputValue(item.dueDate);

  const { data: comments = [] } = useQuery<TodoComment[]>({
    queryKey: ['todo-comments', item.id],
    queryFn: () => api.get(`/kanban/cards/${item.id}/comments`).then(r => r.data),
  });

  const invalidateBoard = () => queryClient.invalidateQueries({ queryKey: BOARDS_KEY });

  const saveMutation = useMutation({
    mutationFn: () => api.patch(`/kanban/cards/${item.id}`, {
      title: title.trim(),
      body: body.trim(),
      assigneeId: assigneeId ? Number(assigneeId) : null,
      dueDate: dueDate || null,
    }).then(r => r.data),
    onSuccess: () => { invalidateBoard(); toast.success('저장했습니다.'); onClose(); },
    onError: (e) => toast.error(errMsg(e, '저장에 실패했습니다.')),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/kanban/cards/${item.id}`).then(r => r.data),
    onSuccess: () => { invalidateBoard(); toast.success('삭제했습니다.'); onClose(); },
    onError: (e) => toast.error(errMsg(e, '삭제에 실패했습니다.')),
  });

  const commentMutation = useMutation({
    mutationFn: (text: string) => api.post(`/kanban/cards/${item.id}/comments`, { body: text }).then(r => r.data),
    onSuccess: () => {
      setComment('');
      queryClient.invalidateQueries({ queryKey: ['todo-comments', item.id] });
      invalidateBoard(); // 줄의 댓글 수 배지
    },
    onError: (e) => toast.error(errMsg(e, '댓글 등록에 실패했습니다.')),
  });

  const commentDeleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/kanban/comments/${id}`).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todo-comments', item.id] });
      invalidateBoard();
    },
    onError: (e) => toast.error(errMsg(e, '댓글 삭제에 실패했습니다.')),
  });

  return (
    <Modal onClose={onClose} title={isDone(item) ? `완료 · ${shortDate(item.doneAt)}` : '할 일'}>
      <div className="space-y-4">
        <input
          value={title} onChange={e => setTitle(e.target.value)} maxLength={200}
          className="w-full px-3 py-2 text-base border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900"
        />

        <textarea
          value={body} onChange={e => setBody(e.target.value)} rows={6} maxLength={5000}
          placeholder="회의 내용·상세 메모"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-y focus:outline-none focus:border-gray-900"
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block min-w-0">
            <span className="block text-xs text-gray-500 mb-1">담당자</span>
            <select
              value={assigneeId} onChange={e => setAssigneeId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900 cursor-pointer"
            >
              <option value="">지정 안 함</option>
              {members.map(m => <option key={m.id} value={m.id}>{displayName(m)}</option>)}
            </select>
          </label>
          <label className="block min-w-0">
            <span className="block text-xs text-gray-500 mb-1">마감일</span>
            <input
              type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900"
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <button onClick={() => setDeleting(true)} className="flex items-center gap-1 text-sm text-gray-400 hover:text-red-600 cursor-pointer">
            <Trash2 size={14} /> 삭제
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-900 cursor-pointer">닫기</button>
            <button
              onClick={() => { if (!title.trim()) return toast.error('제목을 입력해주세요.'); saveMutation.mutate(); }}
              disabled={!dirty || saveMutation.isPending}
              className="px-3 py-1.5 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40 cursor-pointer disabled:cursor-default"
            >저장</button>
          </div>
        </div>

        {/* 댓글 */}
        <div className="border-t border-gray-200 pt-4">
          <p className="text-sm font-medium text-gray-700 mb-2">댓글 {comments.length > 0 && <span className="text-gray-400 tabular-nums">{comments.length}</span>}</p>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {comments.length === 0 && <p className="text-sm text-gray-400">아직 댓글이 없습니다.</p>}
            {comments.map(c => (
              <div key={c.id} className="group flex items-start gap-2 text-sm">
                <div className="min-w-0 flex-1 rounded-lg bg-gray-50 px-3 py-2">
                  <p className="text-xs text-gray-400">
                    {c.author ? displayName(c.author) : '알 수 없음'}
                    <span className="ml-1.5 tabular-nums">{shortDate(c.createdAt)}</span>
                  </p>
                  <p className="text-gray-800 whitespace-pre-wrap break-words mt-0.5">{c.body}</p>
                </div>
                {c.authorId === user?.id && (
                  <button
                    onClick={() => commentDeleteMutation.mutate(c.id)}
                    aria-label="댓글 삭제"
                    className="shrink-0 mt-1 p-1 rounded text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer"
                  ><X size={13} /></button>
                )}
              </div>
            ))}
          </div>
          <form
            onSubmit={e => { e.preventDefault(); const t = comment.trim(); if (!t) return; commentMutation.mutate(t); }}
            className="mt-2 flex items-end gap-2"
          >
            <textarea
              value={comment} onChange={e => setComment(e.target.value)} rows={2} maxLength={2000}
              placeholder="댓글 남기기"
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
              className="min-w-0 flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:border-gray-900"
            />
            <button type="submit" disabled={commentMutation.isPending} className="shrink-0 px-3 py-2 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50 cursor-pointer">등록</button>
          </form>
        </div>
      </div>

      <ConfirmDialog
        open={deleting}
        title="항목을 삭제할까요?"
        message="항목과 댓글이 함께 삭제됩니다. 되돌릴 수 없습니다."
        confirmText="삭제"
        variant="danger"
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setDeleting(false)}
      />
    </Modal>
  );
}

// ========== 공용 모달 ==========

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="relative w-full sm:max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-2xl p-5">
        <div className="flex items-center justify-between gap-2 mb-4">
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <button onClick={onClose} aria-label="닫기" className="p-1 text-gray-400 hover:text-gray-900 cursor-pointer"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
