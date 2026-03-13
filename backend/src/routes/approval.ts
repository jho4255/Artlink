import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// 승인 대기 목록 조회 (Admin 전용)
router.get('/', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    // 갤러리 승인 대기 (상세 정보 포함)
    const pendingGalleries = await prisma.gallery.findMany({
      where: { status: 'PENDING' },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        images: { orderBy: { order: 'asc' }, take: 3 }
      }
    });

    // 공모 승인 대기 (상세 정보 포함)
    const pendingExhibitions = await prisma.exhibition.findMany({
      where: { status: 'PENDING' },
      include: {
        gallery: { select: { id: true, name: true, region: true } }
      }
    });

    // 전시 승인 대기
    const pendingShows = await prisma.show.findMany({
      where: { status: 'PENDING' },
      include: {
        gallery: { select: { id: true, name: true, region: true } }
      }
    });

    // 수정 요청 대기
    const pendingRequests = await prisma.approvalRequest.findMany({
      where: { status: 'PENDING' }
    });

    res.json({ pendingGalleries, pendingExhibitions, pendingShows, pendingRequests });
  } catch (error) { next(error); }
});

// 갤러리 승인/거절
router.patch('/gallery/:id', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { status, rejectReason } = req.body;
    if (status === 'REJECTED' && !rejectReason) {
      throw new AppError('거절 시 사유를 작성해야 합니다.', 400);
    }

    const gallery = await prisma.gallery.update({
      where: { id: parseInt(req.params.id as string) },
      data: { status, rejectReason }
    });
    res.json(gallery);
  } catch (error) { next(error); }
});

// 공모 승인/거절
router.patch('/exhibition/:id', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { status, rejectReason } = req.body;
    if (status === 'REJECTED' && !rejectReason) {
      throw new AppError('거절 시 사유를 작성해야 합니다.', 400);
    }

    const exhibition = await prisma.exhibition.update({
      where: { id: parseInt(req.params.id as string) },
      data: { status, rejectReason }
    });
    res.json(exhibition);
  } catch (error) { next(error); }
});

// 전시 승인/거절
router.patch('/show/:id', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { status, rejectReason } = req.body;
    if (status === 'REJECTED' && !rejectReason) {
      throw new AppError('거절 시 사유를 작성해야 합니다.', 400);
    }

    const show = await prisma.show.update({
      where: { id: parseInt(req.params.id as string) },
      data: { status, rejectReason }
    });
    res.json(show);
  } catch (error) { next(error); }
});

// 수정 요청 제출 (Gallery 유저)
router.post('/edit-request', authenticate, authorize('GALLERY'), async (req, res, next) => {
  try {
    const { type, targetId, changes } = req.body;
    const request = await prisma.approvalRequest.create({
      data: {
        type,
        targetId,
        changes: JSON.stringify(changes),
        requesterId: req.user!.id,
        status: 'PENDING'
      }
    });
    res.status(201).json(request);
  } catch (error) { next(error); }
});

// 수정 요청 승인 (Admin)
router.patch('/edit-request/:id', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { status, rejectReason } = req.body;
    if (status === 'REJECTED' && !rejectReason) {
      throw new AppError('거절 시 사유를 작성해야 합니다.', 400);
    }

    const request = await prisma.approvalRequest.update({
      where: { id: parseInt(req.params.id as string) },
      data: { status, rejectReason }
    });

    // 승인 시 변경사항 적용
    if (status === 'APPROVED') {
      const changes = JSON.parse(request.changes);
      if (request.type === 'GALLERY_EDIT') {
        await prisma.gallery.update({
          where: { id: request.targetId },
          data: changes
        });
      } else if (request.type === 'EXHIBITION_EDIT') {
        await prisma.exhibition.update({
          where: { id: request.targetId },
          data: changes
        });
      }
    }

    res.json(request);
  } catch (error) { next(error); }
});

export default router;
