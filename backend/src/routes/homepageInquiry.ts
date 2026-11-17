import { Router } from 'express';
import { z } from 'zod';
import { ipKeyGenerator } from 'express-rate-limit';
import prisma from '../lib/prisma';
import { authenticate, optionalAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { clientIp } from '../lib/clientIp';
import { LOCK_NS, withKeyLock } from '../lib/keyLock';
import {
  INQUIRY_CONTACT_MAX, INQUIRY_LINK_MAX, INQUIRY_MESSAGE_MAX, INQUIRY_NAME_MAX, INQUIRY_PER_OWNER_DAY,
  countLinks, homepageInquiryLink, isContactLike, ownerDaySince, pruneHomepageInquiries, takeInquirySlot,
} from '../lib/homepageInquiry';

/**
 * 홈페이지 문의 — `/api/homepage-inquiries` (2026-11-14, CLAUDE.md 규칙 82). 규칙은 `lib/homepageInquiry.ts`.
 *
 *  POST   /             (인증 없음) 비회원이 작가·갤러리 홈페이지 [문의하기]로 남긴다 — 받는 사람이 켰을 때만
 *  GET    /mine         받은 문의(작가·갤러리 주인) — 마이페이지 [받은 문의]
 *  PATCH  /:id/read     읽음
 *  DELETE /:id          지우기(되돌릴 수 없다 — 개인정보라 바로 지운다)
 *
 * ⚠️ 남의 문의는 **404**(규칙 23 — 403 은 그 번호가 있다는 걸 알려준다).
 */
const router = Router();

const createSchema = z.object({
  artistId: z.number().int().positive().optional(),
  galleryId: z.number().int().positive().optional(),
  imageId: z.number().int().positive().optional(),
  name: z.string().trim().min(1, '이름을 적어 주세요.').max(INQUIRY_NAME_MAX, `이름은 ${INQUIRY_NAME_MAX}자까지예요.`),
  contact: z.string().trim().min(1, '연락처를 적어 주세요.').max(INQUIRY_CONTACT_MAX, `연락처는 ${INQUIRY_CONTACT_MAX}자까지예요.`),
  message: z.string().trim().min(1, '문의 내용을 적어 주세요.').max(INQUIRY_MESSAGE_MAX, `문의 내용은 ${INQUIRY_MESSAGE_MAX.toLocaleString()}자까지예요.`),
  /** 개인정보 수집·이용·제공 동의 — 화면의 체크 칸. 없으면 받지 않는다 */
  agree: z.literal(true, { message: '개인정보 수집·이용에 동의해 주세요.' }),
  /** 숨은 칸 — 사람은 못 본다. 채워 오면 봇이다 */
  website: z.string().optional(),
});

router.post('/', optionalAuth, async (req, res, next) => {
  try {
    // 봇 — 성공한 척하고 버린다(실패를 알려 주면 숨은 칸을 피해 다시 온다)
    if (typeof req.body?.website === 'string' && req.body.website.trim()) {
      res.status(201).json({ ok: true });
      return;
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0]!.message, 400);
    const body = parsed.data;
    if ((body.artistId ? 1 : 0) + (body.galleryId ? 1 : 0) !== 1) throw new AppError('문의할 홈페이지를 찾을 수 없습니다.', 404);
    if (!isContactLike(body.contact)) throw new AppError('답을 받을 이메일이나 전화번호를 적어 주세요.', 400);
    if (countLinks(body.message) > INQUIRY_LINK_MAX) throw new AppError('링크가 너무 많은 글은 보낼 수 없어요.', 400);

    // 받는 사람 — 받기를 켠 작가 홈페이지 또는 갤러리 홈페이지(승인된 것)만. 꺼져 있으면 403(화면이 로그인으로 보낸다)
    let ownerId: number;
    let galleryId: number | null = null;
    let imageId: number | null = null;
    let workTitle: string | null = null;
    if (body.artistId) {
      const owner = await prisma.user.findFirst({
        where: { id: body.artistId, role: 'ARTIST', deletedAt: null },
        select: { id: true, portfolio: { select: { id: true, guestInquiry: true } } },
      });
      if (!owner) throw new AppError('문의할 홈페이지를 찾을 수 없습니다.', 404);
      if (!owner.portfolio?.guestInquiry) throw new AppError('이 홈페이지는 로그인한 회원의 메시지로만 문의를 받아요.', 403);
      ownerId = owner.id;
      // 작품 문의 — 그 작가의 작품일 때만 붙인다(남의 작품 id 는 조용히 뺀다)
      if (body.imageId) {
        const img = await prisma.portfolioImage.findFirst({ where: { id: body.imageId, portfolioId: owner.portfolio.id }, select: { id: true, title: true } });
        if (img) { imageId = img.id; workTitle = img.title?.trim() || null; }
      }
    } else {
      const g = await prisma.gallery.findFirst({
        where: { id: body.galleryId!, status: 'APPROVED', owner: { deletedAt: null } },
        select: { id: true, ownerId: true, guestInquiry: true },
      });
      if (!g) throw new AppError('문의할 홈페이지를 찾을 수 없습니다.', 404);
      if (!g.guestInquiry) throw new AppError('이 갤러리는 로그인한 회원의 메시지로만 문의를 받아요.', 403);
      ownerId = g.ownerId;
      galleryId = g.id;
    }

    // ① 접속 주소당 1시간 5건 — 저장 전에 자리부터 잡는다
    if (!takeInquirySlot(ipKeyGenerator(clientIp(req)))) {
      throw new AppError('문의를 너무 여러 번 보냈어요. 1시간 뒤에 다시 보내 주세요.', 429);
    }

    // ② 받는 사람당 하루 30건 — 세고 나서 만들기를 받는 사람 단위로 줄 세운다(동시에 보내도 넘지 않게, 규칙 46)
    const created = await withKeyLock(LOCK_NS.homepageInquiries, ownerId, async (tx) => {
      const today = await tx.homepageInquiry.count({ where: { ownerId, createdAt: { gte: ownerDaySince() } } });
      if (today >= INQUIRY_PER_OWNER_DAY) throw new AppError('오늘은 이 홈페이지에 문의가 많이 와서 더 받을 수 없어요. 내일 다시 보내 주세요.', 429);
      return tx.homepageInquiry.create({
        data: { ownerId, galleryId, imageId, workTitle, name: body.name, contact: body.contact, message: body.message },
        select: { id: true },
      });
    });

    // 알림 — 이름과 (작품 문의면) 작품 이름까지만. 연락처·내용은 잠금 화면에 띄우지 않는다(앱 푸시도 이 글로 간다)
    try {
      const about = workTitle ? ` — 〈${workTitle}〉` : imageId ? ' — 작품 문의' : '';
      await prisma.notification.create({
        data: {
          userId: ownerId,
          type: 'HOMEPAGE_INQUIRY',
          message: `${body.name}님이 홈페이지로 문의를 남겼어요${about}`,
          linkUrl: homepageInquiryLink(created.id),
          refKey: `homepage-inquiry:${created.id}`,
        },
      });
    } catch { /* 알림은 덤 — 문의는 이미 저장됐다 */ }
    void pruneHomepageInquiries();

    res.status(201).json({ ok: true });
  } catch (error) { next(error); }
});

/** 받은 문의 — 최신 100건. 작품 문의면 지금 그 작품의 사진(지웠으면 보낸 때의 이름만) */
router.get('/mine', authenticate, async (req, res, next) => {
  try {
    void pruneHomepageInquiries();
    const me = req.user!.id;
    const rows = await prisma.homepageInquiry.findMany({
      where: { ownerId: me },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      include: { gallery: { select: { id: true, name: true, handle: true } } },
    });
    const imageIds = [...new Set(rows.map((r) => r.imageId).filter((v): v is number => v != null))];
    const images = imageIds.length
      ? await prisma.portfolioImage.findMany({ where: { id: { in: imageIds }, portfolio: { userId: me } }, select: { id: true, url: true, title: true } })
      : [];
    const byId = new Map(images.map((i) => [i.id, i]));
    const unread = await prisma.homepageInquiry.count({ where: { ownerId: me, readAt: null } });
    res.json({
      unread,
      items: rows.map((r) => {
        const img = r.imageId != null ? byId.get(r.imageId) : undefined;
        return {
          id: r.id, name: r.name, contact: r.contact, message: r.message,
          createdAt: r.createdAt, readAt: r.readAt,
          work: r.imageId != null ? { id: r.imageId, title: img?.title?.trim() || r.workTitle, url: img?.url ?? null } : null,
          gallery: r.gallery,
        };
      }),
    });
  } catch (error) { next(error); }
});

const ownInquiry = async (id: number, me: number) => {
  if (!Number.isInteger(id) || id <= 0) return null;
  return prisma.homepageInquiry.findFirst({ where: { id, ownerId: me }, select: { id: true, readAt: true } });
};

router.patch('/:id/read', authenticate, async (req, res, next) => {
  try {
    const row = await ownInquiry(parseInt(req.params.id as string), req.user!.id);
    if (!row) throw new AppError('문의를 찾을 수 없습니다.', 404);
    // 이미 읽었으면 그 시각을 그대로 둔다(두 번 눌러도 같은 답 — 규칙 46)
    if (!row.readAt) await prisma.homepageInquiry.updateMany({ where: { id: row.id, readAt: null }, data: { readAt: new Date() } });
    // 이 문의 알림도 읽음으로 — 벨에 같은 일이 남아 있지 않게
    await prisma.notification.updateMany({ where: { userId: req.user!.id, refKey: `homepage-inquiry:${row.id}`, read: false }, data: { read: true } });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const row = await ownInquiry(parseInt(req.params.id as string), req.user!.id);
    if (!row) throw new AppError('문의를 찾을 수 없습니다.', 404);
    await prisma.homepageInquiry.deleteMany({ where: { id: row.id, ownerId: req.user!.id } });
    await prisma.notification.deleteMany({ where: { userId: req.user!.id, refKey: `homepage-inquiry:${row.id}` } });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

export default router;
