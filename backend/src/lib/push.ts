import type { Prisma } from '@prisma/client';
import type { Message, Messaging } from 'firebase-admin/messaging';
import logger from './logger';
import { prisma, setNotificationHook } from './prisma';
import { splitChatNotice } from './chat';

/**
 * 안드로이드 앱 푸시 알림 (2026-11-09, CLAUDE.md 규칙 79) — 벨 알림(Notification)을 그 사람의 기기로도 보낸다.
 *
 * ⚠️ **보내는 곳은 여기 한 곳**이다. 알림을 만드는 코드(15개 파일 34곳)는 그대로 두고, Prisma 미들웨어(lib/prisma.ts 의 갈고리 —
 *    이 파일이 맨 아래에서 꽂는다)가 Notification 쓰기를 보고 `queuePush(pushItemsFor(...))` 를 부른다. 새 알림을 만들 때 따로 할 일이 없다.
 *    이 파일은 routes/push.ts → index.ts 로 불려 들어온다(시드·스크립트처럼 서버를 띄우지 않는 곳에서는 보내지 않는다).
 *    - create / createMany → 보낸다(createMany 는 행 id 를 모른다 — 누르면 화면으로 가지만 읽음 처리는 못 한다)
 *    - update → **message 를 고쳐 쓰고 그 종류가 REPUSH_TYPES 일 때만**(같은 방에 새 메시지 · 대신 입력). 좋아요 합산처럼
 *      같은 줄의 숫자만 올리는 갱신은 다시 울리지 않는다(좋아요마다 울리면 잔소리). 읽음 처리(read)는 message 가 없어 안 걸린다.
 * ⚠️ 알림 저장을 막지 않는다 — 보내기는 응답 뒤(setImmediate)에 하고 실패는 로그만 남긴다.
 * ⚠️ 꺼짐: FIREBASE_SERVICE_ACCOUNT 가 없거나 PUSH=off 면 아무것도 하지 않는다(토큰 조회도 안 한다). 테스트는 기본으로 꺼져 있다(setup-push.ts).
 * ⚠️ 트랜잭션 안에서 알림을 만들고 그 트랜잭션이 되돌려지면 푸시는 이미 나갔을 수 있다 — 지금은 그런 곳이 없다(tx.notification 0곳).
 */

/** 앱의 알림 채널 — frontend lib/native.ts 가 같은 id 로 만든다(AndroidManifest 기본 채널도 같은 값) */
export const PUSH_CHANNEL_ID = 'artlink';
/** 같은 줄을 고쳐 쓰는(update) 알림 중 '새 소식'인 것만 다시 울린다 */
export const REPUSH_TYPES = new Set(['CHAT_MESSAGE', 'SUBMISSION_PROXY_EDIT']);
/** 이 토큰은 더는 쓸 수 없다(앱 삭제·토큰 갱신) — 지운다. ⚠️ invalid-argument 는 넣지 말 것: 우리 메시지가 틀려도 그 코드가 와서 모든 토큰을 지운다 */
const DEAD_TOKEN_CODES = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);
const BODY_MAX = 180;

/**
 * 알림 제목 — 종류별로 (2026-11-11 사용자 결정). 예전엔 늘 'ArtLink' 라 알림 맨 위의 앱 이름과 같은 말이 두 번 보였다.
 * 무엇에 관한 알림인지 제목만 보고 알 수 있게 짧게. 내용(누가·어느 공모)은 본문(Notification.message)이 말한다.
 * ⚠️ 새 알림 종류를 만들면 여기에도 넣을 것 — 빠지면 'ArtLink' 로 나간다(push.test.ts 가 소스를 훑어 막는다).
 */
export const PUSH_TITLES: Record<string, string> = {
  CHAT_MESSAGE: 'ArtTalk',            // 본문이 '…님의 새 메시지: …' 라 '새 메시지' 로 두면 같은 말이 겹친다 — 메시지 화면 이름으로
  NEW_MESSAGE: '새 메시지',
  INQUIRY_NEW: '1:1 문의',             // 본문이 '새 1:1 문의가 등록되었습니다'
  INQUIRY_REPLY: '문의 답변',
  NEW_APPLICANT: '새 지원·참여',        // 초대 수락·초대 코드 참여도 이 종류로 온다 — '지원자'만은 틀린 말
  APPLICATION_STATUS: '지원 결과',
  EXHIBITION_INVITE: '전시 초대',
  APPROVAL_RESULT: '승인 결과',
  EXHIBITION_MANAGER_ASSIGNED: '공모 운영',
  EXHIBITION_DELETED: '공모 삭제',
  OPERATION_NOTICE: '운영 공지',
  SUBMISSION_REMINDER: '출품 자료 안내',
  SUBMISSION_PROXY_EDIT: '출품 자료',
  SETTLEMENT_CONFIRM_REQUEST: '정산 확인 요청',
  SETTLEMENT_ISSUE: '정산 이의',
  SETTLEMENT_SHARED: '정산',
  SETTLEMENT_REMINDER: '정산 안내',
  SETTLEMENT_AUTO_CLOSED: '정산 안내',
  ARTWORK_LIKE: '좋아요',
  NEIGHBOR_FOLLOW: '새 이웃',
  STORY_COMMENT: '새 댓글',
  POST_COMMENT: '새 댓글',
  MENTION: '멘션',
  GUESTBOOK_NEW: '방명록',
  GUESTBOOK_REPLY: '방명록 답글',
  MESSAGE_SANCTION: '운영 안내',
};

export function pushTitle(type: string | null | undefined): string {
  return (type && PUSH_TITLES[type]) || 'ArtLink';
}
const SEND_BATCH = 500; // FCM sendEach 한 번의 상한

export interface PushItem {
  userId: number;
  body: string;
  linkUrl?: string | null;
  notificationId?: number | null;
  type?: string | null;
  /** 알림 서랍에서 같은 tag 면 새것이 옛것을 대신한다(같은 대화방 알림이 쌓이지 않게) */
  tag?: string | null;
  /** 종류별 제목 대신 쓸 제목(대화 — 보낸 사람·방 이름) */
  title?: string | null;
}

export function isPushEnabled(): boolean {
  return process.env.PUSH !== 'off' && !!process.env.FIREBASE_SERVICE_ACCOUNT;
}

type NotificationRow = { id: number; userId: number; type: string; message: string; linkUrl: string | null; refKey: string | null };

function itemFromRow(row: NotificationRow): PushItem {
  return { userId: row.userId, body: row.message, linkUrl: row.linkUrl, notificationId: row.id, type: row.type, tag: row.refKey ?? `n:${row.id}` };
}

/** Notification 쓰기 한 번 → 보낼 것들. 보낼 게 아니면 [] */
export function pushItemsFor(params: Pick<Prisma.MiddlewareParams, 'model' | 'action' | 'args'>, result: unknown): PushItem[] {
  if (params.model !== 'Notification') return [];
  switch (params.action) {
    case 'create':
      return result ? [itemFromRow(result as NotificationRow)] : [];
    case 'createManyAndReturn':
      return Array.isArray(result) ? (result as NotificationRow[]).map(itemFromRow) : [];
    case 'createMany': {
      const data = params.args?.data;
      const rows: Array<Partial<NotificationRow>> = Array.isArray(data) ? data : data ? [data] : [];
      return rows
        .filter((r) => typeof r.userId === 'number' && typeof r.message === 'string')
        .map((r) => ({ userId: r.userId!, body: r.message!, linkUrl: r.linkUrl ?? null, type: r.type ?? null, tag: r.refKey ?? null }));
    }
    case 'update': {
      const row = result as NotificationRow | null;
      if (!row || typeof params.args?.data?.message !== 'string' || !REPUSH_TYPES.has(row.type)) return [];
      return [itemFromRow(row)];
    }
    default:
      return [];
  }
}

// ─── 보내기 ───

let messagingPromise: Promise<Messaging> | null = null;

/** FIREBASE_SERVICE_ACCOUNT = 서비스 계정 JSON 그대로 또는 base64. ⚠️ 이 값을 로그에 찍지 말 것 */
function parseServiceAccount(raw: string): Record<string, string> {
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(text);
}

function getMessagingClient(): Promise<Messaging> {
  messagingPromise ??= (async () => {
    const { cert, getApps, initializeApp } = await import('firebase-admin/app');
    const { getMessaging } = await import('firebase-admin/messaging');
    const name = 'artlink-push';
    const app = getApps().find((a) => a.name === name)
      ?? initializeApp({ credential: cert(parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT ?? '') as never) }, name);
    return getMessaging(app);
  })().catch((err) => {
    messagingPromise = null; // 다음에 다시 시도(설정을 고치고 재시작하지 않아도)
    throw err;
  });
  return messagingPromise;
}

export function buildMessage(token: string, item: PushItem): Message {
  const body = item.body.length > BODY_MAX ? `${item.body.slice(0, BODY_MAX - 1)}…` : item.body;
  return {
    token,
    notification: { title: item.title || pushTitle(item.type), body },
    // data 값은 전부 문자열이어야 한다(FCM)
    data: { linkUrl: item.linkUrl || '/', notificationId: item.notificationId ? String(item.notificationId) : '', type: item.type ?? '' },
    android: {
      priority: 'high',
      notification: { channelId: PUSH_CHANNEL_ID, color: '#c4302b', ...(item.tag ? { tag: item.tag } : {}) },
    },
  };
}

/**
 * 대화 알림은 카카오톡처럼 — 제목 = 보낸 사람(갠톡) · 방 이름(단톡), 본문 = 메시지(단톡은 '보낸 사람: 메시지').
 * 벨 목록 글('○○님의 새 메시지: …')을 그대로 보내면 서랍에서 이름이 길면 정작 메시지가 잘려 안 보였다(2026-11-11 에뮬레이터).
 * 방 이름·종류는 한 번에 받는다(단톡 20명 × 방 수만큼 묻지 않게).
 */
async function chatStyle(items: PushItem[]): Promise<PushItem[]> {
  const chatId = (it: PushItem) => (it.type === 'CHAT_MESSAGE' && it.tag?.startsWith('chat:') ? Number(it.tag.slice(5)) : NaN);
  const ids = [...new Set(items.map(chatId).filter((n) => Number.isInteger(n)))];
  if (!ids.length) return items;
  const chats = new Map((await prisma.chat.findMany({ where: { id: { in: ids } }, select: { id: true, kind: true, title: true } })).map((c) => [c.id, c]));
  return items.map((it) => {
    const c = chats.get(chatId(it));
    const parts = c ? splitChatNotice(it.body) : null;
    if (!c || !parts) return it;
    return c.kind === 'GROUP'
      ? { ...it, title: c.title || 'ArtTalk', body: `${parts.sender}: ${parts.text}` }
      : { ...it, title: parts.sender, body: parts.text };
  });
}

async function deliver(raw: PushItem[]): Promise<void> {
  const items = await chatStyle(raw);
  const userIds = [...new Set(items.map((i) => i.userId))];
  // 탈퇴한 사람에겐 보내지 않는다(탈퇴할 때 토큰도 지운다 — 혹시 남은 것까지)
  const tokens = await prisma.pushToken.findMany({
    where: { userId: { in: userIds }, user: { deletedAt: null } },
    select: { token: true, userId: true },
  });
  if (!tokens.length) return;
  const byUser = new Map<number, string[]>();
  for (const t of tokens) byUser.set(t.userId, [...(byUser.get(t.userId) ?? []), t.token]);
  const messages = items.flatMap((it) => (byUser.get(it.userId) ?? []).map((tk) => buildMessage(tk, it)));
  if (!messages.length) return;

  const messaging = await getMessagingClient();
  for (let i = 0; i < messages.length; i += SEND_BATCH) {
    const chunk = messages.slice(i, i + SEND_BATCH);
    const res = await messaging.sendEach(chunk);
    const dead: string[] = [];
    res.responses.forEach((r, k) => {
      if (r.success) return;
      const code = r.error?.code ?? '';
      if (DEAD_TOKEN_CODES.has(code)) dead.push((chunk[k] as { token: string }).token);
      else logger.warn('Push', `보내기 실패: ${code || r.error?.message || 'unknown'}`);
    });
    if (dead.length) await prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
  }
}

let queue: PushItem[] = [];
let scheduled = false;
let inflight: Promise<void> = Promise.resolve();

/** 보낼 것을 줄에 세운다 — 같은 틱에 쌓인 것(관리자 전원·단톡 참여자들)을 한 번에 조회해 보낸다. 알림 저장(응답)을 기다리게 하지 않는다 */
export function queuePush(items: PushItem[]): void {
  if (!items.length || !isPushEnabled()) return;
  queue.push(...items);
  if (scheduled) return;
  scheduled = true;
  setImmediate(() => {
    scheduled = false;
    const batch = queue;
    queue = [];
    inflight = inflight
      .then(() => deliver(batch))
      .catch((err) => logger.warn('Push', `보내기 중단: ${err instanceof Error ? err.message : String(err)}`));
  });
}

/** 테스트용 — 줄에 선 것과 보내는 중인 것이 다 끝날 때까지 */
export async function pushIdle(): Promise<void> {
  while (scheduled || queue.length) await new Promise((r) => setImmediate(r));
  await inflight;
}

/** 테스트용 — Firebase 클라이언트를 다시 만들게 한다 */
export function __resetPushForTests(): void {
  messagingPromise = null;
  queue = [];
  scheduled = false;
  inflight = Promise.resolve();
}

// Prisma 갈고리에 꽂는다 — 이 모듈을 불러온 순간부터 벨 알림이 기기로도 간다
setNotificationHook((params, result) => queuePush(pushItemsFor(params, result)));
