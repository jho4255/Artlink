import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, optionalAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import logger from '../lib/logger';

// Instagram Graph API 호출 시 타임아웃 (5초)
const INSTAGRAM_TIMEOUT_MS = 5000;

// Instagram OAuth (Instagram API with Instagram Login — 비즈니스/크리에이터 계정)
// 자격증명은 호출 시점에 읽는다(테스트/런타임 구성 용이).
// 장기 토큰(60일) 만료 N일 전이면 갱신 시도
const INSTAGRAM_REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

/** 만료 임박 시 장기 토큰 갱신 (best-effort). 실패해도 기존 토큰으로 계속 사용. */
async function refreshInstagramTokenIfNeeded(gallery: {
  id: number;
  instagramAccessToken: string | null;
  instagramTokenExpiresAt: Date | null;
}): Promise<string | null> {
  const token = gallery.instagramAccessToken;
  if (!token) return null;
  const expiresAt = gallery.instagramTokenExpiresAt;
  // 만료 시각을 모르거나(레거시) 아직 여유 있으면 갱신하지 않음
  if (!expiresAt || expiresAt.getTime() - Date.now() > INSTAGRAM_REFRESH_THRESHOLD_MS) {
    return token;
  }
  try {
    const res = await fetch(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`,
      { signal: AbortSignal.timeout(INSTAGRAM_TIMEOUT_MS) }
    );
    if (!res.ok) return token;
    const data = await res.json() as { access_token?: string; expires_in?: number };
    if (!data.access_token) return token;
    const newExpiry = new Date(Date.now() + (data.expires_in ?? 0) * 1000);
    await prisma.gallery.update({
      where: { id: gallery.id },
      data: { instagramAccessToken: data.access_token, instagramTokenExpiresAt: newExpiry },
    });
    return data.access_token;
  } catch {
    return token; // 갱신 실패 시 기존 토큰 유지
  }
}

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

// Instagram OAuth 연동 (갤러리 오너 전용)
// 프론트에서 Instagram authorize 후 받은 code를 넘기면 토큰 교환 후 저장한다.
const instagramConnectSchema = z.object({
  code: z.string().min(1),
  redirectUri: z.string().url(),
});

router.post('/:id/instagram/connect', authenticate, validate(instagramConnectSchema), async (req, res, next) => {
  try {
    const gallery = await prisma.gallery.findUnique({ where: { id: parseInt(req.params.id as string) } });
    if (!gallery) throw new AppError('갤러리를 찾을 수 없습니다.', 404);
    if (gallery.ownerId !== req.user!.id) throw new AppError('권한이 없습니다.', 403);

    const appId = process.env.INSTAGRAM_APP_ID || '';
    const appSecret = process.env.INSTAGRAM_APP_SECRET || '';
    if (!appId || !appSecret) {
      throw new AppError('Instagram 연동이 서버에 설정되지 않았습니다.', 500);
    }

    const { code, redirectUri } = req.body;

    // 1) code → 단기 토큰 (api.instagram.com/oauth/access_token)
    const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }),
      signal: AbortSignal.timeout(INSTAGRAM_TIMEOUT_MS),
    });
    const shortData = await shortRes.json() as { access_token?: string; user_id?: string; error_message?: string };
    if (!shortRes.ok || !shortData.access_token) {
      logger.warn('Instagram', `code 교환 실패: ${shortData.error_message || shortRes.status}`, { galleryId: gallery.id });
      throw new AppError('Instagram 인증에 실패했습니다. 비즈니스/크리에이터 계정인지 확인해주세요.', 400);
    }

    // 2) 단기 → 장기 토큰 (60일)
    const longRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${appSecret}&access_token=${shortData.access_token}`,
      { signal: AbortSignal.timeout(INSTAGRAM_TIMEOUT_MS) }
    );
    const longData = await longRes.json() as { access_token?: string; expires_in?: number };
    if (!longRes.ok || !longData.access_token) {
      throw new AppError('Instagram 토큰 발급에 실패했습니다.', 400);
    }
    const longToken = longData.access_token;
    const expiresAt = new Date(Date.now() + (longData.expires_in ?? 0) * 1000);

    // 3) username 조회
    const meRes = await fetch(
      `https://graph.instagram.com/me?fields=id,username&access_token=${longToken}`,
      { signal: AbortSignal.timeout(INSTAGRAM_TIMEOUT_MS) }
    );
    if (!meRes.ok) throw new AppError('Instagram 프로필 조회에 실패했습니다.', 400);
    const me = await meRes.json() as { id: string; username: string };

    await prisma.gallery.update({
      where: { id: gallery.id },
      data: {
        instagramAccessToken: longToken,
        instagramTokenExpiresAt: expiresAt,
        instagramUrl: `@${me.username}`,
        instagramProfileVisible: true,
      },
    });

    res.json({ instagramConnected: true, username: me.username });
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
      select: { id: true, instagramAccessToken: true, instagramTokenExpiresAt: true, instagramFeedVisible: true },
    });

    // 토큰 없거나 피드 비공개 → 빈 배열
    if (!gallery?.instagramAccessToken || !gallery.instagramFeedVisible) {
      return res.json([]);
    }

    // 만료 임박 시 장기 토큰 갱신 (best-effort)
    const token = await refreshInstagramTokenIfNeeded(gallery);

    // Graph API로 최근 9개 게시물 조회 (타임아웃 5초, 오류 시 빈 배열 반환)
    const igRes = await fetch(
      `https://graph.instagram.com/me/media?fields=id,media_type,media_url,thumbnail_url,permalink,timestamp&limit=9&access_token=${token}`,
      { signal: AbortSignal.timeout(INSTAGRAM_TIMEOUT_MS) }
    );

    // IG API 오류 → 빈 배열(정상 empty)과 구분되도록 502로 신호
    if (!igRes.ok) return res.status(502).json({ error: 'instagram_unavailable' });

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
    // 토큰은 있으나 IG 호출 실패(네트워크/타임아웃) → 502로 신호 (빈 피드와 구분)
    logger.warn('Instagram', `피드 조회 실패: ${error.message}`, { galleryId: req.params.id });
    res.status(502).json({ error: 'instagram_unavailable' });
  }
});

export default router;
