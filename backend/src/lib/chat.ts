import prisma from './prisma';

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

export interface ChatSummary {
  id: number;
  kind: 'DIRECT' | 'GROUP';
  title: string | null;
  exhibitionId: number | null;
  lastMessageAt: Date;
  unread: number;
  participants: { id: number; name: string; nickname: string | null; avatar: string | null; role: string }[];
  lastMessage: { content: string; senderId: number; createdAt: Date } | null;
}

const participantSelect = {
  user: { select: { id: true, name: true, nickname: true, avatar: true, role: true } },
} as const;

/** 그 사람이 이 방의 참여자인가 — 모든 읽기·쓰기의 유일한 권한 판정 */
export async function isParticipant(chatId: number, userId: number): Promise<boolean> {
  const row = await prisma.chatParticipant.findUnique({
    where: { chatId_userId: { chatId, userId } },
    select: { id: true },
  });
  return !!row;
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
 * 공모 단톡을 만들거나(없으면) 참여자를 최신 상태로 맞춘다.
 *
 * 참여자 = 운영자(갤러리 오너 + 아트링크 주최면 운영 갤러리 오너들 + 초대한 Admin은 제외) + **수락된 작가**.
 * 공모 승인·작가 수락 등 참여자가 달라지는 시점마다 부르면 된다(멱등).
 *
 * ⚠️ 사람을 **빼지는 않는다**. 수락이 취소돼도 지난 대화를 읽을 수 있어야 하고,
 *    말없이 방에서 사라지면 남은 사람들이 영문을 모른다.
 */
export async function ensureExhibitionChat(exhibitionId: number): Promise<number | null> {
  const ex = await prisma.exhibition.findUnique({
    where: { id: exhibitionId },
    select: {
      id: true, title: true, status: true,
      gallery: { select: { ownerId: true } },
      managers: { select: { gallery: { select: { ownerId: true } } } },
      applications: { where: { status: 'ACCEPTED' }, select: { userId: true } },
    },
  });
  if (!ex || ex.status !== 'APPROVED') return null;

  const memberIds = new Set<number>();
  if (ex.gallery?.ownerId) memberIds.add(ex.gallery.ownerId);
  for (const m of ex.managers) if (m.gallery?.ownerId) memberIds.add(m.gallery.ownerId);
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

/** 내 대화 목록 — 마지막 메시지·안 읽은 수까지 한 번에 */
export async function listChats(userId: number): Promise<ChatSummary[]> {
  const rows = await prisma.chat.findMany({
    where: { participants: { some: { userId } } },
    orderBy: { lastMessageAt: 'desc' },
    include: {
      participants: { include: participantSelect },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  return Promise.all(rows.map(async (c) => {
    const me = c.participants.find(p => p.userId === userId);
    const unread = await prisma.chatMessage.count({
      where: {
        chatId: c.id,
        senderId: { not: userId },                       // 내가 보낸 건 안 읽음이 아니다
        ...(me?.lastReadAt ? { createdAt: { gt: me.lastReadAt } } : {}),
      },
    });
    const last = c.messages[0] ?? null;
    // 목록 미리보기: 본문이 없고 첨부만이면 종류 라벨을 보여준다("[사진]" 등)
    const preview = last
      ? (last.content?.trim() || attachmentLabel(last.attachmentType))
      : '';
    return {
      id: c.id,
      kind: c.kind as 'DIRECT' | 'GROUP',
      title: c.title,
      exhibitionId: c.exhibitionId,
      lastMessageAt: c.lastMessageAt,
      unread,
      participants: c.participants.map(p => p.user),
      lastMessage: last ? { content: preview, senderId: last.senderId, createdAt: last.createdAt } : null,
    };
  }));
}

/** 안 읽은 메시지가 있는 방 개수 (벨 배지) */
export async function unreadChatCount(userId: number): Promise<number> {
  const parts = await prisma.chatParticipant.findMany({
    where: { userId }, select: { chatId: true, lastReadAt: true },
  });
  if (parts.length === 0) return 0;
  let n = 0;
  for (const p of parts) {
    const has = await prisma.chatMessage.findFirst({
      where: {
        chatId: p.chatId,
        senderId: { not: userId },
        ...(p.lastReadAt ? { createdAt: { gt: p.lastReadAt } } : {}),
      },
      select: { id: true },
    });
    if (has) n++;
  }
  return n;
}

/**
 * 메시지 목록 + 읽음 정보.
 *   갠톡 : 내가 보낸 메시지에 `read`(상대가 읽었는가)
 *   단톡 : 각 메시지에 `unreadBy`(아직 안 읽은 사람 수, 보낸 사람 제외)
 */
export async function readChat(chatId: number, userId: number) {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: {
      participants: { include: participantSelect },
      exhibition: { select: { id: true, title: true } },
    },
  });
  if (!chat) return null;

  const messages = await prisma.chatMessage.findMany({
    where: { chatId },
    orderBy: { createdAt: 'asc' },
    include: { sender: { select: { id: true, name: true, nickname: true, avatar: true } } },
  });

  const others = chat.participants.filter(p => p.userId !== userId);
  const withRead = messages.map((m) => {
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

  return {
    id: chat.id,
    kind: chat.kind as 'DIRECT' | 'GROUP',
    title: chat.title,
    exhibition: chat.exhibition,
    participants: chat.participants.map(p => p.user),
    otherCount: others.length,
    messages: withRead,
  };
}
