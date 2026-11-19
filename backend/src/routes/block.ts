import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AppError } from '../middleware/errorHandler';
import { markChatNotificationsRead, directKeyOf } from '../lib/chat';

/**
 * 차단 (2026-11-19, ArtTalk 개편) — 둘 사이의 1:1 대화를 **양쪽 모두** 막는다(lib/chatSafety.ts).
 *  · 막은 사람: 그 1:1 방이 목록·배지에서 빠진다(방과 대화는 그대로 — 풀면 돌아온다)
 *  · 막힌 사람: 보내면 "메시지를 보낼 수 없는 상대예요"(누가 막았는지는 말하지 않는다) · 알림 없음
 *  · 단체방(공모방)에는 걸지 않는다 — 운영 공지를 못 받게 되면 안 된다
 * 상태를 적어 보내는 API — 두 번 눌러도 같은 답(규칙 46: createMany skipDuplicates / deleteMany).
 */
const router = Router();
router.use(authenticate);

const blockSchema = z.object({ userId: z.number().int().positive() });

/** 내가 차단한 사람 — 프로필 탭의 '차단한 사람'(풀기) */
router.get('/', async (req, res, next) => {
  try {
    const rows = await prisma.userBlock.findMany({
      where: { blockerId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      include: { blocked: { select: { id: true, name: true, nickname: true, role: true, deletedAt: true } } },
    });
    res.json(rows.map((r) => ({
      id: r.blocked.id,
      name: r.blocked.nickname || r.blocked.name,
      role: r.blocked.role,
      deleted: !!r.blocked.deletedAt,
      blockedAt: r.createdAt,
    })));
  } catch (e) { next(e); }
});

router.post('/', validate(blockSchema), async (req, res, next) => {
  try {
    const me = req.user!.id;
    const userId = req.body.userId as number;
    if (userId === me) throw new AppError('나 자신은 차단할 수 없어요.', 400);
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!target) throw new AppError('차단할 회원을 찾을 수 없어요.', 404);
    await prisma.userBlock.createMany({ data: [{ blockerId: me, blockedId: userId }], skipDuplicates: true });
    // 그 방의 안 읽은 알림도 걷는다 — 목록에서 빠진 방의 알림이 벨에 남아 있으면 열 곳이 없다
    const room = await prisma.chat.findUnique({ where: { directKey: directKeyOf(me, userId) }, select: { id: true } });
    if (room) await markChatNotificationsRead(room.id, me).catch(() => {});
    res.json({ blocked: true });
  } catch (e) { next(e); }
});

router.delete('/:userId', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.userId as string);
    if (!Number.isFinite(userId)) throw new AppError('회원을 찾을 수 없어요.', 404);
    await prisma.userBlock.deleteMany({ where: { blockerId: req.user!.id, blockedId: userId } });
    res.json({ blocked: false });
  } catch (e) { next(e); }
});

export default router;
