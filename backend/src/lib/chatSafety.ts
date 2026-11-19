import prisma from './prisma';

/**
 * ArtTalk 안전장치 (2026-11-19, ArtTalk 개편 — 보내기 한도 · 새 방 한도 · 차단).
 *
 * 그 전엔 회원이면 누구에게나(작가 179명 전원) 방을 열고 얼마든지 보낼 수 있었다 — 걸린 건 전역 요청 한도(15분 300)뿐이었다.
 * 앱 스토어 심사(1:1 대화가 있는 앱은 신고·차단 필수)도 이 파일과 신고 라우트가 맡는다.
 *
 * ⚠️ 한도는 테스트(NODE_ENV=test)와 로컬 E2E(DISABLE_RATE_LIMIT=true)에서 꺼진다 — 부하 스펙(e2e 40)이 한 방에 200개를 몰아 넣는다.
 *    테스트에서 한도 자체를 볼 땐 `setChatLimitsForTest(true)` 로 켠다(끝나면 null 로 되돌릴 것).
 */

/** 한 사람이 1분에 보낼 수 있는 메시지 수 — 사람이 손으로 치는 속도로는 닿지 않는다(사진 10장을 한꺼번에 보내도 10) */
export const CHAT_SEND_PER_MIN = 30;
/** 하루(24시간)에 새로 열 수 있는 1:1 방 수 — 이미 있는 방을 다시 여는 건 세지 않는다 */
export const DIRECT_CHATS_PER_DAY = 30;

const SEND_WINDOW_MS = 60_000;
/** 들고 있을 사람 수 상한 — 넘으면 오래 안 보낸 사람부터 비운다(메모리가 끝없이 늘지 않게) */
const MAX_TRACKED = 20_000;

let forced: boolean | null = null;
/** 테스트 전용 — true/false 로 강제, null 이면 환경대로 */
export function setChatLimitsForTest(on: boolean | null): void { forced = on; sends.clear(); }
export function chatLimitsOn(): boolean {
  if (forced !== null) return forced;
  return process.env.NODE_ENV !== 'test' && process.env.DISABLE_RATE_LIMIT !== 'true';
}

// 사람 → 최근 1분 보낸 시각들. 넣은 순서 = 최근에 보낸 순서(보낼 때마다 지우고 맨 뒤로)
const sends = new Map<number, number[]>();

/**
 * 보내기 한 번을 **센다** — 넘었으면 false(세지 않는다).
 * ⚠️ 판정과 세기 사이에 await 가 없다 — 그래야 동시에 들어온 요청이 같은 빈자리를 보고 다 통과하지 않는다(lib/loginThrottle.ts 와 같은 이유).
 * 서버 메모리라 재시작하면 비워진다(인스턴스 하나 — 늘리면 DB·Redis 로 옮길 것).
 */
export function reserveChatSend(userId: number, now: number = Date.now()): boolean {
  if (!chatLimitsOn()) return true;
  const recent = (sends.get(userId) ?? []).filter((t) => now - t < SEND_WINDOW_MS);
  sends.delete(userId);
  if (recent.length >= CHAT_SEND_PER_MIN) {
    sends.set(userId, recent);
    return false;
  }
  recent.push(now);
  sends.set(userId, recent);
  if (sends.size > MAX_TRACKED) {
    for (const k of sends.keys()) {
      if (sends.size <= MAX_TRACKED * 0.9) break;
      sends.delete(k);
    }
  }
  return true;
}

/** 실패한 보내기는 돌려준다 — 400(빈 글·이상한 첨부)으로 끝난 시도까지 한도를 먹지 않게 */
export function releaseChatSend(userId: number): void {
  const arr = sends.get(userId);
  if (arr?.length) arr.pop();
}

/** 둘 사이의 차단 — 누가 누구를 막았는가(둘 다일 수도 있다) */
export async function blockStateBetween(me: number, other: number): Promise<{ byMe: boolean; byThem: boolean }> {
  const rows = await prisma.userBlock.findMany({
    where: { OR: [{ blockerId: me, blockedId: other }, { blockerId: other, blockedId: me }] },
    select: { blockerId: true },
  });
  return { byMe: rows.some((r) => r.blockerId === me), byThem: rows.some((r) => r.blockerId === other) };
}

/** 내가 차단한 사람들 — 목록·안 읽은 수에서 그 사람과의 1:1 방을 뺄 때 */
export async function blockedIdsOf(me: number): Promise<number[]> {
  const rows = await prisma.userBlock.findMany({ where: { blockerId: me }, select: { blockedId: true } });
  return rows.map((r) => r.blockedId);
}

/** 화면에 보일 막힌 이유 — 누가 막았는지는 알리지 않는다('unavailable') */
export type ChatBlockReason = 'deleted' | 'blocked' | 'unavailable';
export const CHAT_BLOCK_MESSAGES: Record<ChatBlockReason, string> = {
  deleted: '탈퇴한 회원에게는 메시지를 보낼 수 없어요.',
  blocked: '차단한 상대예요. 차단을 풀면 메시지를 보낼 수 있어요.',
  unavailable: '메시지를 보낼 수 없는 상대예요.',
};
