/**
 * 방명록 — 작가 홈페이지(`/portfolio/:userId`)에 남기는 방명록.
 *
 * ## 설계
 * - `target` 의 홈페이지에 `author` 가 글을 남긴다. 읽기는 공개, 쓰기는 로그인.
 * - **방 주인만 답글(parentId)** 을 단다. 답글은 최상위 글에만(1단계).
 * - **비밀글(secret)** 은 방 주인과 작성자만 본문을 본다 — 그 외에는 '비밀글입니다' 로 가린다(신원은 보임).
 * - 새 글은 방 주인에게 **알림**(내 홈페이지로). 답글은 원 글쓴이에게 알림.
 * - 삭제는 글쓴이 · 방 주인 · Admin.
 */
import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, optionalAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';

const router = Router();

const authorSelect = { select: { id: true, name: true, nickname: true, avatar: true, role: true } } as const;
type AuthorRow = { id: number; name: string; nickname: string | null; avatar: string | null; role: string };
const serializeAuthor = (a: AuthorRow) => ({ id: a.id, name: a.nickname || a.name, avatar: a.avatar, role: a.role });
const displayName = (u: { name: string; nickname: string | null }) => u.nickname || u.name;

const writeSchema = z.object({
  body: z.string().trim().min(1, '내용을 입력해주세요.').max(1000, '방명록은 1000자까지입니다.'),
  // secret 은 더 이상 받지 않는다(2026-09-16). 옛 화면이 보내와도 zod 가 조용히 버린다 — 400 으로 막으면 그 화면이 죽는다.
  parentId: z.number().int().optional(),
});

type EntryRow = {
  id: number; body: string; secret: boolean; parentId: number | null; createdAt: Date;
  authorId: number; author: AuthorRow; replies?: EntryRow[];
};

interface SerializedEntry {
  id: number; body: string; secret: boolean; locked: boolean; createdAt: Date;
  author: { id: number; name: string; avatar: string | null; role: string };
  mine: boolean; replies: SerializedEntry[];
}

// 비밀글이면 방 주인/작성자 외에는 본문을 가린다(신원은 보인다).
function serializeEntry(e: EntryRow, viewerId: number | undefined, targetUserId: number): SerializedEntry {
  const canReadSecret = viewerId != null && (viewerId === targetUserId || viewerId === e.authorId);
  const mine = viewerId != null && viewerId === e.authorId;
  return {
    id: e.id,
    body: e.secret && !canReadSecret ? '' : e.body,
    secret: e.secret,
    locked: e.secret && !canReadSecret,
    createdAt: e.createdAt,
    author: serializeAuthor(e.author),
    mine,
    replies: (e.replies ?? []).map((r) => serializeEntry(r, viewerId, targetUserId)),
  };
}

// ── 목록 ──
router.get('/:userId', optionalAuth, async (req, res, next) => {
  try {
    const viewerId = req.user?.id;
    const target = parseInt(req.params.userId as string);
    if (!Number.isFinite(target)) throw new AppError('대상을 찾을 수 없습니다.', 404);

    const rows = await prisma.guestbookEntry.findMany({
      where: { targetUserId: target, parentId: null },
      orderBy: { createdAt: 'desc' }, take: 100,
      include: { author: authorSelect, replies: { orderBy: { createdAt: 'asc' }, include: { author: authorSelect } } },
    });
    res.json({
      entries: rows.map((e) => serializeEntry(e as EntryRow, viewerId, target)),
      isOwner: viewerId === target,
    });
  } catch (e) { next(e); }
});

// ── 작성 (글 또는 방 주인의 답글) ──
router.post('/:userId', authenticate, validate(writeSchema), async (req, res, next) => {
  try {
    const me = req.user!.id;
    const target = parseInt(req.params.userId as string);
    if (!Number.isFinite(target)) throw new AppError('대상을 찾을 수 없습니다.', 404);
    const targetUser = await prisma.user.findFirst({ where: { id: target, deletedAt: null }, select: { id: true } });
    if (!targetUser) throw new AppError('대상을 찾을 수 없습니다.', 404);

    const { body } = req.body;
    const parentId: number | undefined = req.body.parentId;
    // ⚠️ **새 글은 비밀글로 만들 수 없다** (2026-09-16 사용자 결정).
    //    방명록은 작가 홈페이지에 남기는 응원이라 '비밀글입니다' 줄이 섞이면 공개 페이지가 지저분해진다.
    //    보낸 사람만 읽히는 말은 메시지(ArtTalk)가 할 일이다. `secret` 컬럼과 **이미 쓰인 비밀글은 그대로 둔다** —
    //    남이 작가에게만 보이라고 쓴 글을 뒤늦게 공개로 뒤집을 수는 없다. 그래서 읽기 경로(serializeEntry)는 안 건드린다.

    if (parentId != null) {
      // 답글 — **방 주인만**. 최상위 글에만 달 수 있다.
      if (me !== target) throw new AppError('답글은 방 주인만 달 수 있습니다.', 403);
      const parent = await prisma.guestbookEntry.findUnique({ where: { id: parentId }, select: { id: true, targetUserId: true, parentId: true, authorId: true } });
      if (!parent || parent.targetUserId !== target || parent.parentId !== null) throw new AppError('원 글을 찾을 수 없습니다.', 404);

      const entry = await prisma.guestbookEntry.create({
        data: { targetUserId: target, authorId: me, body: body.trim(), parentId },
        include: { author: authorSelect },
      });
      // 원 글쓴이에게 알림 (자기 글에 자기가 답하면 알림 없음)
      // ⚠️ `?tab=guestbook` 필수 — 방명록은 작가 홈페이지의 탭이라(2026-09-25) 쿼리가 없으면 [작품] 탭이 열려 글이 안 보인다
      if (parent.authorId !== me) {
        try {
          const meUser = await prisma.user.findUnique({ where: { id: me }, select: { name: true, nickname: true } });
          await prisma.notification.create({
            data: { userId: parent.authorId, type: 'GUESTBOOK_REPLY', message: `${meUser ? displayName(meUser) : '방 주인'}님이 방명록에 답글을 남겼습니다.`, linkUrl: `/portfolio/${target}?tab=guestbook` },
          });
        } catch { /* best-effort */ }
      }
      return res.status(201).json(serializeEntry({ ...entry, replies: [] } as EntryRow, me, target));
    }

    // 최상위 글
    const entry = await prisma.guestbookEntry.create({
      data: { targetUserId: target, authorId: me, body: body.trim() },
      include: { author: authorSelect },
    });
    // 방 주인에게 알림 (자기 방에 자기가 쓰면 알림 없음)
    if (target !== me) {
      try {
        const meUser = await prisma.user.findUnique({ where: { id: me }, select: { name: true, nickname: true } });
        await prisma.notification.create({
          data: { userId: target, type: 'GUESTBOOK_NEW', message: `${meUser ? displayName(meUser) : '누군가'}님이 방명록을 남겼습니다.`, linkUrl: `/portfolio/${target}?tab=guestbook` },
        });
      } catch { /* best-effort */ }
    }
    res.status(201).json(serializeEntry({ ...entry, replies: [] } as EntryRow, me, target));
  } catch (e) { next(e); }
});

// ── 삭제 (글쓴이 · 방 주인 · Admin) ──
router.delete('/:userId/:entryId', authenticate, async (req, res, next) => {
  try {
    const me = req.user!.id;
    const target = parseInt(req.params.userId as string);
    const entryId = parseInt(req.params.entryId as string);
    const entry = await prisma.guestbookEntry.findUnique({ where: { id: entryId }, select: { authorId: true, targetUserId: true } });
    if (!entry || entry.targetUserId !== target) throw new AppError('방명록을 찾을 수 없습니다.', 404);
    if (entry.authorId !== me && entry.targetUserId !== me && req.user!.role !== 'ADMIN') {
      throw new AppError('삭제 권한이 없습니다.', 403);
    }
    await prisma.guestbookEntry.delete({ where: { id: entryId } });   // 답글은 FK Cascade 로 함께 삭제
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
