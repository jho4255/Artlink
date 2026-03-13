import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';

const favoriteToggleSchema = z.object({
  galleryId: z.number().int().positive().optional(),
  exhibitionId: z.number().int().positive().optional(),
  showId: z.number().int().positive().optional(),
}).refine(data => data.galleryId || data.exhibitionId || data.showId, {
  message: 'galleryId, exhibitionId 또는 showId가 필요합니다.',
});

const router = Router();

// 내 찜 목록 조회
router.get('/', authenticate, async (req, res, next) => {
  try {
    const favorites = await prisma.favorite.findMany({
      where: { userId: req.user!.id },
      include: {
        gallery: { select: { id: true, name: true, mainImage: true, rating: true } },
        exhibition: {
          select: { id: true, title: true, gallery: { select: { name: true } } }
        },
        show: {
          select: { id: true, title: true, posterImage: true, gallery: { select: { name: true } } }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(favorites);
  } catch (error) { next(error); }
});

// 찜 토글
router.post('/toggle', authenticate, validate(favoriteToggleSchema), async (req, res, next) => {
  try {
    const { galleryId, exhibitionId, showId } = req.body;

    // 트랜잭션으로 찜 토글 atomic 보장 (race condition 방지)
    if (galleryId) {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.favorite.findUnique({
          where: { userId_galleryId: { userId: req.user!.id, galleryId } }
        });
        if (existing) {
          await tx.favorite.delete({ where: { id: existing.id } });
          return { favorited: false };
        }
        await tx.favorite.create({ data: { userId: req.user!.id, galleryId } });
        return { favorited: true };
      });
      return res.json(result);
    }

    if (exhibitionId) {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.favorite.findUnique({
          where: { userId_exhibitionId: { userId: req.user!.id, exhibitionId } }
        });
        if (existing) {
          await tx.favorite.delete({ where: { id: existing.id } });
          return { favorited: false };
        }
        await tx.favorite.create({ data: { userId: req.user!.id, exhibitionId } });
        return { favorited: true };
      });
      return res.json(result);
    }

    if (showId) {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.favorite.findUnique({
          where: { userId_showId: { userId: req.user!.id, showId } }
        });
        if (existing) {
          await tx.favorite.delete({ where: { id: existing.id } });
          return { favorited: false };
        }
        await tx.favorite.create({ data: { userId: req.user!.id, showId } });
        return { favorited: true };
      });
      return res.json(result);
    }

    res.status(400).json({ error: 'galleryId, exhibitionId 또는 showId가 필요합니다.' });
  } catch (error) { next(error); }
});

export default router;
