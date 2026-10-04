import { peekPostLoginRedirect } from './postLoginRedirect';

/**
 * 카카오 로그인 state(로그인 CSRF 방어값) — 떠날 때 만들어 적어 두고, 돌아왔을 때 맞춰 본다 (2026-10-04)
 *
 * ⚠️ **돌아오는 화면이 로그인을 누른 탭이 아닐 수 있다.** 실서버 비회원 통계(2026-10-04)에 한 방문이
 * `카카오 로그인 3초 → 로그인 1초 → 카카오 로그인 1초 → 가입 정보 입력 23초 → 가입 완료` 로 남았다 — 방문이 콜백 화면에서 시작했다는 건
 * 그 화면이 **탭 저장소(sessionStorage)가 빈 곳**에서 열렸다는 뜻이다(방문 번호도 state 도 그 저장소에 있다). 그래서 state 를 못 찾아
 * '보안 검증에 실패' → 2초 뒤 로그인 화면 → 사용자가 다시 눌러서야 가입됐다. 지원하려던 공모로 돌아갈 길(`post_login_redirect`)도 원래 탭에 두고 왔다.
 * 휴대폰에서 카카오톡 앱으로 인증하고 돌아올 때 새 탭으로 열리거나, 카카오 화면에서 새 창이 열려 거기서 마친 경우 같은 것이다
 * (어느 환경이었는지는 기록에 남지 않는다 — 우리는 기기 정보를 안 남긴다).
 * 그 전(2026-09-19 감사 S4)엔 "정상 경로에서는 늘 값이 있다"고 보고 저장값이 없으면 거절하게 했는데, 그 전제가 틀렸다.
 *
 * 그래서 state 를 **이 브라우저 전체(localStorage)** 에도 적는다 — 같은 브라우저의 다른 탭으로 돌아와도 맞춰 볼 수 있다.
 * - 맞춰 볼 수 있는 값은 **이 브라우저가 직접 적어 둔 것뿐**이다 — 남이 만든 콜백 주소로는 여전히 로그인되지 않는다(로그인 CSRF 방어는 그대로).
 * - 한 번 맞춰 보면 지운다(탭·브라우저 양쪽). 30분이 지나면 버린다. 여러 탭에서 동시에 시작해도 각자 맞춰 보게 몇 개까지 둔다.
 * - 로그인 뒤 돌아갈 곳도 함께 적어 두었다가, 다른 탭으로 돌아왔으면 그 탭에 되살린다(`AuthCallbackPage`).
 * ⚠️ **다른 브라우저**로 돌아온 경우(인스타그램 안에서 시작해 카카오톡 인증 뒤 사파리·크롬으로 열림)는 저장소를 나누지 않으니 여기서도 못 맞춘다.
 *    그때 콜백 화면은 [카카오로 계속하기] 를 한 번 더 누르게 한다(그 브라우저에서 새로 시작 — 이미 인증해 둬서 보통 바로 돌아온다).
 *    ⚠️ state 없이 받아들이지 말 것 — 로그인 CSRF 가 다시 열린다. 자동으로 카카오에 다시 보내지도 말 것 — 사용자 동작 없이 스크립트로
 *    카카오 인증을 부르면 안드로이드에서 카카오톡 앱 실행이 막히거나 창이 닫힌다(카카오 데브톡 안내).
 * 저장소가 막힌 환경에서도 던지지 않는다 — 못 적으면 못 맞출 뿐, 로그인 버튼이 멈추면 안 된다.
 */

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

/** 브라우저 전체에 적어 두는 자리 — `[{ state, provider, at, returnTo? }]` */
export const OAUTH_PENDING_KEY = 'artlink-oauth-pending';
/** 이보다 오래된 state 는 버린다 — 카카오 계정을 새로 만들며 늦게 돌아오는 사람까지 넉넉히 */
export const OAUTH_STATE_TTL_MS = 30 * 60 * 1000;
/** 동시에 진행 중인 로그인 수 상한(탭마다 하나) */
export const OAUTH_PENDING_MAX = 5;
/** 탭 저장소 키 — 옛 이름 그대로 둔다(배포 순간 이미 카카오에 가 있던 사람이 돌아와도 맞춰지게) */
const sessionKey = (provider: string) => `${provider}_state`;

interface Pending { state: string; provider: string; at: number; returnTo?: string }

function get(kv: KV | null, k: string): string | null { try { return kv ? kv.getItem(k) : null; } catch { return null; } }
function set(kv: KV | null, k: string, v: string) { try { kv?.setItem(k, v); } catch { /* 막힌 환경 — 못 적을 뿐 */ } }
function del(kv: KV | null, k: string) { try { kv?.removeItem(k); } catch { /* 조용히 */ } }

/** 적어 둔 목록 — 망가졌거나 오래된 것은 뺀다 */
function readPending(local: KV | null, now: number): Pending[] {
  const raw = get(local, OAUTH_PENDING_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((p): p is Pending => !!p && typeof p.state === 'string' && p.state.length >= 16 && p.state.length <= 128
      && typeof p.provider === 'string' && Number.isFinite(p.at) && now - p.at <= OAUTH_STATE_TTL_MS && p.at - now <= 60_000);
  } catch { return []; }
}
function writePending(local: KV | null, list: Pending[]) {
  if (list.length) set(local, OAUTH_PENDING_KEY, JSON.stringify(list.slice(-OAUTH_PENDING_MAX)));
  else del(local, OAUTH_PENDING_KEY);
}

/** 맞춰 볼 값 — 추측할 수 없는 무작위. `crypto.randomUUID` 가 없는 옛 브라우저(iOS 15.4 전 인앱 등)에서도 버튼이 멈추지 않게 */
export function newOAuthState(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* 아래로 */ }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/** 떠나기 전에 적는다 — 이 탭(옛 방식) + 이 브라우저(다른 탭으로 돌아와도) */
export function saveOAuthState(provider: string, state: string, o: { now: number; session: KV | null; local: KV | null; returnTo?: string | null }) {
  set(o.session, sessionKey(provider), state);
  const list = readPending(o.local, o.now).filter((p) => p.state !== state);
  list.push({ state, provider, at: o.now, ...(o.returnTo ? { returnTo: o.returnTo } : {}) });
  writePending(o.local, list);
}

export interface OAuthCheck {
  ok: boolean;
  /** 로그인 뒤 돌아갈 곳 — 떠날 때 적어 둔 것(없으면 null) */
  returnTo: string | null;
  /** 이 탭이 아니라 같은 브라우저의 다른 탭에서 시작한 로그인이다(탭 저장소엔 없고 브라우저 저장소에 있었다) */
  otherTab: boolean;
}

/** 돌아와서 맞춰 본다 — 맞으면 양쪽에서 지운다(한 번만 쓴다) */
export function takeOAuthState(provider: string, state: string | null, o: { now: number; session: KV | null; local: KV | null }): OAuthCheck {
  const fail: OAuthCheck = { ok: false, returnTo: null, otherTab: false };
  const all = readPending(o.local, o.now);
  // 오래된 것은 여기서 정리해 둔다(맞든 안 맞든)
  const raw = get(o.local, OAUTH_PENDING_KEY);
  if (raw && JSON.stringify(all) !== raw) writePending(o.local, all);
  if (!state) return fail;
  const inTab = get(o.session, sessionKey(provider)) === state;
  const entry = all.find((p) => p.state === state && p.provider === provider);
  if (!inTab && !entry) return fail;
  if (inTab) del(o.session, sessionKey(provider));
  if (entry) writePending(o.local, all.filter((p) => p !== entry));
  return { ok: true, returnTo: entry?.returnTo ?? null, otherTab: !inTab };
}

/* ───────────── 브라우저에 붙이기 ───────────── */

function storage(which: 'session' | 'local'): KV | null {
  try { return which === 'session' ? window.sessionStorage : window.localStorage; } catch { return null; }
}

/** 카카오로 떠나기 직전 — state 를 만들어 적고 돌려준다(로그인 뒤 돌아갈 곳도 함께) */
export function beginOAuthState(provider: string): string {
  const state = newOAuthState();
  saveOAuthState(provider, state, { now: Date.now(), session: storage('session'), local: storage('local'), returnTo: peekPostLoginRedirect() });
  return state;
}

/** 콜백 화면에서 — 이 브라우저가 적어 둔 state 인가 */
export function checkOAuthState(provider: string, state: string | null): OAuthCheck {
  return takeOAuthState(provider, state, { now: Date.now(), session: storage('session'), local: storage('local') });
}
