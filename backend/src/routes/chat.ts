import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AppError } from '../middleware/errorHandler';
import { canEnterChat, openDirectChat, listChats, readChat, unreadChatCount, notifyChatMessage, markChatNotificationsRead, messagePreview, directKeyOf, directSendBlock } from '../lib/chat';
import { safeFileUrl } from '../lib/safeUrl';
import { matchR2Base } from '../lib/r2Urls';
import { CHAT_REF_TYPES, resolveChatRef, readChatRef, type ChatRef } from '../lib/chatRef';
import {
  reserveChatSend, releaseChatSend, chatLimitsOn, blockStateBetween, DIRECT_CHATS_PER_DAY, CHAT_BLOCK_MESSAGES,
} from '../lib/chatSafety';
import { withKeyLock, LOCK_NS } from '../lib/keyLock';
import { CHAT_REPORT_REASONS, createChatReport } from '../lib/chatReport';

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
 *    권한 판정은 오직 "이 방에 들어가도 되는가"(`canEnterChat` — 참여자 + 작가에겐 운영자가 연 단톡만) 하나다.
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
  attachmentSize: z.number().int().nonnegative().max(25 * 1024 * 1024).optional().nullable(),   // 표시용 — 실제 상한(동영상 25MB) 너머는 거짓이다(2026-09-19)
  // 맥락 카드(2026-11-19) — 화면은 무엇에 대한 말인지 `{type,id}` 만 보낸다. 제목·그림·링크는 서버가 만든다(lib/chatRef.ts)
  ref: z.object({ type: z.enum(CHAT_REF_TYPES), id: z.number().int().positive() }).optional().nullable(),
}).refine(
  (d) => (d.content && d.content.trim().length > 0) || (d.attachmentUrl && d.attachmentType) || !!d.ref,
  { message: '내용이나 첨부가 필요합니다.' },
).refine(
  // 주소와 종류는 함께 와야 한다 — 종류만 빠지면 첨부가 **조용히 사라진** 텍스트 메시지가 됐다(2026-09-19)
  (d) => !!d.attachmentUrl === !!d.attachmentType,
  { message: '첨부 주소와 종류를 함께 보내주세요.' },
);
const directSchema = z.object({
  userId: z.number().int().positive(),
});

const muteSchema = z.object({ muted: z.boolean() });
const hiddenSchema = z.object({ hidden: z.boolean() });
const reportSchema = z.object({
  /** 없으면(0) 메시지가 아니라 그 사람(1:1 방) 신고 */
  messageId: z.number().int().positive().optional().nullable(),
  reason: z.enum(CHAT_REPORT_REASONS),
  detail: z.string().trim().max(1000, '자세한 내용은 1000자까지 쓸 수 있어요.').optional().nullable(),
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
    res.json(await listChats(req.user!.id, req.user!.role));
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
    const target = await prisma.user.findFirst({ where: { id: other, deletedAt: null }, select: { id: true, role: true } });
    if (!target) throw new AppError('대화할 수 없는 상대입니다.', 404);
    // ⚠️ 서버 관문(2026-09-19) — 그 전엔 인증만 되면 임의 id 에 갠톡을 열 수 있어 "아무나 말 걸 수 없다"는 설계가 화면 노출에만 기대고 있었다.
    //    화면의 진입점은 작가·갤러리 페이지(=공개된 사람)와 서로 이웃뿐이다. 일반(VISITOR)·운영 계정에는 이미 방이 있거나 서로 이웃일 때만.
    const publicRole = target.role === 'ARTIST' || target.role === 'GALLERY';
    if (!publicRole && req.user!.role !== 'ADMIN') {
      const existing = await prisma.chat.findUnique({ where: { directKey: directKeyOf(me, other) }, select: { id: true } });
      if (!existing) {
        const [a, b] = await Promise.all([
          prisma.follow.findFirst({ where: { followerId: me, followingId: other }, select: { id: true } }),
          prisma.follow.findFirst({ where: { followerId: other, followingId: me }, select: { id: true } }),
        ]);
        if (!a || !b) throw new AppError('대화할 수 없는 상대입니다.', 404);
      }
    }

    // 차단(2026-11-19) — 둘 중 누가 막았든 새로 열지도, 있는 방을 다시 열지도 않는다(누가 막았는지는 말하지 않는다)
    const blocks = await blockStateBetween(me, other);
    if (blocks.byMe) throw new AppError(CHAT_BLOCK_MESSAGES.blocked, 403);
    if (blocks.byThem) throw new AppError(CHAT_BLOCK_MESSAGES.unavailable, 403);

    // 이미 있는 방이면 그 방으로 — 새 방 한도는 **새로 만들 때만** 센다
    const key = directKeyOf(me, other);
    const existingRoom = await prisma.chat.findUnique({ where: { directKey: key }, select: { id: true } });
    if (existingRoom) return res.json({ id: existingRoom.id });
    if (!chatLimitsOn() || req.user!.role === 'ADMIN') return res.json({ id: await openDirectChat(me, other) });

    // 새 1:1 방은 하루 30개(2026-11-19) — 그 전엔 회원이면 작가 179명 전원에게 방을 열 수 있었다.
    // '세고 나서 만들기'라 사람마다 줄 세운다(규칙 46 · withKeyLock). 운영 계정은 세지 않는다.
    // ⚠️ 잠금 안에서는 **tx 만** 쓸 것 — 바깥 `prisma`(openDirectChat)를 부르면 잠금을 쥔 채 연결을 하나 더 달라고 해서,
    //    동시에 몰리면 연결 풀이 바닥나 전부 10초 뒤 실패했다(테스트가 잡았다: 35개 동시 → 8개만 성공).
    try {
      const chatId = await withKeyLock(LOCK_NS.directChats, me, async (tx) => {
        const again = await tx.chat.findUnique({ where: { directKey: key }, select: { id: true } });
        if (again) return again.id;
        const made = await tx.chat.count({ where: { kind: 'DIRECT', createdById: me, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } });
        if (made >= DIRECT_CHATS_PER_DAY) throw new AppError('오늘은 새 대화를 더 열 수 없어요. 내일 다시 시도해 주세요.', 429);
        const chat = await tx.chat.create({
          data: { kind: 'DIRECT', directKey: key, createdById: me, participants: { create: [{ userId: me }, { userId: other }] } },
          select: { id: true },
        });
        return chat.id;
      });
      res.json({ id: chatId });
    } catch (err) {
      // 상대가 같은 순간 반대쪽에서 열었다(잠금은 사람마다라 막지 못한다) — 그 방을 쓴다
      if ((err as { code?: string })?.code === 'P2002') {
        const again = await prisma.chat.findUnique({ where: { directKey: key }, select: { id: true } });
        if (again) return res.json({ id: again.id });
      }
      throw err;
    }
  } catch (e) { next(e); }
});

/**
 * 방 하나 읽기 — 참여자만. 여는 순간 읽음 처리한다.
 *
 * 쿼리 셋 다 선택이고, 아무것도 없으면 **최근 `CHAT_PAGE_SIZE` 개**를 준다.
 *   · `?after=<id>`  폴링 — 그 뒤 새 메시지만 (조용하면 빈 배열)
 *   · `?before=<id>` 더 보기 — 그 앞 지난 메시지
 *   · `?limit=<n>`   한 번에 받을 개수 (서버가 상한을 건다)
 * ⚠️ 옛 화면은 쿼리를 안 붙이므로 그대로 동작한다(응답 형식도 필드가 늘기만 했다).
 */
router.get('/:id', async (req, res, next) => {
  try {
    const chatId = parseInt(req.params.id as string);
    const me = req.user!.id;
    // 404 로 답한다 — 403 은 "그 방이 있다"는 사실을 알려준다
    if (!Number.isFinite(chatId) || !(await canEnterChat(chatId, me, req.user!.role))) {
      throw new AppError('대화를 찾을 수 없습니다.', 404);
    }
    const num = (v: unknown) => {
      const n = parseInt(String(v));
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    const data = await readChat(chatId, me, {
      after: num(req.query.after),
      before: num(req.query.before),
      limit: num(req.query.limit),
    });
    if (!data) throw new AppError('대화를 찾을 수 없습니다.', 404);

    // 읽음 처리는 **방을 열 때**와 **폴링이 새 메시지를 실어 왔을 때**만 쓴다(감사 S11).
    // 예전엔 GET 마다 썼는데 화면이 8초 폴링이라 방을 열어 둔 사용자 1명당 분당 7.5회 쓰기였다.
    // 조용한 폴링(`after` 응답이 빈 배열)은 읽을 게 없으니 DB 를 건드릴 이유가 없다.
    const polling = req.query.after !== undefined;
    if (!polling || data.messages.length > 0) {
      await prisma.chatParticipant.update({
        where: { chatId_userId: { chatId, userId: me } },
        data: { lastReadAt: new Date() },
      });
      await markChatNotificationsRead(chatId, me).catch(() => {});   // 응답 전에 끝낸다 — 배지가 방을 본 뒤에도 남지 않게
    }
    res.json(data);
  } catch (e) { next(e); }
});

/** 메시지 보내기 — 참여자만 */
router.post('/:id/messages', validate(sendSchema), async (req, res, next) => {
  try {
    const chatId = parseInt(req.params.id as string);
    const me = req.user!.id;
    if (!Number.isFinite(chatId) || !(await canEnterChat(chatId, me, req.user!.role))) {
      throw new AppError('대화를 찾을 수 없습니다.', 404);
    }
    const content = String(req.body.content ?? '').trim();

    // 1:1 방 — 상대가 탈퇴했거나 둘 사이에 차단이 있으면 보내지 않는다(2026-11-19).
    // 그 전엔 탈퇴한 상대에게도 저장됐다 — 아무도 읽지 않는 글이 '보냈다'로 남았다.
    const block = await directSendBlock(chatId, me);
    if (block) throw new AppError(CHAT_BLOCK_MESSAGES[block], block === 'deleted' ? 400 : 403);

    // 첨부는 화면이 먼저 업로드한 **우리 저장소** 주소만 받는다(외부 URL 차단 — 위 ownAttachmentUrl 참고)
    const rawType = req.body.attachmentType as string | undefined;
    const attachmentUrl = rawType ? ownAttachmentUrl(req.body.attachmentUrl) : null;
    const attachmentType = attachmentUrl ? rawType! : null;
    if (rawType && !attachmentUrl) throw new AppError('첨부 주소가 올바르지 않습니다.', 400);

    // 맥락 카드 — 서버가 대상(작품은 이 방 사람의 것만)을 확인하고 내용을 찍는다. 화면이 보낸 건 {type,id} 뿐
    let ref: ChatRef | null = null;
    if (req.body.ref) {
      const parts = await prisma.chatParticipant.findMany({ where: { chatId }, select: { userId: true } });
      ref = await resolveChatRef(req.body.ref, parts.map((p) => p.userId));
    }
    if (!content && !attachmentUrl && !ref) throw new AppError('내용이나 첨부가 필요합니다.', 400);

    // 1분 30개(2026-11-19) — 판정과 세기를 한 번에(await 없이). 운영 계정은 세지 않는다(공지를 몰아 보낼 수 있어야 한다)
    if (req.user!.role !== 'ADMIN' && !reserveChatSend(me)) {
      throw new AppError('메시지를 너무 빨리 보내고 있어요. 잠시 후 다시 보내 주세요.', 429);
    }

    let message;
    try {
      [message] = await prisma.$transaction([
      prisma.chatMessage.create({
        data: {
          chatId, senderId: me, content,
          attachmentUrl,
          attachmentType,
          attachmentName: attachmentUrl ? (req.body.attachmentName ? String(req.body.attachmentName).slice(0, 255) : null) : null,
          attachmentSize: attachmentUrl && Number.isFinite(req.body.attachmentSize) ? Number(req.body.attachmentSize) : null,
          ...(ref ? { ref: ref as unknown as Prisma.InputJsonValue } : {}),
        },
        include: { sender: { select: { id: true, name: true, nickname: true, avatar: true } } },
      }),
      // 목록 정렬용 — 매번 집계하지 않기 위해 여기서 함께 갱신한다
      prisma.chat.update({ where: { id: chatId }, data: { lastMessageAt: new Date() } }),
      // 단톡은 운영자(작가가 아닌 참여자)의 첫 메시지로 작가에게 열린다 — 이미 열렸으면 아무 일도 없다(조건부 updateMany)
      ...(req.user!.role !== 'ARTIST'
        ? [prisma.chat.updateMany({ where: { id: chatId, kind: 'GROUP', openedAt: null }, data: { openedAt: new Date() } })]
        : []),
      // 보낸 사람은 당연히 읽은 것이다 (안 하면 자기 메시지가 안읽음으로 잡힌다)
      prisma.chatParticipant.update({
        where: { chatId_userId: { chatId, userId: me } },
        data: { lastReadAt: new Date() },
      }),
    ]);
    } catch (err) {
      releaseChatSend(me);   // 저장하지 못한 시도는 한도에서 돌려준다
      throw err;
    }

    // 알림 벨에도 남긴다 — best-effort (lib/chat.ts notifyChatMessage 참고)
    try {
      await notifyChatMessage(chatId, me, message.sender.nickname || message.sender.name || '회원', messagePreview(message));
    } catch { /* 메시지는 이미 저장됐다 */ }

    // 응답은 방 읽기(`readChat`)의 메시지와 같은 모양으로 — 화면이 그대로 합친다
    res.status(201).json({ ...message, ref: readChatRef(message.ref), sender: { ...message.sender, deleted: false } });
  } catch (e) { next(e); }
});

/** 읽음 처리 (화면을 열어둔 채 새 메시지가 왔을 때) */
/**
 * 이 방 알림 끄기·켜기 — 참여자만(남의 방은 404). 상태를 적어 보낸다(토글이 아니라 — 두 번 눌러도 같은 답, 규칙 46).
 * 끄면 그 뒤 새 메시지가 벨 알림·앱 푸시로 오지 않는다. 이미 와 있는 알림은 그대로 둔다.
 */
router.patch('/:id/mute', validate(muteSchema), async (req, res, next) => {
  try {
    const chatId = parseInt(req.params.id as string);
    const me = req.user!.id;
    if (!Number.isFinite(chatId) || !(await canEnterChat(chatId, me, req.user!.role))) {
      throw new AppError('대화를 찾을 수 없습니다.', 404);
    }
    const muted = req.body.muted as boolean;
    await prisma.chatParticipant.update({ where: { chatId_userId: { chatId, userId: me } }, data: { muted } });
    res.json({ muted });
  } catch (e) { next(e); }
});

/**
 * 목록에서 숨기기·다시 보이기 — 참여자만(남의 방은 404). 상태를 적어 보낸다(규칙 46).
 * 숨기면 그때까지의 말은 읽은 것으로 친다 — 안 그러면 보이지 않는 방의 안 읽은 수가 배지에 남는다.
 * 숨긴 뒤 새 메시지가 오면 저절로 다시 나온다(`isHiddenNow`). 상대에게는 아무 변화가 없다.
 */
router.patch('/:id/hidden', validate(hiddenSchema), async (req, res, next) => {
  try {
    const chatId = parseInt(req.params.id as string);
    const me = req.user!.id;
    if (!Number.isFinite(chatId) || !(await canEnterChat(chatId, me, req.user!.role))) {
      throw new AppError('대화를 찾을 수 없습니다.', 404);
    }
    const hidden = req.body.hidden as boolean;
    const now = new Date();
    await prisma.chatParticipant.update({
      where: { chatId_userId: { chatId, userId: me } },
      data: hidden ? { hiddenAt: now, lastReadAt: now } : { hiddenAt: null },
    });
    if (hidden) await markChatNotificationsRead(chatId, me).catch(() => {});
    res.json({ hidden });
  } catch (e) { next(e); }
});

/**
 * 신고(2026-11-19, 규칙 33 을 닫는다) — 참여자만. 메시지(`messageId`) 또는 1:1 방의 상대를 신고한다.
 * 관리자는 방을 열 수 없으므로 그 메시지와 앞뒤 몇 줄을 **사본**으로 찍어 둔다(lib/chatReport.ts).
 */
router.post('/:id/report', validate(reportSchema), async (req, res, next) => {
  try {
    const chatId = parseInt(req.params.id as string);
    const me = req.user!.id;
    if (!Number.isFinite(chatId) || !(await canEnterChat(chatId, me, req.user!.role))) {
      throw new AppError('대화를 찾을 수 없습니다.', 404);
    }
    const report = await createChatReport({
      reporterId: me, chatId,
      messageId: req.body.messageId ?? null,
      reason: req.body.reason,
      detail: req.body.detail ?? null,
    });
    res.status(201).json({ id: report.id });
  } catch (e) { next(e); }
});

router.post('/:id/read', async (req, res, next) => {
  try {
    const chatId = parseInt(req.params.id as string);
    const me = req.user!.id;
    if (!Number.isFinite(chatId) || !(await canEnterChat(chatId, me, req.user!.role))) {
      throw new AppError('대화를 찾을 수 없습니다.', 404);
    }
    await prisma.chatParticipant.update({
      where: { chatId_userId: { chatId, userId: me } },
      data: { lastReadAt: new Date() },
    });
    await markChatNotificationsRead(chatId, me).catch(() => {});   // 응답 전에 끝낸다 — 배지가 방을 본 뒤에도 남지 않게
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
