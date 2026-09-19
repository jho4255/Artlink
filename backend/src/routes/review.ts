import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize, optionalAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { safeFileUrl } from '../lib/safeUrl';
import { validate } from '../middleware/validate';
import { maskAnonymousReviews } from '../lib/sanitize';

const reviewCreateSchema = z.object({
  galleryId: z.number().int().positive('유효한 갤러리 ID가 필요합니다.'),
  exhibitionId: z.number().int().positive('공모를 선택해주세요.'),
  // ⚠️ 별점은 2026-09-10 에 없앴다 — 보내와도 **받지 않는다**(zod 가 걸러낸다).
  //    옛 리뷰의 점수는 DB에 그대로 있고, 화면 어디에도 표시하지 않는다.
  content: z.string().min(1, '리뷰 내용을 입력해주세요.').max(2000, '리뷰는 2000자 이내로 작성해주세요.'),
  imageUrl: z.string().optional(),
  anonymous: z.boolean().optional(),
});

const reviewUpdateSchema = z.object({
  content: z.string().min(1).max(2000).optional(),
  imageUrl: z.string().optional(),
  anonymous: z.boolean().optional(),
});

/**
 * 갤러리의 **리뷰 개수**를 다시 센다.
 *
 * ⚠️ 예전엔 여기서 별점 평균(`Gallery.rating`)도 같이 갱신했다. 2026-09-10 에 별점을 없애면서
 *    평균은 **더 이상 건드리지 않는다** — 새 리뷰의 점수가 null 이라 계속 계산하면 옛 점수만
 *    남은 표본의 평균이 되어 실제와 멀어진다. 그 컬럼은 그 시점 값에서 동결된 레거시다.
 * ⚠️ 개수는 반드시 `_count: { _all: true }` 로 셀 것 — 예전 코드처럼 별점 컬럼으로 세면
 *    **null 을 빼고 세므로**, 별점 없는 새 리뷰만 쌓인 갤러리가 '리뷰 0개' 로 보인다.
 */
async function syncReviewCount(
  tx: { review: { aggregate: typeof prisma.review.aggregate }; gallery: { update: typeof prisma.gallery.update } },
  galleryId: number,
) {
  const agg = await tx.review.aggregate({ where: { galleryId }, _count: { _all: true } });
  await tx.gallery.update({ where: { id: galleryId }, data: { reviewCount: agg._count._all } });
}

const router = Router();

// 갤러리 리뷰 목록 조회 (optionalAuth: 작성자 본인/관리자만 익명 리뷰 실명 확인)
router.get('/gallery/:galleryId', optionalAuth, async (req, res, next) => {
  try {
    const reviews = await prisma.review.findMany({
      where: { galleryId: parseInt(req.params.galleryId as string) },
      include: {
        user: { select: { id: true, name: true, nickname: true, avatar: true } },
        exhibition: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' }
    });
    // 익명 리뷰의 작성자 신원(user/userId)은 본인·관리자 외에는 마스킹
    res.json(maskAnonymousReviews(reviews as any[], req.user));
  } catch (error) { next(error); }
});

// 내 리뷰 목록 조회
router.get('/my', authenticate, async (req, res, next) => {
  try {
    const reviews = await prisma.review.findMany({
      where: { userId: req.user!.id },
      include: {
        gallery: { select: { id: true, name: true } },
        exhibition: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(reviews);
  } catch (error) { next(error); }
});

// GET /reviewable/:galleryId — 리뷰 작성 가능한 공모 목록
router.get('/reviewable/:galleryId', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    const galleryId = parseInt(req.params.galleryId as string);
    const userId = req.user!.id;

    // ACCEPTED 상태인 지원 중, 해당 갤러리의 공모만
    const acceptedApps = await prisma.application.findMany({
      where: {
        userId,
        status: 'ACCEPTED',
        exhibition: { galleryId },
      },
      include: {
        exhibition: { select: { id: true, title: true } },
      },
    });

    // 이미 리뷰한 공모 제외
    const reviewedExIds = (await prisma.review.findMany({
      where: { userId, galleryId, exhibitionId: { not: null } },
      select: { exhibitionId: true },
    })).map(r => r.exhibitionId);

    const reviewable = acceptedApps
      .filter(a => !reviewedExIds.includes(a.exhibitionId))
      .map(a => ({ id: a.exhibition.id, title: a.exhibition.title }));

    res.json(reviewable);
  } catch (err) { next(err); }
});

// 리뷰 작성 (Artist 전용)
router.post('/', authenticate, authorize('ARTIST'), validate(reviewCreateSchema), async (req, res, next) => {
  try {
    const { galleryId, exhibitionId, content, anonymous } = req.body;
    // 외부 도메인·이상한 스킴을 그대로 저장하던 구멍(2026-09-19)
    const imageUrl = req.body.imageUrl ? safeFileUrl(req.body.imageUrl) : null;
    if (req.body.imageUrl && !imageUrl) throw new AppError('이미지 주소가 올바르지 않습니다.', 400);

    // 1) 해당 공모가 이 갤러리의 공모인지 확인
    const exhibition = await prisma.exhibition.findUnique({
      where: { id: exhibitionId },
      select: { id: true, galleryId: true, title: true },
    });
    if (!exhibition || exhibition.galleryId !== galleryId) {
      throw new AppError('해당 갤러리의 공모가 아닙니다.', 400);
    }

    // 2) ACCEPTED 지원 이력 확인
    const acceptedApp = await prisma.application.findFirst({
      where: { userId: req.user!.id, exhibitionId, status: 'ACCEPTED' },
    });
    if (!acceptedApp) {
      throw new AppError('수락된 공모에 대해서만 리뷰를 작성할 수 있습니다.', 403);
    }

    // 3) 해당 공모에 대한 기존 리뷰 확인 (공모당 1회) + 멱등 처리
    //    - 같은 공모에 이미 리뷰가 있고, 내용이 같으며 최근(1분) 재전송이면 기존 리뷰를 201로 반환
    //      (더블클릭/네트워크 재시도로 인한 중복 생성 방지)
    //    - 그 외 기존 리뷰가 있으면 409 (공모당 1회)
    //    ※ exhibitionId로 스코프하므로 같은 갤러리의 다른 공모 리뷰를 삼키지 않는다.
    const existingReview = await prisma.review.findFirst({
      where: { userId: req.user!.id, exhibitionId },
    });
    if (existingReview) {
      const isRecentDuplicate =
        existingReview.content === content &&
        existingReview.createdAt >= new Date(Date.now() - 60 * 1000);
      if (isRecentDuplicate) {
        return res.status(201).json(existingReview);
      }
      throw new AppError('이 공모에 대한 리뷰는 이미 작성하셨습니다.', 409);
    }

    // 트랜잭션으로 리뷰 생성 + 평점 재계산 atomic 보장
    const review = await prisma.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          userId: req.user!.id,
          galleryId,
          exhibitionId,
          content,
          imageUrl,
          anonymous: anonymous || false
        }
      });
      await syncReviewCount(tx, galleryId);
      return review;
    });

    res.status(201).json(review);
  } catch (error) { next(error); }
});

// 리뷰 수정 (작성자 본인만)
router.patch('/:id', authenticate, validate(reviewUpdateSchema), async (req, res, next) => {
  try {
    const review = await prisma.review.findUnique({ where: { id: parseInt(req.params.id as string) } });
    if (!review) throw new AppError('리뷰를 찾을 수 없습니다.', 404);
    if (review.userId !== req.user!.id) throw new AppError('본인 리뷰만 수정할 수 있습니다.', 403);

    const { content, anonymous } = req.body;
    const imageUrl = req.body.imageUrl === undefined ? undefined : (req.body.imageUrl ? safeFileUrl(req.body.imageUrl) : null);
    if (req.body.imageUrl && !imageUrl) throw new AppError('이미지 주소가 올바르지 않습니다.', 400);

    // 별점이 없어져 수정이 갤러리 집계에 영향을 주지 않는다 — 트랜잭션이 필요 없다
    const updated = await prisma.review.update({
      where: { id: review.id },
      data: {
        ...(content !== undefined && { content }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(anonymous !== undefined && { anonymous }),
      }
    });
    res.json(updated);
  } catch (error) { next(error); }
});

// 리뷰 삭제 (Admin 또는 작성자 본인)
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const review = await prisma.review.findUnique({ where: { id: parseInt(req.params.id as string) } });
    if (!review) throw new AppError('리뷰를 찾을 수 없습니다.', 404);

    // Admin 또는 작성자만 삭제 가능
    if (req.user!.role !== 'ADMIN' && review.userId !== req.user!.id) {
      throw new AppError('권한이 없습니다.', 403);
    }

    // 삭제 + 리뷰 개수 재계산을 atomic 하게
    await prisma.$transaction(async (tx) => {
      await tx.review.delete({ where: { id: review.id } });
      await syncReviewCount(tx, review.galleryId);
    });

    res.json({ message: '리뷰가 삭제되었습니다.' });
  } catch (error) { next(error); }
});

export default router;
