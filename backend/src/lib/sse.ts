/**
 * 메시지 실시간 푸시용 SSE 연결 레지스트리 (단일 인스턴스 메모리 기반).
 * - Render Starter(항상 켜짐, 단일 인스턴스)에서 Redis 없이 동작.
 * - 수평 확장(인스턴스 2개+) 시에는 pub/sub 어댑터 필요.
 */
import type { Response } from 'express';

const clients = new Map<number, Set<Response>>();

export function addClient(userId: number, res: Response): void {
  let set = clients.get(userId);
  if (!set) { set = new Set(); clients.set(userId, set); }
  set.add(res);
}

export function removeClient(userId: number, res: Response): void {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(userId);
}

/** 특정 유저의 모든 열린 연결로 이벤트 전송 */
export function pushToUser(userId: number, event: string, data: unknown): void {
  const set = clients.get(userId);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch { /* 끊긴 연결은 close 핸들러가 정리 */ }
  }
}

export function connectionCount(): number {
  let n = 0;
  for (const set of clients.values()) n += set.size;
  return n;
}
