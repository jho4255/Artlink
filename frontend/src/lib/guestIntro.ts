/**
 * 소개 팝업 'Welcome to ArtLink' — **언제·누구에게** 띄우는가 (2026-10-18, 사용자 요청 · 같은 날 회원·갤러리로 넓힘)
 *
 * 광고로 들어온 비회원은 대부분 공모 상세 한 화면만 보고 나간다(규칙 64 통계). 아트링크로 무엇을 할 수 있는지를 첫 화면에서 보여 준다 —
 * [작가] ArtLook · 포트폴리오 PDF · 작가 홈페이지 · 공모 간편지원 / [갤러리] ArtLook · 공모 운영 자동화 · 갤러리 홈페이지 · 전시 홍보(위에서 눌러 바꾼다).
 * 어느 화면으로 들어와도(홈 포함) 뜬다. 화면은 `components/shared/GuestIntro.tsx`.
 *
 * 규칙
 *  - **로그인하지 않은 사람** — **방문(탭)마다 한 번**(2026-10-18 사용자 결정 — 처음엔 '브라우저에서 평생 한 번'이었다). 사람이 답하면(가입·로그인·둘러보기·
 *    닫기·ESC·바깥) 그 탭에 적어 두고(sessionStorage) 그 탭에서는 새로고침해도 안 띄운다. 새 탭·다음 방문엔 다시 뜬다.
 *    ⚠️ 이 브라우저로 로그인한 적이 있어도(로그아웃 상태) 띄운다(사용자 결정 — 처음엔 뺐다가 되돌렸다). 다만 이 브라우저에서
 *    누군가 [다시 보지 않기] 를 눌렀으면 로그아웃 상태에서도 안 띄운다.
 *  - **회원**(관리자 제외) — 하루 첫 방문에 한 번, **[다시 보지 않기]** 를 누르면 그 계정은 이 브라우저에서 다시 안 뜬다(사용자 결정).
 *    홈페이지 완성 팝업(규칙 51)이 뜨는 날엔 그쪽에 양보한다 — 한 번에 팝업 둘은 잔소리다. 비회원 소개를 오늘 이 브라우저에서 이미 봤으면(방금 가입) 그날은 안 띄운다.
 *  - 검색 로봇·자동화(navigator.webdriver — E2E·점검 하니스)는 뺀다.
 *  - ⚠️ 뜨는 순간 '봤다'를 적지 말 것 — 답하기 전에 화면이 바뀌거나 새로고침되면 못 본 채로 끝난다(규칙 51 홈페이지 팝업과 같은 사고).
 *  - **하던 일을 끊지 않는다** — 로그인·가입·초대 코드·지원서·약관·마이페이지에서는 안 띄우고, 다른 창(라이트박스 등)이 떠 있으면 기다린다.
 *  - 화면이 자리를 잡은 뒤(`INTRO_SETTLE_MS` 0.6초)에 — 들어오자마자 덮으면 무엇을 보러 왔는지조차 못 본다. 칸 그림은 띄우기 전에 받아 둔다.
 *  - 미리보기 `?intro=1` — 위 조건과 상관없이 띄우고, ⚠️ **아무것도 적지 않는다**(닫아도 이 브라우저의 진짜 한 번이 그대로 남는다 — 처음엔 적어서 미리보기를 본 브라우저에 다시 안 떴다).
 */
import { guestTrackingAllowed } from './guestActivity';
import { kstDay } from './homepageNudge';
import { setPostLoginRedirect, peekPostLoginRedirect } from './postLoginRedirect';

const SEEN_KEY = 'artlink-intro-guest-answered'; // sessionStorage(이 탭): 로그인하지 않은 사람이 답한 시각(ms)
const MEMBER_DAY_KEY = 'artlink-intro-member-day'; // localStorage: { [userId]: 'YYYY-MM-DD' } 그날 답했다(또는 홈페이지 팝업에 양보했다)
const MEMBER_HIDE_KEY = 'artlink-intro-hidden'; // localStorage: { [userId]: 시각 } 다시 보지 않기

// 들어와 이만큼 머문 뒤에 띄운다(2026-10-18 '좀 느리게 뜬다' → 1.5초에서 줄였다). 그림을 받는 동안은 조금 더 기다린다(상한 INTRO_IMG_WAIT_MS)
export const INTRO_SETTLE_MS = 600;
export const INTRO_IMG_WAIT_MS = 2000;

export type IntroSide = 'artist' | 'gallery';
/** 처음 펼칠 쪽 — 갤러리 회원은 갤러리, 그 밖(비회원 포함)은 작가. 광고는 작가를 향한다 */
export function introDefaultSide(role?: string | null): IntroSide { return role === 'GALLERY' ? 'gallery' : 'artist'; }
/** [무료로 시작하기] — 보고 있던 쪽의 역할을 골라 둔 가입 화면(가입 화면에서 바꿀 수 있다) */
export function introSignupHref(side: IntroSide): string { return side === 'gallery' ? '/signup?role=GALLERY' : '/signup?role=ARTIST'; }

/** 미리보기 — 주소에 `?intro=1` 이 있으면 누구에게나 띄운다(로그인했거나 이미 답했어도). 운영자가 자기 브라우저로 확인하려고 */
export function introForced(search: string): boolean {
  try { return new URLSearchParams(search).get('intro') === '1'; } catch { return false; }
}

/** 이 주소에서 띄워도 되는가. 그 일을 하러 온 화면·로그인이 필요한 화면은 뺀다 */
export function introAllowedAt(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (/^\/(login|signup|password|auth|join|terms|privacy|mypage|messages|feed)(\/|$)/.test(p)) return false;
  if (/^\/(galleries|exhibitions|shows)\/new$/.test(p)) return false;
  if (/^\/exhibitions\/[^/]+\/(apply|operation)(\/|$)/.test(p)) return false;
  if (/^\/community\/write$/.test(p)) return false;
  return true;
}

/* ───── 저장소(막힌 환경에서는 이 문서 안에서만 기억한다 — 던지지 않는다) ───── */
const memory = new Map<string, string>();
type Area = 'local' | 'session';
const area = (a: Area): Storage => (a === 'session' ? sessionStorage : localStorage);
function get(key: string, a: Area = 'local'): string | null {
  // 저장소가 열려 있으면 그 값이 진실이다(지웠으면 없는 것) — 메모리는 저장소가 막혔을 때만
  try { return area(a).getItem(key); } catch { return memory.get(`${a}:${key}`) ?? null; }
}
function set(key: string, value: string, a: Area = 'local'): void {
  memory.set(`${a}:${key}`, value);
  try { area(a).setItem(key, value); } catch { /* 막힌 환경 */ }
}
function readMap(key: string): Record<string, string | number> {
  try { const v = JSON.parse(get(key) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

/* ───── 비회원 ───── */

/** 로그인하지 않은 사람에게 띄울 수 있는가 — 아직 답한 적 없고, 이 브라우저에서 아무도 [다시 보지 않기] 를 안 눌렀고, 사람(로봇·자동화가 아님).
 *  로그인한 적 있는 브라우저(로그아웃 상태)도 띄운다(2026-10-18 사용자 결정) */
export function introAudience(o: { authenticated: boolean; hiddenHere: boolean; ua: string; webdriver: boolean; answered: boolean }): boolean {
  return !o.authenticated && !o.webdriver && !o.answered && !o.hiddenHere && guestTrackingAllowed(o.ua, false);
}
/** 이 탭에서 이미 답했는가 — 새 탭·다음 방문엔 다시 뜬다 */
export function isIntroAnswered(): boolean { return !!get(SEEN_KEY, 'session'); }
export function markIntroAnswered(now: number = Date.now()): void { set(SEEN_KEY, String(now), 'session'); }

/* ───── 회원 ───── */

/** 회원에게 띄울 수 있는가 — 관리자가 아니고, [다시 보지 않기] 를 안 눌렀고, 오늘 아직 안 봤고, 사람 */
export function memberIntroAudience(o: { role: string; hidden: boolean; seenToday: boolean; ua: string; webdriver: boolean }): boolean {
  return o.role !== 'ADMIN' && !o.hidden && !o.seenToday && !o.webdriver && guestTrackingAllowed(o.ua, false);
}
export function isMemberIntroHidden(userId: number): boolean { return readMap(MEMBER_HIDE_KEY)[String(userId)] != null; }
/** 이 브라우저에서 누군가 [다시 보지 않기] 를 눌렀는가 — 로그아웃 상태에서도 그 뜻을 지킨다 */
export function isIntroHiddenHere(): boolean { return Object.keys(readMap(MEMBER_HIDE_KEY)).length > 0; }
export function hideMemberIntro(userId: number, now: number = Date.now()): void {
  set(MEMBER_HIDE_KEY, JSON.stringify({ ...readMap(MEMBER_HIDE_KEY), [String(userId)]: now }));
}
/** 오늘 이미 봤는가 — 회원으로 답했거나, 이 탭에서 오늘 로그인 전에 소개에 답했다(방금 가입·로그인한 사람에게 또 띄우지 않는다) */
export function isMemberIntroSeenToday(userId: number, now: number = Date.now()): boolean {
  const today = kstDay(now);
  if (readMap(MEMBER_DAY_KEY)[String(userId)] === today) return true;
  const guestAt = Number(get(SEEN_KEY, 'session'));
  return Number.isFinite(guestAt) && guestAt > 0 && kstDay(guestAt) === today;
}
export function markMemberIntroDay(userId: number, now: number = Date.now()): void {
  set(MEMBER_DAY_KEY, JSON.stringify({ ...readMap(MEMBER_DAY_KEY), [String(userId)]: kstDay(now) }));
}

/** 브라우저에서 지금 이 사람에게 띄울 수 있는가(던지지 않는다). user 가 없으면 비회원 규칙 */
export function introAudienceHere(user: { id: number; role: string } | null | undefined): boolean {
  try {
    const ua = navigator.userAgent;
    const webdriver = navigator.webdriver === true;
    if (user) return memberIntroAudience({ role: user.role, hidden: isMemberIntroHidden(user.id), seenToday: isMemberIntroSeenToday(user.id), ua, webdriver });
    return introAudience({ authenticated: false, hiddenHere: isIntroHiddenHere(), ua, webdriver, answered: isIntroAnswered() });
  } catch { return false; }
}

/**
 * 가입·로그인하러 떠나기 전에 — 공모 상세로 들어와 **작가** 쪽에서 가입하러 가면 가입 뒤 그 공모로 돌아오게 적어 둔다(광고 → 공모 → 지원 흐름).
 * 다른 화면·갤러리 쪽이면 적지 않는다 — 가입한 작가는 작품 올리기로, 갤러리는 갤러리 등록으로 가는 게 맞다(`resolvePostLoginPath`).
 * 이미 적어 둔 곳이 있으면 덮지 않는다.
 */
export function introReturnPath(pathname: string, search: string): string | null {
  return /^\/exhibitions\/\d+\/?$/.test(pathname) ? pathname.replace(/\/$/, '') + search : null;
}
export function rememberIntroReturn(pathname: string, search: string): void {
  const back = introReturnPath(pathname, search);
  if (back && !peekPostLoginRedirect()) setPostLoginRedirect(back);
}
