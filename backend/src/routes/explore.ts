import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, authorize, optionalAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import logger from '../lib/logger';

const router = Router();

// 공개 노출 이름 — 닉네임 우선 (CLAUDE.md 공개 노출 정책)
const publicName = (u?: { name?: string | null; nickname?: string | null } | null) =>
  (u?.nickname?.trim() || u?.name || '누군가').trim();

/**
 * 좋아요 → 작가에게 알림 (작가↔작가 상호성의 핵심)
 *
 * "누가 눌렀는지"를 이름과 프로필 링크로 전달해 맞방문이 일어나게 한다.
 * 다만 알림이 폭주하면 오히려 무시되므로 **24시간 집계**한다:
 *   같은 작품에 대한 미읽음 알림이 이미 있으면 새로 쌓지 않고 문구/링크/시각만 갱신
 *   ("A님 외 3명이 회원님의 작품을 좋아합니다") → 목록 맨 위로 올라온다.
 * 자기 작품에 자기가 누른 경우는 알리지 않는다. 실패해도 좋아요는 성공해야 하므로 best-effort.
 */
const LIKE_AGG_WINDOW_MS = 24 * 60 * 60 * 1000;

async function notifyArtworkLike(imageId: number, likerId: number): Promise<void> {
  const image = await prisma.portfolioImage.findUnique({
    where: { id: imageId },
    select: { portfolio: { select: { userId: true } } },
  });
  const artistId = image?.portfolio.userId;
  if (!artistId || artistId === likerId) return;

  const liker = await prisma.user.findUnique({
    where: { id: likerId },
    select: { name: true, nickname: true },
  });

  const since = new Date(Date.now() - LIKE_AGG_WINDOW_MS);
  const recentLikes = await prisma.portfolioImageLike.count({
    where: { imageId, createdAt: { gte: since } },
  });
  const others = Math.max(recentLikes - 1, 0);
  const message =
    others > 0
      ? `${publicName(liker)}님 외 ${others}명이 회원님의 작품을 좋아합니다.`
      : `${publicName(liker)}님이 회원님의 작품을 좋아합니다.`;

  const refKey = `artwork-like:${imageId}`;
  const linkUrl = `/portfolio/${likerId}`; // 누른 사람 프로필 → 맞방문 유도

  const existing = await prisma.notification.findFirst({
    where: { userId: artistId, refKey, read: false, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  if (existing) {
    await prisma.notification.update({
      where: { id: existing.id },
      data: { message, linkUrl, createdAt: new Date() },
    });
  } else {
    await prisma.notification.create({
      data: { userId: artistId, type: 'ARTWORK_LIKE', message, linkUrl, refKey },
    });
  }
}

// 시드 기반 결정적 PRNG (mulberry32) — seed가 다르면 전혀 다른 난수열(매번/새로고침 시 랜덤 정렬).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 좋아요순 기간 필터 시작 시각 (없으면 전체 기간)
function periodSince(period: string): Date | null {
  const days: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };
  if (!(period in days)) return null; // 'all' 등
  return new Date(Date.now() - days[period] * 86400000);
}

// 같은 작가 작품이 연속으로 나오지 않도록 재배치 — "가중 랜덤 + 실행가능성 보장".
// 매 단계 (직전 작가 제외) 남은 작가 중에서 남은 수에 비례한 가중치로 랜덤 선택하되,
// 어떤 작가의 남은 수가 남은 슬롯의 과반을 넘으면 반드시 그 작가부터 배치(연속을 피할 수 있으면 항상 피함).
// 결정적 "최다 우선"과 달리 작은 작가도 앞쪽에 골고루 섞여 나온다(진짜 랜덤 느낌). rand는 시드 PRNG.
function arrangeNoAdjacent<T>(items: T[], artistOf: (t: T) => number, rand: () => number): T[] {
  const groups = new Map<number, T[]>();
  for (const it of items) {
    const a = artistOf(it);
    if (!groups.has(a)) groups.set(a, []);
    groups.get(a)!.push(it);
  }
  const buckets = Array.from(groups.entries()).map(([a, q]) => ({ a, q }));
  const result: T[] = [];
  let last = -1;
  let remaining = items.length;
  while (remaining > 0) {
    const avail = buckets.filter(b => b.q.length > 0);
    let elig = avail.filter(b => b.a !== last);
    if (elig.length === 0) elig = avail; // 직전 작가만 남음(불가피한 연속)

    // 과반 작가는 강제 우선(연속 최소화). 남은 슬롯(자기 배치 후) 대비 최다가 과반이면 그것부터.
    const capacity = Math.ceil((remaining - 1) / 2);
    const maxLen = Math.max(...avail.map(b => b.q.length));
    let choices = elig;
    if (maxLen > capacity) {
      const forced = elig.filter(b => b.q.length === maxLen);
      choices = forced.length > 0 ? forced : avail.filter(b => b.q.length === maxLen);
    }

    // 남은 수 가중 랜덤 선택
    const totalW = choices.reduce((s, b) => s + b.q.length, 0);
    let r = rand() * totalW;
    let pick = choices[choices.length - 1];
    for (const b of choices) { r -= b.q.length; if (r <= 0) { pick = b; break; } }

    result.push(pick.q.shift()!);
    last = pick.a;
    remaining--;
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
    const isGallery = !!userId && req.user?.role === 'GALLERY';
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
      // 시드 PRNG로 Fisher-Yates 셔플(작가내 순서 랜덤) 후, 같은 작가 연속 방지 배치.
      // id 기준 정렬을 base로 두어 DB 반환 순서와 무관하게 같은 seed면 항상 같은 결과.
      const rand = mulberry32(seed);
      const base = [...candidates].sort((a, b) => a.id - b.id);
      for (let i = base.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [base[i], base[j]] = [base[j], base[i]];
      }
      orderedIds = arrangeNoAdjacent(base, c => c.portfolio.userId, rand).map(c => c.id);
    }

    const pageIds = orderedIds.slice(skip, skip + limit);

    // 해당 페이지 이미지 상세 조회 후 pageIds 순서대로 복원
    const imgs = pageIds.length === 0 ? [] : await prisma.portfolioImage.findMany({
      where: { id: { in: pageIds } },
      include: {
        portfolio: { include: { user: { select: { id: true, name: true, nickname: true, avatar: true } } } },
        _count: { select: { likes: true } },
        ...(userId ? { likes: { where: { userId }, select: { id: true } } } : {}),
        // 스크랩 상태는 '본인 것만' 조회한다 — 남의 스크랩 여부는 응답에 절대 섞이지 않는다.
        ...(isGallery ? { scraps: { where: { userId }, select: { id: true } } } : {}),
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
        ...(isGallery ? { isScrapped: (img as any).scraps?.length > 0 } : {}),
      }));

    res.json({ images, total, page, limit });
  } catch (err) { next(err); }
});

// ── 단일 경로 라우트는 /:imageId 패턴보다 먼저 등록 ────────────────────────

/**
 * GET /highlight — 홈 "이번 주 인기 작품" 섹션용 (인증 불필요)
 *
 * 좋아요가 아직 적은 초기에는 주간 집계가 전부 0이라 의미 없는 순서가 나온다.
 * 그래서 서버가 폴백까지 판단해 `basis`로 알려준다 → 홈이 제목만 바꿔 달면 된다.
 *   week   : 최근 7일 좋아요가 1개 이상 → "이번 주 인기 작품"
 *   all    : 전체 기간 좋아요가 1개 이상 → "많이 사랑받은 작품"
 *   random : 좋아요가 전무 → 날짜 시드 랜덤(하루 동안 고정) → "작가들의 작품"
 */
router.get('/highlight', optionalAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 8, 1), 24);
    const userId = req.user?.id;
    const isGallery = !!userId && req.user?.role === 'GALLERY';
    const candidates = await prisma.portfolioImage.findMany({
      where: { showInExplore: true, portfolio: { user: { deletedAt: null } } },
      select: { id: true, portfolio: { select: { userId: true } } },
    });
    if (candidates.length === 0) {
      res.json({ images: [], basis: 'random' });
      return;
    }

    const countLikes = async (since: Date | null) => {
      const grouped = await prisma.portfolioImageLike.groupBy({
        by: ['imageId'],
        where: since ? { createdAt: { gte: since } } : {},
        _count: { imageId: true },
      });
      return new Map<number, number>(grouped.map(g => [g.imageId, g._count.imageId]));
    };

    const weekCnt = await countLikes(new Date(Date.now() - 7 * 86400000));
    let basis: 'week' | 'all' | 'random' = 'week';
    let cnt = weekCnt;
    if (candidates.every(c => !weekCnt.get(c.id))) {
      cnt = await countLikes(null);
      basis = candidates.some(c => cnt.get(c.id)) ? 'all' : 'random';
    }

    let orderedIds: number[];
    if (basis === 'random') {
      // 날짜 시드 — 하루 동안 같은 순서(새로고침마다 바뀌면 홈이 산만해진다)
      const today = new Date();
      const seed = today.getUTCFullYear() * 10000 + (today.getUTCMonth() + 1) * 100 + today.getUTCDate();
      const rand = mulberry32(seed);
      const base = [...candidates].sort((a, b) => a.id - b.id);
      for (let i = base.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [base[i], base[j]] = [base[j], base[i]];
      }
      orderedIds = arrangeNoAdjacent(base, c => c.portfolio.userId, rand).map(c => c.id);
    } else {
      orderedIds = candidates
        .map(c => ({ id: c.id, c: cnt.get(c.id) || 0 }))
        .sort((a, b) => b.c - a.c || b.id - a.id)
        .map(x => x.id);
    }

    const pageIds = orderedIds.slice(0, limit);
    const imgs = await prisma.portfolioImage.findMany({
      where: { id: { in: pageIds } },
      include: {
        portfolio: { include: { user: { select: { id: true, name: true, nickname: true, avatar: true } } } },
        _count: { select: { likes: true } },
        // 로그인 사용자의 좋아요/스크랩 상태 — 없으면 확대 모달의 하트가 항상 빈 상태로 열려
        // 이미 좋아요한 작품을 다시 누르면 '취소'가 되면서 개수가 어긋난다.
        ...(userId ? { likes: { where: { userId }, select: { id: true } } } : {}),
        ...(isGallery ? { scraps: { where: { userId }, select: { id: true } } } : {}),
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
        likeCount: img._count.likes,
        isLiked: userId ? (img as any).likes?.length > 0 : false,
        ...(isGallery ? { isScrapped: (img as any).scraps?.length > 0 } : {}),
      }));

    res.json({ images, basis });
  } catch (err) { next(err); }
});

/**
 * GET /my-likes — 내가 좋아요한 작품 보드 (로그인)
 * 좋아요가 "누른 사람에게도 남는" 컬렉션이 되도록 회수 경로를 제공한다.
 * 작가가 공개를 내렸거나 탈퇴한 작품은 목록에서 제외한다(작가의 선택 존중).
 */
router.get('/my-likes', authenticate, async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 30, 1), 60);
    const where = {
      userId: req.user!.id,
      image: { showInExplore: true, portfolio: { user: { deletedAt: null } } },
    };
    const [total, likes] = await Promise.all([
      prisma.portfolioImageLike.count({ where }),
      prisma.portfolioImageLike.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          image: {
            include: {
              portfolio: { include: { user: { select: { id: true, name: true, nickname: true, avatar: true } } } },
              _count: { select: { likes: true } },
            },
          },
        },
      }),
    ]);
    // 갤러리 계정이면 확대 모달의 북마크 상태를 맞추기 위해 본인 스크랩 여부를 함께 내려준다
    const scrappedIds = req.user?.role === 'GALLERY'
      ? new Set((await prisma.artworkScrap.findMany({
          where: { userId: req.user.id, imageId: { in: likes.map(l => l.image.id) } },
          select: { imageId: true },
        })).map(s => s.imageId))
      : null;

    const images = likes.map(l => ({
      id: l.image.id,
      url: l.image.url,
      artist: l.image.portfolio.user,
      likeCount: l.image._count.likes,
      isLiked: true,
      ...(scrappedIds ? { isScrapped: scrappedIds.has(l.image.id) } : {}),
      likedAt: l.createdAt,
    }));
    res.json({ images, total, page, limit });
  } catch (err) { next(err); }
});

/**
 * GET /scraps — 갤러리의 비공개 스카우팅 보드
 * ⚠️ 스크랩 사실은 작가에게 절대 노출하지 않는다(집계 수치도 포함). 갤러리가 부담 없이 모으게 하려는 설계.
 */
router.get('/scraps', authenticate, authorize('GALLERY'), async (req, res, next) => {
  try {
    const scraps = await prisma.artworkScrap.findMany({
      where: {
        userId: req.user!.id,
        image: { showInExplore: true, portfolio: { user: { deletedAt: null } } },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        image: {
          include: {
            portfolio: { include: { user: { select: { id: true, name: true, nickname: true, avatar: true } } } },
            _count: { select: { likes: true } },
          },
        },
      },
    });
    // 확대 모달에서 하트 상태가 맞도록 내가 좋아요한 작품인지 함께 내려준다
    const likedIds = new Set((await prisma.portfolioImageLike.findMany({
      where: { userId: req.user!.id, imageId: { in: scraps.map(s => s.imageId) } },
      select: { imageId: true },
    })).map(l => l.imageId));

    res.json({
      scraps: scraps.map(s => ({
        id: s.id,
        memo: s.memo,
        createdAt: s.createdAt,
        image: {
          id: s.image.id,
          url: s.image.url,
          artist: s.image.portfolio.user,
          likeCount: s.image._count.likes,
          isLiked: likedIds.has(s.imageId),
          isScrapped: true,
        },
      })),
    });
  } catch (err) { next(err); }
});

// PATCH /scraps/:id — 메모 수정 (본인 스크랩만)
router.patch('/scraps/:id', authenticate, authorize('GALLERY'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const scrap = await prisma.artworkScrap.findUnique({ where: { id } });
    if (!scrap || scrap.userId !== req.user!.id) throw new AppError('스크랩을 찾을 수 없습니다.', 404);
    const memo = typeof req.body?.memo === 'string' ? req.body.memo.slice(0, 500) : null;
    const updated = await prisma.artworkScrap.update({ where: { id }, data: { memo } });
    res.json({ id: updated.id, memo: updated.memo });
  } catch (err) { next(err); }
});

// POST /:imageId/scrap — 스크랩 토글 (GALLERY 전용)
router.post('/:imageId/scrap', authenticate, authorize('GALLERY'), async (req, res, next) => {
  try {
    const imageId = parseInt(req.params.imageId as string);
    const userId = req.user!.id;
    const image = await prisma.portfolioImage.findUnique({ where: { id: imageId } });
    if (!image || !image.showInExplore) throw new AppError('이미지를 찾을 수 없습니다.', 404);

    const existing = await prisma.artworkScrap.findUnique({
      where: { userId_imageId: { userId, imageId } },
    });
    // 더블클릭 레이스 멱등 처리 (좋아요와 동일 규칙)
    try {
      if (existing) {
        await prisma.artworkScrap.delete({ where: { id: existing.id } });
      } else {
        await prisma.artworkScrap.create({ data: { userId, imageId } });
      }
    } catch (e: any) {
      if (e?.code !== 'P2002' && e?.code !== 'P2025') throw e;
    }
    res.json({ scrapped: !existing });
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

    // 좋아요를 '켠' 경우에만 작가에게 알린다(취소는 알리지 않음). 실패해도 좋아요는 성공 처리.
    if (!existing) {
      try {
        await notifyArtworkLike(imageId, userId);
      } catch (e) {
        logger.warn('Explore', `좋아요 알림 실패(image ${imageId}): ${(e as Error).message}`);
      }
    }

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
