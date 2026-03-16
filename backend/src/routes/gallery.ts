import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, optionalAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import logger from '../lib/logger';

// Instagram Graph API 호출 시 타임아웃 (5초)
const INSTAGRAM_TIMEOUT_MS = 5000;

const galleryCreateSchema = z.object({
  name: z.string().min(1, '갤러리 이름을 입력해주세요.'),
  address: z.string().min(1, '주소를 입력해주세요.'),
  phone: z.string().min(1, '전화번호를 입력해주세요.'),
  description: z.string().min(1, '소개를 입력해주세요.'),
  region: z.string().min(1, '지역을 선택해주세요.'),
  ownerName: z.string().min(1, '대표자명을 입력해주세요.'),
  mainImage: z.string().optional(),
  email: z.string().email('유효한 이메일 형식이 아닙니다.').optional().or(z.literal('')),
});

/** 토큰을 제거하고 instagramConnected boolean으로 변환, 프로필 비공개 시 instagramUrl 숨김 */
function maskInstagram(g: any) {
  const { instagramAccessToken, ...rest } = g;
  return {
    ...rest,
    instagramConnected: !!instagramAccessToken,
    instagramUrl: g.instagramProfileVisible ? g.instagramUrl : null,
  };
}

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
      const result = galleries.map((g: any) => maskInstagram({ ...g, isFavorited: favSet.has(g.id) }));
      return res.json(result);
    }

    res.json(galleries.map((g: any) => maskInstagram({ ...g, isFavorited: false })));
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

    // mainImage만 있고 GalleryImage가 없으면 자동 마이그레이션
    if (gallery.mainImage && gallery.images.length === 0) {
      const created = await prisma.galleryImage.create({
        data: { url: gallery.mainImage, order: 0, galleryId: gallery.id },
      });
      gallery.images = [created];
    }

    // 찜 여부 확인
    let isFavorited = false;
    if (req.user) {
      const fav = await prisma.favorite.findUnique({
        where: { userId_galleryId: { userId: req.user.id, galleryId: gallery.id } }
      });
      isFavorited = !!fav;
    }

    res.json(maskInstagram({ ...gallery, isFavorited }));
  } catch (error) { next(error); }
});

// 갤러리 등록 요청 (Gallery 유저 전용)
router.post('/', authenticate, authorize('GALLERY'), validate(galleryCreateSchema), async (req, res, next) => {
  try {
    const { name, address, phone, description, region, ownerName, mainImage, email } = req.body;
    const gallery = await prisma.gallery.create({
      data: {
        name, address, phone, description, region, ownerName, mainImage,
        email,
        ownerId: req.user!.id,
        status: 'PENDING'
      }
    });
    res.status(201).json(maskInstagram(gallery));
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

// 갤러리 이미지 삭제 (갤러리 오너 전용)
router.delete('/:id/images/:imageId', authenticate, async (req, res, next) => {
  try {
    const galleryId = parseInt(req.params.id as string);
    const imageId = parseInt(req.params.imageId as string);

    const gallery = await prisma.gallery.findUnique({ where: { id: galleryId } });
    if (!gallery) throw new AppError('갤러리를 찾을 수 없습니다.', 404);
    if (gallery.ownerId !== req.user!.id) throw new AppError('권한이 없습니다.', 403);

    const image = await prisma.galleryImage.findUnique({ where: { id: imageId } });
    if (!image || image.galleryId !== galleryId) throw new AppError('이미지를 찾을 수 없습니다.', 404);

    await prisma.galleryImage.delete({ where: { id: imageId } });
    res.status(204).send();
  } catch (error) { next(error); }
});

// 갤러리 상세소개 수정 (갤러리 오너 전용)
router.patch('/:id/detail', authenticate, async (req, res, next) => {
  try {
    const gallery = await prisma.gallery.findUnique({ where: { id: parseInt(req.params.id as string) } });
    if (!gallery) throw new AppError('갤러리를 찾을 수 없습니다.', 404);
    if (gallery.ownerId !== req.user!.id) throw new AppError('권한이 없습니다.', 403);

    const data: any = {};
    if (req.body.detailDesc !== undefined) data.detailDesc = req.body.detailDesc;
    if (req.body.description !== undefined) data.description = req.body.description;

    const updated = await prisma.gallery.update({
      where: { id: gallery.id },
      data,
    });
    res.json(updated);
  } catch (error) { next(error); }
});

// 갤러리 삭제 (Admin 또는 Gallery 오너, cascade로 관련 데이터 자동 삭제)
router.delete('/:id', authenticate, authorize('ADMIN', 'GALLERY'), async (req, res, next) => {
  try {
    const gallery = await prisma.gallery.findUnique({ where: { id: parseInt(req.params.id as string) } });
    if (!gallery) throw new AppError('갤러리를 찾을 수 없습니다.', 404);
    if (req.user!.role === 'GALLERY' && gallery.ownerId !== req.user!.id) {
      throw new AppError('본인 소유 갤러리만 삭제할 수 있습니다.', 403);
    }

    await prisma.gallery.delete({ where: { id: gallery.id } });
    res.json({ message: '갤러리가 삭제되었습니다.' });
  } catch (error) { next(error); }
});

// ========== Instagram 연동 API ==========

// Instagram 토큰 저장 (갤러리 오너 전용)
router.post('/:id/instagram-token', authenticate, async (req, res, next) => {
  try {
    const gallery = await prisma.gallery.findUnique({ where: { id: parseInt(req.params.id as string) } });
    if (!gallery) throw new AppError('갤러리를 찾을 수 없습니다.', 404);
    if (gallery.ownerId !== req.user!.id) throw new AppError('권한이 없습니다.', 403);

    const { accessToken } = req.body;
    if (!accessToken) throw new AppError('액세스 토큰을 입력해주세요.', 400);

    // Graph API로 토큰 유효성 검증 (타임아웃 적용)
    const igRes = await fetch(`https://graph.instagram.com/me?fields=id,username&access_token=${accessToken}`, {
      signal: AbortSignal.timeout(INSTAGRAM_TIMEOUT_MS),
    });
    if (!igRes.ok) throw new AppError('유효하지 않은 Instagram 토큰입니다.', 400);

    const igData = await igRes.json() as { id: string; username: string };
    await prisma.gallery.update({
      where: { id: gallery.id },
      data: { instagramAccessToken: accessToken, instagramUrl: `@${igData.username}`, instagramProfileVisible: true },
    });

    res.json({ instagramConnected: true, username: igData.username });
  } catch (error) { next(error); }
});

// Instagram 프로필 링크 토글 (갤러리 오너 전용)
router.patch('/:id/instagram-profile-visibility', authenticate, async (req, res, next) => {
  try {
    const gallery = await prisma.gallery.findUnique({ where: { id: parseInt(req.params.id as string) } });
    if (!gallery) throw new AppError('갤러리를 찾을 수 없습니다.', 404);
    if (gallery.ownerId !== req.user!.id) throw new AppError('권한이 없습니다.', 403);

    const { visible } = req.body;
    if (visible && !gallery.instagramAccessToken) {
      throw new AppError('Instagram이 연동되지 않았습니다. 먼저 토큰을 등록해주세요.', 400);
    }

    // DB boolean 업데이트만 수행 — username은 instagramUrl에 이미 보존
    await prisma.gallery.update({
      where: { id: gallery.id },
      data: { instagramProfileVisible: !!visible },
    });

    res.json({ success: true });
  } catch (error) { next(error); }
});

// Instagram 피드 공개 토글 (갤러리 오너 전용)
router.patch('/:id/instagram-visibility', authenticate, async (req, res, next) => {
  try {
    const gallery = await prisma.gallery.findUnique({ where: { id: parseInt(req.params.id as string) } });
    if (!gallery) throw new AppError('갤러리를 찾을 수 없습니다.', 404);
    if (gallery.ownerId !== req.user!.id) throw new AppError('권한이 없습니다.', 403);

    const { visible } = req.body;
    if (visible && !gallery.instagramAccessToken) {
      throw new AppError('Instagram이 연동되지 않았습니다. 먼저 토큰을 등록해주세요.', 400);
    }

    await prisma.gallery.update({
      where: { id: gallery.id },
      data: { instagramFeedVisible: !!visible },
    });

    res.json({ success: true, instagramFeedVisible: !!visible });
  } catch (error) { next(error); }
});

// Instagram 피드 조회 (공개 API)
router.get('/:id/instagram-feed', async (req, res, next) => {
  try {
    const gallery = await prisma.gallery.findUnique({
      where: { id: parseInt(req.params.id as string) },
      select: { instagramAccessToken: true, instagramFeedVisible: true },
    });

    // 토큰 없거나 피드 비공개 → 빈 배열
    if (!gallery?.instagramAccessToken || !gallery.instagramFeedVisible) {
      return res.json([]);
    }

    // Graph API로 최근 9개 게시물 조회 (타임아웃 5초, 오류 시 빈 배열 반환)
    const igRes = await fetch(
      `https://graph.instagram.com/me/media?fields=id,media_type,media_url,thumbnail_url,permalink,timestamp&limit=9&access_token=${gallery.instagramAccessToken}`,
      { signal: AbortSignal.timeout(INSTAGRAM_TIMEOUT_MS) }
    );

    if (!igRes.ok) return res.json([]);

    const igData = await igRes.json() as { data?: any[] };
    const posts = (igData.data || []).map((p: any) => ({
      id: p.id,
      mediaType: p.media_type,
      mediaUrl: p.media_url,
      thumbnailUrl: p.thumbnail_url || null,
      permalink: p.permalink,
      timestamp: p.timestamp,
    }));

    res.json(posts);
  } catch (error: any) {
    // best-effort: 오류 시 빈 배열 반환 (서비스 중단 방지)
    logger.warn('Instagram', `피드 조회 실패: ${error.message}`, { galleryId: req.params.id });
    res.json([]);
  }
});

export default router;
