/**
 * Admin 전용 할 일 보드 — 회의 내용·할 일 정리.
 *
 * 보드를 여러 개 만들고(회의별·주제별), 각 보드는 **체크박스 목록** 하나다.
 * 항목마다 담당자·마감일·본문(회의 내용)·댓글·**세부항목**을 붙일 수 있고, 체크하면 완료로 내려간다.
 * 세부항목(KanbanSubtask)은 목록 화면에 그대로 펼쳐지고 거기서 바로 체크한다.
 * (경로와 테이블 이름이 kanban 인 것은 처음에 3열 칸반으로 만들었던 흔적이다. 열 개념은 없다.)
 *
 * ⚠️ 이 라우터의 모든 엔드포인트는 예외 없이 Admin 전용이어야 한다.
 *    보드 제목·항목 본문·댓글에 내부 회의 내용이 그대로 들어가므로, 공개 엔드포인트를 하나라도
 *    만들면 그 즉시 운영 논의가 밖으로 샌다. 라우터 레벨에서 한 번에 걸어 두었으니 풀지 말 것.
 *    (회귀 방지 테스트: src/__tests__/kanban.test.ts 의 '접근 제어' 블록 — 엔드포인트 전수 검사)
 *
 * 개발자 가이드
 * - 순서 계산은 `lib/kanban.ts` 의 순수 함수(sortItems/reorderItems/moveInList)만 사용한다.
 *   라우트에서 position 을 직접 더하거나 빼지 말 것.
 * - **완료는 `doneAt` 하나로만 판정한다.** 별도의 상태 필드를 만들지 말 것 — 두 곳에 두면
 *   반드시 어긋나고, 어긋난 쪽이 화면이면 "체크했는데 안 된 것처럼 보이는" 상태가 된다.
 * - 체크해도 **position 은 건드리지 않는다.** 정렬만 뒤로 보낸다(sortItems). 실제로 줄을 옮기면
 *   체크를 푸는 순간 원래 자리로 돌아올 수 없다.
 */
import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AppError } from '../middleware/errorHandler';
import { sortItems, reorderItems, moveInList } from '../lib/kanban';

const router = Router();

// 이 라우터는 전부 Admin 전용 — 개별 라우트에서 빠뜨리는 사고를 막으려고 라우터 레벨에서 건다.
router.use(authenticate, authorize('ADMIN'));

const boardSchema = z.object({
  title: z.string().trim().min(1, '보드 이름을 입력해주세요.').max(100, '보드 이름은 100자 이내로 입력해주세요.'),
  description: z.string().trim().max(300, '설명은 300자 이내로 입력해주세요.').nullish(),
});

const itemSchema = z.object({
  title: z.string().trim().min(1, '할 일을 입력해주세요.').max(200, '제목은 200자 이내로 입력해주세요.'),
  body: z.string().max(5000, '내용은 5000자 이내로 입력해주세요.').nullish(),
  assigneeId: z.number().int().positive().nullish(),
  dueDate: z.string().trim().min(1).nullish(),
});

const itemPatchSchema = itemSchema.partial().extend({
  done: z.boolean().optional(),
});

const reorderSchema = z.object({
  ids: z.array(z.number().int().positive()).max(500, '한 번에 정렬할 수 있는 항목 수를 넘었습니다.'),
});

const moveIndexSchema = z.object({ index: z.number().int().min(0) });

const subtaskSchema = z.object({
  title: z.string().trim().min(1, '세부항목을 입력해주세요.').max(200, '세부항목은 200자 이내로 입력해주세요.'),
});

const subtaskPatchSchema = z.object({
  title: z.string().trim().min(1, '세부항목을 입력해주세요.').max(200, '세부항목은 200자 이내로 입력해주세요.').optional(),
  done: z.boolean().optional(),
});

const commentSchema = z.object({
  body: z.string().trim().min(1, '내용을 입력해주세요.').max(2000, '댓글은 2000자 이내로 입력해주세요.'),
});

const memberSelect = { id: true, name: true, nickname: true, avatar: true } as const;

const itemInclude = {
  assignee: { select: memberSelect },
  createdBy: { select: memberSelect },
  // 세부항목은 **체크해도 자리가 안 바뀐다** — position 순 그대로. 상위 항목과 다른 점(스키마 주석 참고).
  subtasks: { orderBy: { position: 'asc' } },
  _count: { select: { comments: true } },
} as const;

/** "YYYY-MM-DD" → Date. 저장 규약은 프로젝트 전체와 동일하게 UTC 자정이고, 판정은 KST 달력 날짜로 한다(lib/kstDate.ts). */
function parseDueDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new AppError('마감일이 올바르지 않습니다.', 400);
  return d;
}

/** 담당자는 Admin 중에서만. 탈퇴한 계정도 제외한다. */
async function assertAssignee(assigneeId: number | null): Promise<number | null> {
  if (assigneeId === null) return null;
  const user = await prisma.user.findFirst({
    where: { id: assigneeId, role: 'ADMIN', deletedAt: null },
    select: { id: true },
  });
  if (!user) throw new AppError('담당자로 지정할 수 없는 사용자입니다.', 400);
  return user.id;
}

// ===== 담당자 후보 =====

/** GET /api/kanban/members — 담당자로 지정 가능한 Admin 목록 */
router.get('/members', async (_req, res, next) => {
  try {
    const members = await prisma.user.findMany({
      where: { role: 'ADMIN', deletedAt: null },
      select: memberSelect,
      orderBy: { id: 'asc' },
    });
    res.json(members);
  } catch (error) { next(error); }
});

// ===== 보드 =====

/**
 * GET /api/kanban/boards — 보드 목록. **항목과 세부항목까지 통째로** 실어 보낸다.
 *
 * 화면이 보드 목록 한 장뿐이고 모든 보드를 그 자리에서 펼쳐 보여주기 때문이다
 * (보드를 클릭해 들어가는 단계가 없다). 보드마다 따로 요청하면 화면 하나 그리는 데
 * N+1 번을 부르게 된다. Admin 이 쓰는 보드는 많아야 수십 개 규모라 이 편이 낫다.
 */
router.get('/boards', async (_req, res, next) => {
  try {
    const boards = await prisma.kanbanBoard.findMany({
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      include: {
        createdBy: { select: memberSelect },
        cards: { include: itemInclude },
      },
    });
    res.json(boards.map(board => ({
      ...board,
      cards: sortItems(board.cards),
      counts: {
        done: board.cards.filter(c => c.doneAt).length,
        open: board.cards.filter(c => !c.doneAt).length,
        total: board.cards.length,
      },
    })));
  } catch (error) { next(error); }
});

/** GET /api/kanban/boards/:id — 보드 + 항목 전체 (안 한 일 먼저, 완료는 최근 순으로 뒤에) */
router.get('/boards/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const board = await prisma.kanbanBoard.findUnique({
      where: { id },
      include: {
        createdBy: { select: memberSelect },
        cards: { include: itemInclude },
      },
    });
    if (!board) throw new AppError('보드를 찾을 수 없습니다.', 404);
    res.json({ ...board, cards: sortItems(board.cards) });
  } catch (error) { next(error); }
});

/** POST /api/kanban/boards */
router.post('/boards', validate(boardSchema), async (req, res, next) => {
  try {
    const { title, description } = req.body;
    const last = await prisma.kanbanBoard.findFirst({ orderBy: { position: 'desc' }, select: { position: true } });
    const board = await prisma.kanbanBoard.create({
      data: {
        title,
        description: description || null,
        position: (last?.position ?? -1) + 1,
        createdById: req.user!.id,
      },
      include: { createdBy: { select: memberSelect } },
    });
    res.status(201).json({ ...board, cards: [], counts: { done: 0, open: 0, total: 0 } });
  } catch (error) { next(error); }
});

/** PATCH /api/kanban/boards/:id */
router.patch('/boards/:id', validate(boardSchema.partial()), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const existing = await prisma.kanbanBoard.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AppError('보드를 찾을 수 없습니다.', 404);

    const data: { title?: string; description?: string | null } = {};
    if (req.body.title !== undefined) data.title = req.body.title;
    if (req.body.description !== undefined) data.description = req.body.description || null;

    const board = await prisma.kanbanBoard.update({
      where: { id },
      data,
      include: { createdBy: { select: memberSelect } },
    });
    res.json(board);
  } catch (error) { next(error); }
});

/** PATCH /api/kanban/boards/:id/move — 보드 목록에서의 순서 이동 */
router.patch('/boards/:id/move', validate(moveIndexSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const boards = await prisma.kanbanBoard.findMany({
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (!boards.some(b => b.id === id)) throw new AppError('보드를 찾을 수 없습니다.', 404);

    const updates = moveInList(boards.map(b => b.id), id, req.body.index);
    if (updates.length) {
      await prisma.$transaction(updates.map(u =>
        prisma.kanbanBoard.update({ where: { id: u.id }, data: { position: u.position } })
      ));
    }
    res.json({ moved: updates.length });
  } catch (error) { next(error); }
});

/**
 * PATCH /api/kanban/boards/:id/reorder — 항목 순서 재배치
 *
 * 클라이언트가 원하는 **전체 순서**를 ids 로 보낸다. 한 칸씩 옮기는 API 를 따로 두지 않는 이유:
 * "어느 항목 앞으로" 를 index 로 주고받으면 완료 항목이 뒤로 밀려 보이는 화면과 실제 position 이
 * 어긋나 계산이 틀어진다. 전체 순서를 통째로 보내면 그런 어긋남 자체가 없다.
 */
router.patch('/boards/:id/reorder', validate(reorderSchema), async (req, res, next) => {
  try {
    const boardId = parseInt(req.params.id as string, 10);
    const board = await prisma.kanbanBoard.findUnique({ where: { id: boardId }, select: { id: true } });
    if (!board) throw new AppError('보드를 찾을 수 없습니다.', 404);

    const items = await prisma.kanbanCard.findMany({
      where: { boardId },
      select: { id: true, position: true, doneAt: true },
    });
    const updates = reorderItems(items, req.body.ids);
    if (updates.length) {
      await prisma.$transaction(updates.map(u =>
        prisma.kanbanCard.update({ where: { id: u.id }, data: { position: u.position } })
      ));
    }
    res.json({ moved: updates.length });
  } catch (error) { next(error); }
});

/** DELETE /api/kanban/boards/:id — 항목·댓글까지 함께 삭제(Cascade) */
router.delete('/boards/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const existing = await prisma.kanbanBoard.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AppError('보드를 찾을 수 없습니다.', 404);
    await prisma.kanbanBoard.delete({ where: { id } });
    res.json({ message: '보드가 삭제되었습니다.' });
  } catch (error) { next(error); }
});

// ===== 항목 =====

/** POST /api/kanban/boards/:id/cards — 할 일 추가 (목록 맨 뒤) */
router.post('/boards/:id/cards', validate(itemSchema), async (req, res, next) => {
  try {
    const boardId = parseInt(req.params.id as string, 10);
    const board = await prisma.kanbanBoard.findUnique({ where: { id: boardId }, select: { id: true } });
    if (!board) throw new AppError('보드를 찾을 수 없습니다.', 404);

    const assigneeId = await assertAssignee(req.body.assigneeId ?? null);
    const dueDate = parseDueDate(req.body.dueDate);

    const last = await prisma.kanbanCard.findFirst({
      where: { boardId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const item = await prisma.kanbanCard.create({
      data: {
        boardId,
        title: req.body.title,
        body: req.body.body || null,
        assigneeId,
        dueDate,
        position: (last?.position ?? -1) + 1,
        createdById: req.user!.id,
      },
      include: itemInclude,
    });
    res.status(201).json(item);
  } catch (error) { next(error); }
});

/**
 * PATCH /api/kanban/cards/:id — 내용 수정 + 완료 체크
 *
 * `done: true` 면 doneAt 을 찍고, false 면 지운다. **position 은 건드리지 않는다** —
 * 체크를 풀면 원래 자리로 그대로 돌아와야 하기 때문이다.
 * 이미 체크된 항목에 다시 done:true 가 와도 시각을 덮어쓰지 않는다(두 번 눌러 날짜가 바뀌면 안 된다).
 */
router.patch('/cards/:id', validate(itemPatchSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const existing = await prisma.kanbanCard.findUnique({ where: { id } });
    if (!existing) throw new AppError('항목을 찾을 수 없습니다.', 404);

    const data: Record<string, unknown> = {};
    if (req.body.title !== undefined) data.title = req.body.title;
    if (req.body.body !== undefined) data.body = req.body.body || null;
    if (req.body.assigneeId !== undefined) data.assigneeId = await assertAssignee(req.body.assigneeId ?? null);
    if (req.body.dueDate !== undefined) data.dueDate = parseDueDate(req.body.dueDate);
    if (req.body.done !== undefined) data.doneAt = req.body.done ? (existing.doneAt ?? new Date()) : null;

    const item = await prisma.kanbanCard.update({ where: { id }, data, include: itemInclude });
    res.json(item);
  } catch (error) { next(error); }
});

/** DELETE /api/kanban/cards/:id */
router.delete('/cards/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const existing = await prisma.kanbanCard.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AppError('항목을 찾을 수 없습니다.', 404);
    await prisma.kanbanCard.delete({ where: { id } });
    res.json({ message: '항목이 삭제되었습니다.' });
  } catch (error) { next(error); }
});

// ===== 세부항목 =====

/** POST /api/kanban/cards/:id/subtasks — 세부항목 추가 (맨 뒤) */
router.post('/cards/:id/subtasks', validate(subtaskSchema), async (req, res, next) => {
  try {
    const cardId = parseInt(req.params.id as string, 10);
    const card = await prisma.kanbanCard.findUnique({ where: { id: cardId }, select: { id: true } });
    if (!card) throw new AppError('항목을 찾을 수 없습니다.', 404);

    const last = await prisma.kanbanSubtask.findFirst({
      where: { cardId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const subtask = await prisma.kanbanSubtask.create({
      data: { cardId, title: req.body.title, position: (last?.position ?? -1) + 1 },
    });
    res.status(201).json(subtask);
  } catch (error) { next(error); }
});

/**
 * PATCH /api/kanban/subtasks/:id — 이름 수정 + 완료 체크
 *
 * 상위 항목을 **자동으로 체크하지 않는다.** 세부항목을 다 끝냈다고 그 일이 끝난 건 아니고
 * (확인·보고가 남는다), 자동으로 완료 처리하면 목록에서 사라져 되돌리기도 번거롭다.
 * 화면에는 2/3 처럼 진행만 보여주고, 마무리는 사람이 누른다.
 */
router.patch('/subtasks/:id', validate(subtaskPatchSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const existing = await prisma.kanbanSubtask.findUnique({ where: { id } });
    if (!existing) throw new AppError('세부항목을 찾을 수 없습니다.', 404);

    const data: Record<string, unknown> = {};
    if (req.body.title !== undefined) data.title = req.body.title;
    // 이미 체크된 걸 또 체크해도 시각을 덮어쓰지 않는다 (상위 항목과 같은 규약)
    if (req.body.done !== undefined) data.doneAt = req.body.done ? (existing.doneAt ?? new Date()) : null;

    const subtask = await prisma.kanbanSubtask.update({ where: { id }, data });
    res.json(subtask);
  } catch (error) { next(error); }
});

/** DELETE /api/kanban/subtasks/:id */
router.delete('/subtasks/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const existing = await prisma.kanbanSubtask.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AppError('세부항목을 찾을 수 없습니다.', 404);
    await prisma.kanbanSubtask.delete({ where: { id } });
    res.json({ message: '세부항목이 삭제되었습니다.' });
  } catch (error) { next(error); }
});

// ===== 댓글 =====

/** GET /api/kanban/cards/:id/comments */
router.get('/cards/:id/comments', async (req, res, next) => {
  try {
    const cardId = parseInt(req.params.id as string, 10);
    const card = await prisma.kanbanCard.findUnique({ where: { id: cardId }, select: { id: true } });
    if (!card) throw new AppError('항목을 찾을 수 없습니다.', 404);
    const comments = await prisma.kanbanComment.findMany({
      where: { cardId },
      include: { author: { select: memberSelect } },
      orderBy: { createdAt: 'asc' },
    });
    res.json(comments);
  } catch (error) { next(error); }
});

/** POST /api/kanban/cards/:id/comments */
router.post('/cards/:id/comments', validate(commentSchema), async (req, res, next) => {
  try {
    const cardId = parseInt(req.params.id as string, 10);
    const card = await prisma.kanbanCard.findUnique({ where: { id: cardId }, select: { id: true } });
    if (!card) throw new AppError('항목을 찾을 수 없습니다.', 404);
    const comment = await prisma.kanbanComment.create({
      data: { cardId, authorId: req.user!.id, body: req.body.body },
      include: { author: { select: memberSelect } },
    });
    res.status(201).json(comment);
  } catch (error) { next(error); }
});

/**
 * DELETE /api/kanban/comments/:id — 작성자 본인만.
 * 다른 Admin 이 남긴 회의 기록을 지울 수 있으면 논의 근거가 조용히 사라진다.
 */
router.delete('/comments/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const comment = await prisma.kanbanComment.findUnique({ where: { id }, select: { id: true, authorId: true } });
    if (!comment) throw new AppError('댓글을 찾을 수 없습니다.', 404);
    if (comment.authorId !== req.user!.id) throw new AppError('본인이 작성한 댓글만 삭제할 수 있습니다.', 403);
    await prisma.kanbanComment.delete({ where: { id } });
    res.json({ message: '댓글이 삭제되었습니다.' });
  } catch (error) { next(error); }
});

export default router;
