import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// 작가 검색 (Gallery 유저용, 전시 등록 시 작가 연동)
router.get('/search', authenticate, authorize('GALLERY'), async (req, res, next) => {
  try {
    const q = (req.query.q as string || '').trim();
    if (!q) return res.json([]);

    const users = await prisma.user.findMany({
      where: { role: 'ARTIST', name: { contains: q, mode: 'insensitive' } },
      select: { id: true, name: true, avatar: true },
      take: 10,
    });
    res.json(users);
  } catch (error) { next(error); }
});

// 공개 포트폴리오 조회 (인증 불필요)
router.get('/:userId', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.userId as string);
    if (isNaN(userId)) throw new AppError('유효하지 않은 유저 ID입니다.', 400);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, avatar: true, role: true },
    });
    if (!user || user.role !== 'ARTIST') {
      throw new AppError('포트폴리오를 찾을 수 없습니다.', 404);
    }

    let portfolio = await prisma.portfolio.findUnique({
      where: { userId },
      include: { images: { orderBy: { order: 'asc' } } },
    });

    // 포트폴리오가 없으면 빈 데이터 반환
    const { role, ...userInfo } = user;
    res.json({
      id: portfolio?.id || 0,
      biography: portfolio?.biography || null,
      exhibitionHistory: portfolio?.exhibitionHistory || null,
      images: portfolio?.images || [],
      user: userInfo,
    });
  } catch (error) { next(error); }
});

// 내 포트폴리오 조회
router.get('/', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    let portfolio = await prisma.portfolio.findUnique({
      where: { userId: req.user!.id },
      include: { images: { orderBy: { order: 'asc' } } }
    });
    if (!portfolio) {
      portfolio = await prisma.portfolio.create({
        data: { userId: req.user!.id },
        include: { images: { orderBy: { order: 'asc' } } }
      });
    }
    res.json(portfolio);
  } catch (error) { next(error); }
});

// 포트폴리오 수정
router.put('/', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    const { biography, exhibitionHistory } = req.body;
    const portfolio = await prisma.portfolio.upsert({
      where: { userId: req.user!.id },
      update: { biography, exhibitionHistory },
      create: { userId: req.user!.id, biography, exhibitionHistory },
      include: { images: { orderBy: { order: 'asc' } } }
    });
    res.json(portfolio);
  } catch (error) { next(error); }
});

// 포트폴리오 이미지 추가 (최대 30장)
router.post('/images', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    const portfolio = await prisma.portfolio.findUnique({
      where: { userId: req.user!.id },
      include: { images: true }
    });
    if (!portfolio) {
      throw new AppError('포트폴리오를 먼저 생성해주세요.', 400);
    }
    if (portfolio.images.length >= 30) {
      throw new AppError('작품 사진은 최대 30장까지 등록 가능합니다.', 400);
    }

    const { url } = req.body;
    const image = await prisma.portfolioImage.create({
      data: {
        url,
        portfolioId: portfolio.id,
        order: portfolio.images.length
      }
    });
    res.status(201).json(image);
  } catch (error) { next(error); }
});

// PATCH /images/:imageId/explore — showInExplore 토글 (ARTIST 본인 전용)
router.patch('/images/:imageId/explore', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    const imageId = parseInt(req.params.imageId as string);
    const userId = req.user!.id;

    const image = await prisma.portfolioImage.findUnique({
      where: { id: imageId },
      include: { portfolio: { select: { userId: true } } },
    });

    if (!image || image.portfolio.userId !== userId) {
      return res.status(404).json({ error: '이미지를 찾을 수 없습니다.' });
    }

    const updated = await prisma.portfolioImage.update({
      where: { id: imageId },
      data: { showInExplore: !image.showInExplore },
    });

    res.json(updated);
  } catch (err) { next(err); }
});

// 포트폴리오 이미지 삭제
router.delete('/images/:imageId', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    await prisma.portfolioImage.delete({
      where: { id: parseInt(req.params.imageId as string) }
    });
    res.json({ message: '삭제되었습니다.' });
  } catch (error) { next(error); }
});

export default router;
