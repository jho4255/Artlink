import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, optionalAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { galleryApplicationStats } from '../lib/applicationStats';
import { getSettingBool, ALLOW_ACCEPTED_REVERT } from '../lib/appSettings';
import { safeFileUrl } from '../lib/safeUrl';
import { maskGallery } from '../lib/sanitize';
import { notifyApprovalRequest } from '../lib/telegram';
import { ARTIST_APPLY_TERMS_HASH, ARTIST_APPLY_TERMS_VERSION } from '../lib/terms';
import { bumpViewCount } from '../lib/viewCount';
import { startOfTodayKstAsUtc, endOfTodayKstAsUtc, isDeadlinePassedKst } from '../lib/kstDate';
import { hasSubmissionContent } from '../lib/submission';
import { deleteUploadedFile, deleteUploadedFiles } from '../lib/storage';

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
  customFields: z.array(customFieldSchema).optional().nullable(),
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

function normalizeCustomAnswers(raw: unknown, fields: any[]): { fieldId: string; value: string | string[] }[] {
  const input = Array.isArray(raw) ? raw : [];
  const answers = input
    .filter((a: any) => a && typeof a.fieldId === 'string')
    .map((a: any) => {
      const field = fields.find((f: any) => f.id === a.fieldId);
      const value = Array.isArray(a.value)
        ? Array.from(new Set<string>(a.value.map((v: unknown) => String(v).trim()).filter(Boolean)))
        : String(a.value ?? '').trim();
      return { fieldId: a.fieldId, value, field };
    })
    .filter((a) => a.field);

  for (const field of fields) {
    const answer = answers.find((a) => a.fieldId === field.id);
    const value = answer?.value;
    const empty = Array.isArray(value) ? value.length === 0 : !value;
    if (field.required && empty) {
      throw new AppError(`추가 질문 "${field.label}"에 답변해주세요.`, 400);
    }
    if ((field.type === 'select' || field.type === 'multiselect') && value) {
      const options = Array.isArray(field.options) ? field.options : [];
      const selected = Array.isArray(value) ? value : [value];
      const maxSelect = Number.isInteger(field.maxSelect)
        ? Number(field.maxSelect)
        : field.type === 'select' ? 1 : 0;
      if (selected.some((v) => !options.includes(v))) {
        throw new AppError(`추가 질문 "${field.label}"의 선택지가 올바르지 않습니다.`, 400);
      }
      if (maxSelect > 0 && selected.length > maxSelect) {
        throw new AppError(`추가 질문 "${field.label}"은 최대 ${maxSelect}개까지 선택할 수 있습니다.`, 400);
      }
    }
  }

  return answers.map(({ fieldId, value }) => ({ fieldId, value }));
}

// 진행중인 공모 목록 (마감일이 지나지 않은 것만)
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { region, minGalleryRating } = req.query;

    // KST 달력 날짜 기준 경계로 마감/시작을 판정 (마감일 당일은 종일 노출, 시작일 당일부터 노출)
    const todayStartKst = startOfTodayKstAsUtc();
    const todayEndKst = endOfTodayKstAsUtc();
    const where: any = {
      status: 'APPROVED',
      recruitmentClosed: false, // 모집마감/전시종료(종료 시 자동 마감) 공고는 목록에서 제외
      deadline: { gte: todayStartKst },
      OR: [
        { deadlineStart: null },
        { deadlineStart: { lte: todayEndKst } }
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
      customAnswers: safeJson(app.customAnswers, []),
      exhibition: app.exhibition ? {
        ...app.exhibition,
        customFields: parseCustomFields(app.exhibition.customFields),
      } : app.exhibition,
    })));
  } catch (error) { next(error); }
});

// 거절 확인 (Artist 전용) — 본인의 거절된 지원을 '확인' 처리 → 지원내역 목록에서 숨김
router.post('/applications/:appId/acknowledge-rejection', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    const appId = parseInt(req.params.appId as string);
    const application = await prisma.application.findUnique({ where: { id: appId } });
    if (!application || application.userId !== req.user!.id) {
      throw new AppError('지원 내역을 찾을 수 없습니다.', 404);
    }
    if (application.status !== 'REJECTED') {
      throw new AppError('거절된 지원만 확인 처리할 수 있습니다.', 400);
    }
    const updated = await prisma.application.update({
      where: { id: appId },
      data: { rejectionAckedAt: new Date() },
    });
    res.json({ id: updated.id, rejectionAckedAt: updated.rejectionAckedAt });
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
// Gallery operation overview for My Page.
router.get('/my-operation-overview', authenticate, authorize('GALLERY'), async (req, res, next) => {
  try {
    const galleries = await prisma.gallery.findMany({
      where: { ownerId: req.user!.id },
      select: { id: true }
    });
    const galleryIds = galleries.map(g => g.id);
    if (galleryIds.length === 0) return res.json([]);

    const exhibitions = await prisma.exhibition.findMany({
      where: { galleryId: { in: galleryIds } },
      include: {
        gallery: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    const exhibitionIds = exhibitions.map(e => e.id);
    if (exhibitionIds.length === 0) return res.json([]);

    const [applications, submissions, sales, approvals] = await Promise.all([
      prisma.application.findMany({
        where: { exhibitionId: { in: exhibitionIds } },
        select: { exhibitionId: true, status: true }
      }),
      prisma.exhibitionSubmission.findMany({
        where: { exhibitionId: { in: exhibitionIds } },
        select: { exhibitionId: true, artworkList: true, cv: true, note: true }
      }),
      prisma.artworkSale.findMany({
        where: { exhibitionId: { in: exhibitionIds } },
        select: { exhibitionId: true }
      }),
      prisma.settlementApproval.findMany({
        where: { exhibitionId: { in: exhibitionIds } },
        select: { exhibitionId: true, status: true }
      })
    ]);

    const appCounts = new Map<number, Record<string, number>>();
    const submissionCounts = new Map<number, { submitted: number; complete: number }>();
    const saleCounts = new Map<number, number>();
    const approvalCounts = new Map<number, Record<string, number>>();

    for (const app of applications) {
      const row = appCounts.get(app.exhibitionId) ?? { total: 0, submitted: 0, reviewed: 0, accepted: 0, rejected: 0 };
      row.total += 1;
      row[app.status.toLowerCase()] = (row[app.status.toLowerCase()] ?? 0) + 1;
      appCounts.set(app.exhibitionId, row);
    }

    for (const sub of submissions) {
      const row = submissionCounts.get(sub.exhibitionId) ?? { submitted: 0, complete: 0 };
      const artworks = safeJson<any[]>(sub.artworkList, []);
      const hasArtwork = Array.isArray(artworks) && artworks.length > 0;
      const hasCv = hasSubmissionContent(safeJson(sub.cv, null));
      const hasNote = hasSubmissionContent(safeJson(sub.note, null));
      if (hasArtwork || hasCv || hasNote) row.submitted += 1;
      if (hasArtwork && hasCv && hasNote) row.complete += 1;
      submissionCounts.set(sub.exhibitionId, row);
    }

    for (const sale of sales) {
      saleCounts.set(sale.exhibitionId, (saleCounts.get(sale.exhibitionId) ?? 0) + 1);
    }

    for (const approval of approvals) {
      const row = approvalCounts.get(approval.exhibitionId) ?? { total: 0, pending: 0, approved: 0, issue: 0 };
      row.total += 1;
      row[approval.status.toLowerCase()] = (row[approval.status.toLowerCase()] ?? 0) + 1;
      approvalCounts.set(approval.exhibitionId, row);
    }

    const getStage = (exhibition: any) => {
      if (exhibition.status === 'PENDING') return { key: 'review', label: '승인 대기', tone: 'wait' };
      if (exhibition.status === 'REJECTED') return { key: 'rejected', label: '반려', tone: 'danger' };
      if (exhibition.settledAt) return { key: 'settled', label: '정산 완료', tone: 'done' };
      if (exhibition.ended) return { key: 'settlement', label: '정산 단계', tone: 'accent' };
      if (exhibition.confirmed) return { key: 'confirmed', label: '전시 확정', tone: 'active' };
      if (exhibition.recruitmentClosed) return { key: 'closed', label: '모집 마감', tone: 'wait' };
      return { key: 'recruiting', label: '모집 중', tone: 'active' };
    };

    const getNextAction = (exhibition: any, acceptedCount: number, completeCount: number, saleCount: number, settlement: Record<string, number>) => {
      if (exhibition.status === 'PENDING') {
        return { label: '관리자 승인 대기', description: '승인 후 지원자 모집과 운영 페이지를 사용할 수 있습니다.', route: `/exhibitions/${exhibition.id}` };
      }
      if (exhibition.status === 'REJECTED') {
        return { label: '반려 사유 확인', description: '공모 내용을 수정해 다시 제출해야 합니다.', route: `/exhibitions/${exhibition.id}` };
      }
      if (exhibition.ended) {
        if (exhibition.settledAt) {
          return { label: '정산 완료 내역 보기', description: '작가별 정산 결과와 판매 내역을 확인합니다.', route: `/exhibitions/${exhibition.id}/operation/new` };
        }
        if (exhibition.settlementRequestedAt) {
          const issue = settlement.issue ?? 0;
          return {
            label: issue > 0 ? '정산 이슈 확인' : '작가 승인 대기',
            description: issue > 0 ? '작가가 남긴 이슈를 확인하고 정산을 조정합니다.' : '작가별 정산 승인 상태를 확인합니다.',
            route: `/exhibitions/${exhibition.id}/operation/new`
          };
        }
        return {
          label: saleCount > 0 ? '정산서 작성' : '판매 내역 입력',
          description: saleCount > 0 ? '판매 작품과 배분율을 검토해 정산 요청을 보냅니다.' : '판매 작품을 입력하면 정산서 작성이 시작됩니다.',
          route: `/exhibitions/${exhibition.id}/operation/new`
        };
      }
      if (acceptedCount > 0 && completeCount < acceptedCount) {
        return { label: '작가 자료 수집', description: '확정 작가의 작품, 약력, 작가노트 제출 현황을 확인합니다.', route: `/exhibitions/${exhibition.id}/operation/new` };
      }
      if (exhibition.confirmed) {
        return { label: '운영 자료 확인', description: '캡션, 작품 목록, 홍보 자료를 전시 운영에 맞게 점검합니다.', route: `/exhibitions/${exhibition.id}/operation/new` };
      }
      if (exhibition.recruitmentClosed) {
        return { label: '참여 작가 확정', description: '지원자를 검토하고 참여 작가를 확정합니다.', route: `/exhibitions/${exhibition.id}/applicants` };
      }
      return { label: '지원자 검토', description: '접수 현황을 확인하고 수락/거절 상태를 관리합니다.', route: `/exhibitions/${exhibition.id}/applicants` };
    };

    res.json(exhibitions.map((exhibition: any) => {
      const apps = appCounts.get(exhibition.id) ?? { total: 0, submitted: 0, reviewed: 0, accepted: 0, rejected: 0 };
      const subs = submissionCounts.get(exhibition.id) ?? { submitted: 0, complete: 0 };
      const saleCount = saleCounts.get(exhibition.id) ?? 0;
      const settlement = approvalCounts.get(exhibition.id) ?? { total: 0, pending: 0, approved: 0, issue: 0 };
      return {
        id: exhibition.id,
        title: exhibition.title,
        type: exhibition.type,
        region: exhibition.region,
        imageUrl: exhibition.imageUrl,
        status: exhibition.status,
        rejectReason: exhibition.rejectReason,
        deadlineStart: exhibition.deadlineStart,
        deadline: exhibition.deadline,
        exhibitStartDate: exhibition.exhibitStartDate,
        exhibitDate: exhibition.exhibitDate,
        createdAt: exhibition.createdAt,
        recruitmentClosed: exhibition.recruitmentClosed,
        confirmed: exhibition.confirmed,
        ended: exhibition.ended,
        settlementRequestedAt: exhibition.settlementRequestedAt,
        settledAt: exhibition.settledAt,
        gallery: exhibition.gallery,
        stage: getStage(exhibition),
        nextAction: getNextAction(exhibition, apps.accepted ?? 0, subs.complete, saleCount, settlement),
        counts: {
          applications: apps,
          submissions: {
            required: apps.accepted ?? 0,
            submitted: subs.submitted,
            complete: subs.complete
          },
          sales: { total: saleCount },
          settlement
        }
      };
    }));
  } catch (error) { next(error); }
});

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

    // 상세 조회수 증가 (Admin 통계용, 비-관리자/비-소유자만)
    await bumpViewCount('exhibition', exhibition.id, (exhibition.gallery as any).owner?.id, req.user);

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
    const { title, type, deadline, deadlineStart, exhibitDate, exhibitStartDate, capacity, region, description, galleryId, imageUrl, customFields } = req.body;

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
        customFields: customFields && customFields.length ? JSON.stringify(customFields) : null,
        status: 'PENDING',
        // 대표 이미지를 다중사진 첫 행으로 등록 (이후 상세 페이지에서 추가/삭제/순서변경)
        ...(safeImageUrl ? { images: { create: [{ url: safeImageUrl, order: 0 }] } } : {}),
      }
    });
    void notifyApprovalRequest({
      kind: 'exhibition',
      title: exhibition.title,
      targetId: exhibition.id,
      galleryName: gallery.name,
      requesterName: req.user!.name,
      requesterEmail: req.user!.email,
    });
    res.status(201).json(exhibition);
  } catch (error) { next(error); }
});

// 공모 지원 (Artist 전용) — 지원 시 갤러리 오너에게 인앱 알림(NEW_APPLICANT)
router.post('/:id/apply', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    const exhibitionId = parseInt(req.params.id as string);

    // 중복 지원 확인
    const existing = await prisma.application.findUnique({
      where: { userId_exhibitionId: { userId: req.user!.id, exhibitionId } }
    });
    if (existing) throw new AppError('이미 지원한 공모입니다.', 400);

    // 지원서 고정 양식: 작가약력(필수) / 경력 / 작품사진(1장이상 필수) / 포트폴리오 파일
    const { biography, career, artworkImages, portfolioFileUrl, customAnswers, termsAgreed, termsVersion } = req.body || {};
    const exhibitionData = await prisma.exhibition.findUnique({ where: { id: exhibitionId } });
    if (!exhibitionData) throw new AppError('공모를 찾을 수 없습니다.', 404);
    if (exhibitionData.status !== 'APPROVED') {
      throw new AppError('지원할 수 없는 공모입니다.', 400);
    }
    if (exhibitionData.recruitmentClosed || exhibitionData.ended) {
      throw new AppError('모집이 마감된 공모입니다.', 400);
    }
    // 마감일 지난 공모 차단 (KST 달력 날짜 기준 — 목록 노출 규칙과 일치)
    if (isDeadlinePassedKst(exhibitionData.deadline)) {
      throw new AppError('모집이 마감된 공모입니다.', 400);
    }

    // 모집 정원 마감 확인 (거절된 지원은 정원에서 제외 → 거절 시 슬롯 복구). 빠른 실패용 사전 체크.
    const activeCount = await prisma.application.count({
      where: { exhibitionId, status: { not: 'REJECTED' } },
    });
    if (activeCount >= exhibitionData.capacity) {
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
    const customFields = parseCustomFields(exhibitionData.customFields) ?? [];
    const normalizedCustomAnswers = normalizeCustomAnswers(customAnswers, customFields);
    if (termsAgreed !== true || termsVersion !== ARTIST_APPLY_TERMS_VERSION) {
      throw new AppError('작가 지원 약관에 동의해야 지원할 수 있습니다.', 400);
    }

    // 동시 지원으로 정원이 초과되지 않도록 정원 재확인 + 생성을 트랜잭션으로 원자 처리
    const application = await prisma.$transaction(async (tx) => {
      const count = await tx.application.count({
        where: { exhibitionId, status: { not: 'REJECTED' } },
      });
      if (count >= exhibitionData.capacity) {
        throw new AppError('모집 인원이 마감되었습니다.', 400);
      }
      return tx.application.create({
        data: {
          userId: req.user!.id,
          exhibitionId,
          biography: String(biography).trim(),
          career: careerStr,
          artworkImages: JSON.stringify(images),
          portfolioFileUrl: safeFileUrl(portfolioFileUrl),
          termsAgreedAt: new Date(),
          termsVersion: ARTIST_APPLY_TERMS_VERSION,
          termsTextHash: ARTIST_APPLY_TERMS_HASH,
          customAnswers: normalizedCustomAnswers.length ? JSON.stringify(normalizedCustomAnswers) : null,
        }
      });
    }, { isolationLevel: 'Serializable' });

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

    // 삭제 전 직속 이미지/홍보사진 URL 수집 → cascade 삭제 후 실제 파일 정리(best-effort)
    const [exImgs, promos] = await Promise.all([
      prisma.exhibitionImage.findMany({ where: { exhibitionId: exhibition.id }, select: { url: true } }),
      prisma.promoPhoto.findMany({ where: { exhibitionId: exhibition.id }, select: { url: true } }),
    ]);
    // cascade로 Application, PromoPhoto, Favorite도 자동 삭제 (schema에 onDelete: Cascade 설정됨)
    await prisma.exhibition.delete({ where: { id: exhibition.id } });
    void deleteUploadedFiles([...exImgs.map((i) => i.url), ...promos.map((p) => p.url), (exhibition as any).imageUrl]);
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
        customAnswers: safeJson(app.customAnswers, []),
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
    const validStatuses = ['SUBMITTED', 'ACCEPTED', 'REJECTED']; // 검토중(REVIEWED) 폐지
    if (!validStatuses.includes(status)) {
      throw new AppError('유효하지 않은 상태입니다.', 400);
    }

    const application = await prisma.application.findUnique({ where: { id: appId } });
    if (!application || application.exhibitionId !== exhibitionId) {
      throw new AppError('지원 내역을 찾을 수 없습니다.', 404);
    }

    // 동일 상태 재적용은 변경 없음 → 알림 중복 발송 방지 (일괄 상태변경에서 특히 중요)
    if (application.status === status) {
      return res.json(application);
    }

    // 전이 규칙: 수락은 최종(변경 불가), 거절은 수락으로만 변경 가능. (레거시 REVIEWED는 접수로 간주)
    // 예외: Admin 개발자 도구(allowAcceptedRevert) ON이면 전체 갤러리가 수락→거절 되돌리기 가능.
    const current = application.status === 'REVIEWED' ? 'SUBMITTED' : application.status;
    let acceptedRevert = false;
    if (current !== status) {
      if (current === 'ACCEPTED') {
        const revertAllowed = status === 'REJECTED' && (await getSettingBool(ALLOW_ACCEPTED_REVERT));
        if (!revertAllowed) {
          throw new AppError('수락한 지원은 상태를 변경할 수 없습니다.', 400);
        }
        // 정산 완료 후에는 판매/정산 기록이 확정된 상태라 되돌리기 불가
        if (exhibition.settledAt) {
          throw new AppError('정산이 완료된 공모는 수락을 되돌릴 수 없습니다.', 400);
        }
        acceptedRevert = true;
      }
      if (current === 'REJECTED' && status !== 'ACCEPTED') {
        throw new AppError('거절한 지원은 수락으로만 변경할 수 있습니다.', 400);
      }
    }

    let updated;
    if (acceptedRevert) {
      // 수락→거절 되돌리기: 해당 작가의 운영페이지 제출물·판매기록·정산 데이터를 함께 삭제해
      // 정원/제출현황/정산이 수락 이전으로 정상화되도록 한다. (지원 이력 자체는 거절 상태로 유지 → 정원 슬롯은 자동 복구)
      const sub = await prisma.exhibitionSubmission.findUnique({
        where: { exhibitionId_userId: { exhibitionId, userId: application.userId } },
      });
      [updated] = await prisma.$transaction([
        prisma.application.update({ where: { id: appId }, data: { status } }),
        prisma.exhibitionSubmission.deleteMany({ where: { exhibitionId, userId: application.userId } }),
        prisma.artworkSale.deleteMany({ where: { exhibitionId, artistUserId: application.userId } }),
        prisma.artistSettlement.deleteMany({ where: { exhibitionId, artistUserId: application.userId } }),
        prisma.settlementApproval.deleteMany({ where: { exhibitionId, artistUserId: application.userId } }),
      ]);
      if (sub?.artworkList) {
        try {
          const list = JSON.parse(sub.artworkList) as { image?: string }[];
          void deleteUploadedFiles(list.map((a) => a.image)); // orphan 방지
        } catch { /* 파일 정리는 best-effort */ }
      }
    } else {
      updated = await prisma.application.update({
        where: { id: appId },
        // 상태가 더 이상 거절이 아니면 거절확인 플래그 해제
        data: { status, ...(status !== 'REJECTED' ? { rejectionAckedAt: null } : {}) },
      });
    }

    // 지원 상태 변경 → Artist에게 알림
    const statusLabels: Record<string, string> = { SUBMITTED: '접수', ACCEPTED: '수락', REJECTED: '거절' };
    // 수락 시: 운영 페이지에서 전시정보 입력 안내 + 운영 페이지로 바로 이동
    const accepted = status === 'ACCEPTED';
    const message = accepted
      ? `"${exhibition.title}" 공모에 수락되었습니다! 운영 페이지에서 전시 정보를 입력해주세요.`
      : `"${exhibition.title}" 공모 지원 상태가 '${statusLabels[status] || status}'(으)로 변경되었습니다.`;
    try {
      await prisma.notification.create({
        data: {
          userId: application.userId,
          type: 'APPLICATION_STATUS',
          message,
          linkUrl: accepted ? `/exhibitions/${exhibitionId}/operation/new` : `/exhibitions/${exhibitionId}`,
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
    const safeUrl = safeFileUrl(url);
    if (!safeUrl) throw new AppError('유효한 이미지 URL이 아닙니다.', 400);
    const photo = await prisma.promoPhoto.create({
      data: { url: safeUrl, caption, exhibitionId: exhibition.id }
    });
    res.status(201).json(photo);
  } catch (error) { next(error); }
});

// 홍보 사진 삭제 (해당 공모 소유자만, 사진이 그 공모 소속인지 확인)
router.delete('/:id/promo-photos/:photoId', authenticate, authorize('GALLERY'), async (req, res, next) => {
  try {
    const exhibitionId = parseInt(req.params.id as string);
    const photoId = parseInt(req.params.photoId as string);
    const exhibition = await prisma.exhibition.findUnique({
      where: { id: exhibitionId },
      include: { gallery: { select: { ownerId: true } } },
    });
    if (!exhibition) throw new AppError('공모를 찾을 수 없습니다.', 404);
    if (exhibition.gallery.ownerId !== req.user!.id) throw new AppError('권한이 없습니다.', 403);
    const photo = await prisma.promoPhoto.findFirst({ where: { id: photoId, exhibitionId } });
    if (!photo) throw new AppError('사진을 찾을 수 없습니다.', 404);
    await prisma.promoPhoto.delete({ where: { id: photoId } });
    void deleteUploadedFile(photo.url); // orphan 방지
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
    void deleteUploadedFile(target.url); // orphan 방지
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
