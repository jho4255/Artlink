/**
 * 커뮤니티 게시판 (블라인드식 글로벌 게시판) — 홈 [인기글]의 출처.
 *
 * ## 설계
 * - **글마다 실명/익명 선택**(`anonymous`). 익명이면 응답에서 작성자 신원을 가린다
 *   (id·닉네임·아바타·역할 모두 숨김) — 역추적 방지. 서버는 authz 를 위해 authorId 를 계속 안다.
 * - 목록·랭킹을 매번 집계하지 않으려고 `likeCount`/`commentCount` 를 비정규화해 들고 있는다.
 * - 읽기는 공개(비로그인도), 쓰기는 로그인 필요. 삭제는 작성자 본인 또는 Admin.
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

/** 글 사진은 **우리 저장소** 주소만 (화면이 방금 /api/upload/image 로 올린 것). 외부 URL 차단. */
function ownImageUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const u of raw.slice(0, 10)) {
    const s = safeFileUrl(u);
    if (s && (s.startsWith('/uploads/') || matchR2Base(s))) out.push(s);
  }
  return out;
}

const createSchema = z.object({
  title: z.string().trim().min(1, '제목을 입력해주세요.').max(120, '제목은 120자까지입니다.'),
  body: z.string().trim().min(1, '내용을 입력해주세요.').max(5000, '내용은 5000자까지입니다.'),
  anonymous: z.boolean().optional().default(false),
  images: z.array(z.string()).max(10, '사진은 10장까지입니다.').optional().default([]),
});
const commentSchema = z.object({
  body: z.string().trim().min(1, '댓글을 입력해주세요.').max(2000, '댓글은 2000자까지입니다.'),
  anonymous: z.boolean().optional().default(false),
});

type AuthorRow = { id: number; name: string; nickname: string | null; avatar: string | null; role: string };
const authorSelect = { select: { id: true, name: true, nickname: true, avatar: true, role: true } } as const;

/** 작성자 표기 — 익명이면 신원을 통째로 가린다(역추적 방지). 실명이면 닉네임 우선 + 역할. */
function serializeAuthor(anonymous: boolean, author: AuthorRow, viewerId?: number) {
  const mine = viewerId != null && viewerId === author.id;
  if (anonymous) {
    // 본인에게만 '익명(나)' 로 표시해 삭제 버튼 맥락을 준다. 그 외에는 완전 익명.
    return { id: null as number | null, name: mine ? '익명(나)' : '익명', nickname: null, avatar: null, role: null, anonymous: true, mine };
  }
  return { id: author.id, name: author.nickname || author.name, nickname: author.nickname, avatar: author.avatar, role: author.role, anonymous: false, mine };
}

// ── 목록 ── (sort=recent|popular, page)
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const viewerId = req.user?.id;
    const sort = String(req.query.sort ?? 'recent');
    const page = Math.max(1, parseInt(String(req.query.page ?? '1')) || 1);
    const take = 20;
    const orderBy = sort === 'popular'
      ? [{ likeCount: 'desc' as const }, { commentCount: 'desc' as const }, { createdAt: 'desc' as const }]
      : [{ createdAt: 'desc' as const }];

    // 내 글 / 내 댓글단 글 필터 — 로그인 필요(없으면 빈 목록)
    const mine = String(req.query.mine ?? '');
    let where: Record<string, unknown> = {};
    if (mine === 'posts') where = viewerId ? { authorId: viewerId } : { id: -1 };
    else if (mine === 'comments') where = viewerId ? { comments: { some: { authorId: viewerId } } } : { id: -1 };

    const [rows, total] = await Promise.all([
      prisma.post.findMany({ where, orderBy, skip: (page - 1) * take, take, include: { author: authorSelect } }),
      prisma.post.count({ where }),
    ]);

    res.json({
      posts: rows.map((p) => ({
        id: p.id, title: p.title,
        // 목록엔 본문을 짧게만 (전문은 상세에서)
        excerpt: p.body.length > 140 ? p.body.slice(0, 140) + '…' : p.body,
        thumbnail: p.images[0] ?? null, imageCount: p.images.length,
        likeCount: p.likeCount, commentCount: p.commentCount, viewCount: p.viewCount, createdAt: p.createdAt,
        author: serializeAuthor(p.anonymous, p.author, viewerId),
      })),
      total, page, hasMore: page * take < total,
    });
  } catch (e) { next(e); }
});

// ── 인기글 (홈 위젯) ── 좋아요 많은 순, 동률이면 최신
router.get('/popular', async (req, res, next) => {
  try {
    const limit = Math.min(10, Math.max(1, parseInt(String(req.query.limit ?? '5')) || 5));
    const rows = await prisma.post.findMany({
      orderBy: [{ likeCount: 'desc' }, { commentCount: 'desc' }, { createdAt: 'desc' }],
      take: limit, include: { author: authorSelect },
    });
    res.json(rows.map((p) => ({
      id: p.id, title: p.title, likeCount: p.likeCount, commentCount: p.commentCount, viewCount: p.viewCount, createdAt: p.createdAt,
      author: serializeAuthor(p.anonymous, p.author),
    })));
  } catch (e) { next(e); }
});

// ── 상세 (+ 댓글) ──
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const viewerId = req.user?.id;
    const id = parseInt(req.params.id as string);
    if (!Number.isFinite(id)) throw new AppError('글을 찾을 수 없습니다.', 404);
    const post = await prisma.post.findUnique({
      where: { id },
      include: { author: authorSelect, comments: { orderBy: { createdAt: 'asc' }, include: { author: authorSelect } } },
    });
    if (!post) throw new AppError('글을 찾을 수 없습니다.', 404);

    const liked = viewerId
      ? !!(await prisma.postLike.findUnique({ where: { postId_userId: { postId: id, userId: viewerId } }, select: { id: true } }))
      : false;

    // 조회수 +1 (작성자 본인 조회는 세지 않는다 — 자기 글 새로고침으로 부풀지 않게)
    const isAuthor = viewerId != null && viewerId === post.authorId;
    const viewCount = isAuthor ? post.viewCount : (await prisma.post.update({
      where: { id }, data: { viewCount: { increment: 1 } }, select: { viewCount: true },
    })).viewCount;

    res.json({
      id: post.id, title: post.title, body: post.body, images: post.images,
      likeCount: post.likeCount, commentCount: post.commentCount, viewCount,
      createdAt: post.createdAt, updatedAt: post.updatedAt,
      liked,
      author: serializeAuthor(post.anonymous, post.author, viewerId),
      comments: post.comments.map((c) => ({
        id: c.id, body: c.body, createdAt: c.createdAt,
        author: serializeAuthor(c.anonymous, c.author, viewerId),
      })),
    });
  } catch (e) { next(e); }
});

// ── 작성 ──
router.post('/', authenticate, validate(createSchema), async (req, res, next) => {
  try {
    const { title, body, anonymous } = req.body;
    const images = ownImageUrls(req.body.images);   // 외부 URL 차단, 우리 저장소만
    const post = await prisma.post.create({
      data: { authorId: req.user!.id, title: title.trim(), body: body.trim(), anonymous: !!anonymous, images },
      include: { author: authorSelect },
    });
    res.status(201).json({ id: post.id, author: serializeAuthor(post.anonymous, post.author, req.user!.id) });
  } catch (e) { next(e); }
});

// ── 삭제 (작성자 또는 Admin) ──
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const post = await prisma.post.findUnique({ where: { id }, select: { authorId: true } });
    if (!post) throw new AppError('글을 찾을 수 없습니다.', 404);
    if (post.authorId !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw new AppError('삭제 권한이 없습니다.', 403);
    }
    await prisma.post.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── 좋아요 토글 ──
router.post('/:id/like', authenticate, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const me = req.user!.id;
    const post = await prisma.post.findUnique({ where: { id }, select: { id: true } });
    if (!post) throw new AppError('글을 찾을 수 없습니다.', 404);

    const existing = await prisma.postLike.findUnique({ where: { postId_userId: { postId: id, userId: me } }, select: { id: true } });
    if (existing) {
      const [, updated] = await prisma.$transaction([
        prisma.postLike.delete({ where: { id: existing.id } }),
        prisma.post.update({ where: { id }, data: { likeCount: { decrement: 1 } }, select: { likeCount: true } }),
      ]);
      return res.json({ liked: false, likeCount: updated.likeCount });
    }
    const [, updated] = await prisma.$transaction([
      prisma.postLike.create({ data: { postId: id, userId: me } }),
      prisma.post.update({ where: { id }, data: { likeCount: { increment: 1 } }, select: { likeCount: true } }),
    ]);
    res.json({ liked: true, likeCount: updated.likeCount });
  } catch (e) { next(e); }
});

// ── 댓글 작성 ──
router.post('/:id/comments', authenticate, validate(commentSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const me = req.user!.id;
    const post = await prisma.post.findUnique({ where: { id }, select: { id: true } });
    if (!post) throw new AppError('글을 찾을 수 없습니다.', 404);

    const { body, anonymous } = req.body;
    const [comment] = await prisma.$transaction([
      prisma.postComment.create({
        data: { postId: id, authorId: me, body: body.trim(), anonymous: !!anonymous },
        include: { author: authorSelect },
      }),
      prisma.post.update({ where: { id }, data: { commentCount: { increment: 1 } } }),
    ]);
    res.status(201).json({
      id: comment.id, body: comment.body, createdAt: comment.createdAt,
      author: serializeAuthor(comment.anonymous, comment.author, me),
    });
  } catch (e) { next(e); }
});

// ── 댓글 삭제 (작성자 또는 Admin) ──
router.delete('/:id/comments/:commentId', authenticate, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const commentId = parseInt(req.params.commentId as string);
    const comment = await prisma.postComment.findUnique({ where: { id: commentId }, select: { authorId: true, postId: true } });
    if (!comment || comment.postId !== id) throw new AppError('댓글을 찾을 수 없습니다.', 404);
    if (comment.authorId !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw new AppError('삭제 권한이 없습니다.', 403);
    }
    await prisma.$transaction([
      prisma.postComment.delete({ where: { id: commentId } }),
      prisma.post.update({ where: { id }, data: { commentCount: { decrement: 1 } } }),
    ]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
