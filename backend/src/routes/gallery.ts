import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, optionalAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { maskGallery, maskAnonymousReviews } from '../lib/sanitize';
import { notifyApprovalRequest } from '../lib/telegram';
import { bumpViewCount } from '../lib/viewCount';
import { deleteUploadedFile, deleteUploadedFiles } from '../lib/storage';

const galleryCreateSchema = z.object({
  name: z.string().min(1, '갤러리 이름을 입력해주세요.'),
  address: z.string().min(1, '주소를 입력해주세요.'),
  phone: z.string().min(1, '전화번호를 입력해주세요.'),
  description: z.string().min(1, '소개를 입력해주세요.'),
  region: z.string().min(1, '지역을 선택해주세요.'),
  ownerName: z.string().min(1, '대표자명을 입력해주세요.'),
  mainImage: z.string().optional(),
  email: z.string().email('유효한 이메일 형식이 아닙니다.').optional().or(z.literal('')),
  instagramUrl: z.string().optional(),
});

/** 토큰을 제거하고 instagramConnected boolean으로 변환 — 공유 sanitize.maskGallery 사용 */
const maskInstagram = maskGallery;

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

    // 키워드 검색 (이름/주소/소개)
    const q = ((req.query.q as string) || '').trim();
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { address: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    const orderBy: any = sortBy === 'rating' ? { rating: 'desc' } : sortBy === 'reviewCount' ? { reviewCount: 'desc' } : { createdAt: 'desc' };

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
          include: {
            user: { select: { id: true, name: true, nickname: true, avatar: true } },
            exhibition: { select: { id: true, title: true } },
          },
          orderBy: { createdAt: 'desc' }
        },
        owner: { select: { id: true, name: true } }
      }
    });
    if (!gallery) throw new AppError('갤러리를 찾을 수 없습니다.', 404);
    // 탈퇴 회원의 갤러리는 공개에서 숨김(관리자 제외)
    if (gallery.status === 'WITHDRAWN' && req.user?.role !== 'ADMIN') {
      throw new AppError('갤러리를 찾을 수 없습니다.', 404);
    }

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

    // 상세 조회수 증가 (Admin 통계용, 비-관리자/비-소유자만)
    await bumpViewCount('gallery', gallery.id, gallery.ownerId, req.user);

    // 익명 리뷰의 작성자 신원은 본인/관리자 외에는 숨김 (PII 보호)
    const reviews = maskAnonymousReviews(gallery.reviews as any[], req.user);
    res.json(maskInstagram({ ...gallery, reviews, isFavorited }));
  } catch (error) { next(error); }
});

// 갤러리 등록 요청 (Gallery 유저 전용)
router.post('/', authenticate, authorize('GALLERY'), validate(galleryCreateSchema), async (req, res, next) => {
  try {
    const { name, address, phone, description, region, ownerName, mainImage, email, instagramUrl } = req.body;
    const gallery = await prisma.gallery.create({
      data: {
        name, address, phone, description, region, ownerName, mainImage,
        email,
        instagramUrl: instagramUrl?.trim() || null,
        ownerId: req.user!.id,
        status: 'PENDING'
      }
    });
    void notifyApprovalRequest({
      kind: 'gallery',
      title: gallery.name,
      targetId: gallery.id,
      requesterName: req.user!.name,
      requesterEmail: req.user!.email,
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

    // 대표 이미지(mainImage) 동기화: 첫 이미지를 대표로 유지.
    // mainImage만 읽는 화면(목록/이달의 갤러리/공모 카드/찜 목록)도 사진 변경을 즉시 반영하도록 한다.
    const first = await prisma.galleryImage.findFirst({
      where: { galleryId: gallery.id },
      orderBy: { order: 'asc' },
    });
    if (first && gallery.mainImage !== first.url) {
      await prisma.gallery.update({ where: { id: gallery.id }, data: { mainImage: first.url } });
    }

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
    void deleteUploadedFile(image.url); // orphan 방지: 실제 파일도 제거(best-effort)

    // mainImage 동기화: 항상 남은 첫 이미지로 맞춘다(없으면 null).
    // - 삭제한 이미지가 대표였으면 다음 이미지로 교체 → 목록 등 mainImage만 읽는 화면도 갱신.
    // - 이렇게 하지 않으면 상세 GET의 mainImage 자동 마이그레이션이 삭제된 이미지를 되살려 "삭제 안 됨" 버그 발생.
    const next = await prisma.galleryImage.findFirst({
      where: { galleryId },
      orderBy: { order: 'asc' },
    });
    if (gallery.mainImage !== (next?.url ?? null)) {
      await prisma.gallery.update({
        where: { id: galleryId },
        data: { mainImage: next?.url ?? null },
      });
    }

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
    // 전화번호·주소는 갤러리 주인이 승인 없이 즉시 수정 가능
    if (req.body.phone !== undefined) {
      const phone = String(req.body.phone).trim();
      if (!phone) throw new AppError('전화번호를 입력해주세요.', 400);
      data.phone = phone;
    }
    if (req.body.address !== undefined) {
      const address = String(req.body.address).trim();
      if (!address) throw new AppError('주소를 입력해주세요.', 400);
      data.address = address;
    }
    // 지역도 갤러리 주인이 승인 없이 즉시 수정 가능 (허용된 지역 코드만)
    if (req.body.region !== undefined) {
      const region = String(req.body.region).trim();
      const ALLOWED = ['SEOUL', 'INCHEON', 'GYEONGGI_NORTH', 'GYEONGGI_SOUTH', 'DAEJEON', 'DAEGU', 'BUSAN', 'ULSAN'];
      if (!ALLOWED.includes(region)) throw new AppError('유효하지 않은 지역입니다.', 400);
      data.region = region;
    }
    // 인스타그램 주소 — 갤러리 주인이 직접 입력/수정 (빈 값이면 제거)
    if (req.body.instagramUrl !== undefined) {
      data.instagramUrl = String(req.body.instagramUrl).trim() || null;
    }

    const updated = await prisma.gallery.update({
      where: { id: gallery.id },
      data,
    });
    res.json(maskGallery(updated));
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

    // 삭제 전 갤러리 직속 이미지 URL 수집 → cascade 삭제 후 실제 파일도 정리(best-effort)
    const galleryImages = await prisma.galleryImage.findMany({ where: { galleryId: gallery.id }, select: { url: true } });
    await prisma.gallery.delete({ where: { id: gallery.id } });
    void deleteUploadedFiles([...galleryImages.map((i) => i.url), gallery.mainImage]);
    res.json({ message: '갤러리가 삭제되었습니다.' });
  } catch (error) { next(error); }
});

export default router;
