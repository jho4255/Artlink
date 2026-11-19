import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AppError } from '../middleware/errorHandler';

/**
 * ArtTalk 신고 — 관리자 [신고 관리] 탭 (2026-11-19). 신고 자체는 `POST /api/chats/:id/report`(참여자만).
 *
 * 관리자는 **신고에 찍힌 사본만** 본다(lib/chatReport.ts) — 남의 방을 여는 길은 만들지 않는다(남의 방 404 원칙).
 * 처리는 상태만 남긴다: DONE(조치함) · DISMISSED(문제없음). 회원 제재는 [사용자 관리]에서 한다.
 */
const router = Router();
router.use(authenticate, authorize('ADMIN'));

const processSchema = z.object({
  status: z.enum(['OPEN', 'DONE', 'DISMISSED']),
  adminNote: z.string().trim().max(1000).optional().nullable(),
});

/** 목록 — `?status=OPEN`(확인할 것) / 그 밖(처리한 것). 최근 200건 */
router.get('/', async (req, res, next) => {
  try {
    const status = req.query.status === 'OPEN' ? 'OPEN' : req.query.status === 'DONE' ? 'DONE' : req.query.status === 'DISMISSED' ? 'DISMISSED' : null;
    const rows = await prisma.chatReport.findMany({
      where: status ? { status } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
      include: {
        reporter: { select: { id: true, name: true, nickname: true, role: true } },
        target: { select: { id: true, name: true, nickname: true, role: true, email: true, deletedAt: true } },
      },
    });
    // 같은 사람이 받은 신고 수(처리 안 한 것) — 여러 사람이 같은 상대를 신고했는지 한눈에
    const openByTarget = await prisma.chatReport.groupBy({ by: ['targetUserId'], where: { status: 'OPEN' }, _count: { _all: true } });
    const openCount = new Map(openByTarget.map((g) => [g.targetUserId, g._count._all]));
    res.json(rows.map((r) => ({
      id: r.id,
      chatId: r.chatId,
      messageId: r.messageId || null,
      reason: r.reason,
      detail: r.detail,
      snapshot: r.snapshot,
      status: r.status,
      adminNote: r.adminNote,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt,
      reporter: { id: r.reporter.id, name: r.reporter.nickname || r.reporter.name, role: r.reporter.role },
      target: {
        id: r.target.id, name: r.target.nickname || r.target.name, role: r.target.role,
        email: r.target.email, deleted: !!r.target.deletedAt,
        openReports: openCount.get(r.target.id) ?? 0,
      },
    })));
  } catch (e) { next(e); }
});

/** 처리 — 상태를 적어 보낸다(두 번 눌러도 같은 답) */
router.patch('/:id', validate(processSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    if (!Number.isFinite(id)) throw new AppError('신고를 찾을 수 없습니다.', 404);
    const status = req.body.status as 'OPEN' | 'DONE' | 'DISMISSED';
    const r = await prisma.chatReport.updateMany({
      where: { id },
      data: { status, adminNote: req.body.adminNote ?? null, reviewedAt: status === 'OPEN' ? null : new Date() },
    });
    if (r.count === 0) throw new AppError('신고를 찾을 수 없습니다.', 404);
    res.json({ id, status });
  } catch (e) { next(e); }
});

export default router;
