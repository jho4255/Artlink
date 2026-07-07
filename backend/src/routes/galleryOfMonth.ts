import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { maskGallery } from '../lib/sanitize';
import { AppError } from '../middleware/errorHandler';
import { startOfTodayKstAsUtc } from '../lib/kstDate';

const router = Router();

// 이달의 갤러리 목록 조회 (공개, 만료되지 않은 것만)
router.get('/', async (_req, res, next) => {
  try {
    // 만료되지 않은 항목만 조회 (불필요한 DELETE 제거, expiresAt 인덱스 활용)
    // KST 달력 기준으로 만료일 당일 끝까지 노출(09:00 KST 오프바이원 방지) + 승인된 갤러리만
    const galleries = await prisma.galleryOfMonth.findMany({
      where: { expiresAt: { gte: startOfTodayKstAsUtc() }, gallery: { status: 'APPROVED' } },
      include: {
        gallery: {
          include: { images: { orderBy: { order: 'asc' }, take: 1 } }
        }
      }
    });
    // 중첩된 갤러리에서 Instagram 토큰 등 비밀 제거 (공개 응답)
    res.json(galleries.map((g) => ({ ...g, gallery: maskGallery(g.gallery) })));
  } catch (error) { next(error); }
});

// 이달의 갤러리 등록 (Admin 전용)
// galleryId가 @unique이므로, 만료된 기존 레코드가 남아있을 수 있어 upsert 사용
const gotmCreateSchema = z.object({
  galleryId: z.number().int().positive('갤러리를 선택해주세요.'),
  expiresAt: z.string().min(1, '유효한 만료일이 필요합니다.'),
  title: z.string().optional(),
});
router.post('/', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const parsed = gotmCreateSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0].message, 400);
    const { galleryId, expiresAt, title } = parsed.data;

    // expiresAt이 유효한 날짜 문자열인지 검증 (new Date(undefined) → 500 방지)
    const expires = new Date(expiresAt);
    if (isNaN(expires.getTime())) throw new AppError('유효한 만료일이 필요합니다.', 400);

    const entry = await prisma.galleryOfMonth.upsert({
      where: { galleryId },
      update: { expiresAt: expires, title: title || null },
      create: { galleryId, expiresAt: expires, title: title || null },
      include: { gallery: true }
    });
    res.status(201).json({ ...entry, gallery: maskGallery(entry.gallery) });
  } catch (error) { next(error); }
});

// 이달의 갤러리 삭제 (Admin 전용)
router.delete('/:id', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    await prisma.galleryOfMonth.delete({ where: { id: parseInt(req.params.id as string) } });
    res.json({ message: '삭제되었습니다.' });
  } catch (error) { next(error); }
});

export default router;
