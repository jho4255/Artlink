import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, optionalAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { sendPortfolioEmail } from '../lib/mailer';

// 커스텀 필드 스키마 (공모 등록 시 질문 항목)
const customFieldSchema = z.object({
  id: z.string(),
  label: z.string().min(1),
  type: z.enum(['text', 'textarea', 'select', 'multiselect', 'file']),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  maxLength: z.number().int().min(0).optional(),   // 텍스트 글자수 제한 (0=무제한)
  maxSelect: z.number().int().min(0).optional(),   // 선택형 최대 선택 수 (1=단일, 0=무제한, 2+=최대N개)
});

const exhibitionCreateSchema = z.object({
  title: z.string().min(1, '공모 제목을 입력해주세요.'),
  type: z.enum(['SOLO', 'GROUP', 'ART_FAIR'], { message: '유효한 전시 유형을 선택해주세요.' }),
  deadline: z.string().min(1, '마감일을 입력해주세요.'),
  deadlineStart: z.string().optional().nullable(),
  exhibitDate: z.string().min(1, '전시 종료일을 입력해주세요.'),
  exhibitStartDate: z.string().optional().nullable(),
  capacity: z.number().int().positive('모집인원은 1명 이상이어야 합니다.'),
  region: z.string().min(1, '지역을 선택해주세요.'),
  description: z.string().min(1, '공모 소개를 입력해주세요.'),
  galleryId: z.number().int().positive('갤러리를 선택해주세요.'),
  imageUrl: z.string().optional().nullable(),
  customFields: z.array(customFieldSchema).optional().nullable(),
});

const router = Router();

// customFields JSON 파싱 헬퍼 (DB string → object array)
function parseCustomFields(raw: string | null): any[] | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// 진행중인 공모 목록 (마감일이 지나지 않은 것만)
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { region, minGalleryRating } = req.query;

    const now = new Date();
    // deadlineStart를 날짜 단위로 비교 — KST 유저가 오늘 날짜로 설정한 값(UTC 자정)이
    // UTC 서버 시간보다 미래일 수 있으므로, 내일 끝까지 포함 (최대 +1일 여유)
    const tomorrowEnd = new Date(now);
    tomorrowEnd.setUTCDate(tomorrowEnd.getUTCDate() + 1);
    tomorrowEnd.setUTCHours(23, 59, 59, 999);
    const where: any = {
      status: 'APPROVED',
      deadline: { gte: now },
      OR: [
        { deadlineStart: null },
        { deadlineStart: { lte: tomorrowEnd } }
      ]
    };
    if (region) where.region = region;
    if (req.query.type) where.type = req.query.type;

    const exhibitions = await prisma.exhibition.findMany({
      where,
      include: {
        gallery: {
          select: { id: true, name: true, rating: true, mainImage: true, region: true }
        }
      },
      orderBy: { deadline: 'asc' }
    });

    // 갤러리 별점 필터 (DB 레벨에서 어려우므로 앱 레벨 필터)
    let filtered = exhibitions;
    if (minGalleryRating) {
      filtered = exhibitions.filter(e => e.gallery.rating >= parseFloat(minGalleryRating as string));
    }

    // customFields 파싱
    const withParsed = filtered.map((e: any) => ({
      ...e,
      customFields: parseCustomFields(e.customFields),
    }));

    // 로그인 유저의 찜 여부 확인
    if (req.user) {
      const favorites = await prisma.favorite.findMany({
        where: {
          userId: req.user.id,
          exhibitionId: { in: withParsed.map((e: any) => e.id) }
        },
        select: { exhibitionId: true }
      });
      const favSet = new Set(favorites.map(f => f.exhibitionId));
      return res.json(withParsed.map((e: any) => ({ ...e, isFavorited: favSet.has(e.id) })));
    }

    res.json(withParsed.map((e: any) => ({ ...e, isFavorited: false })));
  } catch (error) { next(error); }
});

// 내 지원 내역 조회 (Artist 전용)
router.get('/my-applications', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    const applications = await prisma.application.findMany({
      where: { userId: req.user!.id },
      include: {
        exhibition: {
          include: {
            gallery: { select: { id: true, name: true, rating: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(applications);
  } catch (error) { next(error); }
});

// 내 공모 목록 조회 (Gallery 유저 전용)
router.get('/my-exhibitions', authenticate, authorize('GALLERY'), async (req, res, next) => {
  try {
    const galleries = await prisma.gallery.findMany({
      where: { ownerId: req.user!.id },
      select: { id: true }
    });
    const galleryIds = galleries.map(g => g.id);
    const exhibitions = await prisma.exhibition.findMany({
      where: { galleryId: { in: galleryIds } },
      include: {
        gallery: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(exhibitions.map((e: any) => ({
      ...e,
      customFields: parseCustomFields(e.customFields),
    })));
  } catch (error) { next(error); }
});

// 공모 상세 조회
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const exhibition = await prisma.exhibition.findUnique({
      where: { id: parseInt(req.params.id as string) },
      include: {
        gallery: {
          include: { owner: { select: { id: true } } }
        },
        promoPhotos: true
      }
    });
    if (!exhibition) throw new AppError('공모를 찾을 수 없습니다.', 404);

    // 찜 여부 확인
    let isFavorited = false;
    if (req.user) {
      const fav = await prisma.favorite.findUnique({
        where: { userId_exhibitionId: { userId: req.user.id, exhibitionId: exhibition.id } }
      });
      isFavorited = !!fav;
    }

    // ownerId를 gallery 객체에 포함하여 프론트엔드에서 권한 체크 가능하도록
    const { owner, ...galleryRest } = exhibition.gallery as any;
    res.json({
      ...exhibition,
      customFields: parseCustomFields(exhibition.customFields),
      gallery: { ...galleryRest, ownerId: owner?.id },
      isFavorited,
    });
  } catch (error) { next(error); }
});

// 공모 등록 요청 (Gallery 유저 전용)
router.post('/', authenticate, authorize('GALLERY'), validate(exhibitionCreateSchema), async (req, res, next) => {
  try {
    const { title, type, deadline, deadlineStart, exhibitDate, exhibitStartDate, capacity, region, description, galleryId, imageUrl, customFields } = req.body;

    // 갤러리 소유권 확인
    const gallery = await prisma.gallery.findUnique({ where: { id: galleryId } });
    if (!gallery || gallery.ownerId !== req.user!.id) {
      throw new AppError('본인 소유의 갤러리만 선택할 수 있습니다.', 403);
    }

    const exhibition = await prisma.exhibition.create({
      data: {
        title, type,
        deadline: new Date(deadline),
        deadlineStart: deadlineStart ? new Date(deadlineStart) : null,
        exhibitDate: new Date(exhibitDate),
        exhibitStartDate: exhibitStartDate ? new Date(exhibitStartDate) : null,
        capacity, region, description, galleryId, imageUrl,
        customFields: customFields ? JSON.stringify(customFields) : null,
        status: 'PENDING'
      }
    });
    res.status(201).json(exhibition);
  } catch (error) { next(error); }
});

// 공모 지원 (Artist 전용) + 포트폴리오 이메일 자동전송
router.post('/:id/apply', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    const exhibitionId = parseInt(req.params.id as string);

    // 중복 지원 확인
    const existing = await prisma.application.findUnique({
      where: { userId_exhibitionId: { userId: req.user!.id, exhibitionId } }
    });
    if (existing) throw new AppError('이미 지원한 공모입니다.', 400);

    // 커스텀 필드 required 검증
    const { customAnswers } = req.body || {};
    const exhibitionData = await prisma.exhibition.findUnique({ where: { id: exhibitionId } });
    if (!exhibitionData) throw new AppError('공모를 찾을 수 없습니다.', 404);

    const fields = parseCustomFields(exhibitionData.customFields);
    if (fields && fields.length > 0) {
      const requiredIds = fields.filter((f: any) => f.required).map((f: any) => f.id);
      const answers: any[] = customAnswers || [];
      for (const reqId of requiredIds) {
        const answer = answers.find((a: any) => a.fieldId === reqId);
        if (!answer || !answer.value) {
          throw new AppError(`필수 항목을 모두 입력해주세요.`, 400);
        }
      }
    }

    const application = await prisma.application.create({
      data: {
        userId: req.user!.id,
        exhibitionId,
        customAnswers: customAnswers ? JSON.stringify(customAnswers) : null,
      }
    });

    // 새 지원자 → Gallery 오너에게 알림
    try {
      const galleryOwner = await prisma.exhibition.findUnique({
        where: { id: exhibitionId },
        include: { gallery: { select: { ownerId: true, name: true } } },
      });
      if (galleryOwner) {
        await prisma.notification.create({
          data: {
            userId: galleryOwner.gallery.ownerId,
            type: 'NEW_APPLICANT',
            message: `"${galleryOwner.gallery.name}" 갤러리의 공모에 새로운 지원자(${req.user!.name})가 있습니다.`,
            linkUrl: `/exhibitions/${exhibitionId}`,
          },
        });
      }
    } catch { /* best-effort */ }

    // 포트폴리오 이메일 전송 (best-effort: 실패해도 지원은 성공)
    try {
      const exhibition = await prisma.exhibition.findUnique({
        where: { id: exhibitionId },
        include: { gallery: { include: { owner: { select: { email: true } } } } }
      });
      const portfolio = await prisma.portfolio.findUnique({
        where: { userId: req.user!.id },
        include: { images: { orderBy: { order: 'asc' } } }
      });

      if (exhibition && exhibition.gallery.owner.email) {
        await sendPortfolioEmail({
          artistName: req.user!.name,
          artistEmail: req.user!.email,
          biography: portfolio?.biography || undefined,
          exhibitionHistory: portfolio?.exhibitionHistory || undefined,
          imageUrls: portfolio?.images.map(img => img.url) || [],
          exhibitionTitle: exhibition.title,
          galleryName: exhibition.gallery.name,
          galleryOwnerEmail: exhibition.gallery.owner.email,
        });
      }
    } catch (emailErr) {
      console.error('[Mailer] 이메일 전송 실패 (지원은 정상 처리됨):', emailErr);
    }

    res.status(201).json(application);
  } catch (error) { next(error); }
});

// 공모 소개 수정 (Gallery 오너 전용)
router.patch('/:id/description', authenticate, async (req, res, next) => {
  try {
    const exhibition = await prisma.exhibition.findUnique({
      where: { id: parseInt(req.params.id as string) },
      include: { gallery: { select: { ownerId: true } } }
    });
    if (!exhibition) throw new AppError('공모를 찾을 수 없습니다.', 404);
    if (exhibition.gallery.ownerId !== req.user!.id) throw new AppError('권한이 없습니다.', 403);

    const updated = await prisma.exhibition.update({
      where: { id: exhibition.id },
      data: { description: req.body.description }
    });
    res.json(updated);
  } catch (error) { next(error); }
});

// 커스텀 필드 수정 (Gallery 오너 전용)
router.patch('/:id/custom-fields', authenticate, async (req, res, next) => {
  try {
    const exhibition = await prisma.exhibition.findUnique({
      where: { id: parseInt(req.params.id as string) },
      include: { gallery: { select: { ownerId: true } } }
    });
    if (!exhibition) throw new AppError('공모를 찾을 수 없습니다.', 404);
    if (exhibition.gallery.ownerId !== req.user!.id) throw new AppError('권한이 없습니다.', 403);

    const { customFields } = req.body;
    // 검증: 배열이거나 null
    if (customFields !== null && customFields !== undefined) {
      const parsed = z.array(customFieldSchema).safeParse(customFields);
      if (!parsed.success) throw new AppError('잘못된 커스텀 필드 형식입니다.', 400);
    }

    const updated = await prisma.exhibition.update({
      where: { id: exhibition.id },
      data: { customFields: customFields ? JSON.stringify(customFields) : null }
    });
    res.json({ ...updated, customFields: parseCustomFields(updated.customFields) });
  } catch (error) { next(error); }
});

// 공모 삭제 (Gallery 오너 또는 Admin)
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const exhibition = await prisma.exhibition.findUnique({
      where: { id: parseInt(req.params.id as string) },
      include: { gallery: { select: { ownerId: true } } }
    });
    if (!exhibition) throw new AppError('공모를 찾을 수 없습니다.', 404);

    // 소유권 확인: Gallery 오너 또는 Admin만 삭제 가능
    const isOwner = exhibition.gallery.ownerId === req.user!.id;
    const isAdmin = req.user!.role === 'ADMIN';
    if (!isOwner && !isAdmin) throw new AppError('권한이 없습니다.', 403);

    // cascade로 Application, PromoPhoto, Favorite도 자동 삭제 (schema에 onDelete: Cascade 설정됨)
    await prisma.exhibition.delete({ where: { id: exhibition.id } });
    res.json({ message: '공모가 삭제되었습니다.' });
  } catch (error) { next(error); }
});

// 공모 지원자 목록 조회 (Gallery 오너 전용)
router.get('/:id/applications', authenticate, authorize('GALLERY'), async (req, res, next) => {
  try {
    const exhibitionId = parseInt(req.params.id as string);
    const exhibition = await prisma.exhibition.findUnique({
      where: { id: exhibitionId },
      include: { gallery: { select: { ownerId: true } } }
    });
    if (!exhibition) throw new AppError('공모를 찾을 수 없습니다.', 404);
    if (exhibition.gallery.ownerId !== req.user!.id) throw new AppError('권한이 없습니다.', 403);

    const applications = await prisma.application.findMany({
      where: { exhibitionId },
      include: {
        user: {
          select: {
            id: true, name: true, email: true, avatar: true,
            portfolio: {
              include: { images: { orderBy: { order: 'asc' }, take: 10 } }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // customAnswers JSON 파싱
    const parsed = applications.map((app: any) => ({
      ...app,
      customAnswers: app.customAnswers ? (() => { try { return JSON.parse(app.customAnswers); } catch { return null; } })() : null,
    }));

    res.json(parsed);
  } catch (error) { next(error); }
});

// 지원 상태 변경 (Gallery 오너 전용)
router.patch('/:id/applications/:appId', authenticate, authorize('GALLERY'), async (req, res, next) => {
  try {
    const exhibitionId = parseInt(req.params.id as string);
    const appId = parseInt(req.params.appId as string);

    const exhibition = await prisma.exhibition.findUnique({
      where: { id: exhibitionId },
      include: { gallery: { select: { ownerId: true } } }
    });
    if (!exhibition) throw new AppError('공모를 찾을 수 없습니다.', 404);
    if (exhibition.gallery.ownerId !== req.user!.id) throw new AppError('권한이 없습니다.', 403);

    const { status } = req.body;
    const validStatuses = ['SUBMITTED', 'REVIEWED', 'ACCEPTED', 'REJECTED'];
    if (!validStatuses.includes(status)) {
      throw new AppError('유효하지 않은 상태입니다.', 400);
    }

    const application = await prisma.application.findUnique({ where: { id: appId } });
    if (!application || application.exhibitionId !== exhibitionId) {
      throw new AppError('지원 내역을 찾을 수 없습니다.', 404);
    }

    const updated = await prisma.application.update({
      where: { id: appId },
      data: { status },
    });

    // 지원 상태 변경 → Artist에게 알림
    const statusLabels: Record<string, string> = { SUBMITTED: '접수', REVIEWED: '검토중', ACCEPTED: '수락', REJECTED: '거절' };
    try {
      await prisma.notification.create({
        data: {
          userId: application.userId,
          type: 'APPLICATION_STATUS',
          message: `"${exhibition.title}" 공모 지원 상태가 '${statusLabels[status] || status}'(으)로 변경되었습니다.`,
          linkUrl: `/exhibitions/${exhibitionId}`,
        },
      });
    } catch { /* best-effort */ }

    res.json(updated);
  } catch (error) { next(error); }
});

// 홍보 사진 등록 (Gallery 전용, 전시 종료 후)
router.post('/:id/promo-photos', authenticate, authorize('GALLERY'), async (req, res, next) => {
  try {
    const exhibition = await prisma.exhibition.findUnique({
      where: { id: parseInt(req.params.id as string) },
      include: { gallery: true }
    });
    if (!exhibition) throw new AppError('공모를 찾을 수 없습니다.', 404);
    if (exhibition.gallery.ownerId !== req.user!.id) throw new AppError('권한이 없습니다.', 403);

    const { url, caption } = req.body;
    const photo = await prisma.promoPhoto.create({
      data: { url, caption, exhibitionId: exhibition.id }
    });
    res.status(201).json(photo);
  } catch (error) { next(error); }
});

// 홍보 사진 삭제
router.delete('/:id/promo-photos/:photoId', authenticate, authorize('GALLERY'), async (req, res, next) => {
  try {
    await prisma.promoPhoto.delete({ where: { id: parseInt(req.params.photoId as string) } });
    res.json({ message: '삭제되었습니다.' });
  } catch (error) { next(error); }
});

export default router;
