/**
 * 스토리 (작업 중 사진 + 짧은 글) — 별도 [소식] 피드의 출처. 커뮤니티(글로벌 게시판)와 다르다.
 *
 * ## 설계
 * - **공개 범위는 글마다** — `PUBLIC`(전체공개) | `NEIGHBORS`(이웃공개).
 *   내가 팔로우한 사람이면 그 사람 이웃공개 스토리도 보인다(팔로우 = 이웃).
 * - [소식] 피드 = **내가 팔로우한 사람 + 나** 의 스토리(최신순). 팔로우한 사람 것은 공개범위 무관하게 다 보인다.
 * - 작가 홈페이지의 스토리 목록(`/user/:id`)은 **비팔로워에게 PUBLIC 만** 보여준다.
 * - 스토리는 익명이 없다 — 소식은 '누가 무엇을' 이 핵심이다.
 */
import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, optionalAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { safeFileUrl } from '../lib/safeUrl';
import { matchR2Base } from '../lib/r2Urls';

const router = Router();

/** 스토리 사진도 **우리 저장소** 주소만 (외부 URL 차단). */
function ownImageUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const u of raw.slice(0, 10)) {
    const s = safeFileUrl(u);
    if (s && (s.startsWith('/uploads/') || matchR2Base(s))) out.push(s);
  }
  return out;
}

const authorSelect = { select: { id: true, name: true, nickname: true, avatar: true, role: true } } as const;
type AuthorRow = { id: number; name: string; nickname: string | null; avatar: string | null; role: string };
const serializeAuthor = (a: AuthorRow) => ({ id: a.id, name: a.nickname || a.name, avatar: a.avatar, role: a.role });

const createSchema = z.object({
  caption: z.string().trim().max(1000, '글은 1000자까지입니다.').optional().default(''),
  images: z.array(z.string()).max(10, '사진은 10장까지입니다.').optional().default([]),
  visibility: z.enum(['PUBLIC', 'NEIGHBORS']).optional().default('NEIGHBORS'),
});

type StoryRow = { id: number; caption: string; images: string[]; visibility: string; createdAt: Date; author: AuthorRow; likeCount: number; commentCount: number };
const serialize = (s: StoryRow, mine: boolean, liked = false) => ({
  id: s.id, caption: s.caption, images: s.images, visibility: s.visibility, createdAt: s.createdAt,
  author: serializeAuthor(s.author), mine,
  likeCount: s.likeCount, commentCount: s.commentCount, liked,
});

/** 뷰어가 좋아요한 스토리 id 집합 (여러 스토리를 한 번에) */
async function likedSet(viewerId: number | undefined, storyIds: number[]): Promise<Set<number>> {
  if (!viewerId || storyIds.length === 0) return new Set();
  const rows = await prisma.storyLike.findMany({ where: { userId: viewerId, storyId: { in: storyIds } }, select: { storyId: true } });
  return new Set(rows.map((r) => r.storyId));
}

// ── [소식] 피드 — 내가 팔로우한 사람 + 나, 최신순 ──
router.get('/feed', authenticate, async (req, res, next) => {
  try {
    const me = req.user!.id;
    const page = Math.max(1, parseInt(String(req.query.page ?? '1')) || 1);
    const take = 20;

    const following = await prisma.follow.findMany({ where: { followerId: me }, select: { followingId: true } });
    const authorIds = [me, ...following.map((f) => f.followingId)];

    const [rows, total] = await Promise.all([
      prisma.story.findMany({
        where: { authorId: { in: authorIds } },
        orderBy: { createdAt: 'desc' }, skip: (page - 1) * take, take, include: { author: authorSelect },
      }),
      prisma.story.count({ where: { authorId: { in: authorIds } } }),
    ]);
    const liked = await likedSet(me, rows.map((s) => s.id));
    res.json({
      stories: rows.map((s) => serialize(s, s.authorId === me, liked.has(s.id))),
      total, page, hasMore: page * take < total,
      followingCount: following.length,
    });
  } catch (e) { next(e); }
});

// ── 한 사람의 스토리 (작가 홈페이지) — 비팔로워는 PUBLIC 만 ──
router.get('/user/:userId', optionalAuth, async (req, res, next) => {
  try {
    const me = req.user?.id;
    const target = parseInt(req.params.userId as string);
    if (!Number.isFinite(target)) throw new AppError('대상을 찾을 수 없습니다.', 404);

    const isSelf = me === target;
    const isFollower = !isSelf && me
      ? !!(await prisma.follow.findUnique({ where: { followerId_followingId: { followerId: me, followingId: target } }, select: { id: true } }))
      : false;
    const canSeeNeighbors = isSelf || isFollower;

    const rows = await prisma.story.findMany({
      where: { authorId: target, ...(canSeeNeighbors ? {} : { visibility: 'PUBLIC' }) },
      orderBy: { createdAt: 'desc' }, take: 30, include: { author: authorSelect },
    });
    const liked = await likedSet(me, rows.map((s) => s.id));
    res.json({ stories: rows.map((s) => serialize(s, isSelf, liked.has(s.id))), canSeeNeighbors });
  } catch (e) { next(e); }
});

// ── 작성 ──
router.post('/', authenticate, validate(createSchema), async (req, res, next) => {
  try {
    const caption = String(req.body.caption ?? '').trim();
    const images = ownImageUrls(req.body.images);
    if (!caption && images.length === 0) throw new AppError('사진이나 글 중 하나는 있어야 합니다.', 400);
    const story = await prisma.story.create({
      data: { authorId: req.user!.id, caption, images, visibility: req.body.visibility ?? 'NEIGHBORS' },
      include: { author: authorSelect },
    });
    res.status(201).json(serialize(story, true));
  } catch (e) { next(e); }
});

// ── 좋아요 누른 사람 목록 (스토리는 익명 없음 — 누가 눌렀는지 보인다) ──
router.get('/:id/likers', optionalAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const rows = await prisma.storyLike.findMany({
      where: { storyId: id }, orderBy: { createdAt: 'desc' }, take: 100,
      include: { user: authorSelect },
    });
    res.json(rows.map((r) => serializeAuthor(r.user)));
  } catch (e) { next(e); }
});

// ── 좋아요 토글 ──
router.post('/:id/like', authenticate, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const me = req.user!.id;
    const story = await prisma.story.findUnique({ where: { id }, select: { id: true } });
    if (!story) throw new AppError('스토리를 찾을 수 없습니다.', 404);

    const existing = await prisma.storyLike.findUnique({ where: { storyId_userId: { storyId: id, userId: me } }, select: { id: true } });
    if (existing) {
      const [, updated] = await prisma.$transaction([
        prisma.storyLike.delete({ where: { id: existing.id } }),
        prisma.story.update({ where: { id }, data: { likeCount: { decrement: 1 } }, select: { likeCount: true } }),
      ]);
      return res.json({ liked: false, likeCount: updated.likeCount });
    }
    const [, updated] = await prisma.$transaction([
      prisma.storyLike.create({ data: { storyId: id, userId: me } }),
      prisma.story.update({ where: { id }, data: { likeCount: { increment: 1 } }, select: { likeCount: true } }),
    ]);
    res.json({ liked: true, likeCount: updated.likeCount });
  } catch (e) { next(e); }
});

// ── 댓글 목록 ──
router.get('/:id/comments', optionalAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const me = req.user?.id;
    const rows = await prisma.storyComment.findMany({
      where: { storyId: id }, orderBy: { createdAt: 'asc' }, include: { author: authorSelect },
    });
    res.json(rows.map((c) => ({
      id: c.id, body: c.body, createdAt: c.createdAt,
      author: serializeAuthor(c.author), mine: me != null && me === c.authorId,
    })));
  } catch (e) { next(e); }
});

// ── 댓글 작성 ──
const commentSchema = z.object({ body: z.string().trim().min(1, '댓글을 입력해주세요.').max(1000, '댓글은 1000자까지입니다.') });
router.post('/:id/comments', authenticate, validate(commentSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const me = req.user!.id;
    const story = await prisma.story.findUnique({ where: { id }, select: { id: true, authorId: true } });
    if (!story) throw new AppError('스토리를 찾을 수 없습니다.', 404);

    const [comment] = await prisma.$transaction([
      prisma.storyComment.create({ data: { storyId: id, authorId: me, body: req.body.body.trim() }, include: { author: authorSelect } }),
      prisma.story.update({ where: { id }, data: { commentCount: { increment: 1 } } }),
    ]);
    // 스토리 주인에게 알림 (자기 글에 자기가 달면 없음)
    if (story.authorId !== me) {
      try {
        const meUser = await prisma.user.findUnique({ where: { id: me }, select: { name: true, nickname: true } });
        await prisma.notification.create({
          data: { userId: story.authorId, type: 'STORY_COMMENT', message: `${meUser ? (meUser.nickname || meUser.name) : '누군가'}님이 소식에 댓글을 남겼습니다.`, linkUrl: `/feed` },
        });
      } catch { /* best-effort */ }
    }
    res.status(201).json({ id: comment.id, body: comment.body, createdAt: comment.createdAt, author: serializeAuthor(comment.author), mine: true });
  } catch (e) { next(e); }
});

// ── 댓글 삭제 (작성자 · 스토리 주인 · Admin) ──
router.delete('/:id/comments/:commentId', authenticate, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const commentId = parseInt(req.params.commentId as string);
    const me = req.user!.id;
    const comment = await prisma.storyComment.findUnique({ where: { id: commentId }, select: { authorId: true, storyId: true, story: { select: { authorId: true } } } });
    if (!comment || comment.storyId !== id) throw new AppError('댓글을 찾을 수 없습니다.', 404);
    if (comment.authorId !== me && comment.story.authorId !== me && req.user!.role !== 'ADMIN') throw new AppError('삭제 권한이 없습니다.', 403);
    await prisma.$transaction([
      prisma.storyComment.delete({ where: { id: commentId } }),
      prisma.story.update({ where: { id }, data: { commentCount: { decrement: 1 } } }),
    ]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── 삭제 (작성자 또는 Admin) ──
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const story = await prisma.story.findUnique({ where: { id }, select: { authorId: true } });
    if (!story) throw new AppError('스토리를 찾을 수 없습니다.', 404);
    if (story.authorId !== req.user!.id && req.user!.role !== 'ADMIN') throw new AppError('삭제 권한이 없습니다.', 403);
    await prisma.story.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
