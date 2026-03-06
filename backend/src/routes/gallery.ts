import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, authorize, optionalAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// 갤러리 목록 조회 (공개, 승인된 것만 / owned=true 시 본인 갤러리 전체)
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { region, minRating, sortBy, owned } = req.query;

    const where: any = { status: 'APPROVED' };

    // Gallery 유저가 본인 갤러리 조회 시 PENDING 포함
    if (owned === 'true' && req.user) {
      delete where.status;
      where.ownerId = req.user.id;
    }

    if (region) where.region = region;
    if (minRating) where.rating = { gte: parseFloat(minRating as string) };

    const orderBy: any = sortBy === 'rating' ? { rating: 'desc' } : { createdAt: 'desc' };

    const galleries = await prisma.gallery.findMany({
      where,
      orderBy,
      include: { images: { orderBy: { order: 'asc' }, take: 1 } }
    });

    // 로그인 유저의 찜 여부 확인
    if (req.user) {
      const favorites = await prisma.favorite.findMany({
        where: {
          userId: req.user.id,
          galleryId: { in: galleries.map((g: any) => g.id) }
        },
        select: { galleryId: true }
      });
      const favSet = new Set(favorites.map(f => f.galleryId));
      const result = galleries.map((g: any) => ({ ...g, isFavorited: favSet.has(g.id) }));
      return res.json(result);
    }

    res.json(galleries.map((g: any) => ({ ...g, isFavorited: false })));
  } catch (error) { next(error); }
});

// 갤러리 상세 조회
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const gallery = await prisma.gallery.findUnique({
      where: { id: parseInt(req.params.id as string) },
      include: {
        images: { orderBy: { order: 'asc' } },
        exhibitions: {
          where: { status: 'APPROVED' },
          orderBy: { deadline: 'asc' },
          include: { promoPhotos: { orderBy: { createdAt: 'desc' } } }
        },
        reviews: {
          include: { user: { select: { id: true, name: true, avatar: true } } },
          orderBy: { createdAt: 'desc' }
        },
        owner: { select: { id: true, name: true } }
      }
    });
    if (!gallery) throw new AppError('갤러리를 찾을 수 없습니다.', 404);

    // 찜 여부 확인
    let isFavorited = false;
    if (req.user) {
      const fav = await prisma.favorite.findUnique({
        where: { userId_galleryId: { userId: req.user.id, galleryId: gallery.id } }
      });
      isFavorited = !!fav;
    }

    res.json({ ...gallery, isFavorited });
  } catch (error) { next(error); }
});

// 갤러리 등록 요청 (Gallery 유저 전용)
router.post('/', authenticate, authorize('GALLERY'), async (req, res, next) => {
  try {
    const { name, address, phone, description, region, ownerName, mainImage, instagramUrl, email } = req.body;
    const gallery = await prisma.gallery.create({
      data: {
        name, address, phone, description, region, ownerName, mainImage,
        instagramUrl, email,
        ownerId: req.user!.id,
        status: 'PENDING'
      }
    });
    res.status(201).json(gallery);
  } catch (error) { next(error); }
});

// 갤러리 이미지 추가
router.post('/:id/images', authenticate, async (req, res, next) => {
  try {
    const gallery = await prisma.gallery.findUnique({ where: { id: parseInt(req.params.id as string) } });
    if (!gallery || gallery.ownerId !== req.user!.id) throw new AppError('권한이 없습니다.', 403);

    const { url, order } = req.body;
    const image = await prisma.galleryImage.create({
      data: { url, order: order || 0, galleryId: gallery.id }
    });
    res.status(201).json(image);
  } catch (error) { next(error); }
});

// 갤러리 상세소개 수정 (갤러리 오너 전용)
router.patch('/:id/detail', authenticate, async (req, res, next) => {
  try {
    const gallery = await prisma.gallery.findUnique({ where: { id: parseInt(req.params.id as string) } });
    if (!gallery) throw new AppError('갤러리를 찾을 수 없습니다.', 404);
    if (gallery.ownerId !== req.user!.id) throw new AppError('권한이 없습니다.', 403);

    const updated = await prisma.gallery.update({
      where: { id: gallery.id },
      data: { detailDesc: req.body.detailDesc }
    });
    res.json(updated);
  } catch (error) { next(error); }
});

// 갤러리 삭제 (Admin 전용, cascade로 관련 데이터 자동 삭제)
router.delete('/:id', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const gallery = await prisma.gallery.findUnique({ where: { id: parseInt(req.params.id as string) } });
    if (!gallery) throw new AppError('갤러리를 찾을 수 없습니다.', 404);

    await prisma.gallery.delete({ where: { id: gallery.id } });
    res.json({ message: '갤러리가 삭제되었습니다.' });
  } catch (error) { next(error); }
});

export default router;
