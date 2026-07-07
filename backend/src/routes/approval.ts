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

// 수정 요청으로 변경 가능한 필드 화이트리스트.
// 소유권(ownerId/galleryId)·승인상태(status)·집계(rating/reviewCount)·조회수(viewCount)·
// 인스타 토큰·정산 플래그 등은 절대 수정 대상이 될 수 없다. (admin이 무심코 승인해도 안전)
const EDIT_TYPES = ['GALLERY_EDIT', 'EXHIBITION_EDIT'] as const;
const GALLERY_EDIT_FIELDS = ['name', 'address', 'phone', 'description', 'detailDesc', 'region', 'mainImage', 'ownerName', 'instagramUrl', 'email'];
const EXHIBITION_EDIT_FIELDS = ['title', 'type', 'deadline', 'deadlineStart', 'exhibitDate', 'exhibitStartDate', 'capacity', 'region', 'description', 'imageUrl', 'customFields'];

function pickAllowed(changes: any, allowed: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  if (changes && typeof changes === 'object' && !Array.isArray(changes)) {
    for (const k of allowed) {
      if (changes[k] !== undefined) out[k] = changes[k];
    }
  }
  return out;
}

// 수정 요청 대상이 요청자(갤러리 오너) 본인 소유인지 검증 — 남의 리소스에 대한 요청 큐잉 차단
async function assertEditRequestOwnership(type: string, targetId: number, userId: number) {
  if (type === 'GALLERY_EDIT') {
    const g = await prisma.gallery.findUnique({ where: { id: targetId }, select: { ownerId: true } });
    if (!g) throw new AppError('수정 대상 갤러리를 찾을 수 없습니다.', 404);
    if (g.ownerId !== userId) throw new AppError('본인 소유의 갤러리만 수정 요청할 수 있습니다.', 403);
  } else {
    const ex = await prisma.exhibition.findUnique({ where: { id: targetId }, select: { gallery: { select: { ownerId: true } } } });
    if (!ex) throw new AppError('수정 대상 공모를 찾을 수 없습니다.', 404);
    if (ex.gallery.ownerId !== userId) throw new AppError('본인 소유의 공모만 수정 요청할 수 있습니다.', 403);
  }
}

// 수정 요청 제출 (Gallery 유저)
router.post('/edit-request', authenticate, authorize('GALLERY'), async (req, res, next) => {
  try {
    const { type, targetId: rawTargetId, changes } = req.body;
    if (!EDIT_TYPES.includes(type)) throw new AppError('유효하지 않은 수정 요청 유형입니다.', 400);
    const targetId = Number(rawTargetId);
    if (!Number.isInteger(targetId)) throw new AppError('유효한 대상 ID가 필요합니다.', 400);

    // 본인 소유 대상만 수정 요청 가능 (confused-deputy 방지)
    await assertEditRequestOwnership(type, targetId, req.user!.id);

    // 변경 항목은 타입별 화이트리스트로 제한 후 저장 (ownerId/status 등 주입 차단)
    const allowed = type === 'GALLERY_EDIT' ? GALLERY_EDIT_FIELDS : EXHIBITION_EDIT_FIELDS;
    const safeChanges = pickAllowed(changes, allowed);
    if (Object.keys(safeChanges).length === 0) throw new AppError('변경할 수 있는 항목이 없습니다.', 400);

    const request = await prisma.approvalRequest.create({
      data: {
        type,
        targetId,
        changes: JSON.stringify(safeChanges),
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
        // 화이트리스트 재적용 — 과거에 쌓인 요청까지 안전하게 (ownerId/status 등 무시)
        await prisma.gallery.update({ where: { id: existingReq.targetId }, data: pickAllowed(changes, GALLERY_EDIT_FIELDS) });
      } else if (existingReq.type === 'EXHIBITION_EDIT') {
        const target = await prisma.exhibition.findUnique({ where: { id: existingReq.targetId } });
        if (!target) throw new AppError('수정 대상 공모를 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.', 404);
        await prisma.exhibition.update({ where: { id: existingReq.targetId }, data: pickAllowed(changes, EXHIBITION_EDIT_FIELDS) });
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
