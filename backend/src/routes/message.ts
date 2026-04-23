import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';

const messageCreateSchema = z.object({
  receiverId: z.number().int().positive('유효한 수신자 ID가 필요합니다.'),
  subject: z.string().min(1, '제목을 입력해주세요.').max(200, '제목은 200자 이내로 작성해주세요.'),
  content: z.string().min(1, '내용을 입력해주세요.').max(5000, '내용은 5000자 이내로 작성해주세요.'),
  exhibitionId: z.number().int().positive().optional(),
  attachments: z.array(z.string()).max(5, '첨부파일은 최대 5개까지 가능합니다.').optional(),
});

const router = Router();

// 안읽은 메시지 수
router.get('/unread-count', authenticate, authorize('ARTIST', 'GALLERY'), async (req, res, next) => {
  try {
    const count = await prisma.message.count({
      where: { receiverId: req.user!.id, read: false },
    });
    res.json({ count });
  } catch (error) { next(error); }
});

// 수신 가능한 상대 목록 (지원 기반)
router.get('/recipients', authenticate, authorize('ARTIST', 'GALLERY'), async (req, res, next) => {
  try {
    const myId = req.user!.id;
    const myRole = req.user!.role;

    if (myRole === 'ARTIST') {
      // Artist: 승인된 모든 갤러리 오너 목록 (지원 전에도 쪽지 가능)
      const galleries = await prisma.gallery.findMany({
        where: { status: 'APPROVED' },
        include: { owner: { select: { id: true, name: true, role: true } } },
      });
      const recipientMap = new Map<number, { userId: number; userName: string; galleryName: string; galleryId: number }>();
      for (const g of galleries) {
        if (g.owner.id !== myId && !recipientMap.has(g.owner.id)) {
          recipientMap.set(g.owner.id, { userId: g.owner.id, userName: g.owner.name, galleryName: g.name, galleryId: g.id });
        }
      }
      res.json(Array.from(recipientMap.values()));
    } else {
      // Gallery: 본인 공모별 지원자 그룹
      const exhibitions = await prisma.exhibition.findMany({
        where: { gallery: { ownerId: myId } },
        select: {
          id: true, title: true,
          gallery: { select: { name: true } },
          applications: {
            select: { user: { select: { id: true, name: true, avatar: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      const result = exhibitions
        .filter(ex => ex.applications.length > 0)
        .map(ex => ({
          exhibitionId: ex.id,
          exhibitionTitle: ex.title,
          galleryName: ex.gallery.name,
          applicants: ex.applications.map(a => ({
            userId: a.user.id,
            name: a.user.name,
            avatar: a.user.avatar,
          })),
        }));
      res.json(result);
    }
  } catch (error) { next(error); }
});

// 대화 목록 (그룹화)
router.get('/conversations', authenticate, authorize('ARTIST', 'GALLERY'), async (req, res, next) => {
  try {
    const myId = req.user!.id;
    const myRole = req.user!.role;

    const messages = await prisma.message.findMany({
      where: { OR: [{ senderId: myId }, { receiverId: myId }] },
      include: {
        sender: { select: { id: true, name: true, role: true, avatar: true } },
        receiver: { select: { id: true, name: true, role: true, avatar: true } },
        exhibition: { select: { id: true, title: true, gallery: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (myRole === 'ARTIST') {
      // Artist: group by gallery -> exhibition
      const groups: Record<string, {
        galleryId: number;
        galleryName: string;
        partnerId: number;
        partnerName: string;
        exhibitions: Record<number, {
          exhibitionId: number;
          exhibitionTitle: string;
          lastMessage: any;
          unreadCount: number;
        }>;
      }> = {};

      for (const m of messages) {
        const partner = m.senderId === myId ? m.receiver : m.sender;
        const galleryId = m.exhibition?.gallery?.id ?? -partner.id;
        const galleryName = m.exhibition?.gallery?.name ?? partner.name;
        const exId = m.exhibitionId ?? 0;
        const exTitle = m.exhibition?.title ?? '일반 문의';

        const key = String(galleryId);
        if (!groups[key]) {
          groups[key] = { galleryId, galleryName, partnerId: partner.id, partnerName: partner.name, exhibitions: {} };
        }
        if (!groups[key].exhibitions[exId]) {
          groups[key].exhibitions[exId] = {
            exhibitionId: exId,
            exhibitionTitle: exTitle,
            lastMessage: m,
            unreadCount: 0,
          };
        }
        if (m.receiverId === myId && !m.read) {
          groups[key].exhibitions[exId].unreadCount++;
        }
      }

      const result = Object.values(groups).map((g) => ({
        ...g,
        exhibitions: Object.values(g.exhibitions),
      }));
      res.json({ role: 'ARTIST', galleries: result });
    } else {
      // Gallery: group by exhibition -> partner
      const groups: Record<string, {
        exhibitionId: number;
        exhibitionTitle: string;
        partners: Record<number, {
          partner: { id: number; name: string; role: string; avatar: string | null };
          lastMessage: any;
          unreadCount: number;
        }>;
      }> = {};

      for (const m of messages) {
        const partner = m.senderId === myId ? m.receiver : m.sender;
        const exId = m.exhibitionId ?? 0;
        const exTitle = m.exhibition?.title ?? '일반 문의';

        const key = String(exId);
        if (!groups[key]) {
          groups[key] = { exhibitionId: exId, exhibitionTitle: exTitle, partners: {} };
        }
        if (!groups[key].partners[partner.id]) {
          groups[key].partners[partner.id] = {
            partner: { id: partner.id, name: partner.name, role: partner.role, avatar: (partner as any).avatar || null },
            lastMessage: m,
            unreadCount: 0,
          };
        }
        if (m.receiverId === myId && !m.read) {
          groups[key].partners[partner.id].unreadCount++;
        }
      }

      const result = Object.values(groups).map((g) => ({
        ...g,
        partners: Object.values(g.partners),
      }));
      res.json({ role: 'GALLERY', exhibitions: result });
    }
  } catch (error) { next(error); }
});

// 특정 상대와의 쓰레드 조회
router.get('/thread/:userId', authenticate, authorize('ARTIST', 'GALLERY'), async (req, res, next) => {
  try {
    const myId = req.user!.id;
    const partnerId = parseInt(req.params.userId as string);
    const exhibitionIdParam = req.query.exhibitionId !== undefined ? parseInt(req.query.exhibitionId as string) : undefined;

    const whereClause: any = {
      OR: [
        { senderId: myId, receiverId: partnerId },
        { senderId: partnerId, receiverId: myId },
      ],
    };

    if (exhibitionIdParam !== undefined) {
      whereClause.exhibitionId = exhibitionIdParam === 0 ? null : exhibitionIdParam;
    }

    const messagesRaw = await prisma.message.findMany({
      where: whereClause,
      include: {
        sender: { select: { id: true, name: true, role: true } },
        receiver: { select: { id: true, name: true, role: true } },
        exhibition: { select: { id: true, title: true } },
        reports: { select: { reporterId: true, status: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const messages = messagesRaw.map((m: any) => {
      const sanctioned = Array.isArray(m.reports) && m.reports.some((r: any) => r.status === 'ACTIONED');
      const reportedByMe = Array.isArray(m.reports) && m.reports.some((r: any) => r.reporterId === myId);
      const { reports, ...rest } = m;
      if (sanctioned) return { ...rest, content: '[제재로 가려진 메시지입니다]', attachments: null, sanctioned: true, reportedByMe };
      if (reportedByMe) return { ...rest, content: '[신고한 메시지입니다]', attachments: null, sanctioned: false, reportedByMe: true };
      return { ...rest, sanctioned: false, reportedByMe: false };
    });

    // Auto-mark received messages as read
    const unreadIds = messagesRaw
      .filter((m) => m.receiverId === myId && !m.read)
      .map((m) => m.id);
    if (unreadIds.length > 0) {
      await prisma.message.updateMany({
        where: { id: { in: unreadIds } },
        data: { read: true },
      });
    }

    res.json(messages);
  } catch (error) { next(error); }
});

// 수신함/발신함 목록
router.get('/', authenticate, authorize('ARTIST', 'GALLERY'), async (req, res, next) => {
  try {
    const myId = req.user!.id;
    const tab = req.query.tab === 'sent' ? 'sent' : 'inbox';

    const where = tab === 'sent' ? { senderId: myId } : { receiverId: myId };

    const messages = await prisma.message.findMany({
      where,
      include: {
        sender: { select: { id: true, name: true, role: true } },
        receiver: { select: { id: true, name: true, role: true } },
        exhibition: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(messages);
  } catch (error) { next(error); }
});

// 단일 메시지 조회 + 읽음 처리
router.get('/:id', authenticate, authorize('ARTIST', 'GALLERY'), async (req, res, next) => {
  try {
    const myId = req.user!.id;
    const messageId = parseInt(req.params.id as string);

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        sender: { select: { id: true, name: true, role: true } },
        receiver: { select: { id: true, name: true, role: true } },
        exhibition: { select: { id: true, title: true } },
      },
    });

    if (!message) throw new AppError('메시지를 찾을 수 없습니다.', 404);
    if (message.senderId !== myId && message.receiverId !== myId) {
      throw new AppError('권한이 없습니다.', 403);
    }

    // Mark as read if receiver
    if (message.receiverId === myId && !message.read) {
      await prisma.message.update({
        where: { id: messageId },
        data: { read: true },
      });
    }

    res.json({ ...message, read: message.receiverId === myId ? true : message.read });
  } catch (error) { next(error); }
});

// 메시지 전송
router.post('/', authenticate, authorize('ARTIST', 'GALLERY'), validate(messageCreateSchema), async (req, res, next) => {
  try {
    const myId = req.user!.id;
    const myRole = req.user!.role;
    const { receiverId, subject, content, exhibitionId, attachments } = req.body;

    // 수신자 확인
    const receiver = await prisma.user.findUnique({
      where: { id: receiverId },
      select: { id: true, role: true },
    });
    if (!receiver) throw new AppError('수신자를 찾을 수 없습니다.', 404);

    // Role guard: Artist→Gallery only, Gallery→Artist only
    if (myRole === 'ARTIST' && receiver.role !== 'GALLERY') {
      throw new AppError('아티스트는 갤러리 유저에게만 메시지를 보낼 수 있습니다.', 400);
    }
    if (myRole === 'GALLERY' && receiver.role !== 'ARTIST') {
      throw new AppError('갤러리는 아티스트 유저에게만 메시지를 보낼 수 있습니다.', 400);
    }

    // Exhibition validation
    if (exhibitionId) {
      const exhibition = await prisma.exhibition.findUnique({ where: { id: exhibitionId } });
      if (!exhibition) throw new AppError('공모를 찾을 수 없습니다.', 404);
    }

    const message = await prisma.message.create({
      data: {
        senderId: myId,
        receiverId,
        subject,
        content,
        exhibitionId: exhibitionId || null,
        attachments: attachments ? JSON.stringify(attachments) : null,
      },
      include: {
        sender: { select: { id: true, name: true, role: true } },
        receiver: { select: { id: true, name: true, role: true } },
        exhibition: { select: { id: true, title: true } },
      },
    });

    // Create notification for receiver (best-effort)
    try {
      await prisma.notification.create({
        data: {
          userId: receiverId,
          type: 'NEW_MESSAGE',
          message: `${req.user!.name}님이 메시지를 보냈습니다: ${subject}`,
          linkUrl: `/messages/thread/${myId}`,
        },
      });
    } catch {
      // best-effort: ignore notification errors
    }

    res.status(201).json(message);
  } catch (error) { next(error); }
});

// 메시지 삭제 (발신자 또는 수신자)
router.delete('/:id', authenticate, authorize('ARTIST', 'GALLERY'), async (req, res, next) => {
  try {
    const myId = req.user!.id;
    const messageId = parseInt(req.params.id as string);

    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message) throw new AppError('메시지를 찾을 수 없습니다.', 404);
    if (message.senderId !== myId && message.receiverId !== myId) {
      throw new AppError('권한이 없습니다.', 403);
    }

    await prisma.message.delete({ where: { id: messageId } });
    res.json({ message: '메시지가 삭제되었습니다.' });
  } catch (error) { next(error); }
});

export default router;
