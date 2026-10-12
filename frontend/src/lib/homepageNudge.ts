/**
 * 작가 로그인 뒤 "홈페이지를 완성해 주세요" 팝업 — **언제** 띄우는가 (2026-10-01, 사용자 요청)
 *
 * 마이페이지 위의 완성도 안내는 그 화면에 들어가야만 보인다. 로그인한 작가가
 * 홈·공모 목록만 보고 나가면 작품 정보가 비어 있다는 걸 알 길이 없었다(실서버: 캡션이 전부 빈 작품 76%).
 * 그래서 **로그인할 때 한 번** 팝업으로 알려준다. 무엇이 비었는지는 `lib/completeness.ts` 하나가 정한다 —
 * 팝업·프로필 탭의 한 줄·편집 화면의 한 줄이 다른 답을 내면 안 된다.
 *
 * 2026-10-02: 입력을 **유도하는 일은 이 팝업이 맡는다**(사용자 결정). 프로필·포트폴리오·ArtLook 세 탭 위에 붙어 있던
 * '홈페이지 완성도' 상자는 없앴고, [프로필] 탭에 한 줄(`ArtistHomepageLine`)만 남겼다 — 팝업을 닫은 뒤에도 남은 일이 보이게.
 *
 * 규칙
 *  - **하루 첫 방문에 한 번**(2026-10-11, 사용자 결정 — 그 전엔 '로그인할 때 한 번'). 로그인이 7일 유지되므로
 *    로그인할 때만 띄우면 첫 주에 돌아온 작가는 한 번도 못 봤다(실서버: 사진만 올리고 떠난 초원·박경연).
 *    예약은 셋 — 로그인할 때(갈 곳을 정한 뒤) · 앱을 열 때(이미 로그인된 채로) · 숨겼던 탭으로 돌아올 때(날이 바뀌었을 수 있다).
 *    한 번 보여 주면(또는 편집 화면에 이미 와 있으면) 그 KST 날짜를 적어 두고 그날은 다시 띄우지 않는다(계정별, 이 브라우저).
 *  - [7일 동안 보지 않기] 를 누르면 그 기간엔 안 뜬다(계정별, 이 브라우저).
 *  - 하던 일을 끊지 않는다 — 지원서·초대 코드 참여·로그인 화면에서는 **기다렸다가** 그 일을 마친 뒤 뜬다.
 *  - 이미 홈페이지 편집 화면이면 띄우지 않고 끝낸다(가라고 할 곳에 이미 와 있다. 그 화면엔 완성도 한 줄이 있다).
 *
 * ⚠️ 로그인 경로에서는 `armHomepageNudge` 를 **갈 곳을 정한 뒤, navigate 직전에** 부를 것(LoginPage·AuthCallbackPage).
 *    앱을 열 때의 예약(`HomepageNudge`)은 **마운트 한 번 + 탭으로 돌아올 때**뿐이다 — 로그인된 사용자가 바뀔 때마다 걸면
 *    로그인 직후 LoginPage 가 잠깐 보내는 /mypage 에서 예약돼 같은 번쩍임이 난다.
 *    `authStore.login` 안에서 켜면 로그인 직후 잠깐 거치는 화면(/mypage)에서 떴다가 목적지에서 닫히며 번쩍인다.
 */

const ARMED_KEY = 'artlink-homepage-nudge'; // sessionStorage: 팝업을 띄울 사용자 id
const SNOOZE_KEY = 'artlink-homepage-nudge-snooze'; // localStorage: { [userId]: 다시 띄워도 되는 시각(ms) }
const SEEN_KEY = 'artlink-homepage-nudge-seen'; // localStorage: { [userId]: 마지막으로 보여 준 KST 날짜 'YYYY-MM-DD' }

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

/** KST 달력 날짜 'YYYY-MM-DD' — 기기 시간대와 무관하게 한국 날짜로 하루를 가른다(규칙 14) */
export function kstDay(now: number = Date.now()): string {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function readSeen(l: KV | null): Record<string, string> {
  try {
    const parsed = JSON.parse(l?.getItem(SEEN_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

/** 오늘(KST) 이미 보여 줬는가 */
export function isHomepageNudgeSeenToday(userId: number, now: number = Date.now(), l: KV | null = local()): boolean {
  return readSeen(l)[String(userId)] === kstDay(now);
}

/** 오늘은 보여 줬다 — 그날은 다시 예약하지 않는다. 지난 날짜는 버린다(계정을 바꿔 가며 쓰는 브라우저에서 쌓이지 않게) */
export function markHomepageNudgeSeen(userId: number, now: number = Date.now(), l: KV | null = local()): void {
  try {
    const today = kstDay(now);
    const all = readSeen(l);
    for (const k of Object.keys(all)) if (all[k] !== today) delete all[k];
    all[String(userId)] = today;
    l?.setItem(SEEN_KEY, JSON.stringify(all));
  } catch { /* 적지 못하면 그날 다시 뜰 수 있을 뿐이다 */ }
}

/**
 * 팝업을 예약한다 — 작가이고, '보지 않기' 기간이 아니고, 오늘 아직 안 보여 줬으면.
 * 로그인할 때(갈 곳을 정한 뒤) · 앱을 열 때 · 숨겼던 탭으로 돌아올 때 부른다(`HomepageNudge`).
 */
export function armHomepageNudge(user: { id: number; role: string } | null | undefined, now: number = Date.now(), s: KV | null = session(), l: KV | null = local()): void {
  try {
    if (!user || user.role !== 'ARTIST' || isHomepageNudgeSnoozed(user.id, now, l)) s?.removeItem(ARMED_KEY);
    // ⚠️ 이 탭에서 띄웠는데 아직 답하지 않았다(예약이 남아 있다) → '오늘 봤다'가 적혀 있어도 다시 띄운다.
    //    답하면 예약을 지우므로 이 경우는 '화면만 바뀌었다'(배포 뒤 새 판으로 바뀌는 새로고침)뿐이다.
    //    2026-10-12 이전 판은 뜨는 순간 '봤다'를 적었다 — 그 판이 휴대폰에 남아 있으면 다음 방문 때 옛 판이 먼저 떠
    //    적어 두고, 실서버 기준 약 20초 뒤 새 판으로 바뀌면서 지워진다. 그 팝업을 여기서 되살린다(옛 판에서 답했으면 예약이 없어 안 뜬다).
    else if (armedHomepageNudgeUserId(s) === user.id) s?.setItem(ARMED_KEY, String(user.id));
    else if (isHomepageNudgeSeenToday(user.id, now, l)) s?.removeItem(ARMED_KEY);
    else s?.setItem(ARMED_KEY, String(user.id));
  } catch { /* 저장 못 하면 이번엔 안 띄운다 */ }
  emit();
}

/** 팝업을 봤거나(닫음·이동) 띄울 필요가 없어졌다 — 이 탭에서는 다시 예약될 때까지 조용히(날짜 기록은 `markHomepageNudgeSeen`) */
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
