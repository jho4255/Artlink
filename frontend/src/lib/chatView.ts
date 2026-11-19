/**
 * 대화 화면(ArtTalk)의 **순수 표시 규칙**.
 *
 * 화면(`pages/MessagesPage.tsx`) 안에 두면 눈으로 볼 수는 있어도 확인할 수가 없다.
 * 여기 규칙들은 "한 사람이 세 줄 쓰면 이름 3번·시각 3번이 나온다" 같은 사고가 실제로 났던 자리라
 * 회귀를 테스트로 잡는다(`__tests__/chatView.test.ts`).
 */
import { displayName } from './utils';

export interface ChatViewUser {
  id: number;
  name: string;
  nickname?: string | null;
}

/** 묶음 판정에 필요한 최소한 — 실제 메시지는 필드가 더 많다 */
export interface ChatViewMessage {
  senderId: number;
  createdAt: string;
}

/**
 * 카카오톡처럼 **이어 보낸 말은 한 묶음**으로 본다.
 * 묶음 = 같은 사람 + 같은 분(minute). ISO 문자열의 앞 16자가 `YYYY-MM-DDTHH:MM` 이라 그대로 자른다.
 *
 * ⚠️ 초 단위까지 비교하면 묶이는 일이 거의 없고, 시(hour)까지만 비교하면
 * 한 시간 전 대화가 방금 말과 붙어버린다.
 */
export function sameChatGroup(a?: ChatViewMessage, b?: ChatViewMessage): boolean {
  return !!a && !!b
    && a.senderId === b.senderId
    && a.createdAt.slice(0, 16) === b.createdAt.slice(0, 16);
}

/**
 * i번째 메시지가 묶음의 첫 줄인지 / 마지막 줄인지.
 *   · 이름 : 첫 줄에만 (단톡에서 남의 말일 때만 — 갠톡은 좌우 자리로 구분된다)
 *   · 시각·읽음 : 마지막 줄에만
 */
export function groupFlags(messages: ChatViewMessage[], i: number): { first: boolean; last: boolean } {
  return {
    first: !sameChatGroup(messages[i - 1], messages[i]),
    last: !sameChatGroup(messages[i], messages[i + 1]),
  };
}

/** 이름을 보여줄 자리인가 — 단톡에서 남이 보낸 묶음의 첫 줄 */
export function showsSenderName(
  kind: 'DIRECT' | 'GROUP',
  mine: boolean,
  first: boolean,
): boolean {
  return kind === 'GROUP' && !mine && first;
}

/** 갠톡은 제목이 없다 — 상대 이름으로 만든다(참여자가 나뿐이면 '나') */
export function chatTitle(
  c: { kind: string; title: string | null; participants: ChatViewUser[] },
  myId: number,
): string {
  if (c.kind === 'GROUP') return c.title || '단체 대화';
  const other = c.participants.find(p => p.id !== myId);
  return other ? displayName(other) : '나';
}

/**
 * ── 증분 폴링을 위한 두 규칙 ────────────────────────────────────────
 *
 * 방을 열면 최근 150개만 받고, 이후 폴링은 `?after=<마지막 id>` 로 **새 것만** 받는다.
 * 예전엔 8초마다 방의 메시지를 통째로 다시 받아서, 방이 오래될수록 무거워졌다
 * (실측 5,000개 방 = 1.4MB × 8초마다 = 175KB/s). 그래서 화면이 두 가지를 스스로 해야 한다.
 */

/** 읽음 판정에 필요한 최소한 */
export interface ChatReader { userId: number; lastReadAt: string | null }

export interface ReadableMessage extends ChatViewMessage {
  id: number;
  read?: boolean | null;
  unreadBy?: number | null;
}

/**
 * ① **초기·폴링·더보기 응답을 하나로 합친다.** id 로 겹치는 건 나중 것이 이긴다
 *    (읽음 표시처럼 같은 메시지의 값이 갱신되므로 '있으면 건너뛰기'가 아니라 덮어쓰기다).
 *    대화에는 삭제가 없어서 합치기만으로 안전하다.
 */
export function mergeMessages<T extends { id: number; createdAt: string }>(
  held: T[],
  incoming: T[],
): T[] {
  if (incoming.length === 0) return held;
  const byId = new Map<number, T>();
  for (const m of held) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  // ⚠️ `createdAt` 이 아니라 **id** 로 정렬한다 — 서버와 같은 기준이어야 한다.
  //    동시에 들어온 메시지는 createdAt 이 같은 밀리초라(Postgres now() = 트랜잭션 시작 시각)
  //    시각으로 정렬하면 서버가 준 순서와 어긋난다. id 는 시퀀스라 곧 삽입 순서다.
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/**
 * ② **읽음 표시를 다시 계산한다.**
 *    `after` 응답에는 지난 메시지가 없으니, 상대가 옛 메시지를 읽어도 서버가 준 `read` 값은
 *    캐시에 든 옛날 그대로다. 서버가 매번 함께 주는 참여자별 `lastReadAt`(`readers`)으로
 *    **내가 들고 있는 모든 메시지**를 다시 판정한다.
 *    ⚠️ 판정 규칙은 서버 `lib/chat.ts readChat` 과 **같아야** 한다(회귀는 chatView.test.ts).
 */
export function applyReadState<T extends ReadableMessage>(
  messages: T[],
  kind: 'DIRECT' | 'GROUP',
  readers: ChatReader[],
  myId: number,
): T[] {
  if (readers.length === 0) return messages;
  return messages.map((m) => {
    if (m.senderId !== myId) return m.read == null && m.unreadBy == null ? m : { ...m, read: null, unreadBy: null };
    // 이 메시지를 아직 안 읽은 사람 (보낸 사람 본인은 제외)
    const notRead = readers.filter(
      r => r.userId !== m.senderId && (!r.lastReadAt || r.lastReadAt < m.createdAt),
    ).length;
    const read = kind === 'DIRECT' ? notRead === 0 : null;
    const unreadBy = kind === 'GROUP' ? notRead : null;
    return m.read === read && m.unreadBy === unreadBy ? m : { ...m, read, unreadBy };
  });
}

/** 오늘 보낸 말은 시:분, 지난 말은 월/일 */
export function timeLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

/* ───────────────────────────── ArtTalk 개편(2026-11-19) — 날짜·시각·미리보기·찾기·링크 ─────────────────────────────
 * 시각은 전부 **한국 시간(KST)** 으로 계산한다(규칙 14) — 브라우저 시간대에 맡기면 테스트·서버(UTC)와 날짜 경계가 어긋난다.
 * Intl 을 쓰지 않고 +9시간으로 직접 계산한다(기기마다 'Asia/Seoul' 지원·표기가 달라 테스트가 흔들린다).
 */
const KST_MS = 9 * 3600_000;
const kst = (iso: string | Date) => new Date(new Date(iso).getTime() + KST_MS);
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** KST 날짜 'YYYY-MM-DD' — 날짜 구분 줄의 기준 */
export function dayKey(iso: string): string {
  return kst(iso).toISOString().slice(0, 10);
}

/** 날짜 구분 줄 — '2026년 11월 19일 목요일' */
export function dividerLabel(iso: string): string {
  const d = kst(iso);
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${WEEKDAYS[d.getUTCDay()]}요일`;
}

/** i번째 말 위에 날짜 구분 줄을 그리는가 — 첫 말이거나 앞 말과 날짜(KST)가 다를 때 */
export function showsDayDivider(messages: { createdAt: string }[], i: number): boolean {
  return i === 0 || dayKey(messages[i - 1].createdAt) !== dayKey(messages[i].createdAt);
}

/** 말풍선 옆 시각 — 늘 '오후 8:46'(날짜는 구분 줄이 말한다). 예전 `timeLabel` 은 지난 말에 날짜만 찍고 시각을 버렸다 */
export function bubbleTime(iso: string): string {
  const d = kst(iso);
  const h = d.getUTCHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h < 12 ? '오전' : '오후'} ${h12}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** 목록 시각 — 오늘 '오후 8:46' · 어제 '어제' · 올해 '11.17' · 그 전 '2025.11.17' */
export function listTime(iso: string, now: Date = new Date()): string {
  const day = dayKey(iso);
  const today = dayKey(now.toISOString());
  if (day === today) return bubbleTime(iso);
  if (day === dayKey(new Date(now.getTime() - 86_400_000).toISOString())) return '어제';
  const [y, m, dd] = day.split('-').map(Number);
  return y === Number(today.slice(0, 4)) ? `${m}.${dd}` : `${y}.${m}.${dd}`;
}

/** 역할 꼬리표 — 대화 목록·머리. 운영 계정은 '아트링크'(관리자라는 말을 쓰지 않는다) */
export function chatRoleTag(role?: string | null): string {
  return role === 'ARTIST' ? '작가' : role === 'GALLERY' ? '갤러리' : role === 'VISITOR' ? '일반' : role === 'ADMIN' ? '아트링크' : '';
}

/** 1:1 방의 상대(없으면 null) */
export function chatCounterpartOf<P extends { id: number }>(c: { kind: string; participants: P[] }, myId: number): P | null {
  if (c.kind !== 'DIRECT') return null;
  return c.participants.find((p) => p.id !== myId) ?? null;
}

/** 목록 미리보기 — 내가 보낸 건 '나: …', 단톡의 남의 말은 '보낸 사람: …' */
export function listPreview(
  c: { kind: string; lastMessage: { content: string; senderId: number; senderName?: string } | null },
  myId: number,
): string {
  const m = c.lastMessage;
  if (!m) return '';
  const text = m.content.replace(/\s+/g, ' ').trim();
  if (m.senderId === myId) return `나: ${text}`;
  if (c.kind === 'GROUP' && m.senderName) return `${m.senderName}: ${text}`;
  return text;
}

export type ChatListTab = 'all' | 'unread' | 'direct' | 'group';

/** 목록 거르기 — 탭 + 찾기(방 이름·상대 이름, 대소문자 무시). 서버를 다시 부르지 않는다 */
export function filterChats<C extends { kind: string; title: string | null; unread: number; participants: ChatViewUser[] }>(
  chats: C[], tab: ChatListTab, q: string, myId: number,
): C[] {
  const needle = q.trim().toLowerCase();
  return chats.filter((c) => {
    if (tab === 'unread' && c.unread <= 0) return false;
    if (tab === 'direct' && c.kind !== 'DIRECT') return false;
    if (tab === 'group' && c.kind !== 'GROUP') return false;
    if (!needle) return true;
    return chatTitle(c, myId).toLowerCase().includes(needle);
  });
}

/**
 * 말 속 주소를 누를 수 있게 — 글을 토막 내 [글 | 주소] 로 돌려준다(화면이 React 요소로 그린다).
 * ⚠️ HTML 로 넣지 말 것 — 남이 쓴 글이다. http·https 만 주소로 친다(javascript: 등은 그냥 글).
 * 끝에 붙은 문장부호(마침표·쉼표·닫는 괄호 등)는 주소에서 뗀다 — '사이트는 https://a.com.' 의 마침표가 주소에 붙으면 404 다.
 */
export type TextPart = { kind: 'text'; value: string } | { kind: 'link'; value: string };
export function linkParts(text: string): TextPart[] {
  const out: TextPart[] = [];
  const re = /https?:\/\/[^\s<>"']+/gi;
  let last = 0;
  for (const m of text.matchAll(re)) {
    let url = m[0];
    const trail = /[.,!?;:)\]}'"…。、]+$/.exec(url);
    if (trail) {
      // 주소 안에 여는 괄호가 있으면 닫는 괄호 하나는 주소의 일부다(위키 주소 등)
      let cut = trail[0];
      if (cut.startsWith(')') && url.slice(0, -cut.length).includes('(')) cut = cut.slice(1);
      url = cut ? url.slice(0, -cut.length) : url;
    }
    const start = m.index ?? 0;
    if (start > last) out.push({ kind: 'text', value: text.slice(last, start) });
    out.push({ kind: 'link', value: url });
    last = start + url.length;
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
  return out.length ? out : [{ kind: 'text', value: text }];
}

/** 맥락 카드 이름표 */
export const CHAT_REF_LABEL: Record<string, string> = {
  WORK: '작품 문의',
  EXHIBITION: '공모 문의',
  SHOW: '전시 문의',
  GALLERY: '갤러리 문의',
};

/** 입력 칸 글자 수 — 1,800 부터 '1,812 / 2,000' 을 보여 주고, 넘으면 [보내기]를 잠근다(말없이 자르지 않는다) */
export const CHAT_MAX_LEN = 2000;
export const CHAT_COUNT_FROM = 1800;
