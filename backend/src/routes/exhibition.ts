import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, optionalAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { sendPortfolioEmail } from '../lib/mailer';
import { galleryApplicationStats } from '../lib/applicationStats';
import { safeFileUrl } from '../lib/safeUrl';
import { maskGallery } from '../lib/sanitize';

// 커스텀 필드 스키마 (공모 등록 시 질문 항목)
const customFieldSchema = z.object({
  id: z.string(),
  label: z.string().min(1),
  type: z.enum(['text', 'textarea', 'select', 'multiselect', 'file']),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  maxLength: z.number().int().min(0).optional(),   // 텍스트 글자수 제한 (0=무제한)
  maxSelect: z.number().int().min(0).optional(),   // 선택형 최대 선택 수 (1=단일, 0=무제한, 2+=최대N개)
}).refine(
  (f) => {
    // 선택형에서 최대 선택 수가 옵션 개수를 초과하면 안 됨 (0=무제한은 허용)
    if ((f.type === 'select' || f.type === 'multiselect') && f.maxSelect && f.maxSelect > 0) {
      return f.maxSelect <= (f.options?.length ?? 0);
    }
    return true;
  },
  { message: '최대 선택 수는 옵션 개수를 넘을 수 없습니다.' }
);

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
  // customFields(추가정보요청)는 제거됨 — 스키마에서 빼면 잔여 draft의 customFields는 z.object가 자동으로 무시
});

const router = Router();

// customFields JSON 파싱 헬퍼 (DB string → object array)
function parseCustomFields(raw: string | null): any[] | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// 안전 JSON 파싱 (지원서 career/artworkImages 등)
function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

// 경력 JSON → 이메일용 텍스트 변환
function careerToText(career: any): string | undefined {
  if (!career || typeof career !== 'object') return undefined;
  const labels: Record<string, string> = { artFair: '아트페어', solo: '개인전', group: '단체전' };
  const lines: string[] = [];
  for (const key of ['artFair', 'solo', 'group']) {
    const entries = Array.isArray(career[key]) ? career[key] : [];
    if (entries.length === 0) continue;
    lines.push(`[${labels[key]}]`);
    for (const e of entries) {
      lines.push(`- ${[e?.year, e?.content].filter(Boolean).join(' ')}`.trim());
    }
  }
  return lines.length ? lines.join('\n') : undefined;
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
      recruitmentClosed: false, // 모집마감/전시종료(종료 시 자동 마감) 공고는 목록에서 제외
      deadline: { gte: now },
      OR: [
        { deadlineStart: null },
        { deadlineStart: { lte: tomorrowEnd } }
      ]
    };
    if (region) where.region = region;
    if (req.query.type) where.type = req.query.type;

    // 키워드 검색 (제목/소개) — 기존 deadlineStart OR과 충돌 방지 위해 AND로 결합
    const q = ((req.query.q as string) || '').trim();
    if (q) {
      where.AND = [
        { OR: where.OR },
        { OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ] },
      ];
      delete where.OR;
    }

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
    res.json(applications.map((app: any) => ({
      ...app,
      career: safeJson(app.career, null),
      artworkImages: safeJson<string[]>(app.artworkImages, []),
    })));
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
    const exhibitionId = parseInt(req.params.id as string);
    let exhibition = await prisma.exhibition.findUnique({
      where: { id: exhibitionId },
      include: {
        gallery: {
          include: { owner: { select: { id: true } } }
        },
        promoPhotos: true,
        images: { orderBy: { order: 'asc' } },
      }
    });
    if (!exhibition) throw new AppError('공모를 찾을 수 없습니다.', 404);
    // 탈퇴 회원의 공모는 공개에서 숨김(관리자 제외)
    if (exhibition.status === 'WITHDRAWN' && req.user?.role !== 'ADMIN') {
      throw new AppError('공모를 찾을 수 없습니다.', 404);
    }

    // lazy 백필: 기존 공모(imageUrl만 있고 ExhibitionImage 행 없음)는 첫 조회 시 대표 이미지를 행으로 승격.
    if (exhibition.images.length === 0 && exhibition.imageUrl) {
      await prisma.exhibitionImage.create({ data: { url: exhibition.imageUrl, order: 0, exhibitionId } });
      exhibition = await prisma.exhibition.findUnique({
        where: { id: exhibitionId },
        include: {
          gallery: { include: { owner: { select: { id: true } } } },
          promoPhotos: true,
          images: { orderBy: { order: 'asc' } },
        }
      }) as typeof exhibition;
    }

    // 찜 여부 확인
    let isFavorited = false;
    if (req.user) {
      const fav = await prisma.favorite.findUnique({
        where: { userId_exhibitionId: { userId: req.user.id, exhibitionId: exhibition.id } }
      });
      isFavorited = !!fav;
    }

    // ownerId를 gallery 객체에 포함하여 프론트엔드에서 권한 체크 가능하도록.
    // maskGallery로 Instagram 토큰 등 서버 전용 비밀 제거 (공개 엔드포인트).
    const { owner, ...galleryRest } = exhibition.gallery as any;
    res.json({
      ...exhibition,
      customFields: parseCustomFields(exhibition.customFields),
      gallery: maskGallery({ ...galleryRest, ownerId: owner?.id }),
      isFavorited,
    });
  } catch (error) { next(error); }
});

// 공모 등록 요청 (Gallery 유저 전용)
router.post('/', authenticate, authorize('GALLERY'), validate(exhibitionCreateSchema), async (req, res, next) => {
  try {
    const { title, type, deadline, deadlineStart, exhibitDate, exhibitStartDate, capacity, region, description, galleryId, imageUrl } = req.body;

    // 갤러리 소유권 확인
    const gallery = await prisma.gallery.findUnique({ where: { id: galleryId } });
    if (!gallery || gallery.ownerId !== req.user!.id) {
      throw new AppError('본인 소유의 갤러리만 선택할 수 있습니다.', 403);
    }

    const safeImageUrl = safeFileUrl(imageUrl);
    const exhibition = await prisma.exhibition.create({
      data: {
        title, type,
        deadline: new Date(deadline),
        deadlineStart: deadlineStart ? new Date(deadlineStart) : null,
        exhibitDate: new Date(exhibitDate),
        exhibitStartDate: exhibitStartDate ? new Date(exhibitStartDate) : null,
        capacity, region, description, galleryId, imageUrl: safeImageUrl,
        // 추가정보요청(customFields) 기능 제거 — 지원서는 고정 양식(경력/작품사진/포트폴리오) 사용
        status: 'PENDING',
        // 대표 이미지를 다중사진 첫 행으로 등록 (이후 상세 페이지에서 추가/삭제/순서변경)
        ...(safeImageUrl ? { images: { create: [{ url: safeImageUrl, order: 0 }] } } : {}),
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

    // 지원서 고정 양식: 작가약력(필수) / 경력 / 작품사진(1장이상 필수) / 포트폴리오 파일
    const { biography, career, artworkImages, portfolioFileUrl } = req.body || {};
    const exhibitionData = await prisma.exhibition.findUnique({ where: { id: exhibitionId } });
    if (!exhibitionData) throw new AppError('공모를 찾을 수 없습니다.', 404);
    if (exhibitionData.status !== 'APPROVED') {
      throw new AppError('지원할 수 없는 공모입니다.', 400);
    }
    if (exhibitionData.recruitmentClosed || exhibitionData.ended) {
      throw new AppError('모집이 마감된 공모입니다.', 400);
    }

    // 모집 정원 마감 확인 (현재 지원자 수가 정원 이상이면 차단)
    const applicantCount = await prisma.application.count({ where: { exhibitionId } });
    if (applicantCount >= exhibitionData.capacity) {
      throw new AppError('모집 인원이 마감되었습니다.', 400);
    }

    // 필수 검증: 작가 약력
    if (!biography || !String(biography).trim()) {
      throw new AppError('작가 약력을 입력해주세요.', 400);
    }
    // 필수 검증: 작품 사진 1장 이상 (최대 10장)
    const images: string[] = (Array.isArray(artworkImages) ? artworkImages : [])
      .map((u) => safeFileUrl(u))
      .filter((u): u is string => !!u);
    if (images.length < 1) throw new AppError('작품 사진을 1장 이상 첨부해주세요.', 400);
    if (images.length > 10) throw new AppError('작품 사진은 최대 10장까지 첨부할 수 있습니다.', 400);

    const careerStr = career == null ? null : typeof career === 'string' ? career : JSON.stringify(career);

    const application = await prisma.application.create({
      data: {
        userId: req.user!.id,
        exhibitionId,
        biography: String(biography).trim(),
        career: careerStr,
        artworkImages: JSON.stringify(images),
        portfolioFileUrl: safeFileUrl(portfolioFileUrl),
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

    // 지원서 이메일 전송 (best-effort: 실패해도 지원은 성공) — 지원 시 제출한 내용을 전송
    try {
      const exhibition = await prisma.exhibition.findUnique({
        where: { id: exhibitionId },
        include: { gallery: { include: { owner: { select: { email: true } } } } }
      });

      if (exhibition && exhibition.gallery.owner.email) {
        await sendPortfolioEmail({
          artistName: req.user!.name,
          artistEmail: req.user!.email,
          biography: String(biography).trim(),
          exhibitionHistory: careerToText(safeJson(careerStr, null)),
          imageUrls: images,
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
            id: true, name: true, nickname: true, email: true, phone: true, avatar: true,
            portfolio: {
              include: { images: { orderBy: { order: 'asc' }, take: 10 } }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // 갤러리 단위 지원 횟수/순번/첫지원 여부 계산
    const stats = await galleryApplicationStats(exhibition.galleryId, applications.map(a => a.userId));

    // 지원서 고정 양식 필드 파싱 + 갤러리 지원 통계 부착
    // 연락처(이메일/전화)는 지원 시점부터 갤러리 오너에게 노출 (지원 동의 문구에서 고지). 상태 무관.
    const parsed = applications.map((app: any) => {
      return {
        ...app,
        career: safeJson(app.career, null),
        artworkImages: safeJson<string[]>(app.artworkImages, []),
        ...(stats.get(app.id) ?? { galleryApplicationCount: 1, galleryApplicationOrder: 1, isFirstApplication: true }),
      };
    });

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

    // 상태 단계 강제: 접수(0) → 검토중(1) → 수락/거절(2). 역행 금지(낮은 단계로 되돌리기 차단)
    const statusRank: Record<string, number> = { SUBMITTED: 0, REVIEWED: 1, ACCEPTED: 2, REJECTED: 2 };
    if (statusRank[status] < statusRank[application.status]) {
      throw new AppError('이미 진행된 단계로 되돌릴 수 없습니다.', 400);
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

// ========== 공모 사진 관리 (다중, 오너/Admin) ==========
const MAX_EXHIBITION_IMAGES = 20;

// 오너(또는 Admin) 권한 확인 후 exhibition 반환
async function assertExhibitionOwner(exhibitionId: number, user: { id: number; role: string }) {
  const exhibition = await prisma.exhibition.findUnique({
    where: { id: exhibitionId },
    include: { gallery: { select: { ownerId: true } } },
  });
  if (!exhibition) throw new AppError('공모를 찾을 수 없습니다.', 404);
  if (user.role !== 'ADMIN' && exhibition.gallery.ownerId !== user.id) {
    throw new AppError('권한이 없습니다.', 403);
  }
  return exhibition;
}

// 첫 사진(order 최소)을 대표 imageUrl로 동기화 (목록 썸네일 호환)
async function syncExhibitionImageUrl(exhibitionId: number) {
  const first = await prisma.exhibitionImage.findFirst({
    where: { exhibitionId },
    orderBy: { order: 'asc' },
  });
  await prisma.exhibition.update({
    where: { id: exhibitionId },
    data: { imageUrl: first ? first.url : null },
  });
}

// 사진 추가
router.post('/:id/images', authenticate, async (req, res, next) => {
  try {
    const exhibitionId = parseInt(req.params.id as string);
    const exhibition = await assertExhibitionOwner(exhibitionId, req.user!);
    const url = safeFileUrl(req.body?.url);
    if (!url) throw new AppError('유효한 이미지 URL이 아닙니다.', 400);
    let count = await prisma.exhibitionImage.count({ where: { exhibitionId } });
    // 안전망: 기존 대표 imageUrl이 아직 행으로 승격되지 않았다면 먼저 order 0으로 보존
    // (상세 GET 백필을 거치지 않고 업로드해도 기존 사진이 유실되지 않도록)
    if (count === 0 && exhibition.imageUrl) {
      await prisma.exhibitionImage.create({ data: { url: exhibition.imageUrl, order: 0, exhibitionId } });
      count = 1;
    }
    if (count >= MAX_EXHIBITION_IMAGES) {
      throw new AppError(`사진은 최대 ${MAX_EXHIBITION_IMAGES}장까지 등록할 수 있습니다.`, 400);
    }
    await prisma.exhibitionImage.create({ data: { url, order: count, exhibitionId } });
    await syncExhibitionImageUrl(exhibitionId);
    const images = await prisma.exhibitionImage.findMany({ where: { exhibitionId }, orderBy: { order: 'asc' } });
    res.status(201).json(images);
  } catch (error) { next(error); }
});

// 사진 삭제 (최소 1장 유지)
router.delete('/:id/images/:imageId', authenticate, async (req, res, next) => {
  try {
    const exhibitionId = parseInt(req.params.id as string);
    await assertExhibitionOwner(exhibitionId, req.user!);
    const imageId = parseInt(req.params.imageId as string);
    const count = await prisma.exhibitionImage.count({ where: { exhibitionId } });
    if (count <= 1) throw new AppError('사진은 최소 한 장 이상 등록되어 있어야 합니다.', 400);
    const target = await prisma.exhibitionImage.findFirst({ where: { id: imageId, exhibitionId } });
    if (!target) throw new AppError('사진을 찾을 수 없습니다.', 404);
    await prisma.exhibitionImage.delete({ where: { id: imageId } });
    // order 재정렬 (0..n-1)
    const remaining = await prisma.exhibitionImage.findMany({ where: { exhibitionId }, orderBy: { order: 'asc' } });
    await Promise.all(remaining.map((img, i) => prisma.exhibitionImage.update({ where: { id: img.id }, data: { order: i } })));
    await syncExhibitionImageUrl(exhibitionId);
    const images = await prisma.exhibitionImage.findMany({ where: { exhibitionId }, orderBy: { order: 'asc' } });
    res.json(images);
  } catch (error) { next(error); }
});

// 사진 순서 변경 (드래그앤드롭) — orderedIds: 새 순서의 이미지 id 배열
router.patch('/:id/images/reorder', authenticate, async (req, res, next) => {
  try {
    const exhibitionId = parseInt(req.params.id as string);
    await assertExhibitionOwner(exhibitionId, req.user!);
    const orderedIds = req.body?.orderedIds;
    if (!Array.isArray(orderedIds) || orderedIds.some((x) => !Number.isInteger(x))) {
      throw new AppError('orderedIds 배열이 필요합니다.', 400);
    }
    const existing = await prisma.exhibitionImage.findMany({ where: { exhibitionId }, select: { id: true } });
    const existingIds = new Set(existing.map((e) => e.id));
    // orderedIds가 현재 이미지 집합과 정확히 일치해야 함
    if (orderedIds.length !== existing.length || orderedIds.some((id) => !existingIds.has(id))) {
      throw new AppError('이미지 목록이 일치하지 않습니다.', 400);
    }
    await Promise.all(orderedIds.map((id: number, i: number) =>
      prisma.exhibitionImage.update({ where: { id }, data: { order: i } })));
    await syncExhibitionImageUrl(exhibitionId);
    const images = await prisma.exhibitionImage.findMany({ where: { exhibitionId }, orderBy: { order: 'asc' } });
    res.json(images);
  } catch (error) { next(error); }
});

export default router;
