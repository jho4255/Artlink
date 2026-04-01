import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AppError } from '../middleware/errorHandler';

const inquiryCreateSchema = z.object({
  subject: z.string().min(1, '제목을 입력해주세요.').max(200, '제목은 200자 이내로 작성해주세요.'),
  content: z.string().min(1, '내용을 입력해주세요.').max(5000, '내용은 5000자 이내로 작성해주세요.'),
});

const replySchema = z.object({
  reply: z.string().min(1, '답변을 입력해주세요.').max(5000, '답변은 5000자 이내로 작성해주세요.'),
});

const router = Router();

// GET /inquiries — 문의 목록 (Admin: 전체, Artist/Gallery: 내 문의만)
router.get('/', authenticate, async (req, res, next) => {
  try {
    const statusFilter = req.query.status as string | undefined;
    const where: any = {};

    if (req.user!.role !== 'ADMIN') {
      where.userId = req.user!.id;
    }
    if (statusFilter && ['OPEN', 'ANSWERED'].includes(statusFilter)) {
      where.status = statusFilter;
    }

    const inquiries = await prisma.inquiry.findMany({
      where,
      include: { user: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(inquiries);
  } catch (err) {
    next(err);
  }
});

// GET /inquiries/:id — 문의 상세 (본인 or Admin만)
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const inquiry = await prisma.inquiry.findUnique({
      where: { id: Number(req.params.id) },
      include: { user: { select: { id: true, name: true, role: true } } },
    });
    if (!inquiry) throw new AppError('문의를 찾을 수 없습니다.', 404);
    if (req.user!.role !== 'ADMIN' && inquiry.userId !== req.user!.id) {
      throw new AppError('권한이 없습니다.', 403);
    }
    res.json(inquiry);
  } catch (err) {
    next(err);
  }
});

// POST /inquiries — 문의 작성 (Artist, Gallery만)
router.post('/', authenticate, authorize('ARTIST', 'GALLERY'), validate(inquiryCreateSchema), async (req, res, next) => {
  try {
    const { subject, content } = req.body;
    const inquiry = await prisma.inquiry.create({
      data: { subject, content, userId: req.user!.id },
    });
    res.status(201).json(inquiry);
  } catch (err) {
    next(err);
  }
});

// PATCH /inquiries/:id/reply — Admin 답변
router.patch('/:id/reply', authenticate, authorize('ADMIN'), validate(replySchema), async (req, res, next) => {
  try {
    const inquiry = await prisma.inquiry.findUnique({ where: { id: Number(req.params.id) } });
    if (!inquiry) throw new AppError('문의를 찾을 수 없습니다.', 404);

    const updated = await prisma.inquiry.update({
      where: { id: inquiry.id },
      data: { reply: req.body.reply, status: 'ANSWERED', repliedAt: new Date() },
    });

    // 답변 알림
    try {
      await prisma.notification.create({
        data: {
          userId: inquiry.userId,
          type: 'INQUIRY_REPLY',
          message: `문의 "${inquiry.subject}"에 답변이 등록되었습니다.`,
          linkUrl: '/support',
        },
      });
    } catch { /* best-effort */ }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
