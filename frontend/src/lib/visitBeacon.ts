import { useEffect } from 'react';
import api from '@/lib/axios';

/**
 * 일간 방문 기록 (2026-09-28, Admin [통계] 탭) — 서버 `backend/src/lib/visitStats.ts` 가 세는 규칙의 화면 쪽.
 *
 * - 기기마다 무작위 id 하나(localStorage). 이름·이메일·IP 같은 건 보내지 않는다 — 방문자 수를 세는 데 필요 없다.
 * - **하루 한 번**, 그리고 로그인·로그아웃으로 신원이 바뀌면 한 번 더 보낸다(비회원으로 들어와 로그인한 사람을 회원으로 옮기려고).
 *   같은 날·같은 신원이면 다시 안 보낸다 — 페이지를 옮길 때마다 부르면 요청만 늘고 수는 안 바뀐다(서버도 한 줄로 합친다).
 * - 실패해도 조용히 넘어간다 — 통계 때문에 사용자 화면이 흔들리면 안 된다. 재시도도 하지 않는다(다음 방문에 다시 보낸다).
 * - ⚠️ localStorage 가 막힌 환경(사생활 보호 모드 등)에서는 매번 새 id 가 되어 과대 집계될 수 있다 — 그래서 메모리에도 들고 있는다.
 */
const ID_KEY = 'artlink-visitor-id';
const SENT_KEY = 'artlink-visit-sent';
let memoryId: string | null = null;
let memorySent: string | null = null;

function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* 막힌 환경 — 메모리 값으로 버틴다 */ }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // randomUUID 가 없는 옛 브라우저 — 서버 형식(영숫자·하이픈 16~64자)만 맞추면 된다
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
}

export function visitorId(): string {
  const stored = storageGet(ID_KEY);
  if (stored && /^[A-Za-z0-9-]{16,64}$/.test(stored)) return stored;
  memoryId = memoryId ?? newId();
  storageSet(ID_KEY, memoryId);
  return memoryId;
}

/** KST 달력 날짜 'YYYY-MM-DD' — 다시 보낼지 판단용(집계 날짜는 서버가 정한다) */
export function kstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 오늘 이 신원으로 이미 보냈는가 — 보낼 차례면 표시를 남기고 true */
export function claimVisitSlot(userId: number | null, now: Date = new Date()): boolean {
  const mark = `${kstToday(now)}|${userId ?? 'guest'}`;
  if ((storageGet(SENT_KEY) ?? memorySent) === mark) return false;
  memorySent = mark;
  storageSet(SENT_KEY, mark);
  return true;
}

/** App 맨 위에서 한 번 — 사용자 id 가 바뀌면(로그인·로그아웃) 다시 판단한다 */
export function useVisitBeacon(userId: number | null) {
  useEffect(() => {
    if (!claimVisitSlot(userId)) return;
    api.post('/visits', { visitorId: visitorId() }).catch(() => { /* 통계용 — 실패해도 조용히 */ });
  }, [userId]);
}
