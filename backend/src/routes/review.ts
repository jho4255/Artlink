import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';

const reviewCreateSchema = z.object({
  galleryId: z.number().int().positive('유효한 갤러리 ID가 필요합니다.'),
  rating: z.number().int().min(1, '별점은 1~5 사이여야 합니다.').max(5, '별점은 1~5 사이여야 합니다.'),
  content: z.string().min(1, '리뷰 내용을 입력해주세요.').max(2000, '리뷰는 2000자 이내로 작성해주세요.'),
  imageUrl: z.string().optional(),
  anonymous: z.boolean().optional(),
});

const reviewUpdateSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  content: z.string().min(1).max(2000).optional(),
  imageUrl: z.string().optional(),
  anonymous: z.boolean().optional(),
});

const router = Router();

// 갤러리 리뷰 목록 조회
router.get('/gallery/:galleryId', async (req, res, next) => {
  try {
    const reviews = await prisma.review.findMany({
      where: { galleryId: parseInt(req.params.galleryId) },
      include: { user: { select: { id: true, name: true, avatar: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json(reviews);
  } catch (error) { next(error); }
});

// 내 리뷰 목록 조회
router.get('/my', authenticate, async (req, res, next) => {
  try {
    const reviews = await prisma.review.findMany({
      where: { userId: req.user!.id },
      include: { gallery: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json(reviews);
  } catch (error) { next(error); }
});

// 리뷰 작성 (Artist 전용)
router.post('/', authenticate, authorize('ARTIST'), validate(reviewCreateSchema), async (req, res, next) => {
  try {
    const { galleryId, rating, content, imageUrl, anonymous } = req.body;

    // 중복 제출 방지 (idempotency): 같은 유저+갤러리+내용이 최근 1분 내에 있으면 기존 리뷰 반환
    // Render 콜드스타트(~30s) 중 timeout → 재클릭 시 동일 리뷰 다수 생성되는 문제 방지
    const recentDup = await prisma.review.findFirst({
      where: {
        userId: req.user!.id,
        galleryId,
        content,
        createdAt: { gte: new Date(Date.now() - 60 * 1000) },
      },
    });
    if (recentDup) {
      return res.status(201).json(recentDup);
    }

    // 트랜잭션으로 리뷰 생성 + 평점 재계산 atomic 보장
    const review = await prisma.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          userId: req.user!.id,
          galleryId,
          rating,
          content,
          imageUrl,
          anonymous: anonymous || false
        }
      });
      const agg = await tx.review.aggregate({
        where: { galleryId },
        _avg: { rating: true },
        _count: { rating: true }
      });
      await tx.gallery.update({
        where: { id: galleryId },
        data: { rating: agg._avg.rating || 0, reviewCount: agg._count.rating }
      });
      return review;
    });

    res.status(201).json(review);
  } catch (error) { next(error); }
});

// 리뷰 수정 (작성자 본인만)
router.patch('/:id', authenticate, validate(reviewUpdateSchema), async (req, res, next) => {
  try {
    const review = await prisma.review.findUnique({ where: { id: parseInt(req.params.id as string) } });
    if (!review) throw new AppError('리뷰를 찾을 수 없습니다.', 404);
    if (review.userId !== req.user!.id) throw new AppError('본인 리뷰만 수정할 수 있습니다.', 403);

    const { rating, content, imageUrl, anonymous } = req.body;

    // rating 변경 시 트랜잭션으로 atomic 보장
    if (rating !== undefined) {
      const updated = await prisma.$transaction(async (tx) => {
        const updated = await tx.review.update({
          where: { id: review.id },
          data: {
            ...(rating !== undefined && { rating }),
            ...(content !== undefined && { content }),
            ...(imageUrl !== undefined && { imageUrl }),
            ...(anonymous !== undefined && { anonymous }),
          }
        });
        const agg = await tx.review.aggregate({
          where: { galleryId: review.galleryId },
          _avg: { rating: true },
          _count: { rating: true }
        });
        await tx.gallery.update({
          where: { id: review.galleryId },
          data: { rating: agg._avg.rating || 0, reviewCount: agg._count.rating }
        });
        return updated;
      });
      return res.json(updated);
    }

    const updated = await prisma.review.update({
      where: { id: review.id },
      data: {
        ...(content !== undefined && { content }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(anonymous !== undefined && { anonymous }),
      }
    });
    res.json(updated);
  } catch (error) { next(error); }
});

// 리뷰 삭제 (Admin 또는 작성자 본인)
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const review = await prisma.review.findUnique({ where: { id: parseInt(req.params.id as string) } });
    if (!review) throw new AppError('리뷰를 찾을 수 없습니다.', 404);

    // Admin 또는 작성자만 삭제 가능
    if (req.user!.role !== 'ADMIN' && review.userId !== req.user!.id) {
      throw new AppError('권한이 없습니다.', 403);
    }

    // 트랜잭션으로 삭제 + 평점 재계산 atomic 보장
    await prisma.$transaction(async (tx) => {
      await tx.review.delete({ where: { id: review.id } });
      const agg = await tx.review.aggregate({
        where: { galleryId: review.galleryId },
        _avg: { rating: true },
        _count: { rating: true }
      });
      await tx.gallery.update({
        where: { id: review.galleryId },
        data: { rating: agg._avg.rating || 0, reviewCount: agg._count.rating }
      });
    });

    res.json({ message: '리뷰가 삭제되었습니다.' });
  } catch (error) { next(error); }
});

export default router;
