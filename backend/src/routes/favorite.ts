import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AppError } from '../middleware/errorHandler';

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
        gallery: { select: { id: true, name: true, mainImage: true, rating: true, reviewCount: true, status: true } },
        exhibition: {
          select: { id: true, title: true, status: true, gallery: { select: { name: true } } }
        },
        show: {
          select: { id: true, title: true, posterImage: true, status: true, gallery: { select: { name: true } } }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    // 탈퇴(WITHDRAWN)/미승인 대상은 상세 진입 시 404이므로 목록에서 제외.
    // 각 찜 행은 gallery/exhibition/show 중 정확히 하나에만 연결됨.
    const valid = favorites.filter((f) => {
      const target = f.gallery ?? f.exhibition ?? f.show;
      return target != null && target.status === 'APPROVED';
    });
    res.json(valid);
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
        // 신규 찜: 대상이 존재하고 승인된 상태여야 함 (미승인/탈퇴 대상 찜 방지)
        const gallery = await tx.gallery.findUnique({ where: { id: galleryId }, select: { status: true } });
        if (!gallery || gallery.status !== 'APPROVED') {
          throw new AppError('대상을 찾을 수 없습니다.', 404);
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
        // 신규 찜: 대상이 존재하고 승인된 상태여야 함 (미승인/탈퇴 대상 찜 방지)
        const exhibition = await tx.exhibition.findUnique({ where: { id: exhibitionId }, select: { status: true } });
        if (!exhibition || exhibition.status !== 'APPROVED') {
          throw new AppError('대상을 찾을 수 없습니다.', 404);
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
        // 신규 찜: 대상이 존재하고 승인된 상태여야 함 (미승인/탈퇴 대상 찜 방지)
        const show = await tx.show.findUnique({ where: { id: showId }, select: { status: true } });
        if (!show || show.status !== 'APPROVED') {
          throw new AppError('대상을 찾을 수 없습니다.', 404);
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
