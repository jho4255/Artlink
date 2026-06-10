import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { safeFileUrl } from '../lib/safeUrl';

const router = Router();

// career JSON 문자열 → 객체 파싱 (프론트엔드는 항상 객체로 받음)
function parseCareer(raw: string | null | undefined) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// 작가 검색 (Gallery 유저용, 전시 등록 시 작가 연동)
router.get('/search', authenticate, authorize('GALLERY'), async (req, res, next) => {
  try {
    const q = (req.query.q as string || '').trim();
    if (!q) return res.json([]);

    const users = await prisma.user.findMany({
      where: { role: 'ARTIST', name: { contains: q, mode: 'insensitive' } },
      select: { id: true, name: true, nickname: true, avatar: true },
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
      select: { id: true, name: true, nickname: true, avatar: true, role: true, instagramUrl: true },
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
      career: parseCareer(portfolio?.career),
      portfolioFileUrl: portfolio?.portfolioFileUrl || null,
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
    res.json({ ...portfolio, career: parseCareer(portfolio.career) });
  } catch (error) { next(error); }
});

// 포트폴리오 수정
router.put('/', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    const { biography, career, portfolioFileUrl } = req.body;
    // career는 객체로 올 수 있으므로 JSON 문자열로 정규화
    const careerStr =
      career == null ? null : typeof career === 'string' ? career : JSON.stringify(career);
    const data = { biography, career: careerStr, portfolioFileUrl: safeFileUrl(portfolioFileUrl) };
    const portfolio = await prisma.portfolio.upsert({
      where: { userId: req.user!.id },
      update: data,
      create: { userId: req.user!.id, ...data },
      include: { images: { orderBy: { order: 'asc' } } }
    });
    res.json({ ...portfolio, career: parseCareer(portfolio.career) });
  } catch (error) { next(error); }
});

// 포트폴리오 이미지 추가 (최대 10장)
router.post('/images', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    const portfolio = await prisma.portfolio.findUnique({
      where: { userId: req.user!.id },
      include: { images: true }
    });
    if (!portfolio) {
      throw new AppError('포트폴리오를 먼저 생성해주세요.', 400);
    }
    if (portfolio.images.length >= 10) {
      throw new AppError('작품 사진은 최대 10장까지 등록 가능합니다.', 400);
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
