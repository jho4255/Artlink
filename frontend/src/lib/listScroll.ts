/**
 * 목록 → 공모 한 건 화면 → [← 목록] 으로 돌아왔을 때 **보던 자리** (2026-11-20, 규칙 88).
 * 두 화면이 같은 주소(`/mypage?tab=…`)라 `ScrollToTop` 이 움직이지 않고, 한 건 화면은 열 때 맨 위로 올린다 —
 * 그래서 목록을 열 때의 위치를 적어 두고 돌아오면 되돌린다. 30분이 지났으면(다른 길로 다시 들어온 것) 되돌리지 않는다.
 */
const saved = new Map<string, { y: number; at: number }>();
const TTL_MS = 30 * 60 * 1000;

export function rememberListScroll(key: string, y: number = typeof window !== 'undefined' ? window.scrollY : 0): void {
  saved.set(key, { y, at: Date.now() });
}

/** 되돌릴 위치(없으면 null) — 한 번 쓰면 지운다 */
export function takeListScroll(key: string, now: number = Date.now()): number | null {
  const v = saved.get(key);
  saved.delete(key);
  if (!v || now - v.at > TTL_MS) return null;
  return v.y;
}
