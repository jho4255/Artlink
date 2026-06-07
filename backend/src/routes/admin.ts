import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { galleryApplicationStats } from '../lib/applicationStats';

const router = Router();

const VALID_ROLES = ['ADMIN', 'ARTIST', 'GALLERY'];

/**
 * 사용자 검색 (ADMIN 전용) — 이메일/이름 부분일치, 최대 50명
 * GET /api/admin/users?q=검색어
 */
router.get('/users', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const q = ((req.query.q as string) || '').trim();
    const users = await prisma.user.findMany({
      where: q
        ? { OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
          ] }
        : undefined,
      select: { id: true, email: true, name: true, role: true, provider: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(users);
  } catch (error) { next(error); }
});

/**
 * 역할 변경 (ADMIN 전용)
 * PATCH /api/admin/users/:id/role  body: { role: 'ADMIN' | 'ARTIST' | 'GALLERY' }
 * - 본인 역할은 변경 불가 (자기 권한 잠금 방지)
 */
router.patch('/users/:id/role', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const { role } = req.body;
    if (!VALID_ROLES.includes(role)) throw new AppError('유효하지 않은 역할입니다.', 400);
    if (id === req.user!.id) throw new AppError('본인의 역할은 변경할 수 없습니다.', 400);

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new AppError('사용자를 찾을 수 없습니다.', 404);
    // 관리자 계정은 다른 관리자가 강등/변경할 수 없음 (관리자 보호)
    if (target.role === 'ADMIN') throw new AppError('관리자 계정의 역할은 변경할 수 없습니다.', 403);

    const updated = await prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, email: true, name: true, role: true, provider: true },
    });
    res.json(updated);
  } catch (error) { next(error); }
});

// ========== 운영 조회 (ADMIN 전용): 지원 현황 / 작가 지원이력 / 갤러리 게시물 ==========

const APP_STATUSES = ['SUBMITTED', 'REVIEWED', 'ACCEPTED', 'REJECTED'];

/** 상태별 카운트 헬퍼 */
function countByStatus(apps: { status: string }[]) {
  const counts: Record<string, number> = { ALL: apps.length };
  for (const s of APP_STATUSES) counts[s] = 0;
  for (const a of apps) counts[a.status] = (counts[a.status] || 0) + 1;
  return counts;
}

/**
 * 전체 공모 목록 (ADMIN 전용) — 제목 검색/갤러리 필터, 지원자 수 포함
 * GET /api/admin/exhibitions?q=&galleryId=
 */
router.get('/exhibitions', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const q = ((req.query.q as string) || '').trim();
    const galleryId = req.query.galleryId ? parseInt(req.query.galleryId as string) : undefined;
    const where: any = {};
    if (q) where.title = { contains: q, mode: 'insensitive' };
    if (galleryId) where.galleryId = galleryId;

    const exhibitions = await prisma.exhibition.findMany({
      where,
      select: {
        id: true, title: true, type: true, status: true, deadline: true, createdAt: true,
        gallery: { select: { id: true, name: true } },
        _count: { select: { applications: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(exhibitions);
  } catch (error) { next(error); }
});

/**
 * 특정 공모의 지원 현황 (ADMIN 전용) — 지원자 + 상태 + 결정시각 + 커스텀답변
 * GET /api/admin/exhibitions/:id/applications
 */
router.get('/exhibitions/:id/applications', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const exhibitionId = parseInt(req.params.id as string);
    const exhibition = await prisma.exhibition.findUnique({
      where: { id: exhibitionId },
      select: {
        id: true, title: true, type: true, status: true, capacity: true, deadline: true,
        gallery: { select: { id: true, name: true } },
      },
    });
    if (!exhibition) throw new AppError('공모를 찾을 수 없습니다.', 404);

    const applications = await prisma.application.findMany({
      where: { exhibitionId },
      include: { user: { select: { id: true, name: true, nickname: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // 갤러리 단위 지원 횟수/순번/첫지원 여부
    const stats = await galleryApplicationStats(exhibition.gallery.id, applications.map(a => a.userId));

    const safe = (raw: string | null, fb: any) => { if (!raw) return fb; try { return JSON.parse(raw); } catch { return fb; } };
    const parsed = applications.map((app: any) => ({
      id: app.id,
      status: app.status,
      appliedAt: app.createdAt,
      decidedAt: app.updatedAt,
      user: app.user,
      biography: app.biography ?? null,
      career: safe(app.career, null),
      artworkImages: safe(app.artworkImages, []),
      portfolioFileUrl: app.portfolioFileUrl ?? null,
      ...(stats.get(app.id) ?? { galleryApplicationCount: 1, galleryApplicationOrder: 1, isFirstApplication: true }),
    }));

    res.json({ exhibition, counts: countByStatus(applications), applications: parsed });
  } catch (error) { next(error); }
});

/**
 * 특정 사용자(작가)의 지원 이력 (ADMIN 전용) — 어떤 공모에 지원하고 수락/거절됐는지
 * GET /api/admin/users/:id/applications
 */
router.get('/users/:id/applications', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id as string);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, nickname: true, email: true, role: true },
    });
    if (!user) throw new AppError('사용자를 찾을 수 없습니다.', 404);

    const applications = await prisma.application.findMany({
      where: { userId },
      select: {
        id: true, status: true, createdAt: true, updatedAt: true,
        exhibition: {
          select: { id: true, title: true, gallery: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const history = applications.map((a) => ({
      id: a.id,
      status: a.status,
      appliedAt: a.createdAt,
      decidedAt: a.updatedAt,
      exhibition: a.exhibition ? { id: a.exhibition.id, title: a.exhibition.title } : null,
      gallery: a.exhibition?.gallery ?? null,
    }));

    res.json({ user, counts: countByStatus(applications), applications: history });
  } catch (error) { next(error); }
});

/**
 * 갤러리 검색 (ADMIN 전용) — 이름 부분일치, 공모/전시 수 포함
 * GET /api/admin/galleries?q=
 */
router.get('/galleries', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const q = ((req.query.q as string) || '').trim();
    const galleries = await prisma.gallery.findMany({
      where: q ? { name: { contains: q, mode: 'insensitive' } } : undefined,
      select: {
        id: true, name: true, region: true, status: true, ownerName: true, createdAt: true,
        owner: { select: { id: true, name: true, email: true } },
        _count: { select: { exhibitions: true, shows: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(galleries);
  } catch (error) { next(error); }
});

/**
 * 갤러리가 올린 모든 공모 + 전시 (ADMIN 전용) — 상태 무관 전체 이력
 * GET /api/admin/galleries/:id/posts
 */
router.get('/galleries/:id/posts', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const galleryId = parseInt(req.params.id as string);
    const gallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      select: { id: true, name: true, ownerName: true },
    });
    if (!gallery) throw new AppError('갤러리를 찾을 수 없습니다.', 404);

    const [exhibitions, shows] = await Promise.all([
      prisma.exhibition.findMany({
        where: { galleryId },
        select: {
          id: true, title: true, type: true, status: true, deadline: true, createdAt: true,
          _count: { select: { applications: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.show.findMany({
        where: { galleryId },
        select: { id: true, title: true, status: true, startDate: true, endDate: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    res.json({ gallery, exhibitions, shows });
  } catch (error) { next(error); }
});

export default router;
