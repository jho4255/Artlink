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

/** 오늘 보낸 말은 시:분, 지난 말은 월/일 */
export function timeLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}
