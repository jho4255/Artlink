/**
 * 로그인이 풀려도 쓰던 입력을 남긴다 (2026-11-21, 공모 흐름 신뢰성 점검 O6 — 사용자 결정 "남겨").
 *
 * 로그인(7일)이 끝나면 **아무 요청이나** 401 을 받는 순간 로그아웃된다(axios 인터셉터) — 저장 버튼만이 아니라
 * 30초마다 도는 알림 숫자 요청도 그렇다. 그러면 화면이 로그인으로 넘어가고, 로그인하면 같은 화면으로 돌아오지만
 * 쓰던 정산 금액·출품 자료·지원서는 사라져 있었다.
 *
 * 그래서 입력 칸이 있는 화면이 **'지금 저장 안 된 것'을 내주는 함수**를 등록해 두고(`useStashOnAuthLoss`),
 * 인터셉터가 로그아웃하기 직전에 그것들을 이 기기에 적는다(`stashBeforeAuthLoss`). 다시 로그인해 같은 화면이 뜨면
 * 그 화면이 꺼내(`takeAuthStash`) 서버 값 위에 다시 얹는다 — 저장은 사람이 누른다(저장 안 된 변경으로 보인다).
 *
 *  · localStorage — 카카오 로그인은 다른 탭에서 돌아올 수 있다(규칙 64). 계정 번호로 나눠 다른 사람에게는 안 꺼내진다.
 *  · 3일 지나면 버린다 · 한 번 꺼내면 지운다 · 사람이 [로그아웃]을 누르면 전부 지운다(authStore.logout — 만료일 때만 남긴다).
 *  · 저장 안 된 게 없으면 아무것도 적지 않는다(함수가 null 을 돌려준다).
 */
import { useEffect, useRef } from 'react';

const PREFIX = 'artlink-auth-stash:';
export const AUTH_STASH_TTL_MS = 3 * 24 * 60 * 60 * 1000;

const getters = new Map<string, () => unknown>();

const storageKey = (userId: number, key: string) => `${PREFIX}${userId}:${key}`;

function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

/** 화면이 '저장 안 된 것'을 내주는 함수를 등록한다. 돌려받은 함수로 뗀다. */
export function registerAuthStash(key: string, get: () => unknown): () => void {
  getters.set(key, get);
  return () => { if (getters.get(key) === get) getters.delete(key); };
}

/** 로그아웃 직전(401) — 등록된 화면들의 저장 안 된 입력을 이 기기에 적는다. 무슨 일이 있어도 던지지 않는다 */
export function stashBeforeAuthLoss(userId: number | null | undefined): void {
  if (!userId) return;
  const s = storage();
  if (!s) return;
  for (const [key, get] of getters) {
    try {
      const value = get();
      if (value == null) continue;
      s.setItem(storageKey(userId, key), JSON.stringify({ at: Date.now(), value }));
    } catch { /* 저장소가 꽉 찼거나 막혔다 — 다른 화면 것은 계속 */ }
  }
}

function read<T>(s: Storage, k: string): T | null {
  try {
    const raw = s.getItem(k);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; value?: T };
    if (typeof parsed?.at !== 'number' || Date.now() - parsed.at > AUTH_STASH_TTL_MS || parsed.value == null) {
      s.removeItem(k);
      return null;
    }
    return parsed.value;
  } catch {
    try { s.removeItem(k); } catch { /* */ }
    return null;
  }
}

/** 남겨 둔 것이 있는가(꺼내지 않는다) — 화면이 그 탭을 먼저 열지 정할 때 */
export function hasAuthStash(userId: number | null | undefined, key: string): boolean {
  const s = storage();
  if (!userId || !s) return false;
  return read(s, storageKey(userId, key)) != null;
}

/** 들여다본다(지우지 않는다) — 렌더 중에 읽을 땐 이걸 쓰고, 다 쓴 뒤 `dropAuthStash` */
export function peekAuthStash<T>(userId: number | null | undefined, key: string): T | null {
  const s = storage();
  if (!userId || !s) return null;
  return read<T>(s, storageKey(userId, key));
}

export function dropAuthStash(userId: number | null | undefined, key: string): void {
  const s = storage();
  if (!userId || !s) return;
  try { s.removeItem(storageKey(userId, key)); } catch { /* */ }
}

/** 꺼낸다 — 한 번 꺼내면 지운다 */
export function takeAuthStash<T>(userId: number | null | undefined, key: string): T | null {
  const value = peekAuthStash<T>(userId, key);
  dropAuthStash(userId, key);
  return value;
}

/** 이 접두어로 남겨 둔 열쇠들(계정 번호 뒤 부분) — 갤러리 대신 입력처럼 '어느 작가 것인지'를 찾을 때 */
export function authStashKeys(userId: number | null | undefined, prefix: string): string[] {
  const s = storage();
  if (!userId || !s) return [];
  const head = `${PREFIX}${userId}:`;
  const out: string[] = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(head + prefix)) out.push(k.slice(head.length));
    }
  } catch { return []; }
  return out.filter((k) => read(s, head + k) != null);
}

/** 사람이 [로그아웃]을 눌렀다 — 이 기기에 남긴 입력을 전부 지운다(같은 컴퓨터의 다음 사람) */
export function clearAuthStashes(): void {
  const s = storage();
  if (!s) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k?.startsWith(PREFIX)) keys.push(k); }
    keys.forEach((k) => s.removeItem(k));
  } catch { /* */ }
}

/**
 * 화면이 쓴다 — `snapshot()` 은 저장 안 된 게 있을 때만 값을, 없으면 null. 매 렌더 새 함수여도 된다(ref 로 최신 것을 부른다).
 * key 가 null 이면 등록하지 않는다(아직 무엇을 쓰는 화면인지 모를 때 · 잠긴 화면).
 */
export function useStashOnAuthLoss(key: string | null, snapshot: () => unknown): void {
  const fn = useRef(snapshot);
  useEffect(() => { fn.current = snapshot; });
  useEffect(() => {
    if (!key) return;
    return registerAuthStash(key, () => fn.current());
  }, [key]);
}

/** 열쇠 이름 — 화면과 탭 고르기가 같은 이름을 쓰게 */
export const stashKeys = {
  settlement: (exhibitionId: number | string) => `settlement:${exhibitionId}`,
  /** 작가 본인은 자기 번호, 갤러리 대신 입력은 그 작가 번호 */
  submission: (exhibitionId: number | string, artistId: number) => `submission:${exhibitionId}:${artistId}`,
  submissionPrefix: (exhibitionId: number | string) => `submission:${exhibitionId}:`,
  apply: (exhibitionId: number | string) => `apply:${exhibitionId}`,
  /** 낸 지원서 고치기(2026-11-21, 규칙 90) — 새로 쓰던 지원서와 섞이지 않게 따로 */
  applyEdit: (exhibitionId: number | string) => `apply-edit:${exhibitionId}`,
};
