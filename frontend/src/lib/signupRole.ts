/**
 * 회원가입의 역할 (2026-10-08 사용자 결정).
 * 로그인 화면은 역할을 묻지 않는다 — 어느 역할이든 카카오·이메일 둘 다라 고를 이유가 없고, 로그인하면 **가입했던 계정 그대로** 들어간다.
 * 역할은 [회원가입] 화면(`/signup`)에서 고른다: [아티스트 · 갤러리 · 일반] → [카카오로 가입하기] / [이메일로 가입하기].
 * 카카오로 가입하면 고른 역할을 적어 두고 떠나, 돌아온 '회원 정보 입력'(AuthCallbackPage)이 그 역할을 골라 둔다(두 번 고르지 않게 — 거기서 바꿀 수 있다).
 * 이메일 가입은 주소(`/signup/email?role=`)로 넘긴다.
 *
 * 저장소가 막혀도 던지지 않는다 — 고른 것을 잊을 뿐이다.
 */
export type SignupRole = 'ARTIST' | 'GALLERY' | 'VISITOR';
export const SIGNUP_ROLES: readonly SignupRole[] = ['ARTIST', 'GALLERY', 'VISITOR'];
export const isSignupRole = (v: unknown): v is SignupRole => typeof v === 'string' && (SIGNUP_ROLES as readonly string[]).includes(v);

/** 카카오로 떠나기 직전에 고른 역할 — 돌아온 가입 정보 입력이 이어받는다(다른 탭으로 돌아올 수 있어 localStorage, 30분) */
const SIGNUP_ROLE_KEY = 'artlink-signup-role';
const SIGNUP_ROLE_TTL_MS = 30 * 60_000;

export function stashSignupRole(role: SignupRole, now = Date.now()): void {
  try { localStorage.setItem(SIGNUP_ROLE_KEY, JSON.stringify({ role, at: now })); } catch { /* 막힌 환경 */ }
}
/** 지우지 않고 본다 — StrictMode 가 초기값 함수를 두 번 불러도 같은 답이어야 한다. 가입·로그인을 마치면 `clearSignupRole` */
export function peekSignupRole(now = Date.now()): SignupRole | null {
  try {
    const raw = localStorage.getItem(SIGNUP_ROLE_KEY);
    if (!raw) return null;
    const { role, at } = JSON.parse(raw);
    return isSignupRole(role) && typeof at === 'number' && now - at < SIGNUP_ROLE_TTL_MS ? role : null;
  } catch { return null; }
}
export function clearSignupRole(): void {
  try { localStorage.removeItem(SIGNUP_ROLE_KEY); } catch { /* 막힌 환경 */ }
}

/** 가입하고 갈 곳이 작가만 하는 일이면 아티스트를 골라 둔다 — 공모 지원·초대 코드(광고 → 공모 → 지원으로 오는 길에 한 번 더 누르게 하지 않는다) */
export function contextSignupRole(redirectPath: string | null): SignupRole | null {
  if (!redirectPath) return null;
  const p = redirectPath.split('?')[0] ?? '';
  if (/^\/exhibitions\/\d+\/apply$/.test(p) || /^\/join\/[^/]+$/.test(p)) return 'ARTIST';
  return null;
}
