import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, optionalAuth } from '../middleware/auth';

const router = Router();

// (id, seed) → 결정적 의사난수. seed가 다르면 순서가 바뀜(매번/새로고침 시 랜덤 정렬).
function shuffleHash(id: number, seed: number): number {
  let h = (id ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// 좋아요순 기간 필터 시작 시각 (없으면 전체 기간)
function periodSince(period: string): Date | null {
  const days: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };
  if (!(period in days)) return null; // 'all' 등
  return new Date(Date.now() - days[period] * 86400000);
}

// 같은 작가 작품이 연속(두 개 이상)으로 나오지 않도록 재배치.
// 각 작가 큐의 셔플 순서는 유지하되, 매 단계 "남은 수가 가장 많은(≠직전) 작가"를 골라 배치(막다른 배치 방지).
// 동수일 땐 입력(셔플) 순서를 따르므로 seed가 바뀌면 전체 배치도 달라진다.
function arrangeNoAdjacent<T>(items: T[], artistOf: (t: T) => number): T[] {
  const groups = new Map<number, T[]>();
  for (const it of items) {
    const a = artistOf(it);
    if (!groups.has(a)) groups.set(a, []);
    groups.get(a)!.push(it);
  }
  const result: T[] = [];
  let last = -1;
  while (result.length < items.length) {
    let bestA = -1, bestLen = -1;
    for (const [a, q] of groups) {
      if (q.length === 0 || a === last) continue;
      if (q.length > bestLen) { bestLen = q.length; bestA = a; }
    }
    if (bestA === -1) { // 직전 작가만 남음(불가피)
      for (const [a, q] of groups) if (q.length > 0) { bestA = a; break; }
    }
    result.push(groups.get(bestA)!.shift()!);
    last = bestA;
  }
  return result;
}

// GET / — 공개 탐색 피드 (Explore)
//   sort=random&seed=N : 시드 기반 랜덤 + 같은 작가 연속 방지 (기본)
//   sort=popular&period=day|week|month|year|all : 기간 내 받은 좋아요 수 내림차순
// 정렬/분산은 전체 후보 기준으로 계산 후 페이지 슬라이스 → 무한스크롤 페이지 경계에서도 규칙 유지.
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 30, 1), 60);
    const skip = (page - 1) * limit;
    const userId = req.user?.id;
    const sort = req.query.sort === 'popular' ? 'popular' : 'random';
    const seed = (Math.abs(parseInt(req.query.seed as string)) || 1) >>> 0;
    const period = String(req.query.period || 'all');

    // 탈퇴(deletedAt) 작가의 이미지는 탐색 피드에서 제외
    const feedWhere = { showInExplore: true, portfolio: { user: { deletedAt: null } } };

    // 전체 후보(id + 작가id)만 가볍게 조회 → 전체 기준으로 정렬/분산
    const candidates = await prisma.portfolioImage.findMany({
      where: feedWhere,
      select: { id: true, portfolio: { select: { userId: true } } },
    });
    const total = candidates.length;

    let orderedIds: number[];
    if (sort === 'popular') {
      // 기간 내 좋아요 집계 (period=all 이면 전체 기간)
      const since = periodSince(period);
      const grouped = await prisma.portfolioImageLike.groupBy({
        by: ['imageId'],
        where: since ? { createdAt: { gte: since } } : {},
        _count: { imageId: true },
      });
      const cnt = new Map<number, number>(grouped.map(g => [g.imageId, g._count.imageId]));
      orderedIds = candidates
        .map(c => ({ id: c.id, c: cnt.get(c.id) || 0 }))
        .sort((a, b) => b.c - a.c || b.id - a.id) // 좋아요 많은 순, 동수는 최신(id) 순
        .map(x => x.id);
    } else {
      // 시드 셔플 후 같은 작가 연속 방지
      const shuffled = [...candidates].sort((a, b) => shuffleHash(a.id, seed) - shuffleHash(b.id, seed));
      orderedIds = arrangeNoAdjacent(shuffled, c => c.portfolio.userId).map(c => c.id);
    }

    const pageIds = orderedIds.slice(skip, skip + limit);

    // 해당 페이지 이미지 상세 조회 후 pageIds 순서대로 복원
    const imgs = pageIds.length === 0 ? [] : await prisma.portfolioImage.findMany({
      where: { id: { in: pageIds } },
      include: {
        portfolio: { include: { user: { select: { id: true, name: true, nickname: true, avatar: true } } } },
        _count: { select: { likes: true } },
        ...(userId ? { likes: { where: { userId }, select: { id: true } } } : {}),
      },
    });
    const byId = new Map(imgs.map(i => [i.id, i]));
    const images = pageIds
      .map(id => byId.get(id))
      .filter((i): i is NonNullable<typeof i> => !!i)
      .map(img => ({
        id: img.id,
        url: img.url,
        artist: img.portfolio.user,
        likeCount: img._count.likes, // 배지는 항상 전체 좋아요 수
        isLiked: userId ? (img as any).likes?.length > 0 : false,
      }));

    res.json({ images, total, page, limit });
  } catch (err) { next(err); }
});

// POST /:imageId/like — 좋아요 토글
router.post('/:imageId/like', authenticate, async (req, res, next) => {
  try {
    const imageId = parseInt(req.params.imageId as string);
    const userId = req.user!.id;

    const image = await prisma.portfolioImage.findUnique({ where: { id: imageId } });
    if (!image || !image.showInExplore) {
      return res.status(404).json({ error: '이미지를 찾을 수 없습니다.' });
    }

    const existing = await prisma.portfolioImageLike.findUnique({
      where: { userId_imageId: { userId, imageId } },
    });

    // 더블클릭 레이스를 멱등 처리: P2002(중복 생성)/P2025(없는 행 삭제)는 최종 상태로 수렴하므로 무시
    try {
      if (existing) {
        await prisma.portfolioImageLike.delete({ where: { id: existing.id } });
      } else {
        await prisma.portfolioImageLike.create({ data: { userId, imageId } });
      }
    } catch (e: any) {
      if (e?.code !== 'P2002' && e?.code !== 'P2025') throw e;
    }

    const likeCount = await prisma.portfolioImageLike.count({ where: { imageId } });
    res.json({ liked: !existing, likeCount });
  } catch (err) { next(err); }
});

// GET /:imageId/likes — 좋아요 누른 사용자 목록 (이미지 소유자만 상세 조회)
router.get('/:imageId/likes', optionalAuth, async (req, res, next) => {
  try {
    const imageId = parseInt(req.params.imageId as string);
    const userId = req.user?.id;

    const image = await prisma.portfolioImage.findUnique({
      where: { id: imageId },
      include: { portfolio: { select: { userId: true } } },
    });
    if (!image) {
      return res.status(404).json({ error: '이미지를 찾을 수 없습니다.' });
    }

    const likeCount = await prisma.portfolioImageLike.count({ where: { imageId } });
    const isOwner = userId === image.portfolio.userId;

    if (isOwner) {
      const likers = await prisma.portfolioImageLike.findMany({
        where: { imageId },
        include: { user: { select: { id: true, name: true, nickname: true, avatar: true } } },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ likeCount, likers: likers.map(l => l.user) });
    } else {
      res.json({ likeCount, likers: [] });
    }
  } catch (err) { next(err); }
});

export default router;
