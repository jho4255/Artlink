import type { Prisma } from '@prisma/client';
import prisma from './prisma';
import { AppError } from '../middleware/errorHandler';
import { messagePreview } from './chat';

/**
 * ArtTalk 신고 (2026-11-19 — CLAUDE.md 규칙 33 '메시지 신고가 화면에서 끊겨 있다'를 닫는다).
 *
 * 예전 신고(`routes/report.ts`)는 옛 쪽지(`Message`)만 받았고, 대화가 ArtTalk(`ChatMessage`)으로 바뀐 뒤로는
 * 말풍선에 신고 버튼도 없어 **신고할 방법이 아예 없었다**. 앱 스토어 심사(1:1 대화가 있는 앱은 신고·차단 필수)에도 걸린다.
 *
 * ⚠️ 관리자도 남의 방을 열 수 없다(남의 방 404 — 그대로 둔다). 대신 신고하는 순간 **그 메시지와 앞뒤 몇 줄을 사본으로** 찍어 둔다.
 *    신고한 사람은 그 방의 참여자라 이미 본 대화다 — 화면이 "신고하면 이 메시지와 앞뒤 대화 일부가 운영자에게 전달돼요"라고 알린다.
 * ⚠️ 같은 사람이 같은 메시지(1:1 방이면 같은 상대)를 두 번 신고하지 못한다 — DB unique 가 판정한다(409, 규칙 46).
 */
export const CHAT_REPORT_REASONS = ['SPAM', 'ABUSE', 'SCAM', 'ETC'] as const;
export type ChatReportReason = (typeof CHAT_REPORT_REASONS)[number];
export const CHAT_REPORT_LABELS: Record<ChatReportReason, string> = {
  SPAM: '스팸·광고',
  ABUSE: '욕설·비방',
  SCAM: '사기 의심',
  ETC: '기타',
};

/** 신고한 메시지 앞뒤로 몇 줄을 찍어 둘까 */
const AROUND = 4;
/** 1:1 방(사람) 신고면 최근 몇 줄 */
const ROOM_TAIL = 10;

export interface ChatReportLine {
  id: number;
  senderId: number;
  senderName: string;
  content: string;
  attachmentType: string | null;
  attachmentUrl: string | null;
  attachmentName: string | null;
  createdAt: string;
  /** 신고한 바로 그 메시지 */
  target: boolean;
}

const lineSelect = {
  id: true, senderId: true, content: true, attachmentType: true, attachmentUrl: true, attachmentName: true, ref: true, createdAt: true,
  sender: { select: { name: true, nickname: true } },
} as const;

type LineRow = Prisma.ChatMessageGetPayload<{ select: typeof lineSelect }>;
const toLine = (m: LineRow, targetId: number | null): ChatReportLine => ({
  id: m.id,
  senderId: m.senderId,
  senderName: m.sender.nickname || m.sender.name || '회원',
  // 글이 없으면 첨부·카드 이름이라도(관리자가 '빈 줄'만 보지 않게)
  content: m.content?.trim() ? m.content : messagePreview(m),
  attachmentType: m.attachmentType,
  attachmentUrl: m.attachmentUrl,
  attachmentName: m.attachmentName,
  createdAt: m.createdAt.toISOString(),
  target: m.id === targetId,
});

export async function createChatReport(input: {
  reporterId: number; chatId: number; messageId: number | null; reason: ChatReportReason; detail: string | null;
}) {
  const { reporterId, chatId, messageId } = input;
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: { id: true, kind: true, title: true, participants: { select: { userId: true } } },
  });
  if (!chat) throw new AppError('대화를 찾을 수 없습니다.', 404);

  let targetUserId: number;
  let lines: ChatReportLine[];
  if (messageId) {
    const msg = await prisma.chatMessage.findFirst({ where: { id: messageId, chatId }, select: { id: true, senderId: true } });
    if (!msg) throw new AppError('신고할 메시지를 찾을 수 없어요.', 404);
    if (msg.senderId === reporterId) throw new AppError('내가 보낸 메시지는 신고할 수 없어요.', 400);
    targetUserId = msg.senderId;
    const [before, after] = await Promise.all([
      prisma.chatMessage.findMany({ where: { chatId, id: { lt: messageId } }, orderBy: { id: 'desc' }, take: AROUND, select: lineSelect }),
      prisma.chatMessage.findMany({ where: { chatId, id: { gte: messageId } }, orderBy: { id: 'asc' }, take: AROUND + 1, select: lineSelect }),
    ]);
    lines = [...before.reverse(), ...after].map((m) => toLine(m, messageId));
  } else {
    // 사람 신고는 1:1 방에서만 — 단톡은 '누구'인지 메시지로 가린다(화면도 말풍선에서만 연다)
    if (chat.kind !== 'DIRECT') throw new AppError('단체 대화는 메시지를 길게 눌러 신고해 주세요.', 400);
    const other = chat.participants.find((p) => p.userId !== reporterId);
    if (!other) throw new AppError('신고할 상대를 찾을 수 없어요.', 404);
    targetUserId = other.userId;
    const tail = await prisma.chatMessage.findMany({ where: { chatId }, orderBy: { id: 'desc' }, take: ROOM_TAIL, select: lineSelect });
    lines = tail.reverse().map((m) => toLine(m, null));
  }

  let report;
  try {
    report = await prisma.chatReport.create({
      data: {
        reporterId, chatId, messageId: messageId ?? 0, targetUserId,
        reason: input.reason,
        detail: input.detail?.trim() || null,
        snapshot: { kind: chat.kind, title: chat.title, lines } as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') throw new AppError('이미 신고했어요. 운영팀이 확인하고 있어요.', 409);
    throw e;
  }

  // 관리자 전원에게 — 벨 + 앱 푸시('ArtTalk 신고'). 신고 한 건에 한 줄(refKey 로 묶을 게 없다). best-effort
  try {
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN', deletedAt: null }, select: { id: true } });
    if (admins.length) {
      await prisma.notification.createMany({
        data: admins.map((a) => ({
          userId: a.id,
          type: 'CHAT_REPORT',
          message: `ArtTalk 신고가 들어왔어요: ${CHAT_REPORT_LABELS[input.reason]}`,
          linkUrl: '/mypage?tab=report-manage',
          refKey: `chat-report:${report.id}`,
        })),
      });
    }
  } catch { /* 신고는 이미 저장됐다 */ }
  return report;
}
