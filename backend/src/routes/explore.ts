import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, optionalAuth } from '../middleware/auth';

const router = Router();

// GET / — 공개 탐색 피드 (Explore)
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 30;
    const skip = (page - 1) * limit;
    const userId = req.user?.id;

    const [images, total] = await Promise.all([
      prisma.portfolioImage.findMany({
        where: { showInExplore: true },
        orderBy: { id: 'desc' },
        skip,
        take: limit,
        include: {
          portfolio: {
            include: {
              user: { select: { id: true, name: true, avatar: true } },
            },
          },
          _count: { select: { likes: true } },
          ...(userId ? { likes: { where: { userId }, select: { id: true } } } : {}),
        },
      }),
      prisma.portfolioImage.count({ where: { showInExplore: true } }),
    ]);

    // 같은 작가 이미지가 연속으로 나오지 않도록 라운드로빈 분산
    const mapped = images.map(img => ({
      id: img.id,
      url: img.url,
      artist: img.portfolio.user,
      likeCount: img._count.likes,
      isLiked: userId ? (img as any).likes?.length > 0 : false,
    }));

    const byArtist = new Map<number, typeof mapped>();
    for (const img of mapped) {
      const arr = byArtist.get(img.artist.id) || [];
      arr.push(img);
      byArtist.set(img.artist.id, arr);
    }
    const queues = Array.from(byArtist.values());
    const interleaved: typeof mapped = [];
    while (interleaved.length < mapped.length) {
      for (const q of queues) {
        if (q.length > 0) interleaved.push(q.shift()!);
      }
    }

    res.json({
      images: interleaved,
      total,
      page,
      limit,
    });
  } catch (err) { next(err); }
});

// POST /:imageId/like — 좋아요 토글
router.post('/:imageId/like', authenticate, async (req, res, next) => {
  try {
    const imageId = parseInt(req.params.imageId as string);
    const userId = req.user!.id;

    const image = await prisma.portfolioImage.findUnique({ where: { id: imageId } });
    if (!image || !image.showInExplore) {
      return res.status(404).json({ error: '이미지를 찾을 수 없습니다.' });
    }

    const existing = await prisma.portfolioImageLike.findUnique({
      where: { userId_imageId: { userId, imageId } },
    });

    if (existing) {
      await prisma.portfolioImageLike.delete({ where: { id: existing.id } });
    } else {
      await prisma.portfolioImageLike.create({ data: { userId, imageId } });
    }

    const likeCount = await prisma.portfolioImageLike.count({ where: { imageId } });
    res.json({ liked: !existing, likeCount });
  } catch (err) { next(err); }
});

// GET /:imageId/likes — 좋아요 누른 사용자 목록 (이미지 소유자만 상세 조회)
router.get('/:imageId/likes', optionalAuth, async (req, res, next) => {
  try {
    const imageId = parseInt(req.params.imageId as string);
    const userId = req.user?.id;

    const image = await prisma.portfolioImage.findUnique({
      where: { id: imageId },
      include: { portfolio: { select: { userId: true } } },
    });
    if (!image) {
      return res.status(404).json({ error: '이미지를 찾을 수 없습니다.' });
    }

    const likeCount = await prisma.portfolioImageLike.count({ where: { imageId } });
    const isOwner = userId === image.portfolio.userId;

    if (isOwner) {
      const likers = await prisma.portfolioImageLike.findMany({
        where: { imageId },
        include: { user: { select: { id: true, name: true, avatar: true } } },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ likeCount, likers: likers.map(l => l.user) });
    } else {
      res.json({ likeCount, likers: [] });
    }
  } catch (err) { next(err); }
});

export default router;
