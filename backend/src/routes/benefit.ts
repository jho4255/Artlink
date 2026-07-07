import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { deleteUploadedFile } from '../lib/storage';

// linkUrl 정규화: 절대 http(s) URL 또는 동일 출처 경로('/...')만 허용.
// 'www.example.com'처럼 스킴 없는 값은 https:// 를 붙여 보정, javascript:/data: 등은 거부.
function normalizeLinkUrl(u: string | null | undefined): string | null | undefined {
  if (u === undefined) return undefined; // 미전송 → 필드 자체 생략
  if (u === null) return null;
  const t = u.trim();
  if (!t) return null;
  if (t.startsWith('/')) return t; // 동일 출처 경로
  try {
    const p = new URL(t);
    if (p.protocol === 'http:' || p.protocol === 'https:') return t;
    throw new AppError('유효한 링크 URL이 필요합니다.', 400);
  } catch (e) {
    if (e instanceof AppError) throw e;
  }
  try {
    return new URL('https://' + t).toString();
  } catch {
    throw new AppError('유효한 링크 URL이 필요합니다.', 400);
  }
}

// 화이트리스트 스키마 (Benefit 모델엔 order 필드가 없어 제외). id/createdAt mass-assignment 차단
const benefitSchema = z.object({
  title: z.string().min(1, '제목을 입력해주세요.'),
  description: z.string().min(1, '설명을 입력해주세요.'),
  imageUrl: z.string().nullish(),
  linkUrl: z.string().nullish(),
});

const router = Router();

// 혜택 목록 조회 (공개)
router.get('/', async (_req, res, next) => {
  try {
    const benefits = await prisma.benefit.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(benefits);
  } catch (error) { next(error); }
});

// 혜택 생성 (Admin 전용)
router.post('/', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const parsed = benefitSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0].message, 400);
    const { title, description, imageUrl, linkUrl } = parsed.data;
    const benefit = await prisma.benefit.create({
      data: {
        title,
        description,
        imageUrl: imageUrl ?? null,
        linkUrl: normalizeLinkUrl(linkUrl) ?? null,
      }
    });
    res.status(201).json(benefit);
  } catch (error) { next(error); }
});

// 혜택 수정 (Admin 전용)
router.patch('/:id', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const parsed = benefitSchema.partial().safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0].message, 400);
    const { title, description, imageUrl, linkUrl } = parsed.data;
    // 전달된 필드만 반영 (whitelist)
    const data: any = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (imageUrl !== undefined) data.imageUrl = imageUrl;
    if (linkUrl !== undefined) data.linkUrl = normalizeLinkUrl(linkUrl);
    const benefit = await prisma.benefit.update({
      where: { id: parseInt(req.params.id as string) },
      data
    });
    res.json(benefit);
  } catch (error) { next(error); }
});

// 혜택 삭제 (Admin 전용)
router.delete('/:id', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const benefit = await prisma.benefit.findUnique({ where: { id }, select: { imageUrl: true } });
    await prisma.benefit.delete({ where: { id } });
    if (benefit) void deleteUploadedFile(benefit.imageUrl); // orphan 방지
    res.json({ message: '삭제되었습니다.' });
  } catch (error) { next(error); }
});

export default router;
