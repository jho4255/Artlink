import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AppError } from '../middleware/errorHandler';
import { isParticipant, openDirectChat, listChats, readChat, unreadChatCount } from '../lib/chat';
import { safeFileUrl } from '../lib/safeUrl';
import { matchR2Base } from '../lib/r2Urls';

/**
 * 대화 첨부는 **우리 저장소 주소만** 허용한다(화면이 방금 `/api/upload/*` 로 올린 것).
 * ⚠️ `safeFileUrl` 만 쓰면 임의 외부 http(s) 주소가 통과해, 받는 사람 브라우저가 그걸 불러온다 →
 *    **IP 추적 픽셀·피싱(외부 악성 파일 링크)** 통로가 된다. 대화는 특정 상대에게 밀어넣는 것이라
 *    자기 프로필 이미지(자기 피해)와 달리 위험하다. 그래서 `/uploads/`(디스크) 또는 R2 공개주소만 통과시킨다.
 */
function ownAttachmentUrl(raw: unknown): string | null {
  const u = safeFileUrl(raw);
  if (!u) return null;
  if (u.startsWith('/uploads/')) return u;   // 로컬/폴백 디스크 저장
  if (matchR2Base(u)) return u;              // R2 공개 주소(화이트리스트)
  return null;
}

/**
 * 대화 API (갠톡·단톡).
 *
 * ⚠️ **역할로 막지 않는다.** 작가끼리도, 갤러리끼리도 대화할 수 있다 —
 *    권한 판정은 오직 "이 방의 참여자인가"(`isParticipant`) 하나다.
 *    예전 쪽지는 라우트마다 역할 규칙이 박혀 있어 작가↔작가가 아예 불가능했다.
 *
 * ⚠️ 대신 **방을 여는 길목**이 좁다. `POST /direct` 는 상대 id 를 받지만,
 *    화면에서 그 사람을 보고 누르는 경로(둘러보기·작가 홈페이지)에서만 노출된다.
 *    단톡은 여기서 못 만든다 — 공모가 승인될 때 서버가 자동으로 만든다(`lib/chat.ts`).
 */
const router = Router();

router.use(authenticate);

// 본문만, 첨부만, 또는 둘 다 — 하나는 있어야 한다.
// 첨부(사진/동영상/파일)는 화면에서 먼저 업로드(`/api/upload/*`)한 뒤 그 결과 url·메타를 함께 보낸다.
const sendSchema = z.object({
  content: z.string().trim().max(2000, '2000자까지 보낼 수 있습니다.').optional().default(''),
  attachmentUrl: z.string().max(2048).optional().nullable(),
  attachmentType: z.enum(['IMAGE', 'VIDEO', 'FILE']).optional().nullable(),
  attachmentName: z.string().max(255).optional().nullable(),
  attachmentSize: z.number().int().nonnegative().max(100 * 1024 * 1024).optional().nullable(),
}).refine(
  (d) => (d.content && d.content.trim().length > 0) || (d.attachmentUrl && d.attachmentType),
  { message: '내용이나 첨부가 필요합니다.' },
);
const directSchema = z.object({
  userId: z.number().int().positive(),
});

/** 안 읽은 메시지가 있는 방 수 (벨 배지) */
router.get('/unread-count', async (req, res, next) => {
  try {
    res.json({ count: await unreadChatCount(req.user!.id) });
  } catch (e) { next(e); }
});

/** 내 대화 목록 */
router.get('/', async (req, res, next) => {
  try {
    res.json(await listChats(req.user!.id));
  } catch (e) { next(e); }
});

/**
 * 갠톡 열기 — 없으면 만들고, 있으면 그 방으로.
 * 화면에서 상대를 보고 누르는 자리에서만 호출된다(둘러보기 작품 모달·작가 홈페이지).
 */
router.post('/direct', validate(directSchema), async (req, res, next) => {
  try {
    const me = req.user!.id;
    const other = req.body.userId as number;
    if (other === me) throw new AppError('자기 자신과는 대화할 수 없습니다.', 400);

    // 탈퇴한 회원과는 새로 시작할 수 없다 (이미 있는 방은 그대로 읽힌다)
    const target = await prisma.user.findFirst({ where: { id: other, deletedAt: null }, select: { id: true } });
    if (!target) throw new AppError('대화할 수 없는 상대입니다.', 404);

    const chatId = await openDirectChat(me, other);
    res.json({ id: chatId });
  } catch (e) { next(e); }
});

/** 방 하나 읽기 — 참여자만. 여는 순간 읽음 처리한다 */
router.get('/:id', async (req, res, next) => {
  try {
    const chatId = parseInt(req.params.id as string);
    const me = req.user!.id;
    // 404 로 답한다 — 403 은 "그 방이 있다"는 사실을 알려준다
    if (!Number.isFinite(chatId) || !(await isParticipant(chatId, me))) {
      throw new AppError('대화를 찾을 수 없습니다.', 404);
    }
    const data = await readChat(chatId, me);
    if (!data) throw new AppError('대화를 찾을 수 없습니다.', 404);

    await prisma.chatParticipant.update({
      where: { chatId_userId: { chatId, userId: me } },
      data: { lastReadAt: new Date() },
    });
    res.json(data);
  } catch (e) { next(e); }
});

/** 메시지 보내기 — 참여자만 */
router.post('/:id/messages', validate(sendSchema), async (req, res, next) => {
  try {
    const chatId = parseInt(req.params.id as string);
    const me = req.user!.id;
    if (!Number.isFinite(chatId) || !(await isParticipant(chatId, me))) {
      throw new AppError('대화를 찾을 수 없습니다.', 404);
    }
    const content = String(req.body.content ?? '').trim();

    // 첨부는 화면이 먼저 업로드한 **우리 저장소** 주소만 받는다(외부 URL 차단 — 위 ownAttachmentUrl 참고)
    const rawType = req.body.attachmentType as string | undefined;
    const attachmentUrl = rawType ? ownAttachmentUrl(req.body.attachmentUrl) : null;
    const attachmentType = attachmentUrl ? rawType! : null;
    if (rawType && !attachmentUrl) throw new AppError('첨부 주소가 올바르지 않습니다.', 400);
    if (!content && !attachmentUrl) throw new AppError('내용이나 첨부가 필요합니다.', 400);

    const [message] = await prisma.$transaction([
      prisma.chatMessage.create({
        data: {
          chatId, senderId: me, content,
          attachmentUrl,
          attachmentType,
          attachmentName: attachmentUrl ? (req.body.attachmentName ? String(req.body.attachmentName).slice(0, 255) : null) : null,
          attachmentSize: attachmentUrl && Number.isFinite(req.body.attachmentSize) ? Number(req.body.attachmentSize) : null,
        },
        include: { sender: { select: { id: true, name: true, nickname: true, avatar: true } } },
      }),
      // 목록 정렬용 — 매번 집계하지 않기 위해 여기서 함께 갱신한다
      prisma.chat.update({ where: { id: chatId }, data: { lastMessageAt: new Date() } }),
      // 보낸 사람은 당연히 읽은 것이다 (안 하면 자기 메시지가 안읽음으로 잡힌다)
      prisma.chatParticipant.update({
        where: { chatId_userId: { chatId, userId: me } },
        data: { lastReadAt: new Date() },
      }),
    ]);

    res.status(201).json(message);
  } catch (e) { next(e); }
});

/** 읽음 처리 (화면을 열어둔 채 새 메시지가 왔을 때) */
router.post('/:id/read', async (req, res, next) => {
  try {
    const chatId = parseInt(req.params.id as string);
    const me = req.user!.id;
    if (!Number.isFinite(chatId) || !(await isParticipant(chatId, me))) {
      throw new AppError('대화를 찾을 수 없습니다.', 404);
    }
    await prisma.chatParticipant.update({
      where: { chatId_userId: { chatId, userId: me } },
      data: { lastReadAt: new Date() },
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
