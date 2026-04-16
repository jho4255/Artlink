import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';

const reportCreateSchema = z.object({
  messageId: z.number().int().positive('유효한 메시지 ID가 필요합니다.'),
  reason: z.string().min(1, '신고 사유를 입력해주세요.').max(500, '신고 사유는 500자 이내로 작성해주세요.'),
  detail: z.string().max(2000, '상세 내용은 2000자 이내로 작성해주세요.').optional(),
});

const reportProcessSchema = z.object({
  status: z.enum(['ACTIONED', 'DISMISSED'], { message: '처리 상태를 선택해주세요.' }),
  adminNote: z.string().max(1000, '관리자 메모는 1000자 이내로 작성해주세요.').optional(),
  deleteMessage: z.boolean().optional(),
});

const router = Router();

// 메시지 신고
router.post('/', authenticate, authorize('ARTIST', 'GALLERY'), validate(reportCreateSchema), async (req, res, next) => {
  try {
    const myId = req.user!.id;
    const { messageId, reason, detail } = req.body;

    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message) throw new AppError('메시지를 찾을 수 없습니다.', 404);

    // Can't report own message
    if (message.senderId === myId) {
      throw new AppError('본인이 보낸 메시지는 신고할 수 없습니다.', 400);
    }

    // Must be conversation participant
    if (message.senderId !== myId && message.receiverId !== myId) {
      throw new AppError('해당 대화의 참여자만 신고할 수 있습니다.', 403);
    }

    try {
      const report = await prisma.messageReport.create({
        data: {
          messageId,
          reporterId: myId,
          reason,
          detail: detail || null,
        },
        include: {
          message: { select: { id: true, subject: true, senderId: true } },
        },
      });
      res.status(201).json(report);
    } catch (error: any) {
      // Duplicate report (unique constraint on [messageId, reporterId])
      if (error.code === 'P2002') {
        throw new AppError('이미 신고한 메시지입니다.', 409);
      }
      throw error;
    }
  } catch (error) { next(error); }
});

// 신고 목록 (Admin)
router.get('/', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const status = req.query.status as string | undefined;
    const where = status ? { status } : {};

    const reports = await prisma.messageReport.findMany({
      where,
      include: {
        message: {
          select: {
            id: true,
            subject: true,
            content: true,
            senderId: true,
            receiverId: true,
            sender: { select: { id: true, name: true, role: true } },
            receiver: { select: { id: true, name: true, role: true } },
          },
        },
        reporter: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(reports);
  } catch (error) { next(error); }
});

// 신고 처리 (Admin)
router.patch('/:id', authenticate, authorize('ADMIN'), validate(reportProcessSchema), async (req, res, next) => {
  try {
    const reportId = parseInt(req.params.id as string);
    const { status, adminNote, deleteMessage } = req.body;

    const report = await prisma.messageReport.findUnique({
      where: { id: reportId },
      include: { message: { select: { id: true, senderId: true, subject: true } } },
    });
    if (!report) throw new AppError('신고를 찾을 수 없습니다.', 404);

    // Update report status
    const updated = await prisma.messageReport.update({
      where: { id: reportId },
      data: {
        status,
        adminNote: adminNote || null,
      },
    });

    // If ACTIONED, create notification for message sender
    if (status === 'ACTIONED' && report.message) {
      try {
        await prisma.notification.create({
          data: {
            userId: report.message.senderId,
            type: 'MESSAGE_SANCTION',
            message: `메시지 "${report.message.subject}"이(가) 운영 정책 위반으로 제재되었습니다.`,
            linkUrl: null,
          },
        });
      } catch {
        // best-effort
      }

      // Delete message if requested
      if (deleteMessage && report.message) {
        await prisma.message.delete({ where: { id: report.message.id } });
      }
    }

    res.json(updated);
  } catch (error) { next(error); }
});

export default router;
