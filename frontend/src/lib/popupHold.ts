/**
 * 알림을 눌러 들어온 화면에서는 팝업을 띄우지 않는다 (2026-11-11, CLAUDE.md 규칙 79).
 *
 * 앱 알림(답변·새 메시지)을 누른 사람은 **그것을 보러 왔다**. 그런데 앱이 꺼져 있다 켜지면 그 방문이 '하루 첫 방문'이라
 * 소개 팝업(규칙 73)·홈페이지 완성 팝업(규칙 51)이 그 화면을 덮었다(2026-11-11 에뮬레이터 실측 — 문의 답변을 눌렀는데 'Welcome to ArtLink').
 * 그래서 알림이 데려간 화면에 있는 동안은 둘 다 기다리고, **다른 화면으로 넘어가면 풀린다** — 그때부터는 원래 규칙대로
 * (지원서·초대 코드 화면에서 기다렸다가 나오면 뜨는 `nudgePlace` 의 'wait' 와 같은 뜻).
 *
 * - '봤다'로 적지 않는다(두 팝업 모두 사람이 답할 때만 적는다) — 이미 떠 있던 팝업은 감추기만 하고, 다음 화면에서 다시 보인다.
 * - 판정 `popupsHeldAt` 은 상태를 바꾸지 않는다(렌더·useSyncExternalStore 에서 불러도 된다). 떠났는지는 `notePopupHoldPath` 가
 *   주소가 바뀔 때마다 본다(lib/native.ts `useNativeBridge`).
 * - 알림이 데려갈 화면에 아직 닿기 전(앱이 막 켜져 라우터를 기다리는 중)에도 막는다. 닿지 못하면 ARRIVE_TIMEOUT_MS 뒤 풀린다.
 * - 브라우저(웹)에서는 아무도 hold 를 걸지 않으므로 늘 false — 웹 동작은 그대로다.
 */
let heldPath: string | null = null;
let arrived = false;
let version = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<() => void>();

export const ARRIVE_TIMEOUT_MS = 10_000;

const norm = (p: string): string => p.split(/[?#]/)[0].replace(/\/+$/, '') || '/';

function livePath(): string {
  try { return window.location.pathname; } catch { return ''; }
}

function changed(): void {
  version += 1;
  subs.forEach((f) => { try { f(); } catch { /* 구독자 하나가 던져도 나머지는 알린다 */ } });
}

function release(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  heldPath = null;
  arrived = false;
  changed();
}

/** 알림을 눌렀다 — 그 알림이 데려갈 화면(path, 쿼리 포함 가능)에 있는 동안 팝업을 막는다 */
export function holdPopupsFor(path: string): void {
  heldPath = norm(path);
  arrived = norm(livePath()) === heldPath; // 이미 그 화면이면 곧바로 '닿았다'(같은 주소로의 이동은 주소 변화가 없다)
  if (timer) clearTimeout(timer);
  timer = arrived ? null : setTimeout(() => { if (heldPath !== null && !arrived) release(); }, ARRIVE_TIMEOUT_MS);
  changed();
}

/** 지금 이 화면에서 팝업을 막아야 하나(상태를 바꾸지 않는다) */
export function popupsHeldAt(pathname: string): boolean {
  if (heldPath === null) return false;
  return !arrived || norm(pathname) === heldPath;
}

/** 주소가 바뀔 때마다 — 데려간 화면에 닿았는지, 거기서 떠났는지 */
export function notePopupHoldPath(pathname: string): void {
  if (heldPath === null) return;
  if (norm(pathname) === heldPath) {
    if (!arrived) {
      arrived = true;
      if (timer) clearTimeout(timer);
      timer = null;
      changed();
    }
  } else if (arrived) {
    release();
  }
}

export function subscribePopupHold(cb: () => void): () => void {
  subs.add(cb);
  return () => { subs.delete(cb); };
}

/** useSyncExternalStore 용 — 바뀔 때마다 오르는 숫자 */
export function popupHoldVersion(): number {
  return version;
}

/** 테스트용 */
export function __resetPopupHold(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  heldPath = null;
  arrived = false;
  version = 0;
  subs.clear();
}
