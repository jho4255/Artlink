import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { ensureExhibitionChat } from '../lib/chat';
import { authenticate, authorize } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { richField } from '../lib/richText';
import { validate } from '../middleware/validate';
import { notifyApprovalRequest } from '../lib/telegram';
import { LOCK_NS, withKeyLock } from '../lib/keyLock';
import { deleteExhibitionWithNotice, deleteGalleryWithNotice, exhibitionDeleteFacts } from '../lib/deletion';
import { readAttachments } from '../lib/exhibitionAttachments';

const router = Router();

// 승인 대기 목록 조회 (Admin 전용)
router.get('/', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    // 갤러리 승인 대기 (상세 정보 포함)
    // 가입 계정의 이메일과 **인증 여부**를 함께 — 관리자가 승인할 때 그 갤러리 메일이 맞는지 판단한다(2026-10-08).
    // emailVerifiedAt = 이메일 가입(인증번호 확인) · provider = 카카오 가입이면 이메일은 본인이 적은 값이다
    const pendingGalleries = await prisma.gallery.findMany({
      where: { status: 'PENDING' },
      include: {
        owner: { select: { id: true, name: true, email: true, provider: true, emailVerifiedAt: true } },
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
    const pendingRequests = await Promise.all(requests.map(async (request) => ({
      ...request,
      requester: requesterById.get(request.requesterId) ?? null,
      // 삭제 요청 — 지우면 무엇이 사라지는지 관리자가 그 자리에서 보게(수락 작가 · 출품 자료 · 판매 · 정산)
      ...(isDeleteType(request.type) ? { target: await deleteTargetSummary(request.type, request.targetId) } : {}),
    })));

    res.json({
      pendingGalleries,
      // 첨부파일은 승인 전에 관리자가 열어 볼 수 있게 — 이상한 줄은 건너뛰고 늘 배열로
      pendingExhibitions: pendingExhibitions.map((e) => ({ ...e, attachments: readAttachments(e.attachments) })),
      pendingShows,
      pendingRequests,
    });
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
    // 주관 갤러리가 없으면 알릴 사람이 없다 — 아트링크 주최 공모는 애초에 승인 절차를 안 타므로
    // (등록 즉시 APPROVED) 여기까지 오지 않지만, 오더라도 조용히 넘어간다.
    if (exhibition.gallery) {
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
    }

    // 승인된 공모에는 단톡방을 만들어 둔다 — 갤러리와 수락 작가가 자동 참여자가 된다(lib/chat.ts).
    // 실패해도 승인은 성공이어야 하므로 best-effort.
    if (status === 'APPROVED') {
      try { await ensureExhibitionChat(exhibition.id); } catch { /* best-effort */ }
    }

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
    // 주관 갤러리가 없는 공모(아트링크 주최)는 갤러리 오너가 없으므로 아무도 통과 못 한다 — 의도된 동작
    if (ex.gallery?.ownerId !== userId) throw new AppError('본인 소유의 공모만 수정 요청할 수 있습니다.', 403);
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
    // 서식 있는 글 칸은 여기서도 허용 목록으로 거른다 — 관리자가 승인하면 그대로 저장되는 길이라, 안 거르면 이 경로로 HTML 이 들어간다(2026-10-03)
    if (type === 'EXHIBITION_EDIT' && 'description' in safeChanges) {
      safeChanges.description = richField(safeChanges.description, { label: '공모 소개', maxText: 20000, required: true, emptyMessage: '공모 소개를 입력해주세요.' });
    }
    if (type === 'GALLERY_EDIT' && 'detailDesc' in safeChanges) {
      safeChanges.detailDesc = richField(safeChanges.detailDesc, { label: '소개', maxText: 5000 });
    }

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
    if (status !== 'APPROVED' && status !== 'REJECTED') throw new AppError('유효하지 않은 상태입니다.', 400);
    if (status === 'REJECTED' && !rejectReason) {
      throw new AppError('거절 시 사유를 작성해야 합니다.', 400);
    }

    const reqId = parseInt(req.params.id as string);
    const existingReq = await prisma.approvalRequest.findUnique({ where: { id: reqId } });
    // 삭제 요청은 이 길로 처리하지 않는다(아래 delete-request) — 여기로 오면 대상은 안 지워지고 '승인됨' 만 남는다
    if (!existingReq || !EDIT_TYPES.includes(existingReq.type as any)) throw new AppError('수정 요청을 찾을 수 없습니다.', 404);
    if (existingReq.status !== 'PENDING') throw new AppError('이미 처리된 요청입니다.', 400);

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

// ==========================================================================
// 삭제 요청 (2026-10-03 사용자 결정) — 수락한 작가가 있거나 판매·정산 기록이 있는 공모(와 그런 공모가 있는 갤러리)는
// 갤러리가 직접 지울 수 없다(lib/deletion.ts). 피치 못할 사정이 있을 수 있어 사유를 적어 관리자에게 요청하고,
// 관리자가 [승인 관리]에서 무엇이 사라지는지 보고 지운다. 기존 `ApprovalRequest` 를 쓴다(DB 변경 없음):
//   type = EXHIBITION_DELETE | GALLERY_DELETE, targetId, changes = {"reason","title"}
// ==========================================================================

const DELETE_TYPES = ['EXHIBITION_DELETE', 'GALLERY_DELETE'] as const;
type DeleteType = (typeof DELETE_TYPES)[number];
function isDeleteType(t: string): t is DeleteType { return (DELETE_TYPES as readonly string[]).includes(t); }

function parseChanges(raw: string): { reason?: string; title?: string } {
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

/** 관리자 화면에 보일 대상 요약. 대상이 이미 없으면 gone */
async function deleteTargetSummary(type: string, targetId: number) {
  if (type === 'EXHIBITION_DELETE') {
    const ex = await prisma.exhibition.findUnique({
      where: { id: targetId },
      select: { id: true, title: true, recruitOnly: true, recruitmentClosed: true, ended: true, gallery: { select: { name: true } } },
    });
    if (!ex) return { gone: true };
    return { gone: false, name: ex.title, galleryName: ex.gallery?.name ?? null, ended: ex.ended, ...(await exhibitionDeleteFacts(ex.id)) };
  }
  const g = await prisma.gallery.findUnique({ where: { id: targetId }, select: { id: true, name: true } });
  if (!g) return { gone: true };
  const exhibitions = await prisma.exhibition.findMany({ where: { galleryId: g.id }, select: { id: true } });
  const facts = await Promise.all(exhibitions.map((e) => exhibitionDeleteFacts(e.id)));
  return {
    gone: false,
    name: g.name,
    exhibitions: exhibitions.length,
    accepted: facts.reduce((n, f) => n + f.accepted, 0),
    submissions: facts.reduce((n, f) => n + f.submissions, 0),
    sales: facts.reduce((n, f) => n + f.sales, 0),
    settled: facts.filter((f) => f.settled).length,
  };
}

const deleteRequestSchema = z.object({
  type: z.enum(DELETE_TYPES),
  targetId: z.number().int().positive(),
  reason: z.string().trim().min(5, '삭제하려는 이유를 5자 이상 적어 주세요.').max(1000, '이유는 1000자까지 쓸 수 있어요.'),
});

// 삭제 요청 보내기 (갤러리 — 본인 소유만)
router.post('/delete-request', authenticate, authorize('GALLERY'), validate(deleteRequestSchema), async (req, res, next) => {
  try {
    const { type, targetId, reason } = req.body as z.infer<typeof deleteRequestSchema>;
    let title: string;
    if (type === 'EXHIBITION_DELETE') {
      const ex = await prisma.exhibition.findUnique({
        where: { id: targetId },
        select: { title: true, hostType: true, settledAt: true, gallery: { select: { ownerId: true } } },
      });
      // 아트링크 주최 공모는 운영을 위임받았을 뿐이라 갤러리가 지울 대상이 아니다(직접 삭제도 막힌다)
      if (!ex || ex.hostType === 'ADMIN' || ex.gallery?.ownerId !== req.user!.id) throw new AppError('공모를 찾을 수 없습니다.', 404);
      if (ex.settledAt) throw new AppError('정산이 끝난 공모는 기록을 남기려고 삭제하지 않아요. 꼭 필요하면 1:1 문의로 알려 주세요.', 400);
      title = ex.title;
    } else {
      const g = await prisma.gallery.findUnique({ where: { id: targetId }, select: { name: true, ownerId: true } });
      if (!g || g.ownerId !== req.user!.id) throw new AppError('갤러리를 찾을 수 없습니다.', 404);
      title = g.name;
    }
    // 같은 대상에 대기 중인 요청은 하나 — '세고 나서 만들기' 라 잠근다(lib/keyLock.ts)
    const ns = type === 'EXHIBITION_DELETE' ? LOCK_NS.exhibitionDeleteRequests : LOCK_NS.galleryDeleteRequests;
    const created = await withKeyLock(ns, targetId, async (tx) => {
      const dup = await tx.approvalRequest.findFirst({ where: { type, targetId, status: 'PENDING' }, select: { id: true } });
      if (dup) throw new AppError('이미 삭제 요청을 보냈어요. 관리자 확인을 기다리고 있어요.', 409);
      return tx.approvalRequest.create({
        data: { type, targetId, changes: JSON.stringify({ reason, title }), requesterId: req.user!.id, status: 'PENDING' },
      });
    });
    void notifyApprovalRequest({
      kind: 'delete-request',
      title: `${type === 'EXHIBITION_DELETE' ? '공모' : '갤러리'} 「${title}」 — ${reason.slice(0, 80)}`,
      targetId,
      requesterName: req.user!.name,
      requesterEmail: req.user!.email,
    });
    res.status(201).json({ id: created.id, type, targetId, status: created.status, reason, createdAt: created.createdAt });
  } catch (error) { next(error); }
});

// 내 삭제 요청 — 대기 중 전부 + 최근 30일 안에 반려된 것(카드에 '반려됨 · 사유' 를 보여 준다)
router.get('/my-delete-requests', authenticate, authorize('GALLERY'), async (req, res, next) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const rows = await prisma.approvalRequest.findMany({
      where: {
        requesterId: req.user!.id,
        type: { in: [...DELETE_TYPES] },
        OR: [{ status: 'PENDING' }, { status: 'REJECTED', updatedAt: { gte: since } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(rows.map((r) => ({
      id: r.id, type: r.type, targetId: r.targetId, status: r.status, rejectReason: r.rejectReason,
      reason: parseChanges(r.changes).reason ?? '', createdAt: r.createdAt, updatedAt: r.updatedAt,
    })));
  } catch (error) { next(error); }
});

// 요청 취소 (본인 · 대기 중만)
router.delete('/delete-request/:id', authenticate, authorize('GALLERY'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const r = Number.isFinite(id) ? await prisma.approvalRequest.findUnique({ where: { id } }) : null;
    if (!r || r.requesterId !== req.user!.id || !isDeleteType(r.type)) throw new AppError('삭제 요청을 찾을 수 없습니다.', 404);
    if (r.status !== 'PENDING') throw new AppError('이미 처리된 요청이에요.', 400);
    await prisma.approvalRequest.delete({ where: { id } });
    res.json({ id, cancelled: true });
  } catch (error) { next(error); }
});

// 삭제 요청 처리 (관리자) — 승인 = 실제로 지운다(+ 작가·요청자 알림) / 거절 = 사유 필수
const deleteDecisionSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  rejectReason: z.string().trim().max(1000).optional(),
});
router.patch('/delete-request/:id', authenticate, authorize('ADMIN'), validate(deleteDecisionSchema), async (req, res, next) => {
  try {
    const { status, rejectReason } = req.body as z.infer<typeof deleteDecisionSchema>;
    if (status === 'REJECTED' && !rejectReason) throw new AppError('거절 시 사유를 작성해야 합니다.', 400);
    const id = parseInt(req.params.id as string);
    const r = Number.isFinite(id) ? await prisma.approvalRequest.findUnique({ where: { id } }) : null;
    if (!r || !isDeleteType(r.type)) throw new AppError('삭제 요청을 찾을 수 없습니다.', 404);
    if (r.status !== 'PENDING') throw new AppError('이미 처리된 요청입니다.', 400);
    const { title = '' } = parseChanges(r.changes);
    const isExhibition = r.type === 'EXHIBITION_DELETE';
    const where = isExhibition ? '/mypage?tab=my-exhibitions' : '/mypage?tab=my-galleries';

    let gone = false;
    if (status === 'APPROVED') {
      // 대상이 이미 없으면(관리자가 따로 지웠다) 요청만 정리한다 — 큐에 영영 남지 않게
      if (isExhibition) {
        gone = !(await prisma.exhibition.findUnique({ where: { id: r.targetId }, select: { id: true } }));
        if (!gone) await deleteExhibitionWithNotice(r.targetId);
      } else {
        gone = !(await prisma.gallery.findUnique({ where: { id: r.targetId }, select: { id: true } }));
        if (!gone) await deleteGalleryWithNotice(r.targetId);
      }
    }
    const updated = await prisma.approvalRequest.update({
      where: { id },
      data: { status, rejectReason: status === 'REJECTED' ? rejectReason : null },
    });
    try {
      await prisma.notification.create({
        data: {
          userId: r.requesterId,
          type: 'APPROVAL_RESULT',
          message: status === 'APPROVED'
            ? `${isExhibition ? '공모' : '갤러리'} "${title}" 삭제 요청이 승인되어 삭제되었어요.`
            : `${isExhibition ? '공모' : '갤러리'} "${title}" 삭제 요청이 반려되었어요. (사유: ${rejectReason})`,
          linkUrl: where,
        },
      });
    } catch { /* best-effort */ }
    res.json({ id: updated.id, status: updated.status, rejectReason: updated.rejectReason, alreadyGone: gone });
  } catch (error) { next(error); }
});

export default router;
