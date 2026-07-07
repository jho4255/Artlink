import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { safeFileUrl } from '../lib/safeUrl';
import { deleteUploadedFile } from '../lib/storage';

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

    // 탈퇴(deletedAt) 회원의 포트폴리오는 공개에서 숨김 → 404
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
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

    const url = safeFileUrl(req.body.url);
    if (!url) throw new AppError('유효하지 않은 이미지 URL입니다.', 400);
    // 중간 삭제 후에도 order가 겹치지 않도록 (기존 최대 order) + 1 사용
    const nextOrder = portfolio.images.reduce((max, img) => Math.max(max, img.order), -1) + 1;
    const image = await prisma.portfolioImage.create({
      data: {
        url,
        portfolioId: portfolio.id,
        order: nextOrder
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

// 포트폴리오 이미지 삭제 (본인 포트폴리오 이미지만)
router.delete('/images/:imageId', authenticate, authorize('ARTIST'), async (req, res, next) => {
  try {
    const imageId = parseInt(req.params.imageId as string);
    // 소유권 확인: 이미지가 요청자 본인의 포트폴리오에 속하는지 검증 (IDOR 차단)
    const image = await prisma.portfolioImage.findUnique({
      where: { id: imageId },
      include: { portfolio: { select: { userId: true } } },
    });
    if (!image || image.portfolio.userId !== req.user!.id) {
      throw new AppError('이미지를 찾을 수 없습니다.', 404);
    }
    await prisma.portfolioImage.delete({ where: { id: imageId } });
    void deleteUploadedFile(image.url); // orphan 방지
    res.json({ message: '삭제되었습니다.' });
  } catch (error) { next(error); }
});

export default router;
