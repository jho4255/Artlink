import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';

const router = Router();

// GET /notifications — 내 알림 목록 (최근 50개, 미읽음 우선)
router.get('/', authenticate, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 50);
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: [{ read: 'asc' }, { createdAt: 'desc' }],
      take: limit,
    });
    res.json(notifications);
  } catch (err) {
    next(err);
  }
});

// GET /notifications/unread-count — 미읽음 카운트
router.get('/unread-count', authenticate, async (req, res, next) => {
  try {
    const count = await prisma.notification.count({
      where: { userId: req.user!.id, read: false },
    });
    res.json({ count });
  } catch (err) {
    next(err);
  }
});

// PATCH /notifications/:id/read — 읽음 처리
router.patch('/:id/read', authenticate, async (req, res, next) => {
  try {
    const notif = await prisma.notification.findUnique({ where: { id: Number(req.params.id) } });
    if (!notif || notif.userId !== req.user!.id) {
      return res.status(404).json({ error: '알림을 찾을 수 없습니다.' });
    }
    await prisma.notification.update({
      where: { id: notif.id },
      data: { read: true },
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// PATCH /notifications/read-all — 전체 읽음
router.patch('/read-all', authenticate, async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user!.id, read: false },
      data: { read: true },
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
