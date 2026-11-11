/**
 * 앱을 보고 있을 때 온 알림 — 카카오톡처럼 화면 위 배너로 (2026-11-11, CLAUDE.md 규칙 79).
 *
 * 안드로이드는 앱이 앞에 있으면 알림 서랍에 띄우지 않는다(native.ts onPushReceived 가 받는다). 예전엔 벨 숫자만 바뀌어
 * 대화 중이 아니면 메시지가 온 줄 몰랐다. 시스템 알림으로 띄우는 설정(presentationOptions)도 있지만 그러면 **지금 보고 있는 그 방**의
 * 메시지에도 울린다 — 카카오톡은 그 방을 보고 있으면 조용하다. 그래서 화면이 판단한다:
 *  - 알림이 데려갈 화면을 이미 보고 있으면 띄우지 않는다(대화방 · 대화 목록에서 온 대화 알림)
 *  - 아니면 위쪽 배너(누르면 그 화면, 4.5초 뒤 사라짐, 새 것이 오면 바꿔 낀다) — components/shared/PushBanner.tsx
 * ⚠️ 판정은 여기 `pushBannerWanted` 하나 — 테스트가 이걸 본다.
 */
export interface PushBannerItem {
  key: number;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

let current: PushBannerItem | null = null;
let seq = 0;
const subs = new Set<() => void>();
const changed = () => subs.forEach((f) => { try { f(); } catch { /* 하나가 던져도 나머지는 알린다 */ } });

export function showPushBanner(item: Omit<PushBannerItem, 'key'>): void {
  current = { ...item, key: ++seq };
  changed();
}
export function dismissPushBanner(key?: number): void {
  if (!current || (key != null && current.key !== key)) return;   // 그 사이 새 배너로 바뀌었으면 그대로 둔다
  current = null;
  changed();
}
export function getPushBanner(): PushBannerItem | null { return current; }
export function subscribePushBanner(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }

/** 그 알림이 데려갈 화면을 지금 보고 있는가(그러면 배너가 필요 없다) */
export function isOnTarget(linkUrl: string | null | undefined, here: { pathname: string; search: string }, type?: string | null): boolean {
  const norm = (p: string) => p.replace(/\/+$/, '') || '/';
  let target: URL;
  try { target = new URL(linkUrl || '/', 'https://x.invalid'); } catch { return false; }
  const herePath = norm(here.pathname);
  const params = new URLSearchParams(here.search);
  // 대화 알림 — 그 방을 보고 있거나, 대화 목록을 보고 있으면(목록이 곧바로 갱신된다) 조용히
  if (type === 'CHAT_MESSAGE' && herePath === '/messages') {
    const want = target.searchParams.get('chat');
    const open = params.get('chat');
    return !open || open === want;
  }
  if (norm(target.pathname) !== herePath) return false;
  for (const [k, v] of target.searchParams) if (params.get(k) !== v) return false;
  return true;
}

export function pushBannerWanted(data: Record<string, unknown> | undefined, here: { pathname: string; search: string }): boolean {
  const link = typeof data?.linkUrl === 'string' ? data.linkUrl : '/';
  return !isOnTarget(link, here, typeof data?.type === 'string' ? data.type : null);
}

/** 테스트용 */
export function __resetPushBanner(): void { current = null; seq = 0; subs.clear(); }
