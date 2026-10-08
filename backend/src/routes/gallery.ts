import { Router } from 'express';
import { isRegion } from '../lib/regions';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, optionalAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { maskGallery, maskAnonymousReviews, maskExhibition } from '../lib/sanitize';
import { deleteGalleryWithNotice, galleryBlockReason } from '../lib/deletion';
import { safeFileUrl } from '../lib/safeUrl';
import { notifyApprovalRequest } from '../lib/telegram';
import { bumpViewCount } from '../lib/viewCount';
import { deleteUploadedFile, deleteUploadedFiles } from '../lib/storage';
import { handleTaken, isHandleParam, normalizeHandle, validateHandle } from '../lib/handle';
import { matchR2Base } from '../lib/r2Urls';
import { richTextPlain, sanitizeRichText } from '../lib/richText';

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
    // ⚠️ 별점 필터(minRating)는 2026-09-10 에 없앴다 — 별점을 화면에 안 보여주면서
    //    그걸로 거르게 하면 **기준을 알 수 없는 필터**가 된다. 쿼리로 와도 무시한다.

    // 키워드 검색 (이름/주소/소개)
    const q = ((req.query.q as string) || '').trim();
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { address: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    // 별점순은 없앴다(위 참고). 리뷰 **개수**순은 별점과 무관하므로 남긴다.
    const orderBy: any = sortBy === 'reviewCount' ? { reviewCount: 'desc' } : { createdAt: 'desc' };

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
    // 숫자 id 또는 `@handle` (2026-09-16). 핸들이 규칙에 안 맞으면 조회조차 하지 않는다.
    const param = String(req.params.id ?? '');
    let where: { id: number } | { handle: string };
    if (isHandleParam(param)) {
      const h = normalizeHandle(param);
      if (validateHandle(h)) throw new AppError('갤러리를 찾을 수 없습니다.', 404);
      where = { handle: h };
    } else {
      const numeric = parseInt(param);
      if (isNaN(numeric)) throw new AppError('갤러리를 찾을 수 없습니다.', 404);
      where = { id: numeric };
    }
    const gallery = await prisma.gallery.findUnique({
      where,
      include: {
        images: { orderBy: { order: 'asc' } },
        // 갤러리가 직접 적은 지난 활동 기록 — 아트링크 공모와 한 줄로 섞여 나간다(화면이 합친다)
        archives: { orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] },
        exhibitions: {
          where: { status: 'APPROVED' },
          orderBy: { deadline: 'asc' },
          // 홍보 사진은 올린 순서대로(2026-09-27) — 여러 장을 한 번에 올리면 고른 순서가 곧 앨범 순서다. desc 면 한 묶음이 거꾸로 선다
          include: { promoPhotos: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } }
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
    // 승인된 것만 공개한다. 심사중(PENDING)·반려(REJECTED)·탈퇴(WITHDRAWN)는 **당사자와 Admin 만**.
    //
    // 예전엔 WITHDRAWN 만 막아서, 목록에는 안 뜨는데 **주소로 id 를 치면 비로그인에게도 전부 보였다**.
    // 순번 id 라 1번부터 훑으면 심사 중인 신청서와 반려 사유까지 긁을 수 있었다.
    // 없는 것처럼 404 로 돌려준다 — 403 이면 "그 번호에 뭔가 있다"는 것까지 알려주는 셈이다.
    // 화이트리스트(APPROVED 만 통과)로 둔 이유: 나중에 상태가 늘어도 기본이 '숨김'이 되게.
    if (gallery.status !== 'APPROVED') {
      const viewer = req.user;
      // 탈퇴(WITHDRAWN)는 종전대로 Admin 만 — 소유자에게도 다시 열지 않는다
      const allowed = viewer?.role === 'ADMIN'
        || (gallery.ownerId === viewer?.id && gallery.status !== 'WITHDRAWN');
      if (!allowed) throw new AppError('갤러리를 찾을 수 없습니다.', 404);
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

    // 아트링크(Admin) 주최 공모 중 이 갤러리가 운영을 위임받은 것도 함께 보여준다.
    // 실제로 이 갤러리가 운영하는 공고이므로 갤러리 페이지에 없으면 관람객이 찾지 못한다.
    // 주관 갤러리인 경우는 위 relation(exhibitions)에 이미 들어 있어 제외한다 — 안 그러면 두 번 나온다.
    const managedExhibitions = await prisma.exhibition.findMany({
      where: {
        status: 'APPROVED',
        hostType: 'ADMIN',
        galleryId: { not: gallery.id },
        managers: { some: { galleryId: gallery.id } },
      },
      orderBy: { deadline: 'asc' },
      include: { promoPhotos: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    const exhibitions = [...gallery.exhibitions, ...managedExhibitions]
      .sort((a, b) => a.deadline.getTime() - b.deadline.getTime()); // relation 과 같은 정렬 유지

    // 함께한 작가 (2026-09-16, 사용자 결정: 공개) — 이 갤러리가 운영한 공모에 **수락된** 작가를 자동으로 모은다.
    // 갤러리에겐 실적, 작가에겐 노출이다. 갤러리가 특정 작가를 빼고 싶으면 `hiddenArtistIds` 로 숨긴다(주인·Admin 에겐
    // 숨긴 것도 `hidden: true` 로 내려가 되돌릴 수 있다). 탈퇴한 작가·작가 아닌 계정은 뺀다.
    const canManage = req.user?.role === 'ADMIN' || req.user?.id === gallery.ownerId;
    const hidden = new Set(gallery.hiddenArtistIds ?? []);
    const accepted = exhibitions.length === 0 ? [] : await prisma.application.findMany({
      where: { exhibitionId: { in: exhibitions.map((e) => e.id) }, status: 'ACCEPTED', user: { deletedAt: null, role: 'ARTIST' } },
      orderBy: { createdAt: 'desc' },
      select: {
        userId: true,
        user: {
          select: {
            id: true, name: true, nickname: true, handle: true, avatar: true,
            portfolio: { select: { images: { orderBy: { order: 'asc' }, take: 1, select: { url: true, width: true, height: true } } } },
          },
        },
      },
    });
    const seen = new Set<number>();
    const artists = accepted
      .filter((a) => (seen.has(a.userId) ? false : (seen.add(a.userId), true)))
      .filter((a) => canManage || !hidden.has(a.userId))
      .map((a) => ({
        id: a.user.id, name: a.user.name, nickname: a.user.nickname, handle: a.user.handle, avatar: a.user.avatar,
        cover: a.user.portfolio?.images[0] ?? null,
        hidden: hidden.has(a.userId),
      }));

    // 익명 리뷰의 작성자 신원은 본인/관리자 외에는 숨김 (PII 보호)
    const reviews = maskAnonymousReviews(gallery.reviews as any[], req.user);
    // hiddenArtistIds 자체는 내부 설정이라 응답에서 뺀다(주인은 artists[].hidden 으로 본다)
    const { hiddenArtistIds: _hiddenIds, ...publicGallery } = gallery;
    void _hiddenIds;
    // 공모는 정산·심사 내부 값을 빼고 싣는다(공개 응답 — 2026-10-03 점검 S4)
    res.json(maskInstagram({ ...publicGallery, exhibitions: exhibitions.map((e) => maskExhibition(e)), reviews, isFavorited, artists }));
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

    const url = safeFileUrl(req.body.url);
    if (!url) throw new AppError('유효하지 않은 이미지 URL입니다.', 400);
    const { order } = req.body;
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
/**
 * 갤러리 페이지 주소 `/@handle` (2026-09-16).
 *
 * ⚠️ 작가 주소와 **같은 이름 공간**이라 중복 검사는 `handleTaken()`(양쪽을 함께 본다)으로만 한다.
 * ⚠️ 자동 생성은 없다 — 상호가 한글이면 로마자로 옮길 방법이 없다. 주인이 직접 정한다.
 */
router.get('/:id/handle-check', authenticate, async (req, res, next) => {
  try {
    const gallery = await assertOwnGallery(req.params.id as string, req.user!);
    const handle = normalizeHandle(req.query.handle);
    const reason = validateHandle(handle);
    if (reason) return res.json({ available: false, reason });
    res.json({ available: !(await handleTaken(handle, { galleryId: gallery.id })), handle });
  } catch (error) { next(error); }
});

router.put('/:id/handle', authenticate, async (req, res, next) => {
  try {
    const gallery = await assertOwnGallery(req.params.id as string, req.user!);
    const handle = normalizeHandle(req.body?.handle);
    const reason = validateHandle(handle);
    if (reason) throw new AppError(reason, 400);
    if (await handleTaken(handle, { galleryId: gallery.id })) throw new AppError('이미 사용 중인 주소입니다.', 409);
    const updated = await prisma.gallery.update({ where: { id: gallery.id }, data: { handle }, select: { id: true, handle: true } });
    res.json(updated);
  } catch (error) { next(error); }
});

/**
 * 지난 활동 기록 (2026-09-16) — 갤러리가 **아트링크 밖에서** 해 온 전시·아트페어를 사후에 적는다.
 * 공개 페이지에서 아트링크 공모와 한 줄로 섞여 나가므로 작가가 갤러리를 고를 때 이력으로 읽는다.
 * ⚠️ 사진은 **우리 저장소 주소만** 받는다(커뮤니티·스토리와 같은 규칙) — 외부 URL 주입 방지.
 */
const ARCHIVE_MAX_IMAGES = 12;
/** 서식 있는 글의 한도 — 글자는 보이는 글 기준, HTML 은 태그까지(태그가 글자 수를 몇 배로 부풀린다) */
const ARCHIVE_BODY_MAX_TEXT = 4000;
const DETAIL_DESC_MAX_TEXT = 5000;
const DETAIL_DESC_MAX_HTML = 40000;
const archiveSchema = z.object({
  title: z.string().trim().min(1, '제목을 입력해주세요.').max(120),
  venue: z.string().trim().max(120).nullish(),
  period: z.string().trim().max(60).nullish(),
  date: z.string().trim().nullish(),
  artists: z.string().trim().max(500).nullish(),
  // 서식 있는 글(HTML) — 태그 몫까지 받고, 보이는 글자 수는 아래 refine 이 본다
  body: z.string().trim().max(ARCHIVE_BODY_MAX_TEXT * 10).nullish()
    .refine((v) => !v || richTextPlain(v).length <= ARCHIVE_BODY_MAX_TEXT, `본문은 ${ARCHIVE_BODY_MAX_TEXT.toLocaleString()}자까지 쓸 수 있습니다.`),
  images: z.array(z.string()).max(ARCHIVE_MAX_IMAGES).optional(),
});

/** 우리 저장소(업로드 경로 또는 R2 공개 주소)에서 온 사진만 남긴다 */
function ownImageUrls(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((u) => safeFileUrl(u))
    .filter((u): u is string => !!u && (u.startsWith('/uploads/') || !!matchR2Base(u)))
    .slice(0, ARCHIVE_MAX_IMAGES);
}

/** 그 갤러리를 운영할 수 있는가 — 주인 또는 Admin. 아니면 404/403 */
async function assertOwnGallery(idRaw: string, user: { id: number; role: string }) {
  const id = parseInt(idRaw);
  if (isNaN(id)) throw new AppError('갤러리를 찾을 수 없습니다.', 404);
  const gallery = await prisma.gallery.findUnique({ where: { id }, select: { id: true, ownerId: true } });
  if (!gallery) throw new AppError('갤러리를 찾을 수 없습니다.', 404);
  if (gallery.ownerId !== user.id && user.role !== 'ADMIN') throw new AppError('권한이 없습니다.', 403);
  return gallery;
}

const archiveData = (body: any) => ({
  title: String(body.title).trim(),
  venue: body.venue?.trim() || null,
  period: body.period?.trim() || null,
  date: body.date ? new Date(body.date) : null,
  artists: body.artists?.trim() || null,
  body: sanitizeRichText(body.body),   // 서식 있는 글 — 허용 목록만(lib/richText.ts)
  images: ownImageUrls(body.images),
});

router.post('/:id/archives', authenticate, validate(archiveSchema), async (req, res, next) => {
  try {
    const gallery = await assertOwnGallery(req.params.id as string, req.user!);
    const archive = await prisma.galleryArchive.create({ data: { galleryId: gallery.id, ...archiveData(req.body) } });
    res.status(201).json(archive);
  } catch (error) { next(error); }
});

router.patch('/:id/archives/:archiveId', authenticate, validate(archiveSchema), async (req, res, next) => {
  try {
    const gallery = await assertOwnGallery(req.params.id as string, req.user!);
    const archiveId = parseInt(req.params.archiveId as string);
    const existing = await prisma.galleryArchive.findUnique({ where: { id: archiveId }, select: { galleryId: true } });
    // 남의 갤러리 기록을 자기 갤러리 id 로 고치지 못하게 (IDOR)
    if (!existing || existing.galleryId !== gallery.id) throw new AppError('기록을 찾을 수 없습니다.', 404);
    const archive = await prisma.galleryArchive.update({ where: { id: archiveId }, data: archiveData(req.body) });
    res.json(archive);
  } catch (error) { next(error); }
});

router.delete('/:id/archives/:archiveId', authenticate, async (req, res, next) => {
  try {
    const gallery = await assertOwnGallery(req.params.id as string, req.user!);
    const archiveId = parseInt(req.params.archiveId as string);
    const existing = await prisma.galleryArchive.findUnique({ where: { id: archiveId }, select: { galleryId: true, images: true } });
    if (!existing || existing.galleryId !== gallery.id) throw new AppError('기록을 찾을 수 없습니다.', 404);
    await prisma.galleryArchive.delete({ where: { id: archiveId } });
    void deleteUploadedFiles(existing.images); // orphan 방지
    res.json({ message: '삭제되었습니다.' });
  } catch (error) { next(error); }
});

// 함께한 작가 숨기기/보이기 (갤러리 주인·Admin). 자동 집계에서 특정 작가만 빼는 스위치 — 지원 기록은 건드리지 않는다.
router.patch('/:id/artists/:artistId', authenticate, async (req, res, next) => {
  try {
    const galleryId = parseInt(req.params.id as string);
    const artistId = parseInt(req.params.artistId as string);
    if (isNaN(galleryId) || isNaN(artistId)) throw new AppError('유효하지 않은 요청입니다.', 400);
    const gallery = await prisma.gallery.findUnique({ where: { id: galleryId }, select: { ownerId: true, hiddenArtistIds: true } });
    if (!gallery) throw new AppError('갤러리를 찾을 수 없습니다.', 404);
    if (gallery.ownerId !== req.user!.id && req.user!.role !== 'ADMIN') throw new AppError('권한이 없습니다.', 403);
    const hiddenWanted = req.body?.hidden === true;
    const next = new Set(gallery.hiddenArtistIds ?? []);
    if (hiddenWanted) next.add(artistId); else next.delete(artistId);
    await prisma.gallery.update({ where: { id: galleryId }, data: { hiddenArtistIds: [...next] } });
    res.json({ artistId, hidden: hiddenWanted });
  } catch (error) { next(error); }
});

router.patch('/:id/detail', authenticate, async (req, res, next) => {
  try {
    const gallery = await prisma.gallery.findUnique({ where: { id: parseInt(req.params.id as string) } });
    if (!gallery) throw new AppError('갤러리를 찾을 수 없습니다.', 404);
    if (gallery.ownerId !== req.user!.id) throw new AppError('권한이 없습니다.', 403);

    const data: any = {};
    // 소개는 서식 있는 글(2026-09-28) — 편집기가 보낸 HTML 을 허용 목록으로 걸러 저장한다(lib/richText.ts).
    // ⚠️ 그대로 넣지 말 것 — 화면이 HTML 로 그리므로 여기서 안 거르면 저장형 XSS 다(화면도 한 번 더 거른다).
    if (req.body.detailDesc !== undefined) {
      const v = req.body.detailDesc;
      if (v !== null && typeof v !== 'string') throw new AppError('소개 형식이 올바르지 않습니다.', 400);
      if (typeof v === 'string' && v.length > DETAIL_DESC_MAX_HTML) throw new AppError('소개가 너무 깁니다.', 400);
      const clean = sanitizeRichText(v);
      if (clean && richTextPlain(clean).length > DETAIL_DESC_MAX_TEXT) throw new AppError(`소개는 ${DETAIL_DESC_MAX_TEXT.toLocaleString()}자까지 쓸 수 있습니다.`, 400);
      data.detailDesc = clean;
    }
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
      if (!isRegion(region)) throw new AppError('유효하지 않은 지역입니다.', 400);   // 목록은 lib/regions.ts 한 곳
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

/**
 * 갤러리 계정이 이 갤러리를 직접 지울 수 있는가 — 화면이 [갤러리 삭제]를 누를 때 먼저 묻는다(직접 삭제 창 / 삭제 요청 창).
 * 규칙은 `lib/deletion.ts` 한 곳. 관리자는 늘 지울 수 있어 `blocked: null`.
 */
router.get('/:id/delete-check', authenticate, authorize('ADMIN', 'GALLERY'), async (req, res, next) => {
  try {
    const gallery = await prisma.gallery.findUnique({ where: { id: parseInt(req.params.id as string) }, select: { id: true, ownerId: true } });
    if (!gallery || (req.user!.role === 'GALLERY' && gallery.ownerId !== req.user!.id)) throw new AppError('갤러리를 찾을 수 없습니다.', 404);
    res.json({ blocked: req.user!.role === 'ADMIN' ? null : await galleryBlockReason(gallery.id) });
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
    // ⚠️ 갤러리를 지우면 그 갤러리의 공모가 cascade 로 **통째로** 지워진다. 공모 직접 삭제와 같은 규칙으로 막는다(2026-10-03 점검 P1-4 —
    //    정산 완료 공모는 직접 삭제가 막혀 있었는데 갤러리 삭제로는 판매·정산 기록까지 사라졌다). 막히면 관리자에게 삭제 요청.
    if (req.user!.role !== 'ADMIN') {
      const blocked = await galleryBlockReason(gallery.id);
      if (blocked) throw new AppError(`${blocked} 관리자에게 삭제 요청을 보내 주세요.`, 400);
    }
    // cascade 삭제 + 딸린 공모의 작가에게 알림 + 갤러리·공모 사진 파일 정리
    await deleteGalleryWithNotice(gallery.id);
    res.json({ message: '갤러리가 삭제되었습니다.' });
  } catch (error) { next(error); }
});

export default router;
