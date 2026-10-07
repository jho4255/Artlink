/**
 * 이메일 가입(아티스트·갤러리·일반) · 비밀번호 찾기 · 이메일 로그인 (2026-10-08 사용자 결정).
 * 서버 규칙은 `backend/src/lib/emailCode.ts`(인증번호·비밀번호 규칙) · `routes/auth.ts`.
 * ⚠️ `passwordProblem` 은 서버와 **같은 규칙**이어야 한다 — 화면이 통과시킨 비밀번호를 서버가 거절하면 함정이다(`emailAuth.test.ts` 가 대조).
 */

/** 인증번호 길이 */
export const CODE_LENGTH = 6;
/** 휴대폰 번호 — 카카오 가입 화면·서버와 같은 형식 */
export const PHONE_RE = /^01[0-9]-?\d{3,4}-?\d{4}$/;

/** 8자 이상(bcrypt 가 보는 72바이트까지), 영문과 숫자를 함께 */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return '비밀번호는 8자 이상이어야 해요.';
  if (new TextEncoder().encode(pw).length > 72) return '비밀번호가 너무 길어요(영문 기준 72자까지).';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '비밀번호에 영문과 숫자를 함께 넣어 주세요.';
  return null;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** 주소 모양만 본다(실제 확인은 인증번호가 한다) */
export function looksLikeEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

/** 인증번호 칸 — 숫자만, 6자리까지(메일에서 '123 456' 처럼 띄어 복사해도 된다) */
export function cleanCodeInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

/** 남은 시간 '9:05' */
export function formatRemaining(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/**
 * 이 브라우저에서 이메일로 로그인한 적이 있는가 — 있으면 로그인 화면에서 이메일 칸을 펼쳐 두고 주소를 채운다.
 * 카카오로 들어오는 대부분(작가)에게는 접힌 한 줄만 보인다. 저장소가 막혀도 던지지 않는다.
 */
const EMAIL_LOGIN_KEY = 'artlink-login-email';
export function rememberEmailLogin(email: string): void {
  try { localStorage.setItem(EMAIL_LOGIN_KEY, normalizeEmail(email)); } catch { /* 막힌 환경 — 다음에 접혀 있을 뿐 */ }
}
export function recalledEmailLogin(): string {
  try { return localStorage.getItem(EMAIL_LOGIN_KEY) ?? ''; } catch { return ''; }
}

/** 서버가 준 이유(우리 라우트는 `{ error }`) → 없으면 한도 초과(429, express-rate-limit 의 영어 글)·기본 문구 */
export function authErrorMessage(err: any, fallback: string): string {
  const data = err?.response?.data;
  if (data && typeof data === 'object' && typeof data.error === 'string' && data.error) return data.error;
  if (err?.response?.status === 429) return '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.';
  return fallback;
}
