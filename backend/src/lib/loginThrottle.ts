/**
 * 로그인 실패 한도 (2026-10-08) — 비밀번호 로그인이 실서버에서 처음 열리면서 넣었다.
 *
 * 두 가지로 센다(자동 보안 검토 반영):
 *  ① **이메일 + 접속 주소**: 15분에 10번 틀리면 그 주소에서 그 이메일 로그인을 15분 막는다 — 한 곳에서 비밀번호를 계속 넣어 보는 것.
 *  ② **이메일 전체**: 15분에 50번 — 여러 주소를 돌려 쓰는 무차별 대입.
 * ①만 있으면 주소를 바꿔 가며 끝없이 넣어 볼 수 있고, 이메일 하나로만(10번) 세면 **남이 일부러 틀려서 진짜 주인을 막을 수 있다**(잠금 악용).
 * 그래서 주인의 주소는 ①에 안 걸리고, 남이 주인을 막으려면 ②의 50번을 채워야 한다. 비밀번호를 재설정하면 그 이메일은 바로 풀린다.
 *
 * ⚠️ 서버 메모리에 든다 — 실서버는 인스턴스가 하나(Render Starter)라 충분하다. 배포·재시작하면 비워진다(그 정도는 괜찮다).
 *    인스턴스를 여럿으로 늘리면 DB 로 옮길 것.
 * ⚠️ 없는 계정의 실패도 똑같이 센다 — 다르게 굴면 그 차이로 가입 여부가 드러난다.
 */
export const LOGIN_FAIL_WINDOW_MS = 15 * 60_000;
/** 이메일 + 접속 주소 */
export const LOGIN_FAIL_MAX = 10;
/** 이메일 전체(여러 주소 합) */
export const LOGIN_FAIL_MAX_PER_EMAIL = 50;
const MAX_TRACKED = 20_000;

const fails = new Map<string, { count: number; first: number }>();
const pairKey = (email: string, ip: string) => `${email}|${ip}`;
const emailKey = (email: string) => `${email}|*`;

function current(key: string, now: number) {
  const f = fails.get(key);
  if (f && now - f.first > LOGIN_FAIL_WINDOW_MS) {
    fails.delete(key);
    return undefined;
  }
  return f;
}

function bump(key: string, now: number) {
  const f = current(key, now);
  if (f) {
    f.count += 1;
    return;
  }
  // 오래된 것부터 버린다 — 아무 주소나 넣어 보는 요청으로 메모리가 끝없이 늘지 않게
  if (fails.size >= MAX_TRACKED) {
    for (const [k, v] of fails) if (now - v.first > LOGIN_FAIL_WINDOW_MS) fails.delete(k);
    if (fails.size >= MAX_TRACKED) fails.delete(fails.keys().next().value as string);
  }
  fails.set(key, { count: 1, first: now });
}

/** 지금 이 주소에서 이 이메일로 로그인을 받지 않는가 */
export function loginBlocked(email: string, ip: string, now = Date.now()): boolean {
  return (current(pairKey(email, ip), now)?.count ?? 0) >= LOGIN_FAIL_MAX
    || (current(emailKey(email), now)?.count ?? 0) >= LOGIN_FAIL_MAX_PER_EMAIL;
}

export function noteLoginFailure(email: string, ip: string, now = Date.now()): void {
  bump(pairKey(email, ip), now);
  bump(emailKey(email), now);
}

/** 로그인에 성공했거나 비밀번호를 재설정했다 — 그 이메일의 기록을 모두 지운다 */
export function clearLoginFailures(email: string): void {
  const prefix = `${email}|`;
  for (const k of [...fails.keys()]) if (k.startsWith(prefix)) fails.delete(k);
}

/** 테스트용 */
export function resetLoginThrottle(): void {
  fails.clear();
}
