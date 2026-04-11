import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// 이달의 갤러리 목록 조회 (공개, 만료되지 않은 것만)
router.get('/', async (_req, res, next) => {
  try {
    // 만료되지 않은 항목만 조회 (불필요한 DELETE 제거, expiresAt 인덱스 활용)
    const galleries = await prisma.galleryOfMonth.findMany({
      where: { expiresAt: { gte: new Date() } },
      include: {
        gallery: {
          include: { images: { orderBy: { order: 'asc' }, take: 1 } }
        }
      }
    });
    res.json(galleries);
  } catch (error) { next(error); }
});

// 이달의 갤러리 등록 (Admin 전용)
// galleryId가 @unique이므로, 만료된 기존 레코드가 남아있을 수 있어 upsert 사용
router.post('/', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { galleryId, expiresAt } = req.body;
    const entry = await prisma.galleryOfMonth.upsert({
      where: { galleryId },
      update: { expiresAt: new Date(expiresAt) },
      create: { galleryId, expiresAt: new Date(expiresAt) },
      include: { gallery: true }
    });
    res.status(201).json(entry);
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
