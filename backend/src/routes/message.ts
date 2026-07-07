import { Router } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { addClient, removeClient, pushToUser } from '../lib/sse';
import { JWT_SECRET } from '../lib/jwt';
import { safeFileUrl } from '../lib/safeUrl';

// 갤러리는 본인 공모 지원자에게만, 작가는 승인 갤러리에게만 메시지 가능 (기존 대화 있으면 회신 허용)
async function canSend(myId: number, myRole: string, receiverId: number): Promise<boolean> {
  if (myRole === 'GALLERY') {
    const applied = await prisma.application.findFirst({
      where: { userId: receiverId, exhibition: { gallery: { ownerId: myId } } },
      select: { id: true },
    });
    if (applied) return true;
    // 작가가 먼저 말을 건 경우(기존 대화) 회신 허용
    const incoming = await prisma.message.findFirst({ where: { senderId: receiverId, receiverId: myId }, select: { id: true } });
    return !!incoming;
  }
  if (myRole === 'ARTIST') {
    const g = await prisma.gallery.findFirst({ where: { ownerId: receiverId, status: 'APPROVED' }, select: { id: true } });
    if (g) return true;
    // 갤러리가 삭제/승인해제된 뒤에도 기존 대화가 있으면 회신 허용 (일방향 대화 방지)
    const existing = await prisma.message.findFirst({
      where: { OR: [{ senderId: receiverId, receiverId: myId }, { senderId: myId, receiverId }] },
      select: { id: true },
    });
    return !!existing;
  }
  return false;
}

const messageCreateSchema = z.object({
  receiverId: z.number().int().positive('유효한 수신자 ID가 필요합니다.'),
  subject: z.string().min(1, '제목을 입력해주세요.').max(200, '제목은 200자 이내로 작성해주세요.'),
  content: z.string().min(1, '내용을 입력해주세요.').max(5000, '내용은 5000자 이내로 작성해주세요.'),
  exhibitionId: z.number().int().positive().optional(),
  attachments: z.array(z.object({ url: z.string(), name: z.string(), type: z.string(), size: z.number().optional() })).max(5, '첨부파일은 최대 5개까지 가능합니다.').optional(),
});

const router = Router();

// SSE 접속용 단기 티켓 발급 (헤더 인증). EventSource URL에 장기 JWT를 노출하지 않기 위함.
router.post('/stream-ticket', authenticate, authorize('ARTIST', 'GALLERY'), (req, res) => {
  const ticket = jwt.sign({ userId: req.user!.id, sse: true }, JWT_SECRET, { expiresIn: '60s' });
  res.json({ ticket });
});

// SSE 실시간 스트림 (EventSource는 헤더 불가 → 단기 티켓으로 인증). :id 라우트보다 먼저 등록.
router.get('/stream', (req, res) => {
  const ticket = (req.query.ticket as string) || '';
  let userId: number;
  try {
    const decoded = jwt.verify(ticket, JWT_SECRET) as { userId: number; sse?: boolean };
    if (!decoded.sse) { res.status(401).end(); return; }
    userId = decoded.userId;
  } catch {
    res.status(401).end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  addClient(userId, res);
  const keepalive = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* noop */ } }, 25000);
  req.on('close', () => { clearInterval(keepalive); removeClient(userId, res); });
});

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
        include: { owner: { select: { id: true, name: true, nickname: true, role: true } } },
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
            select: { user: { select: { id: true, name: true, nickname: true, avatar: true } } },
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
            name: a.user.nickname || a.user.name,
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
        sender: { select: { id: true, name: true, nickname: true, role: true, avatar: true } },
        receiver: { select: { id: true, name: true, nickname: true, role: true, avatar: true } },
        exhibition: { select: { id: true, title: true, gallery: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (myRole === 'ARTIST') {
      // Artist: group by gallery -> exhibition
      // 갤러리 이름 룩업 (exhibition 없는 일반 문의용)
      const partnerIds = [...new Set(messages.map(m => m.senderId === myId ? m.receiverId : m.senderId))];
      const partnerGalleries = await prisma.gallery.findMany({
        where: { ownerId: { in: partnerIds }, status: 'APPROVED' },
        select: { id: true, name: true, ownerId: true },
      });
      const galleryByOwner = new Map(partnerGalleries.map(g => [g.ownerId, g]));

      const groups: Record<string, {
        galleryId: number;
        galleryName: string;
        ownerId: number;
        exhibitions: Record<number, {
          exhibitionId: number;
          exhibitionTitle: string;
          lastMessage: any;
          unreadCount: number;
        }>;
      }> = {};

      for (const m of messages) {
        const partner = m.senderId === myId ? m.receiver : m.sender;
        const ownerGallery = galleryByOwner.get(partner.id);
        const galleryId = m.exhibition?.gallery?.id ?? ownerGallery?.id ?? -partner.id;
        const galleryName = m.exhibition?.gallery?.name ?? ownerGallery?.name ?? (partner as any).nickname ?? partner.name;
        const exId = m.exhibitionId ?? 0;
        const exTitle = m.exhibition?.title ?? '일반 문의';

        const key = String(galleryId);
        if (!groups[key]) {
          groups[key] = { galleryId, galleryName, ownerId: partner.id, exhibitions: {} };
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

      const result = Object.values(groups).map((g) => {
        const exhibitions = Object.values(g.exhibitions);
        return { ...g, exhibitions, totalUnread: exhibitions.reduce((sum, e) => sum + e.unreadCount, 0) };
      });
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
            partner: { id: partner.id, name: (partner as any).nickname || partner.name, role: partner.role, avatar: (partner as any).avatar || null },
            lastMessage: m,
            unreadCount: 0,
          };
        }
        if (m.receiverId === myId && !m.read) {
          groups[key].partners[partner.id].unreadCount++;
        }
      }

      const result = Object.values(groups).map((g) => {
        const partners = Object.values(g.partners);
        return { ...g, partners, totalUnread: partners.reduce((sum, p) => sum + p.unreadCount, 0) };
      });
      res.json({ role: 'GALLERY', exhibitions: result });
    }
  } catch (error) { next(error); }
});

// 카톡식 1:1 대화 목록 (상대별 1개, 최신 메시지/미읽음)
router.get('/chats', authenticate, authorize('ARTIST', 'GALLERY'), async (req, res, next) => {
  try {
    const myId = req.user!.id;
    const messages = await prisma.message.findMany({
      where: { OR: [{ senderId: myId }, { receiverId: myId }] },
      include: {
        sender: { select: { id: true, name: true, nickname: true, role: true, avatar: true } },
        receiver: { select: { id: true, name: true, nickname: true, role: true, avatar: true } },
        exhibition: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 갤러리 상대의 표시명을 갤러리명으로 보정
    const partnerIds = [...new Set(messages.map(m => (m.senderId === myId ? m.receiverId : m.senderId)))];
    const galleries = await prisma.gallery.findMany({
      where: { ownerId: { in: partnerIds }, status: 'APPROVED' },
      select: { name: true, ownerId: true },
    });
    const galleryByOwner = new Map(galleries.map(g => [g.ownerId, g.name]));

    const byPartner = new Map<number, any>();
    for (const m of messages) {
      const partner = m.senderId === myId ? m.receiver : m.sender;
      if (!byPartner.has(partner.id)) {
        const displayName = partner.role === 'GALLERY'
          ? (galleryByOwner.get(partner.id) || partner.nickname || partner.name)
          : (partner.nickname || partner.name);
        byPartner.set(partner.id, {
          partner: { id: partner.id, name: displayName, role: partner.role, avatar: partner.avatar || null },
          lastMessage: { content: m.content, createdAt: m.createdAt, fromMe: m.senderId === myId, exhibitionTitle: m.exhibition?.title ?? null },
          unreadCount: 0,
        });
      }
      if (m.receiverId === myId && !m.read) byPartner.get(partner.id).unreadCount++;
    }
    res.json(Array.from(byPartner.values()));
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
        sender: { select: { id: true, name: true, nickname: true, role: true } },
        receiver: { select: { id: true, name: true, nickname: true, role: true } },
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

    const partnerUser = await prisma.user.findUnique({
      where: { id: partnerId },
      select: { id: true, name: true, nickname: true, role: true, avatar: true },
    });
    res.json({ partner: partnerUser ? { ...partnerUser, name: partnerUser.nickname || partnerUser.name } : null, messages });
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
        sender: { select: { id: true, name: true, nickname: true, role: true } },
        receiver: { select: { id: true, name: true, nickname: true, role: true } },
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
        sender: { select: { id: true, name: true, nickname: true, role: true } },
        receiver: { select: { id: true, name: true, nickname: true, role: true } },
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

    // 수신자 확인 (탈퇴한 회원에게는 전송 불가)
    const receiver = await prisma.user.findFirst({
      where: { id: receiverId, deletedAt: null },
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

    // 대화 상대 제한(스팸 차단): 갤러리는 본인 공모 지원자에게만 (작가가 먼저 보낸 경우 회신 허용)
    if (!(await canSend(myId, myRole, receiverId))) {
      throw new AppError('대화할 수 없는 상대입니다. 갤러리는 본인 공모에 지원한 작가에게만 메시지를 보낼 수 있습니다.', 403);
    }

    // Exhibition validation
    if (exhibitionId) {
      const exhibition = await prisma.exhibition.findUnique({ where: { id: exhibitionId } });
      if (!exhibition) throw new AppError('공모를 찾을 수 없습니다.', 404);
    }

    // 첨부파일 url 정규화 — 저장형 XSS 방지. 정규화 실패한 항목은 폐기.
    const cleanAttachments = Array.isArray(attachments)
      ? attachments
          .map((a: { url: string; name: string; type: string; size?: number }) => ({ ...a, url: safeFileUrl(a.url) }))
          .filter((a): a is { url: string; name: string; type: string; size?: number } => a.url !== null)
      : [];

    const message = await prisma.message.create({
      data: {
        senderId: myId,
        receiverId,
        subject,
        content,
        exhibitionId: exhibitionId || null,
        attachments: cleanAttachments.length ? JSON.stringify(cleanAttachments) : null,
      },
      include: {
        sender: { select: { id: true, name: true, nickname: true, role: true } },
        receiver: { select: { id: true, name: true, nickname: true, role: true } },
        exhibition: { select: { id: true, title: true } },
      },
    });

    // 실시간 푸시 (SSE) — 수신자 + 발신자(다중 탭 동기화)
    pushToUser(receiverId, 'message', message);
    pushToUser(myId, 'message', message);

    // Create notification for receiver (best-effort)
    try {
      const baseSubject = subject.replace(/^(Re:\s*)+/i, '');
      // 발신자 표시명: 갤러리는 갤러리명, 그 외는 nickname||name (/chats 파트너 표시 로직과 동일)
      let senderName = message.sender.nickname || message.sender.name;
      if (myRole === 'GALLERY') {
        const myGallery = await prisma.gallery.findFirst({ where: { ownerId: myId, status: 'APPROVED' }, select: { name: true } });
        senderName = myGallery?.name || senderName;
      }
      await prisma.notification.create({
        data: {
          userId: receiverId,
          type: 'NEW_MESSAGE',
          message: `${senderName}님이 메시지를 보냈습니다: ${subject}`,
          linkUrl: `/messages?partner=${myId}${exhibitionId ? `&exhibition=${exhibitionId}` : ''}&subject=${encodeURIComponent(baseSubject)}`,
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
