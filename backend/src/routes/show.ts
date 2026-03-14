import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, optionalAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';

// 작가 엔트리: {name, userId?} 형태 or 하위호환 문자열
const artistEntrySchema = z.object({
  name: z.string().min(1),
  userId: z.number().int().positive().optional().nullable(),
});

const showCreateSchema = z.object({
  title: z.string().min(1, '전시 제목을 입력해주세요.'),
  description: z.string().min(1, '전시 소개를 입력해주세요.'),
  startDate: z.string().min(1, '시작일을 입력해주세요.'),
  endDate: z.string().min(1, '종료일을 입력해주세요.'),
  openingHours: z.string().min(1, '관람 시간을 입력해주세요.'),
  admissionFee: z.string().min(1, '입장료를 입력해주세요.'),
  location: z.string().min(1, '위치를 입력해주세요.'),
  region: z.string().min(1, '지역을 선택해주세요.'),
  artists: z.array(z.union([z.string(), artistEntrySchema])).optional().nullable(),
  posterImage: z.string().min(1, '포스터 이미지를 등록해주세요.'),
  galleryId: z.number().int().positive('갤러리를 선택해주세요.'),
  additionalImages: z.array(z.string()).max(10).optional().nullable(),
});

/**
 * 하위호환: 기존 ["name"] 형식을 [{name: "name"}]으로 변환
 * DB에 JSON string으로 저장된 artists 필드를 파싱
 */
function normalizeArtists(artistsJson: string | null): { name: string; userId: number | null }[] | null {
  if (!artistsJson) return null;
  try {
    const parsed = JSON.parse(artistsJson);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((a: any) => {
      if (typeof a === 'string') return { name: a, userId: null };
      return { name: a.name, userId: a.userId || null };
    });
  } catch { return null; }
}

/**
 * 입력 배열(string | object 혼합)을 일관된 ArtistEntry[]로 정규화
 */
function normalizeArtistsInput(artists: any[] | null | undefined): { name: string; userId: number | null }[] | null {
  if (!artists || artists.length === 0) return null;
  return artists.map((a: any) => {
    if (typeof a === 'string') return { name: a, userId: null };
    return { name: a.name, userId: a.userId || null };
  });
}

const router = Router();

// APPROVED 전시 목록 (region/status 필터)
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { region } = req.query;
    const now = new Date();

    const where: any = { status: 'APPROVED' };
    if (region) where.region = region;

    // status 필터: ongoing(진행중), upcoming(예정), ended(종료)
    if (req.query.showStatus === 'ongoing') {
      where.startDate = { lte: now };
      where.endDate = { gte: now };
    } else if (req.query.showStatus === 'upcoming') {
      where.startDate = { gt: now };
    } else if (req.query.showStatus === 'ended') {
      where.endDate = { lt: now };
    }

    const shows = await prisma.show.findMany({
      where,
      include: {
        gallery: { select: { id: true, name: true, mainImage: true, region: true } },
        images: { orderBy: { order: 'asc' }, take: 3 },
      },
      orderBy: { startDate: 'asc' },
    });

    // 찜 여부
    if (req.user) {
      const favorites = await prisma.favorite.findMany({
        where: { userId: req.user.id, showId: { in: shows.map(s => s.id) } },
        select: { showId: true },
      });
      const favSet = new Set(favorites.map(f => f.showId));
      return res.json(shows.map(s => ({
        ...s,
        artists: normalizeArtists(s.artists),
        isFavorited: favSet.has(s.id),
      })));
    }

    res.json(shows.map(s => ({
      ...s,
      artists: normalizeArtists(s.artists),
      isFavorited: false,
    })));
  } catch (error) { next(error); }
});

// 내 전시 목록 (Gallery 유저 전용)
router.get('/my-shows', authenticate, authorize('GALLERY'), async (req, res, next) => {
  try {
    const galleries = await prisma.gallery.findMany({
      where: { ownerId: req.user!.id },
      select: { id: true },
    });
    const galleryIds = galleries.map(g => g.id);
    const shows = await prisma.show.findMany({
      where: { galleryId: { in: galleryIds } },
      include: { gallery: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(shows.map(s => ({
      ...s,
      artists: normalizeArtists(s.artists),
    })));
  } catch (error) { next(error); }
});

// 전시 상세 조회
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const show = await prisma.show.findUnique({
      where: { id: parseInt(req.params.id as string) },
      include: {
        gallery: { include: { owner: { select: { id: true } } } },
        images: { orderBy: { order: 'asc' } },
      },
    });
    if (!show) throw new AppError('전시를 찾을 수 없습니다.', 404);

    let isFavorited = false;
    if (req.user) {
      const fav = await prisma.favorite.findUnique({
        where: { userId_showId: { userId: req.user.id, showId: show.id } },
      });
      isFavorited = !!fav;
    }

    const { owner, ...galleryRest } = show.gallery as any;
    res.json({
      ...show,
      artists: normalizeArtists(show.artists),
      gallery: { ...galleryRest, ownerId: owner?.id },
      isFavorited,
    });
  } catch (error) { next(error); }
});

// 전시 등록 요청 (Gallery 유저 전용)
router.post('/', authenticate, authorize('GALLERY'), validate(showCreateSchema), async (req, res, next) => {
  try {
    const { title, description, startDate, endDate, openingHours, admissionFee, location, region, artists, posterImage, galleryId, additionalImages } = req.body;

    // 갤러리 소유권 확인
    const gallery = await prisma.gallery.findUnique({ where: { id: galleryId } });
    if (!gallery || gallery.ownerId !== req.user!.id) {
      throw new AppError('본인 소유의 갤러리만 선택할 수 있습니다.', 403);
    }

    // 날짜 검증
    if (new Date(startDate) > new Date(endDate)) {
      throw new AppError('시작일은 종료일 이전이어야 합니다.', 400);
    }

    const normalizedArtists = normalizeArtistsInput(artists);

    // Show + 추가 이미지를 트랜잭션으로 묶어서 생성
    const show = await prisma.$transaction(async (tx) => {
      const created = await tx.show.create({
        data: {
          title, description,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          openingHours, admissionFee, location, region,
          artists: normalizedArtists ? JSON.stringify(normalizedArtists) : null,
          posterImage, galleryId,
          status: 'PENDING',
        },
      });

      // 추가 이미지 일괄 생성
      if (additionalImages && additionalImages.length > 0) {
        await tx.showImage.createMany({
          data: additionalImages.map((url: string, i: number) => ({
            url, order: i, showId: created.id,
          })),
        });
      }

      return created;
    });

    res.status(201).json(show);
  } catch (error) { next(error); }
});

// 전시 소개/이미지 수정 (소유자 전용)
router.patch('/:id', authenticate, async (req, res, next) => {
  try {
    const show = await prisma.show.findUnique({
      where: { id: parseInt(req.params.id as string) },
      include: { gallery: { select: { ownerId: true } } },
    });
    if (!show) throw new AppError('전시를 찾을 수 없습니다.', 404);
    if (show.gallery.ownerId !== req.user!.id) throw new AppError('권한이 없습니다.', 403);

    const { description, artists } = req.body;
    const data: any = {};
    if (description !== undefined) data.description = description;
    if (artists !== undefined) {
      const normalized = normalizeArtistsInput(artists);
      data.artists = normalized ? JSON.stringify(normalized) : null;
    }

    const updated = await prisma.show.update({ where: { id: show.id }, data });
    res.json({ ...updated, artists: normalizeArtists(updated.artists) });
  } catch (error) { next(error); }
});

// 전시 삭제 (소유자 or Admin)
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const show = await prisma.show.findUnique({
      where: { id: parseInt(req.params.id as string) },
      include: { gallery: { select: { ownerId: true } } },
    });
    if (!show) throw new AppError('전시를 찾을 수 없습니다.', 404);

    const isOwner = show.gallery.ownerId === req.user!.id;
    const isAdmin = req.user!.role === 'ADMIN';
    if (!isOwner && !isAdmin) throw new AppError('권한이 없습니다.', 403);

    await prisma.show.delete({ where: { id: show.id } });
    res.json({ message: '전시가 삭제되었습니다.' });
  } catch (error) { next(error); }
});

// 추가 이미지 등록
router.post('/:id/images', authenticate, authorize('GALLERY'), async (req, res, next) => {
  try {
    const show = await prisma.show.findUnique({
      where: { id: parseInt(req.params.id as string) },
      include: { gallery: true },
    });
    if (!show) throw new AppError('전시를 찾을 수 없습니다.', 404);
    if (show.gallery.ownerId !== req.user!.id) throw new AppError('권한이 없습니다.', 403);

    const { url, order } = req.body;
    const image = await prisma.showImage.create({
      data: { url, order: order || 0, showId: show.id },
    });
    res.status(201).json(image);
  } catch (error) { next(error); }
});

// 이미지 삭제
router.delete('/:id/images/:imageId', authenticate, authorize('GALLERY'), async (req, res, next) => {
  try {
    const show = await prisma.show.findUnique({
      where: { id: parseInt(req.params.id as string) },
      include: { gallery: true },
    });
    if (!show) throw new AppError('전시를 찾을 수 없습니다.', 404);
    if (show.gallery.ownerId !== req.user!.id) throw new AppError('권한이 없습니다.', 403);

    await prisma.showImage.delete({ where: { id: parseInt(req.params.imageId as string) } });
    res.json({ message: '이미지가 삭제되었습니다.' });
  } catch (error) { next(error); }
});

export default router;
