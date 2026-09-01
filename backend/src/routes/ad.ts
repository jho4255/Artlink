/**
 * 광고 배너 (Admin 관리) — 사이드바 하단 등에 노출하는 자체 광고 슬롯.
 *  · 공개 GET `/` — 활성 배너만(position 순). 화면이 여기서 하나를 골라 띄운다.
 *  · Admin CRUD — 이미지·제목·링크·활성·순서.
 * 이미지는 우리 저장소 주소만(safeFileUrl + /uploads | R2). 링크는 안전한 스킴만.
 */
import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { safeFileUrl } from '../lib/safeUrl';
import { matchR2Base } from '../lib/r2Urls';

const router = Router();

/** 광고 이미지는 우리 저장소 주소만 */
function ownImage(raw: unknown): string | null {
  const s = safeFileUrl(raw);
  if (s && (s.startsWith('/uploads/') || matchR2Base(s))) return s;
  return null;
}
/** 링크는 내부 경로(/...) 또는 안전한 http(s) 만 */
function safeLink(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const s = raw.trim();
  if (s.startsWith('/')) return s.slice(0, 500);
  const u = safeFileUrl(s);
  return u ? u.slice(0, 500) : '';
}

const upsertSchema = z.object({
  imageUrl: z.string().min(1, '이미지를 넣어주세요.'),
  title: z.string().trim().max(80).optional().default(''),
  linkUrl: z.string().optional().default(''),
  active: z.boolean().optional().default(true),
  position: z.number().int().optional().default(0),
});

// ── 공개: 활성 배너 ──
router.get('/', async (_req, res, next) => {
  try {
    const rows = await prisma.adBanner.findMany({ where: { active: true }, orderBy: [{ position: 'asc' }, { createdAt: 'desc' }] });
    res.json(rows.map((a) => ({ id: a.id, imageUrl: a.imageUrl, title: a.title, linkUrl: a.linkUrl })));
  } catch (e) { next(e); }
});

// ── Admin: 전체(비활성 포함) ──
router.get('/all', authenticate, authorize('ADMIN'), async (_req, res, next) => {
  try {
    const rows = await prisma.adBanner.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'desc' }] });
    res.json(rows);
  } catch (e) { next(e); }
});

// ── Admin: 생성 ──
router.post('/', authenticate, authorize('ADMIN'), validate(upsertSchema), async (req, res, next) => {
  try {
    const imageUrl = ownImage(req.body.imageUrl);
    if (!imageUrl) throw new AppError('이미지 주소가 올바르지 않습니다.', 400);
    const ad = await prisma.adBanner.create({
      data: { imageUrl, title: (req.body.title ?? '').trim(), linkUrl: safeLink(req.body.linkUrl), active: req.body.active ?? true, position: req.body.position ?? 0 },
    });
    res.status(201).json(ad);
  } catch (e) { next(e); }
});

// ── Admin: 수정 ──
router.patch('/:id', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    const exists = await prisma.adBanner.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new AppError('광고를 찾을 수 없습니다.', 404);
    const data: Record<string, unknown> = {};
    if (req.body.imageUrl !== undefined) {
      const img = ownImage(req.body.imageUrl);
      if (!img) throw new AppError('이미지 주소가 올바르지 않습니다.', 400);
      data.imageUrl = img;
    }
    if (req.body.title !== undefined) data.title = String(req.body.title).trim().slice(0, 80);
    if (req.body.linkUrl !== undefined) data.linkUrl = safeLink(req.body.linkUrl);
    if (req.body.active !== undefined) data.active = !!req.body.active;
    if (req.body.position !== undefined) data.position = parseInt(String(req.body.position)) || 0;
    const ad = await prisma.adBanner.update({ where: { id }, data });
    res.json(ad);
  } catch (e) { next(e); }
});

// ── Admin: 삭제 ──
router.delete('/:id', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string);
    await prisma.adBanner.delete({ where: { id } }).catch(() => { throw new AppError('광고를 찾을 수 없습니다.', 404); });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
