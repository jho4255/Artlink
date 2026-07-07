import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { notifyApprovalRequest } from '../lib/telegram';

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
    const requests = await prisma.approvalRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    const requesterIds = [...new Set(requests.map((request) => request.requesterId))];
    const requesters = requesterIds.length
      ? await prisma.user.findMany({
          where: { id: { in: requesterIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const requesterById = new Map(requesters.map((requester) => [requester.id, requester]));
    const pendingRequests = requests.map((request) => ({
      ...request,
      requester: requesterById.get(request.requesterId) ?? null,
    }));

    res.json({ pendingGalleries, pendingExhibitions, pendingShows, pendingRequests });
  } catch (error) { next(error); }
});

// 갤러리 승인/거절
router.patch('/gallery/:id', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { status, rejectReason } = req.body;
    if (status !== 'APPROVED' && status !== 'REJECTED') {
      throw new AppError('유효하지 않은 상태입니다.', 400);
    }
    if (status === 'REJECTED' && !rejectReason) {
      throw new AppError('거절 시 사유를 작성해야 합니다.', 400);
    }

    const id = parseInt(req.params.id as string);
    const existing = await prisma.gallery.findUnique({ where: { id } });
    if (!existing) throw new AppError('갤러리를 찾을 수 없습니다.', 404);

    const gallery = await prisma.gallery.update({
      where: { id },
      // 재승인 시 이전 거절 사유를 남기지 않도록 APPROVED면 rejectReason 초기화
      data: { status, rejectReason: status === 'APPROVED' ? null : rejectReason }
    });

    // 승인/거절 → Gallery 오너에게 알림
    try {
      const statusLabel = status === 'APPROVED' ? '승인' : '거절';
      await prisma.notification.create({
        data: {
          userId: gallery.ownerId,
          type: 'APPROVAL_RESULT',
          message: `갤러리 "${gallery.name}"이(가) ${statusLabel}되었습니다.${rejectReason ? ` (사유: ${rejectReason})` : ''}`,
          linkUrl: `/galleries/${gallery.id}`,
        },
      });
    } catch { /* best-effort */ }

    res.json(gallery);
  } catch (error) { next(error); }
});

// 공모 승인/거절
router.patch('/exhibition/:id', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { status, rejectReason } = req.body;
    if (status !== 'APPROVED' && status !== 'REJECTED') {
      throw new AppError('유효하지 않은 상태입니다.', 400);
    }
    if (status === 'REJECTED' && !rejectReason) {
      throw new AppError('거절 시 사유를 작성해야 합니다.', 400);
    }

    const id = parseInt(req.params.id as string);
    const existing = await prisma.exhibition.findUnique({ where: { id } });
    if (!existing) throw new AppError('공모를 찾을 수 없습니다.', 404);

    const exhibition = await prisma.exhibition.update({
      where: { id },
      // 재승인 시 이전 거절 사유를 남기지 않도록 APPROVED면 rejectReason 초기화
      data: { status, rejectReason: status === 'APPROVED' ? null : rejectReason },
      include: { gallery: { select: { ownerId: true, name: true } } },
    });

    // 승인/거절 → Gallery 오너에게 알림
    try {
      const statusLabel = status === 'APPROVED' ? '승인' : '거절';
      await prisma.notification.create({
        data: {
          userId: exhibition.gallery.ownerId,
          type: 'APPROVAL_RESULT',
          message: `공모 "${exhibition.title}"이(가) ${statusLabel}되었습니다.${rejectReason ? ` (사유: ${rejectReason})` : ''}`,
          linkUrl: `/exhibitions/${exhibition.id}`,
        },
      });
    } catch { /* best-effort */ }

    res.json(exhibition);
  } catch (error) { next(error); }
});

// 전시 승인/거절
router.patch('/show/:id', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { status, rejectReason } = req.body;
    if (status !== 'APPROVED' && status !== 'REJECTED') {
      throw new AppError('유효하지 않은 상태입니다.', 400);
    }
    if (status === 'REJECTED' && !rejectReason) {
      throw new AppError('거절 시 사유를 작성해야 합니다.', 400);
    }

    const id = parseInt(req.params.id as string);
    const existing = await prisma.show.findUnique({ where: { id } });
    if (!existing) throw new AppError('전시를 찾을 수 없습니다.', 404);

    const show = await prisma.show.update({
      where: { id },
      // 재승인 시 이전 거절 사유를 남기지 않도록 APPROVED면 rejectReason 초기화
      data: { status, rejectReason: status === 'APPROVED' ? null : rejectReason },
      include: { gallery: { select: { ownerId: true, name: true } } },
    });

    // 승인/거절 → Gallery 오너에게 알림
    try {
      const statusLabel = status === 'APPROVED' ? '승인' : '거절';
      await prisma.notification.create({
        data: {
          userId: show.gallery.ownerId,
          type: 'APPROVAL_RESULT',
          message: `전시 "${show.title}"이(가) ${statusLabel}되었습니다.${rejectReason ? ` (사유: ${rejectReason})` : ''}`,
          linkUrl: `/shows/${show.id}`,
        },
      });
    } catch { /* best-effort */ }

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
    void notifyApprovalRequest({
      kind: 'edit-request',
      title: type,
      targetId: request.targetId,
      requesterName: req.user!.name,
      requesterEmail: req.user!.email,
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

    const reqId = parseInt(req.params.id as string);
    const existingReq = await prisma.approvalRequest.findUnique({ where: { id: reqId } });
    if (!existingReq) throw new AppError('수정 요청을 찾을 수 없습니다.', 404);

    // 승인 시: 대상이 살아있는지 먼저 확인하고 변경 적용 (없으면 친절한 404, 상태도 바꾸지 않음)
    if (status === 'APPROVED') {
      let changes: any;
      try {
        changes = JSON.parse(existingReq.changes);
      } catch {
        throw new AppError('수정 요청 데이터를 해석할 수 없습니다.', 400);
      }
      if (existingReq.type === 'GALLERY_EDIT') {
        const target = await prisma.gallery.findUnique({ where: { id: existingReq.targetId } });
        if (!target) throw new AppError('수정 대상 갤러리를 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.', 404);
        await prisma.gallery.update({ where: { id: existingReq.targetId }, data: changes });
      } else if (existingReq.type === 'EXHIBITION_EDIT') {
        const target = await prisma.exhibition.findUnique({ where: { id: existingReq.targetId } });
        if (!target) throw new AppError('수정 대상 공모를 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.', 404);
        await prisma.exhibition.update({ where: { id: existingReq.targetId }, data: changes });
      }
    }

    // 대상 변경이 성공한 뒤에야 요청 상태를 갱신
    const request = await prisma.approvalRequest.update({
      where: { id: reqId },
      data: { status, rejectReason }
    });

    res.json(request);
  } catch (error) { next(error); }
});

export default router;
