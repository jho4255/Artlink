/**
 * 작가 로그인 뒤 "홈페이지를 완성해 주세요" 팝업 — **언제** 띄우는가 (2026-10-01, 사용자 요청)
 *
 * 마이페이지 위의 완성도 체크리스트(`ArtistChecklist`)는 그 화면에 들어가야만 보인다. 로그인한 작가가
 * 홈·공모 목록만 보고 나가면 작품 정보가 비어 있다는 걸 알 길이 없었다(실서버: 캡션이 전부 빈 작품 76%).
 * 그래서 **로그인할 때 한 번** 팝업으로 알려준다. 무엇이 비었는지는 체크리스트와 같은 판정(`lib/completeness.ts`)을 쓴다 —
 * 두 화면이 다른 답을 내면 안 된다.
 *
 * 규칙
 *  - 로그인(가입 포함) 한 번에 한 번. 닫으면 다음 로그인 때까지 안 뜬다. 토큰이 7일이라 적어도 주 1회는 다시 묻는다.
 *  - [7일 동안 보지 않기] 를 누르면 그 기간엔 로그인해도 안 뜬다(계정별, 이 브라우저).
 *  - 하던 일을 끊지 않는다 — 지원서·초대 코드 참여·로그인 화면에서는 **기다렸다가** 그 일을 마친 뒤 뜬다.
 *  - 이미 홈페이지 편집 화면이면 띄우지 않고 끝낸다(가라고 할 곳에 이미 와 있다. 그 화면엔 체크리스트가 있다).
 *
 * ⚠️ `armHomepageNudge` 는 **갈 곳을 정한 뒤, navigate 직전에** 부를 것(LoginPage·AuthCallbackPage).
 *    `authStore.login` 안에서 켜면 로그인 직후 잠깐 거치는 화면(/mypage)에서 떴다가 목적지에서 닫히며 번쩍인다.
 */

const ARMED_KEY = 'artlink-homepage-nudge'; // sessionStorage: 팝업을 띄울 사용자 id
const SNOOZE_KEY = 'artlink-homepage-nudge-snooze'; // localStorage: { [userId]: 다시 띄워도 되는 시각(ms) }

export const NUDGE_SNOOZE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
// 사파리 비공개 모드·저장소 차단에서는 접근만 해도 던진다 — 그땐 팝업을 안 띄울 뿐, 로그인은 그대로 된다
const session = (): KV | null => { try { return window.sessionStorage; } catch { return null; } };
const local = (): KV | null => { try { return window.localStorage; } catch { return null; } };

// 저장소는 변경 이벤트가 없다(같은 탭) — 화면이 따라오도록 직접 알린다(useSyncExternalStore)
const listeners = new Set<() => void>();
export function subscribeHomepageNudge(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
const emit = () => listeners.forEach((l) => l());

function readSnooze(l: KV | null): Record<string, number> {
  try {
    const parsed = JSON.parse(l?.getItem(SNOOZE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

export function isHomepageNudgeSnoozed(userId: number, now: number = Date.now(), l: KV | null = local()): boolean {
  const until = Number(readSnooze(l)[String(userId)]);
  return Number.isFinite(until) && until > now;
}

/** 로그인 직후 — 작가이고 '보지 않기' 기간이 아니면 팝업을 예약한다 */
export function armHomepageNudge(user: { id: number; role: string } | null | undefined, now: number = Date.now(), s: KV | null = session(), l: KV | null = local()): void {
  try {
    if (!user || user.role !== 'ARTIST' || isHomepageNudgeSnoozed(user.id, now, l)) s?.removeItem(ARMED_KEY);
    else s?.setItem(ARMED_KEY, String(user.id));
  } catch { /* 저장 못 하면 이번엔 안 띄운다 */ }
  emit();
}

/** 팝업을 봤거나(닫음·이동) 띄울 필요가 없어졌다 — 다음 로그인까지 조용히 */
export function disarmHomepageNudge(s: KV | null = session()): void {
  try { s?.removeItem(ARMED_KEY); } catch { /* 무시 */ }
  emit();
}

/** 지금 팝업이 예약된 사용자 id (없으면 null) */
export function armedHomepageNudgeUserId(s: KV | null = session()): number | null {
  try {
    const raw = s?.getItem(ARMED_KEY);
    const id = raw ? Number(raw) : NaN;
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch { return null; }
}

/** [7일 동안 보지 않기] */
export function snoozeHomepageNudge(userId: number, now: number = Date.now(), s: KV | null = session(), l: KV | null = local()): void {
  try {
    const all = readSnooze(l);
    // 지난 기록은 버린다 — 계정을 바꿔 가며 쓰는 브라우저에서 끝없이 쌓이지 않게
    for (const k of Object.keys(all)) if (!(Number(all[k]) > now)) delete all[k];
    all[String(userId)] = now + NUDGE_SNOOZE_DAYS * DAY_MS;
    l?.setItem(SNOOZE_KEY, JSON.stringify(all));
  } catch { /* 저장 못 하면 이번 로그인만 닫힌다 */ }
  disarmHomepageNudge(s);
}

/**
 * 이 화면에서 팝업을 어떻게 할까.
 *  - `show` : 띄운다
 *  - `wait` : 하던 일이 있다 — 다른 화면으로 갈 때까지 기다린다
 *  - `done` : 이미 홈페이지 편집 화면이다 — 띄우지 않고 끝낸다
 */
export type NudgePlace = 'show' | 'wait' | 'done';
export function nudgePlace(pathname: string, search: string): NudgePlace {
  if (pathname === '/login' || pathname.startsWith('/auth/')) return 'wait';
  if (pathname.startsWith('/join/')) return 'wait';
  if (/^\/exhibitions\/[^/]+\/apply\/?$/.test(pathname)) return 'wait';
  if (pathname === '/mypage' && new URLSearchParams(search).get('tab') === 'homepage-edit') return 'done';
  return 'show';
}
