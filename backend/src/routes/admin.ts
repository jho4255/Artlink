import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();

const VALID_ROLES = ['ADMIN', 'ARTIST', 'GALLERY'];

/**
 * 사용자 검색 (ADMIN 전용) — 이메일/이름 부분일치, 최대 50명
 * GET /api/admin/users?q=검색어
 */
router.get('/users', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const q = ((req.query.q as string) || '').trim();
    const users = await prisma.user.findMany({
      where: q
        ? { OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
          ] }
        : undefined,
      select: { id: true, email: true, name: true, role: true, provider: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(users);
  } catch (error) { next(error); }
});

/**
 * 역할 변경 (ADMIN 전용)
 * PATCH /api/admin/users/:id/role  body: { role: 'ADMIN' | 'ARTIST' | 'GALLERY' }
 * - 본인 역할은 변경 불가 (자기 권한 잠금 방지)
 */
router.patch('/users/:id/role', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const { role } = req.body;
    if (!VALID_ROLES.includes(role)) throw new AppError('유효하지 않은 역할입니다.', 400);
    if (id === req.user!.id) throw new AppError('본인의 역할은 변경할 수 없습니다.', 400);

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new AppError('사용자를 찾을 수 없습니다.', 404);
    // 관리자 계정은 다른 관리자가 강등/변경할 수 없음 (관리자 보호)
    if (target.role === 'ADMIN') throw new AppError('관리자 계정의 역할은 변경할 수 없습니다.', 403);

    const updated = await prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, email: true, name: true, role: true, provider: true },
    });
    res.json(updated);
  } catch (error) { next(error); }
});

export default router;
