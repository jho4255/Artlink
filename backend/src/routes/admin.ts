import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { galleryApplicationStats } from '../lib/applicationStats';
import { getSettingBool, setSettingBool, ALLOW_ACCEPTED_REVERT } from '../lib/appSettings';
import { dailyVisitorStats, memberVisitSummary, visitedTodayWhere } from '../lib/visitStats';
import { dailyExportStats } from '../lib/exportStats';
import { guestStats } from '../lib/guestActivity';
import { todoCounts, adminExhibitionRows } from '../lib/adminConsole';
import { clampDays, statsSummary, statsMembers, statsCalls, statsGalleries, statsUsage } from '../lib/adminStats';
import { filledCount, hasCaption, hasCareer, MIN_WORKS } from '../lib/artistCompleteness';
import { kstDay } from '../lib/visitStats';

const router = Router();

const VALID_ROLES = ['ADMIN', 'ARTIST', 'GALLERY', 'VISITOR'];

/**
 * 사용자 검색 (ADMIN 전용) — 이메일/이름 부분일치, 최대 100명
 * GET /api/admin/users?q=검색어&role=ARTIST|GALLERY|ADMIN
 *     &visited=today  → 오늘(KST) 방문한 회원만(Admin 제외 — [통계] 탭 일간 방문자의 '회원' 수와 같은 사람들), 최근 접속 순
 * 응답의 사용자마다 `visitDays7`(최근 7일 중 방문한 날 수) · `visitedToday` · `todayFirstAt`(오늘 처음 들어온 시각)을 붙인다.
 */
router.get('/users', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const q = ((req.query.q as string) || '').trim();
    const role = ((req.query.role as string) || '').trim();
    if (role && !VALID_ROLES.includes(role)) throw new AppError('유효하지 않은 역할입니다.', 400);
    const visited = ((req.query.visited as string) || '').trim();
    if (visited && visited !== 'today') throw new AppError('visited 는 today 만 됩니다.', 400);
    // 표 모드(2026-11-21 [사용자 관리] 개편) — paged=1 이면 { rows, total, counts } 로 준다. 옛 배열 응답은 다른 화면(필진 찾기 등)이 쓴다
    if (req.query.paged === '1') return res.json(await pagedUsers(req.query as Record<string, string>, q, role, visited));
    const PAGE_SIZE = 100;
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10) || 1);
    const where: any = visited === 'today' ? visitedTodayWhere() : {};
    if (role) where.role = role;
    if (q) {
      where.OR = [
        { email: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
      ];
    }
    const users = await prisma.user.findMany({
      where,
      select: {
        id: true, email: true, name: true, role: true, provider: true, createdAt: true, lastSeenAt: true,
        galleries: {
          select: { id: true, name: true, status: true },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: visited === 'today' ? [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }] : { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });
    const visits = await memberVisitSummary(users.map((u) => u.id));
    res.json(users.map((u) => ({ ...u, ...(visits.get(u.id) ?? { visitDays7: 0, visitedToday: false, todayFirstAt: null }) })));
  } catch (error) { next(error); }
});

export const USERS_PAGE_SIZE = 50;
const USER_FILTERS = ['noWorks', 'neverApplied', 'newThisWeek'] as const;
const USER_SORTS = ['recent', 'lastSeen', 'name'] as const;

/**
 * [사용자 관리] 표 — 역할 탭 · 찾기(이름·이메일·닉네임·@주소) · 걸러 보기 · 정렬 · 50명씩.
 * 줄마다 최근 7일 방문한 날(칸 일곱) · 작품 수 · 지원(전체·수락·검토 대기) · 가진 갤러리.
 */
async function pagedUsers(query: Record<string, string>, q: string, role: string, visited: string) {
  const filter = (USER_FILTERS as readonly string[]).includes(query.filter) ? query.filter : '';
  const sort = (USER_SORTS as readonly string[]).includes(query.sort) ? query.sort : 'recent';
  const page = Math.max(1, parseInt(query.page || '1', 10) || 1);
  const now = new Date();
  const search: any = q ? {
    OR: [
      { email: { contains: q, mode: 'insensitive' } },
      { name: { contains: q, mode: 'insensitive' } },
      { nickname: { contains: q, mode: 'insensitive' } },
      { handle: { contains: q.replace(/^@/, '').toLowerCase() } },
    ],
  } : {};
  const scope: any = visited === 'today' ? { ...visitedTodayWhere(now), ...search } : { ...(role ? { role } : {}), ...search };
  const filterWhere: Record<string, any> = {
    noWorks: { role: 'ARTIST', OR: [{ portfolio: null }, { portfolio: { images: { none: {} } } }] },
    neverApplied: { role: 'ARTIST', applications: { none: {} } },
    newThisWeek: { createdAt: { gte: new Date(now.getTime() - 7 * 86400000) } },
  };
  const where = filter ? { AND: [scope, filterWhere[filter]] } : scope;
  const orderBy: any = visited === 'today' || sort === 'lastSeen'
    ? [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }]
    : sort === 'name' ? [{ name: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }];

  const [total, rows, roleCounts, today, filterCounts] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where, orderBy, skip: (page - 1) * USERS_PAGE_SIZE, take: USERS_PAGE_SIZE,
      select: {
        id: true, email: true, name: true, nickname: true, handle: true, role: true, provider: true, createdAt: true, lastSeenAt: true, deletedAt: true,
        galleries: { select: { id: true, name: true, status: true }, orderBy: { createdAt: 'desc' } },
        portfolio: { select: { _count: { select: { images: true } } } },
      },
    }),
    prisma.user.groupBy({ by: ['role'], where: search, _count: { _all: true } }),
    prisma.user.count({ where: { ...visitedTodayWhere(now), ...search } }),
    Promise.all(USER_FILTERS.map((f) => prisma.user.count({ where: { AND: [scope, filterWhere[f]] } }))),
  ]);
  const ids = rows.map((u) => u.id);
  const [apps, visits] = await Promise.all([
    prisma.application.groupBy({ by: ['userId', 'status'], where: { userId: { in: ids } }, _count: { _all: true } }),
    prisma.dailyVisit.findMany({ where: { userId: { in: ids }, day: { gte: new Date(kstDay(now).getTime() - 6 * 86400000) } }, select: { userId: true, day: true, createdAt: true } }),
  ]);
  const todayKey = kstDay(now).getTime();
  const appBy = new Map<number, { total: number; accepted: number; pending: number; rejected: number }>();
  for (const a of apps) {
    const r = appBy.get(a.userId) ?? { total: 0, accepted: 0, pending: 0, rejected: 0 };
    r.total += a._count._all;
    if (a.status === 'ACCEPTED') r.accepted += a._count._all;
    else if (a.status === 'REJECTED') r.rejected += a._count._all;
    else r.pending += a._count._all;
    appBy.set(a.userId, r);
  }
  const days = new Map<number, boolean[]>();
  const firstToday = new Map<number, Date>();
  for (const v of visits) {
    if (v.userId == null) continue;
    const arr = days.get(v.userId) ?? Array(7).fill(false);
    const idx = 6 - Math.round((todayKey - v.day.getTime()) / 86400000);
    if (idx >= 0 && idx < 7) arr[idx] = true;
    days.set(v.userId, arr);
    if (idx === 6 && (!firstToday.get(v.userId) || v.createdAt < firstToday.get(v.userId)!)) firstToday.set(v.userId, v.createdAt);
  }
  return {
    page, pageSize: USERS_PAGE_SIZE, total,
    counts: {
      ALL: roleCounts.reduce((n, r) => n + r._count._all, 0),
      ...Object.fromEntries(roleCounts.map((r) => [r.role, r._count._all])),
      TODAY: today,
    },
    filterCounts: Object.fromEntries(USER_FILTERS.map((f, i) => [f, filterCounts[i]])),
    rows: rows.map((u) => {
      const d = days.get(u.id) ?? Array(7).fill(false);
      return {
        ...u,
        portfolio: undefined,
        works: u.portfolio?._count.images ?? 0,
        applications: appBy.get(u.id) ?? { total: 0, accepted: 0, pending: 0, rejected: 0 },
        visitDays: d,
        visitDays7: d.filter(Boolean).length,
        todayFirstAt: firstToday.get(u.id) ?? null,
      };
    }),
  };
}

/**
 * 회원 한 명 (ADMIN 전용, 2026-11-21) — [사용자 관리]의 옆 칸 / 휴대폰 창.
 * 접속·방문 · (작가) 홈페이지 채운 정도 · 활동 · 지원 이력 · (갤러리) 가진 갤러리와 게시물 수.
 * 옛 [운영 조회 > 작가 지원이력] 이 여기로 들어왔다.
 */
router.get('/users/:id/summary', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    if (!Number.isFinite(id)) throw new AppError('사용자를 찾을 수 없습니다.', 404);
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, email: true, name: true, nickname: true, handle: true, role: true, provider: true, avatar: true,
        createdAt: true, lastSeenAt: true, deletedAt: true, emailVerifiedAt: true,
        portfolio: {
          select: {
            statement: true, biography: true, career: true,
            images: { select: { title: true, medium: true, sizeText: true, year: true, showInExplore: true } },
          },
        },
        galleries: {
          select: { id: true, name: true, status: true, handle: true, createdAt: true, viewCount: true, _count: { select: { exhibitions: true, shows: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!user) throw new AppError('사용자를 찾을 수 없습니다.', 404);
    const now = new Date();
    const today = kstDay(now).getTime();
    const [visitRows, likes, following, followers, stories, posts, exports, favorites, applications] = await Promise.all([
      prisma.dailyVisit.findMany({ where: { userId: id, day: { gte: new Date(today - 29 * 86400000) } }, select: { day: true } }),
      prisma.portfolioImageLike.count({ where: { userId: id } }),
      prisma.follow.count({ where: { followerId: id } }),
      prisma.follow.count({ where: { followingId: id } }),
      prisma.story.count({ where: { authorId: id } }),
      prisma.post.count({ where: { authorId: id } }),
      prisma.portfolioExport.count({ where: { userId: id } }),
      prisma.favorite.count({ where: { userId: id } }),
      prisma.application.findMany({
        where: { userId: id },
        select: {
          id: true, status: true, createdAt: true, updatedAt: true, joinedVia: true,
          exhibition: { select: { id: true, title: true, hostType: true, gallery: { select: { id: true, name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const daySet = new Set(visitRows.map((v) => v.day.getTime()));
    const days7 = [...daySet].filter((t) => t >= today - 6 * 86400000).length;
    const p = user.portfolio;
    const images = p?.images ?? [];
    const homepage = user.role === 'ARTIST' ? {
      works: images.length,
      captioned: images.filter(hasCaption).length,
      inExplore: images.filter((i) => i.showInExplore).length,
      hasStatement: !!String(p?.statement ?? '').trim(),
      hasBio: !!String(p?.biography ?? '').trim() || hasCareer(p?.career),
      filled: p ? filledCount({ statement: p.statement, biography: p.biography, career: p.career, images }) : 0,
      minWorks: MIN_WORKS,
    } : null;
    const counts = { total: applications.length, ACCEPTED: 0, REJECTED: 0, SUBMITTED: 0 } as Record<string, number>;
    for (const a of applications) {
      const k = a.status === 'ACCEPTED' || a.status === 'REJECTED' ? a.status : 'SUBMITTED';
      counts[k] += 1;
    }
    res.json({
      user: { ...user, portfolio: undefined },
      visits: { days7, days30: daySet.size },
      homepage,
      activity: { likes, following, followers, stories, posts, exports, favorites },
      applications: applications.map((a) => ({
        id: a.id, status: a.status, appliedAt: a.createdAt, decidedAt: a.status === 'SUBMITTED' || a.status === 'REVIEWED' ? null : a.updatedAt,
        joinedVia: a.joinedVia,
        exhibition: a.exhibition ? { id: a.exhibition.id, title: a.exhibition.title, hostType: a.exhibition.hostType } : null,
        gallery: a.exhibition?.gallery ?? null,
      })),
      applicationCounts: counts,
    });
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

const APP_STATUSES = ['SUBMITTED', 'ACCEPTED', 'REJECTED'];

/** 상태별 카운트 헬퍼 */
function countByStatus(apps: { status: string }[]) {
  const counts: Record<string, number> = { ALL: apps.length };
  for (const s of APP_STATUSES) counts[s] = 0;
  for (const a of apps) counts[a.status] = (counts[a.status] || 0) + 1;
  return counts;
}

/**
 * 전체 공모 목록 (ADMIN 전용) — [운영 조회]의 공모 표(2026-11-21: 단계 재료 · 숫자 · 멈춘 사정)
 * GET /api/admin/exhibitions?q=
 */
router.get('/exhibitions', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const q = ((req.query.q as string) || '').trim();
    res.json(await adminExhibitionRows({ q }));
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
    // 갤러리 없는 아트링크 주최 공모면 빈 Map (갤러리 단위 통계가 성립하지 않는다)
    const stats = await galleryApplicationStats(exhibition.gallery?.id, applications.map(a => a.userId));

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

    const [row] = await adminExhibitionRows({ ids: [exhibitionId] });
    res.json({ exhibition, row: row ?? null, counts: countByStatus(applications), applications: parsed });
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
    // 페이지네이션: 1-based page 쿼리 → skip 적용. page 미지정 시 1페이지처럼 동작(하위호환).
    // 프론트가 순수 배열을 기대하므로 응답 형태는 배열 유지, page만 존중.
    const PAGE_SIZE = 50;
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10) || 1);
    const galleries = await prisma.gallery.findMany({
      where: q ? { name: { contains: q, mode: 'insensitive' } } : undefined,
      select: {
        id: true, name: true, region: true, status: true, ownerName: true, createdAt: true, handle: true, viewCount: true, mainImage: true, address: true,
        owner: { select: { id: true, name: true, email: true, lastSeenAt: true, emailVerifiedAt: true, provider: true } },
        _count: { select: { exhibitions: true, shows: true, reviews: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
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
      select: { id: true, name: true, ownerName: true, status: true, region: true, address: true, handle: true, viewCount: true, createdAt: true, mainImage: true,
        owner: { select: { id: true, name: true, email: true, lastSeenAt: true } } },
    });
    if (!gallery) throw new AppError('갤러리를 찾을 수 없습니다.', 404);

    const [exhibitions, shows] = await Promise.all([
      prisma.exhibition.findMany({
        where: { galleryId },
        select: {
          id: true, title: true, type: true, status: true, deadline: true, createdAt: true, hostType: true, viewCount: true,
          _count: { select: { applications: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.show.findMany({
        where: { galleryId },
        select: { id: true, title: true, status: true, startDate: true, endDate: true, createdAt: true, viewCount: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    res.json({ gallery, exhibitions, shows });
  } catch (error) { next(error); }
});

/**
 * 전체 전시 목록 (ADMIN 전용, 2026-11-21) — [운영 조회]의 전시 탭. 상태 무관
 * GET /api/admin/shows?q=
 */
router.get('/shows', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const q = ((req.query.q as string) || '').trim();
    const shows = await prisma.show.findMany({
      where: q ? { title: { contains: q, mode: 'insensitive' } } : undefined,
      select: {
        id: true, title: true, status: true, region: true, startDate: true, endDate: true, posterImage: true, viewCount: true, createdAt: true, reviewedAt: true,
        gallery: { select: { id: true, name: true } },
        _count: { select: { favorites: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    res.json(shows);
  } catch (error) { next(error); }
});

/**
 * 처리할 일 수 (ADMIN 전용, 2026-11-21) — 메뉴 배지 · 통계 [요약] '지금 처리할 일'.
 * GET /api/admin/todo-counts
 */
router.get('/todo-counts', authenticate, authorize('ADMIN'), async (_req, res, next) => {
  try {
    res.json(await todoCounts());
  } catch (error) { next(error); }
});

/**
 * [통계] 탭(2026-11-21 개편) — 요약 · 회원 · 공모·지원 · 갤러리·전시 · 기능 사용. ?days=1~180(기본 30)
 * 같은 기간은 1분 저장한다(lib/adminStats.ts).
 */
router.get('/stats/summary', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try { res.json(await statsSummary(clampDays(req.query.days))); } catch (error) { next(error); }
});
router.get('/stats/members', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try { res.json(await statsMembers(clampDays(req.query.days))); } catch (error) { next(error); }
});
router.get('/stats/calls', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try { res.json(await statsCalls(clampDays(req.query.days))); } catch (error) { next(error); }
});
router.get('/stats/galleries', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try { res.json(await statsGalleries(clampDays(req.query.days))); } catch (error) { next(error); }
});
router.get('/stats/usage', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try { res.json(await statsUsage(clampDays(req.query.days))); } catch (error) { next(error); }
});

/**
 * 페이지별 상세 조회수 통계 (ADMIN 전용)
 * GET /api/admin/view-stats
 * - 갤러리 상세 / 모집공고(공모) 상세 / 전시 상세 각각의 조회수를 내림차순으로 반환
 * - 조회수는 비-관리자·비-소유자의 상세 페이지 진입 시 누적됨 (lib/viewCount)
 */
router.get('/view-stats', authenticate, authorize('ADMIN'), async (_req, res, next) => {
  try {
    const [galleries, exhibitions, shows] = await Promise.all([
      prisma.gallery.findMany({
        select: { id: true, name: true, status: true, viewCount: true },
        orderBy: [{ viewCount: 'desc' }, { id: 'asc' }],
      }),
      prisma.exhibition.findMany({
        select: {
          id: true, title: true, type: true, status: true, viewCount: true,
          gallery: { select: { name: true } },
        },
        orderBy: [{ viewCount: 'desc' }, { id: 'asc' }],
      }),
      prisma.show.findMany({
        select: {
          id: true, title: true, status: true, viewCount: true,
          gallery: { select: { name: true } },
        },
        orderBy: [{ viewCount: 'desc' }, { id: 'asc' }],
      }),
    ]);

    // 합계도 함께 제공하여 대시보드에서 총 조회수를 표시할 수 있게 한다.
    const sum = (arr: { viewCount: number }[]) => arr.reduce((acc, r) => acc + r.viewCount, 0);
    res.json({
      galleries: galleries.map((g) => ({ id: g.id, name: g.name, status: g.status, viewCount: g.viewCount })),
      exhibitions: exhibitions.map((e) => ({
        id: e.id, title: e.title, type: e.type, status: e.status,
        galleryName: e.gallery?.name ?? '', viewCount: e.viewCount,
      })),
      shows: shows.map((s) => ({
        id: s.id, title: s.title, status: s.status,
        galleryName: s.gallery?.name ?? '', viewCount: s.viewCount,
      })),
      totals: {
        galleries: sum(galleries),
        exhibitions: sum(exhibitions),
        shows: sum(shows),
      },
    });
  } catch (error) { next(error); }
});

// ========== 개발자 도구 (ADMIN 전용): 런타임 전역 플래그 토글 ==========

/**
 * GET /api/admin/stats/visitors?days=30 — 일간 방문자(회원/비회원). Admin [통계] 탭(2026-09-28).
 * 오늘(KST) 포함 최근 N일(1~180), 기록 없는 날은 0. `since` 는 집계를 시작한 날(그 전은 '기록 없음').
 * 세는 규칙은 `lib/visitStats.ts`(기기×날짜 한 줄, 회원=서로 다른 userId, Admin 제외).
 */
router.get('/stats/visitors', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const days = Number(req.query.days ?? 30);
    if (!Number.isFinite(days) || days < 1) throw new AppError('기간이 올바르지 않습니다.', 400);
    res.json(await dailyVisitorStats(days));
  } catch (error) { next(error); }
});

/**
 * GET /api/admin/stats/portfolio-exports?days=30 — 포트폴리오 PDF 저장(날짜별 횟수·작가 수·방식). Admin [통계] 탭(2026-10-03).
 * 방문자 통계와 같은 모양: 오늘(KST) 포함 최근 N일(1~180), 기록 없는 날은 0, `since` = 집계 시작일. 규칙은 `lib/exportStats.ts`.
 */
router.get('/stats/portfolio-exports', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const days = Number(req.query.days ?? 30);
    if (!Number.isFinite(days) || days < 1) throw new AppError('기간이 올바르지 않습니다.', 400);
    res.json(await dailyExportStats(days));
  } catch (error) { next(error); }
});

/**
 * GET /api/admin/stats/guests?days=30 — 비회원 둘러보기(무엇을 보고 얼마나 머물렀는가). Admin [통계] 탭(2026-10-03).
 * 오늘(KST) 포함 최근 N일(1~90 — 기록은 90일만 둔다). 규칙은 `lib/guestActivity.ts`.
 */
router.get('/stats/guests', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const days = Number(req.query.days ?? 30);
    if (!Number.isFinite(days) || days < 1) throw new AppError('기간이 올바르지 않습니다.', 400);
    res.json(await guestStats(days));
  } catch (error) { next(error); }
});

/**
 * 개발자 도구 설정 조회
 * GET /api/admin/dev-settings
 * - allowAcceptedRevert: ON이면 전체 갤러리가 '수락'한 지원을 '거절'로 되돌릴 수 있음
 *   (되돌리면 해당 작가의 운영페이지 제출물/판매기록/정산 데이터가 삭제됨)
 */
router.get('/dev-settings', authenticate, authorize('ADMIN'), async (_req, res, next) => {
  try {
    res.json({ allowAcceptedRevert: await getSettingBool(ALLOW_ACCEPTED_REVERT) });
  } catch (error) { next(error); }
});

/**
 * 개발자 도구 설정 변경
 * PUT /api/admin/dev-settings  body: { allowAcceptedRevert: boolean }
 */
router.put('/dev-settings', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { allowAcceptedRevert } = req.body || {};
    if (typeof allowAcceptedRevert !== 'boolean') {
      throw new AppError('allowAcceptedRevert는 boolean이어야 합니다.', 400);
    }
    await setSettingBool(ALLOW_ACCEPTED_REVERT, allowAcceptedRevert);
    res.json({ allowAcceptedRevert });
  } catch (error) { next(error); }
});

export default router;
