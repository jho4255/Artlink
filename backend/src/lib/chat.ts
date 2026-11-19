import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { exhibitionNotifyTargets } from './exhibitionAccess';
import { withKeyLock, LOCK_NS } from './keyLock';
import { CHAT_REF_LABELS, readChatRef, type ChatRef, type ChatRefType } from './chatRef';
import { blockStateBetween, blockedIdsOf, type ChatBlockReason } from './chatSafety';

/**
 * 대화(갠톡·단톡) 공용 로직.
 *
 * ## 누가 대화할 수 있나
 * **방에 들어가 있으면 대화할 수 있다** — 그게 전부다. 역할(작가/갤러리)로 막지 않는다.
 * 예전 쪽지는 라우트마다 "작가는 갤러리에게만" 같은 규칙이 박혀 있어 작가끼리 대화가 아예 안 됐다.
 *
 * ## 대신 **방이 생기는 길목**을 좁힌다
 * 아무나 검색해서 말을 걸 수 있으면 스팸이 된다. 방은 두 가지 경로로만 생긴다.
 *   · 갠톡(DIRECT) — 둘러보기·작가 홈페이지에서 **그 사람을 보고** 시작한다(`openDirectChat`)
 *   · 단톡(GROUP)  — 공모가 승인될 때 자동으로 생기고(`ensureExhibitionChat`),
 *                    갤러리(+아트링크 주최면 운영 갤러리들)와 **수락된 작가**가 자동 참여자가 된다
 *
 * ## 읽음
 * 참여자마다 `lastReadAt` 하나만 둔다. 메시지마다 읽음 행을 쌓으면 단톡 20명 × 메시지 수만큼
 * 행이 불어난다 — 시각 하나로 같은 답을 낼 수 있다.
 *   · 갠톡  : 내가 보낸 메시지를 상대의 lastReadAt 과 비교해 '읽음'
 *   · 단톡  : 보낸 사람을 뺀 참여자 중 lastReadAt 이 그 메시지보다 이른 사람 수 = 안 읽은 수
 */

/** 갠톡 중복 방지 키 — 두 사람의 id 를 정렬해 붙인다(누가 먼저 걸든 같은 방) */
export const directKeyOf = (a: number, b: number): string =>
  a < b ? `${a}-${b}` : `${b}-${a}`;

/** 첨부만 있는 메시지의 목록 미리보기 라벨 */
export function attachmentLabel(type?: string | null): string {
  if (type === 'IMAGE') return '[사진]';
  if (type === 'VIDEO') return '[동영상]';
  if (type === 'FILE') return '[파일]';
  return '';
}

/** 목록 미리보기·알림 글 — 글이 있으면 글, 없으면 첨부 종류, 그것도 없으면 맥락 카드 종류('[작품 문의]') */
export function messagePreview(m: { content?: string | null; attachmentType?: string | null; ref?: unknown }): string {
  const text = (m.content ?? '').trim();
  if (text) return text;
  const att = attachmentLabel(m.attachmentType);
  if (att) return att;
  const ref = readChatRef(m.ref);
  return ref ? CHAT_REF_LABELS[ref.type] : '';
}

/** 대화 참여자 — 화면에 내보내는 모양. 탈퇴한 사람은 이름이 이미 '탈퇴한 회원'으로 바뀌어 있고 `deleted` 가 true 다 */
export interface ChatPerson { id: number; name: string; nickname: string | null; avatar: string | null; role: string; deleted: boolean }

export interface ChatSummary {
  id: number;
  kind: 'DIRECT' | 'GROUP';
  title: string | null;
  exhibitionId: number | null;
  /** 단톡의 얼굴 — 그 공모의 포스터(없으면 null) */
  cover: string | null;
  lastMessageAt: Date;
  unread: number;
  /** 내가 이 방 알림을 껐는가 */
  muted: boolean;
  participants: ChatPerson[];
  /** senderName — 단톡 미리보기의 '보낸 사람: 글'(닉네임 우선) */
  lastMessage: { content: string; senderId: number; senderName: string; createdAt: Date } | null;
}

const participantSelect = {
  user: { select: { id: true, name: true, nickname: true, avatar: true, role: true, deletedAt: true, handle: true } },
} as const;

type ParticipantUser = { id: number; name: string; nickname: string | null; avatar: string | null; role: string; deletedAt: Date | null; handle?: string | null };
/** DB 행 → 화면에 내보낼 참여자(탈퇴 시각·핸들은 내보내지 않는다) */
const toPerson = (u: ParticipantUser): ChatPerson => ({
  id: u.id, name: u.name, nickname: u.nickname, avatar: u.avatar, role: u.role, deleted: !!u.deletedAt,
});

/** 숨긴 방인가 — 숨긴 뒤 새 메시지가 왔으면(마지막 메시지가 숨긴 시각보다 뒤) 다시 보인다 */
export const isHiddenNow = (hiddenAt: Date | null | undefined, lastMessageAt: Date): boolean =>
  !!hiddenAt && lastMessageAt.getTime() <= hiddenAt.getTime();

/** 그 사람이 이 방의 참여자인가 (열림 여부는 보지 않는다 — 방에 들어가도 되는가는 `canEnterChat`) */
export async function isParticipant(chatId: number, userId: number): Promise<boolean> {
  const row = await prisma.chatParticipant.findUnique({
    where: { chatId_userId: { chatId, userId } },
    select: { id: true },
  });
  return !!row;
}

/**
 * 아직 작가에게 안 열린 단톡인가 (2026-11-19 — 카카오톡 단체방처럼).
 * 공모 단톡은 승인 때 저절로 생기고 수락된 작가가 들어가지만, **운영자의 첫 메시지 전에는 작가에게 보이지 않는다**
 * (목록·주소 모두 — 남의 방과 같은 404). 단톡의 참여자는 운영자(갤러리 주인·운영 갤러리·관리자)와 수락된 작가뿐이고
 * 작가는 운영자일 수 없으므로(지원은 작가만 한다) 역할로 가른다.
 */
export const groupClosedFor = (chat: { kind: string; openedAt: Date | null }, role: string | undefined): boolean =>
  chat.kind === 'GROUP' && !chat.openedAt && role === 'ARTIST';

/** 이 방에 들어가도 되는가 — 모든 읽기·쓰기의 권한 판정(참여자 + 작가에겐 열린 단톡만). 아니면 라우트가 404 */
export async function canEnterChat(chatId: number, userId: number, role: string | undefined): Promise<boolean> {
  const row = await prisma.chatParticipant.findUnique({
    where: { chatId_userId: { chatId, userId } },
    select: { chat: { select: { kind: true, openedAt: true } } },
  });
  return !!row && !groupClosedFor(row.chat, role);
}

/**
 * 두 사람의 갠톡을 찾거나 만든다.
 * @returns 방 id
 *
 * ⚠️ 자기 자신과는 만들 수 없다(같은 id 두 개면 참여자 유니크 제약에 걸린다).
 * ⚠️ 동시에 두 번 눌러도 방이 하나여야 하므로 `directKey` 유니크 충돌을 잡아 되읽는다.
 */
export async function openDirectChat(a: number, b: number): Promise<number> {
  if (a === b) throw new Error('SELF_CHAT');
  const key = directKeyOf(a, b);
  const found = await prisma.chat.findUnique({ where: { directKey: key }, select: { id: true } });
  if (found) return found.id;
  try {
    const chat = await prisma.chat.create({
      data: {
        kind: 'DIRECT',
        directKey: key,
        createdById: a,
        participants: { create: [{ userId: a }, { userId: b }] },
      },
      select: { id: true },
    });
    return chat.id;
  } catch {
    // 동시 요청이 먼저 만들었다 — 그 방을 쓴다
    const again = await prisma.chat.findUnique({ where: { directKey: key }, select: { id: true } });
    if (!again) throw new Error('CHAT_CREATE_FAILED');
    return again.id;
  }
}

/**
 * 운영자가 작가 한 명에게 갠톡으로 안내를 보낸다 — 자료 제출 안내·정산 확인 재안내(`routes/operation.ts`).
 *
 * ⚠️ 2026-09-19 까지 이 두 안내는 폐기된 `Message`(옛 쪽지) 테이블에 쓰였다. ArtTalk 은 `Chat` 만 읽으므로
 *    갤러리는 "N명에게 보냈습니다" 를 보는데 **작가는 그 글을 볼 방법이 없었다**(정산 금액 설명까지 유실).
 *    `retiredApis.test.ts` 는 프론트 소스만 훑어 서버가 내부적으로 옛 모델에 쓰는 이 경로를 못 잡았다 —
 *    회귀는 `operation.test.ts` 가 `ChatMessage` 에 실제로 들어갔는지 본다.
 * ⚠️ 단톡이 아니라 **갠톡**이다 — 단톡에 보내면 "누가 아직 안 냈는지" 가 전원에게 드러난다.
 * @returns 방 id (알림 링크 `/messages?chat=<id>` 에 쓴다)
 */
export async function sendDirectNotice(fromUserId: number, toUserId: number, text: string): Promise<number> {
  const chatId = await openDirectChat(fromUserId, toUserId);
  const now = new Date();
  await prisma.$transaction([
    prisma.chatMessage.create({ data: { chatId, senderId: fromUserId, content: text } }),
    prisma.chat.update({ where: { id: chatId }, data: { lastMessageAt: now } }),
    // 보낸 사람은 읽은 것이다 — 안 하면 자기 안내가 안읽음으로 잡힌다(`routes/chat.ts` 와 같은 규칙)
    prisma.chatParticipant.update({ where: { chatId_userId: { chatId, userId: fromUserId } }, data: { lastReadAt: now } }),
  ]);
  return chatId;
}

/**
 * 새 메시지 알림 — 보낸 사람을 뺀 참여자에게 `CHAT_MESSAGE` (2026-09-19).
 *
 * 그 전까지 ArtTalk 은 **알림이 전혀 없었다** — 유일한 신호가 Navbar 의 30초 폴링 배지라 브라우저를 열어둘 때만 보였고,
 * 며칠 뒤 접속한 작가의 알림 벨은 비어 있었다("갤러리가 문의를 보냈는데 왜 몰랐지").
 * ⚠️ 방마다 **미읽음 알림 하나**로 합친다(`refKey: chat:<id>`, 작품 좋아요와 같은 방식) — 단톡에서 말이 오갈 때마다
 *    참여자 20명 × 메시지 수만큼 행이 쌓이면 안 된다. 방을 열면 `markChatNotificationsRead` 가 읽음 처리한다.
 * best-effort — 실패해도 메시지 전송은 이미 끝났다.
 */
/** 대화 알림 글 — 벨 목록에 이대로 나온다. 앱 푸시는 `splitChatNotice` 로 다시 갈라 카카오톡처럼(제목 = 보낸 사람) 보낸다 */
export const chatNoticeMessage = (senderName: string, preview: string): string =>
  `${senderName}님의 새 메시지: ${preview.replace(/\s+/g, ' ').slice(0, 60)}`;

/** `chatNoticeMessage` 의 짝 — 모양이 다르면 null(그때는 글 그대로 보낸다) */
export function splitChatNotice(message: string): { sender: string; text: string } | null {
  const m = /^(.+?)님의 새 메시지: ([\s\S]*)$/.exec(message);
  return m ? { sender: m[1], text: m[2] } : null;
}

export async function notifyChatMessage(chatId: number, senderId: number, senderName: string, preview: string): Promise<void> {
  // 이 방 알림을 끈 사람(`muted`)은 뺀다 — 벨 알림이 없으면 앱 푸시도 없다(lib/push.ts 가 벨 알림을 보고 보낸다)
  // 탈퇴한 사람도 뺀다 — 단톡에 남아 있지만 받을 사람이 없다
  const others = await prisma.chatParticipant.findMany({
    where: { chatId, userId: { not: senderId }, muted: false, user: { deletedAt: null } },
    select: { userId: true },
  });
  if (others.length === 0) return;
  const refKey = `chat:${chatId}`;
  const linkUrl = `/messages?chat=${chatId}`;
  const message = chatNoticeMessage(senderName, preview);
  for (const { userId } of others) {
    // ⚠️ '고쳐 쓸 줄이 없으면 만든다'를 받는 사람마다 줄 세운다(2026-11-19) — 같은 방에 메시지 둘이 동시에 오면 둘 다 '없음'을 보고
    //    같은 방 알림이 두 줄이 됐다(`refKey` 는 unique 가 아니다 — 글 좋아요 알림과 같은 구멍, 규칙 46).
    //    알림 쓰기가 잠금 안의 **마지막 쿼리**다(lib/push.ts — 트랜잭션이 되돌려져도 푸시는 이미 나갔을 수 있다).
    //    ⚠️ `update`(한 줄)를 `updateMany` 로 바꾸지 말 것 — 푸시 갈고리가 update 만 다시 울린다(REPUSH_TYPES).
    await withKeyLock(LOCK_NS.chatNotes, userId, async (tx) => {
      const existing = await tx.notification.findFirst({ where: { userId, refKey, read: false }, select: { id: true } });
      if (existing) {
        await tx.notification.update({ where: { id: existing.id }, data: { message, linkUrl, createdAt: new Date() } });
      } else {
        await tx.notification.create({ data: { userId, type: 'CHAT_MESSAGE', message, linkUrl, refKey } });
      }
    });
  }
}

/** 방을 읽었으면 그 방의 새 메시지 알림도 읽은 것이다 — 안 그러면 벨 배지가 방을 이미 본 뒤에도 남는다 */
export async function markChatNotificationsRead(chatId: number, userId: number): Promise<void> {
  await prisma.notification.updateMany({ where: { userId, refKey: `chat:${chatId}`, read: false }, data: { read: true } });
}

/**
 * 공모 단톡을 만들거나(없으면) 참여자를 최신 상태로 맞춘다.
 *
 * 참여자 = 운영자(갤러리 오너 + 아트링크 주최면 운영 갤러리 오너들 + 초대한 Admin은 제외) + **수락된 작가**.
 * 공모 승인·작가 수락 등 참여자가 달라지는 시점마다 부르면 된다(멱등).
 *
 * ⚠️ 사람을 **빼지는 않는다**. 수락이 취소돼도 지난 대화를 읽을 수 있어야 하고,
 *    말없이 방에서 사라지면 남은 사람들이 영문을 모른다.
 */
/**
 * 공모 제목이 바뀌면 단톡방 이름도 따라 바꾼다(방 이름 = 공모 제목). 방이 아직 없으면 아무 일도 없다.
 * 아트링크 주최 공모의 제목 고치기(`PATCH /exhibitions/:id/title`)와 갤러리 수정 요청 승인(approval.ts)이 부른다.
 */
export async function syncExhibitionChatTitle(exhibitionId: number, title: string): Promise<void> {
  try {
    await prisma.chat.updateMany({ where: { exhibitionId }, data: { title } });
  } catch { /* best-effort — 방 이름이 늦게 따라와도 공모 제목은 이미 바뀌었다 */ }
}

export async function ensureExhibitionChat(exhibitionId: number): Promise<number | null> {
  const ex = await prisma.exhibition.findUnique({
    where: { id: exhibitionId },
    select: {
      id: true, title: true, status: true, hostType: true,
      gallery: { select: { ownerId: true } },
      managers: { select: { gallery: { select: { ownerId: true } } } },
      applications: { where: { status: 'ACCEPTED' }, select: { userId: true } },
    },
  });
  if (!ex || ex.status !== 'APPROVED') return null;

  // ⚠️ 운영자가 **반드시 방에 있어야** 한다. 아트링크가 갤러리를 안 끼고 여는 공모(2026-09-10)는
  //    갤러리 오너도 위임 갤러리도 없어서, 그냥 두면 **작가들만 있는 방**이 된다 —
  //    주최자가 공지도 못 하고 작가가 물어볼 곳도 없다. 그럴 때만 Admin 이 들어간다.
  const memberIds = new Set<number>(await exhibitionNotifyTargets(ex as any));
  for (const a of ex.applications) memberIds.add(a.userId);

  const chat = await prisma.chat.upsert({
    where: { exhibitionId },
    update: { title: ex.title },
    create: { kind: 'GROUP', title: ex.title, exhibitionId, createdById: ex.gallery?.ownerId ?? null },
    select: { id: true },
  });

  const existing = await prisma.chatParticipant.findMany({
    where: { chatId: chat.id }, select: { userId: true },
  });
  const have = new Set(existing.map(p => p.userId));
  const toAdd = [...memberIds].filter(id => !have.has(id));
  if (toAdd.length > 0) {
    await prisma.chatParticipant.createMany({
      data: toAdd.map(userId => ({ chatId: chat.id, userId })),
      skipDuplicates: true,
    });
  }
  return chat.id;
}

/**
 * "안 읽음" 조건 — 방마다 기준 시각(`lastReadAt`)이 다르다.
 *
 * ⚠️ 방마다 쿼리를 돌지 말 것. 예전엔 `for (const p of parts)` 로 방 수만큼 쿼리를 날렸는데,
 *    이 계산은 **로그인한 모든 사용자가 30초마다**(Navbar 배지) 부른다 — 방이 늘수록,
 *    사용자가 늘수록 배경 폴링이 DB 커넥션을 다 먹는다.
 *    기준 시각이 방마다 다르니 `OR` 한 덩어리로 묶어 **한 번에** 묻는다.
 */
const unreadWhere = (
  userId: number,
  parts: { chatId: number; lastReadAt: Date | null }[],
) => ({
  OR: parts.map(p => ({
    chatId: p.chatId,
    senderId: { not: userId },                          // 내가 보낸 건 안 읽음이 아니다
    ...(p.lastReadAt ? { createdAt: { gt: p.lastReadAt } } : {}),
  })),
});

/**
 * 내 대화 목록 — 마지막 메시지·안 읽은 수까지 한 번에.
 *
 * 빠지는 방 셋(2026-11-19, ArtTalk 개편):
 *  · **메시지가 없는 1:1 방** — [메시지]·이웃 고르기가 누르는 순간 방을 만들어서, 아무것도 안 보냈는데 상대 목록에 빈 방이 떴다
 *    (실서버 갠톡 2개가 전부 이것이었다). 첫 메시지가 오가면 그때 양쪽 목록에 나온다. 단톡은 서버가 만들고 운영자가 쓸 곳이라 늘 보인다.
 *  · **숨긴 방** — 숨긴 뒤 새 메시지가 오면 다시 나온다(`isHiddenNow`).
 *  · **내가 차단한 사람과의 1:1 방** — 방과 대화는 그대로다(차단을 풀면 돌아온다).
 */
export async function listChats(userId: number, role?: string): Promise<ChatSummary[]> {
  const [rows, blocked] = await Promise.all([
    prisma.chat.findMany({
      where: {
        participants: { some: { userId } },
        OR: [{ kind: 'GROUP' }, { messages: { some: {} } }],
        // 작가에게는 운영자가 첫 말을 보낸(열린) 단톡만 — groupClosedFor 와 같은 규칙
        ...(role === 'ARTIST' ? { NOT: { kind: 'GROUP', openedAt: null } } : {}),
      },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        participants: { include: participantSelect },
        messages: {
          orderBy: { id: 'desc' }, take: 1,   // readChat 과 같이 id — createdAt 은 동시 삽입에서 어긋난다
          include: { sender: { select: { name: true, nickname: true } } },
        },
        exhibition: { select: { imageUrl: true } },
      },
    }),
    blockedIdsOf(userId),
  ]);
  const blockedSet = new Set(blocked);
  const visible = rows.filter((c) => {
    const mine = c.participants.find((p) => p.userId === userId);
    if (isHiddenNow(mine?.hiddenAt, c.lastMessageAt)) return false;
    if (c.kind === 'DIRECT' && c.participants.some((p) => p.userId !== userId && blockedSet.has(p.userId))) return false;
    return true;
  });
  if (visible.length === 0) return [];

  // 방마다 count 를 돌지 않고 한 번에 묶어 센다 (위 unreadWhere 참고)
  const mine = visible.map(c => ({
    chatId: c.id,
    lastReadAt: c.participants.find(p => p.userId === userId)?.lastReadAt ?? null,
  }));
  const grouped = await prisma.chatMessage.groupBy({
    by: ['chatId'],
    where: unreadWhere(userId, mine),
    _count: { _all: true },
  });
  const unreadOf = new Map(grouped.map(g => [g.chatId, g._count._all]));

  return visible.map((c) => {
    const last = c.messages[0] ?? null;
    return {
      id: c.id,
      kind: c.kind as 'DIRECT' | 'GROUP',
      title: c.title,
      exhibitionId: c.exhibitionId,
      cover: c.kind === 'GROUP' ? c.exhibition?.imageUrl ?? null : null,
      lastMessageAt: c.lastMessageAt,
      unread: unreadOf.get(c.id) ?? 0,
      muted: c.participants.find(p => p.userId === userId)?.muted ?? false,
      participants: c.participants.map(p => toPerson(p.user)),
      // 목록 미리보기: 본문이 없고 첨부만이면 종류 라벨("[사진]"), 카드만이면 "[작품 문의]"
      lastMessage: last
        ? { content: messagePreview(last), senderId: last.senderId, senderName: last.sender.nickname || last.sender.name || '회원', createdAt: last.createdAt }
        : null,
    };
  });
}

/** 안 읽은 메시지가 있는 방 개수 (벨 배지) */
export async function unreadChatCount(userId: number): Promise<number> {
  const [all, blocked] = await Promise.all([
    prisma.chatParticipant.findMany({ where: { userId }, select: { chatId: true, lastReadAt: true } }),
    blockedIdsOf(userId),
  ]);
  // 내가 차단한 사람과의 1:1 방은 목록에 없다 — 배지에도 세지 않는다(안 그러면 열 수 없는 숫자가 남는다)
  let parts = all;
  if (blocked.length && all.length) {
    const hidden = await prisma.chat.findMany({
      where: { kind: 'DIRECT', participants: { some: { userId } }, AND: [{ participants: { some: { userId: { in: blocked } } } }] },
      select: { id: true },
    });
    const skip = new Set(hidden.map((c) => c.id));
    parts = all.filter((p) => !skip.has(p.chatId));
  }
  if (parts.length === 0) return 0;
  // 개수가 아니라 **방의 수**라 groupBy 로 방만 뽑는다 (총 2쿼리)
  const grouped = await prisma.chatMessage.groupBy({
    by: ['chatId'],
    where: unreadWhere(userId, parts),
  });
  return grouped.length;
}

/** 방을 열 때 한 번에 내려주는 메시지 수. 화면은 이 뒤로 `before` 로 더 받는다 */
export const CHAT_PAGE_SIZE = 150;
/** 한 번에 받을 수 있는 최대치 — 화면이 큰 수를 보내도 여기서 잘린다 */
const CHAT_MAX_TAKE = 200;

export interface ReadChatOptions {
  /** 이 id **이후**의 새 메시지만 (폴링). 조용하면 빈 배열이라 방 크기와 무관하게 싸다 */
  after?: number;
  /** 이 id **이전**의 지난 메시지 (더 보기) */
  before?: number;
  limit?: number;
}

/**
 * 메시지 목록 + 읽음 정보.
 *   갠톡 : 내가 보낸 메시지에 `read`(상대가 읽었는가)
 *   단톡 : 각 메시지에 `unreadBy`(아직 안 읽은 사람 수, 보낸 사람 제외)
 *
 * ⚠️⚠️ **방의 메시지를 전부 내려주지 말 것.** 예전엔 `take` 가 없어서 방에 쌓인 걸 통째로 보냈는데,
 *    화면이 이 응답을 **8초마다** 다시 받는다(`MessagesPage` refetchInterval). 실측 메시지당 287 bytes 라
 *    5,000개 방이면 1.4MB × 8초마다 = 175KB/s 였다. 방이 오래될수록 무거워지는 구조다.
 *    지금은 최근 `CHAT_PAGE_SIZE` 개만 주고, 폴링은 `after` 로 **새 것만** 받는다(보통 빈 배열).
 *
 * ⚠️⚠️ **커서도 정렬도 `id` 로 한다 — 둘을 다르게 쓰면 메시지가 샌다.**
 *    처음엔 커서만 `id`, 정렬은 `createdAt` 이었는데 그러면 둘의 순서가 어긋난다:
 *    Postgres 의 `now()` 는 **트랜잭션 시작 시각**이라, 동시에 들어온 메시지는 `createdAt` 이 같은
 *    밀리초이거나 심지어 id 순서와 **거꾸로**다(실측: 창의 마지막이 id 269 인데 창 안에 id 265 가 있었다).
 *      · 폴링 : 창의 마지막 id 로 `after` 를 잡으면 **이미 받은 걸 또 받는다**(실측 5건)
 *      · 더보기: 창의 첫 id 로 `before` 를 잡으면 그보다 id 가 큰 옛 메시지를 **영영 못 받는다**
 *    `id` 는 시퀀스라 곧 삽입 순서이고 중복도 빈틈도 없다. 화면 표시는 분(minute) 단위로 묶으므로
 *    밀리초 이하의 차이는 보이지도 않는다. (프론트 `mergeMessages` 도 같은 이유로 id 로 정렬한다)
 *
 * ⚠️ `after` 응답에는 **지난 메시지가 없다.** 그래서 상대가 옛 메시지를 읽어도 그 '읽음' 표시가
 *    안 바뀐다 — 화면이 다시 계산할 수 있게 참여자별 `lastReadAt`(`readers`)을 **매번 함께** 준다.
 *    (같은 규칙이 프론트 `lib/chatView.ts` 의 `applyReadState` 에 있다)
 */
export async function readChat(chatId: number, userId: number, opts: ReadChatOptions = {}) {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: {
      participants: { include: participantSelect },
      exhibition: {
        select: {
          id: true, title: true, imageUrl: true, hostType: true,
          // 운영자 판정용(단톡의 '주최' 표시) — 응답에는 싣지 않는다
          gallery: { select: { ownerId: true } },
          managers: { select: { gallery: { select: { ownerId: true } } } },
        },
      },
    },
  });
  if (!chat) return null;

  const take = Math.min(Math.max(opts.limit ?? CHAT_PAGE_SIZE, 1), CHAT_MAX_TAKE);
  const sender = { sender: { select: { id: true, name: true, nickname: true, avatar: true, deletedAt: true } } };

  let messages;
  let hasMore = false;
  if (opts.after != null) {
    // 폴링 — 새 것만. 더 있으면 화면이 곧 또 부르므로 hasMore 를 따지지 않는다
    messages = await prisma.chatMessage.findMany({
      where: { chatId, id: { gt: opts.after } },
      orderBy: { id: 'asc' }, take, include: sender,
    });
  } else {
    // 최신 쪽에서 take+1 개를 떠서 '더 있는가'를 추가 쿼리 없이 안다
    const where = opts.before != null ? { chatId, id: { lt: opts.before } } : { chatId };
    const desc = await prisma.chatMessage.findMany({
      where, orderBy: { id: 'desc' }, take: take + 1, include: sender,
    });
    hasMore = desc.length > take;
    messages = desc.slice(0, take).reverse();          // 화면은 오래된 것부터 그린다
  }

  const others = chat.participants.filter(p => p.userId !== userId);
  const withRead = messages.map((raw) => {
    // 탈퇴 시각은 내보내지 않는다 · 맥락 카드는 읽을 때 한 번 더 모양을 지킨다(이상한 값은 null)
    const { sender: { deletedAt, ...senderRest }, ref, ...rest } = raw;
    const m = { ...rest, sender: { ...senderRest, deleted: !!deletedAt }, ref: readChatRef(ref) };
    if (m.senderId !== userId) return { ...m, read: null, unreadBy: null };
    // 이 메시지를 아직 안 읽은 사람 (보낸 사람 본인은 제외)
    const notRead = chat.participants.filter(
      p => p.userId !== m.senderId && (!p.lastReadAt || p.lastReadAt < m.createdAt),
    ).length;
    return {
      ...m,
      read: chat.kind === 'DIRECT' ? notRead === 0 : null,
      unreadBy: chat.kind === 'GROUP' ? notRead : null,
    };
  });

  const me = chat.participants.find(p => p.userId === userId);
  const base = {
    id: chat.id,
    kind: chat.kind as 'DIRECT' | 'GROUP',
    title: chat.title,
    exhibition: chat.exhibition ? { id: chat.exhibition.id, title: chat.exhibition.title, imageUrl: chat.exhibition.imageUrl } : null,
    participants: chat.participants.map(p => toPerson(p.user)),
    /** 내가 이 방 알림을 껐는가 */
    muted: me?.muted ?? false,
    /** 내 목록에서 숨긴 방인가(숨긴 뒤 새 메시지가 왔으면 false) */
    hidden: isHiddenNow(me?.hiddenAt, chat.lastMessageAt),
    /** 작가에게 열린 방인가 — 단톡은 운영자의 첫 메시지 뒤에 열린다(갠톡은 늘 true). 운영자 화면이 빈 방 안내를 고른다 */
    opened: chat.kind !== 'GROUP' || !!chat.openedAt,
    otherCount: others.length,
    messages: withRead,
    /** 더 앞(과거) 메시지가 남아 있는가 — `after` 폴링에서는 항상 false */
    hasMore,
    /** 참여자별 마지막 읽은 시각 — 화면이 캐시에 든 옛 메시지의 읽음 표시를 갱신하는 근거 */
    readers: chat.participants.map(p => ({ userId: p.userId, lastReadAt: p.lastReadAt })),
  };
  // 폴링(`after`)에는 방의 '머리' 정보를 다시 싣지 않는다 — 바뀌지 않는 것이고, 몇 초마다 묻기엔 쿼리가 늘어난다.
  // 화면은 방을 열 때 받은 머리를 들고 있는다(새로 온 메시지의 맥락 카드는 메시지에 실려 온다).
  if (opts.after != null) return base;
  return { ...base, ...(await chatRoomMeta(chat, userId)) };
}

/** 1:1 상대 — 이름·역할·탈퇴 여부 + 그 사람 홈페이지 주소(작가 = 핸들·숫자 주소, 갤러리 = 승인된 첫 갤러리) */
export interface ChatCounterpart extends ChatPerson {
  homepage: string | null;
  /** 갤러리 회원이면 그 갤러리 이름(계정 이름과 다를 수 있다) */
  galleryName: string | null;
}

async function counterpartOf(u: ParticipantUser): Promise<ChatCounterpart> {
  const person = toPerson(u);
  if (u.deletedAt) return { ...person, homepage: null, galleryName: null };
  if (u.role === 'ARTIST') return { ...person, homepage: u.handle ? `/@${u.handle}` : `/portfolio/${u.id}`, galleryName: null };
  if (u.role === 'GALLERY') {
    const g = await prisma.gallery.findFirst({
      where: { ownerId: u.id, status: 'APPROVED' }, orderBy: { id: 'asc' }, select: { id: true, handle: true, name: true },
    });
    return { ...person, homepage: g ? (g.handle ? `/@${g.handle}` : `/galleries/${g.id}`) : null, galleryName: g?.name ?? null };
  }
  return { ...person, homepage: null, galleryName: null };
}

/**
 * 방을 **열 때만** 싣는 것 — 1:1 상대(홈페이지 주소) · 단톡 운영자 · 맥락 카드 · 보낼 수 있는가.
 * 쿼리가 몇 개 더 든다(상대 갤러리 · 차단 · 마지막 카드) — 그래서 폴링에서는 빼고 여기 모았다.
 */
async function chatRoomMeta(
  chat: {
    id: number; kind: string;
    participants: { userId: number; user: ParticipantUser }[];
    exhibition: { hostType: string; gallery: { ownerId: number } | null; managers: { gallery: { ownerId: number } | null }[] } | null;
  },
  userId: number,
): Promise<{
  counterpart: ChatCounterpart | null;
  operatorIds: number[];
  context: (ChatRef & { messageId: number }) | null;
  canSend: boolean;
  blockReason: ChatBlockReason | null;
}> {
  const lastRef = await prisma.chatMessage.findFirst({
    where: { chatId: chat.id, ref: { not: Prisma.DbNull } },
    orderBy: { id: 'desc' },
    select: { id: true, ref: true },
  });
  const ref = lastRef ? readChatRef(lastRef.ref) : null;
  const context = ref && lastRef ? { ...ref, messageId: lastRef.id } : null;

  if (chat.kind === 'GROUP') {
    // 단톡의 '주최' — 그 공모의 알림을 받는 사람(갤러리 주인·운영 갤러리, 갤러리 없는 아트링크 공모는 관리자, 규칙 22)
    const operatorIds = chat.exhibition ? await exhibitionNotifyTargets(chat.exhibition as never) : [];
    return { counterpart: null, operatorIds, context, canSend: true, blockReason: null };
  }
  const other = chat.participants.find((p) => p.userId !== userId)?.user;
  if (!other) return { counterpart: null, operatorIds: [], context, canSend: false, blockReason: 'unavailable' };
  const counterpart = await counterpartOf(other);
  let blockReason: ChatBlockReason | null = null;
  if (other.deletedAt) blockReason = 'deleted';
  else {
    const b = await blockStateBetween(userId, other.id);
    blockReason = b.byMe ? 'blocked' : b.byThem ? 'unavailable' : null;
  }
  return { counterpart, operatorIds: [], context, canSend: !blockReason, blockReason };
}

/** 이 사람이 이 방(1:1)에 지금 보낼 수 없는 이유 — 보낼 수 있으면 null. 단톡은 늘 null(차단을 걸지 않는다) */
export async function directSendBlock(chatId: number, userId: number): Promise<ChatBlockReason | null> {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: { kind: true, participants: { where: { userId: { not: userId } }, select: { userId: true, user: { select: { deletedAt: true } } } } },
  });
  if (!chat || chat.kind !== 'DIRECT') return null;
  const other = chat.participants[0];
  if (!other) return 'unavailable';
  if (other.user.deletedAt) return 'deleted';
  const b = await blockStateBetween(userId, other.userId);
  return b.byMe ? 'blocked' : b.byThem ? 'unavailable' : null;
}

export type { ChatRefType };
