import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AppError } from '../middleware/errorHandler';

const favoriteToggleSchema = z.object({
  galleryId: z.number().int().positive().optional(),
  exhibitionId: z.number().int().positive().optional(),
  showId: z.number().int().positive().optional(),
}).refine(data => data.galleryId || data.exhibitionId || data.showId, {
  message: 'galleryId, exhibitionId 또는 showId가 필요합니다.',
});

const router = Router();

// 내 찜 목록 조회
router.get('/', authenticate, async (req, res, next) => {
  try {
    const favorites = await prisma.favorite.findMany({
      where: { userId: req.user!.id },
      include: {
        // ⚠️ 별점(rating)은 2026-09-10 에 없앴다 — 응답에 싣지 않는다(화면이 다시 그리지 못하게)
        gallery: { select: { id: true, name: true, mainImage: true, reviewCount: true, status: true } },
        exhibition: {
          select: { id: true, title: true, status: true, gallery: { select: { name: true } } }
        },
        show: {
          select: { id: true, title: true, posterImage: true, status: true, gallery: { select: { name: true } } }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    // 탈퇴(WITHDRAWN)/미승인 대상은 상세 진입 시 404이므로 목록에서 제외.
    // 각 찜 행은 gallery/exhibition/show 중 정확히 하나에만 연결됨.
    const valid = favorites.filter((f) => {
      const target = f.gallery ?? f.exhibition ?? f.show;
      return target != null && target.status === 'APPROVED';
    });
    res.json(valid);
  } catch (error) { next(error); }
});

/**
 * 찜 토글 — '확인하고 만들지' 않는다 (CLAUDE.md 규칙 46, 2026-09-19 수정).
 *
 * 예전엔 `$transaction` 안에서 `findUnique → create` 였는데, 기본 격리수준(ReadCommitted)에서는 동시 요청 둘 다
 * "없음"을 보고 들어가 `@@unique` 위반(P2002) → 400 "데이터 처리 중 오류" 가 났다. 모바일 더블탭에서 흔했고,
 * 화면의 낙관적 갱신이 조용히 롤백돼 "눌렀는데 안 눌림" 이 됐다(2026-09-19 실측: 동시 4회 → 200 1건 + 400 3건).
 * 좋아요·이웃(`community.ts`·`story.ts`·`follow.ts`)은 이미 이 패턴인데 찜만 빠져 있었다.
 *
 * `deleteMany` 는 없는 걸 지워도, `createMany({skipDuplicates})` 는 있는 걸 만들어도 던지지 않는다.
 * 지운 행이 있으면 '취소', 없으면 '추가' — 어느 쪽이든 200 이고 두 번 누르면 원래대로 돌아온다.
 */
router.post('/toggle', authenticate, validate(favoriteToggleSchema), async (req, res, next) => {
  try {
    const { galleryId, exhibitionId, showId } = req.body;
    const userId = req.user!.id;

    const target: { key: { galleryId?: number; exhibitionId?: number; showId?: number }; approved: () => Promise<boolean> } | null =
      galleryId ? {
        key: { galleryId },
        approved: async () => (await prisma.gallery.findUnique({ where: { id: galleryId }, select: { status: true } }))?.status === 'APPROVED',
      } : exhibitionId ? {
        key: { exhibitionId },
        approved: async () => (await prisma.exhibition.findUnique({ where: { id: exhibitionId }, select: { status: true } }))?.status === 'APPROVED',
      } : showId ? {
        key: { showId },
        approved: async () => (await prisma.show.findUnique({ where: { id: showId }, select: { status: true } }))?.status === 'APPROVED',
      } : null;
    if (!target) return res.status(400).json({ error: 'galleryId, exhibitionId 또는 showId가 필요합니다.' });

    const removed = await prisma.favorite.deleteMany({ where: { userId, ...target.key } });
    if (removed.count > 0) return res.json({ favorited: false });

    // 신규 찜: 대상이 존재하고 승인된 상태여야 함 (미승인/탈퇴 대상 찜 방지)
    if (!(await target.approved())) throw new AppError('대상을 찾을 수 없습니다.', 404);
    await prisma.favorite.createMany({ data: [{ userId, ...target.key }], skipDuplicates: true });
    res.json({ favorited: true });
  } catch (error) { next(error); }
});

export default router;
