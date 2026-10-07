/**
 * 이메일별 로그인 실패 한도 (2026-10-08) — 비밀번호 로그인이 실서버에서 처음 열리면서 넣었다.
 *
 * IP 단위 한도(index.ts `clientKey`, 15분 30회)는 **어디서 오는가**를 보는데, 그 판정은 앞단 프록시(Cloudflare)를 믿어야 한다.
 * 그 판단이 틀리거나 여러 IP 를 돌려 쓰면 한 계정에 비밀번호를 무한히 넣어 볼 수 있다 — 그래서 **어느 계정인가**로도 센다.
 * 15분 안에 10번 틀리면 그 이메일은 15분 동안 로그인을 받지 않는다(맞는 비밀번호여도). 비밀번호를 재설정하면 바로 풀린다.
 *
 * ⚠️ 서버 메모리에 든다 — 실서버는 인스턴스가 하나(Render Starter)라 충분하다. 배포·재시작하면 비워진다(그 정도는 괜찮다).
 *    인스턴스를 여럿으로 늘리면 DB 로 옮길 것.
 * ⚠️ 없는 계정의 실패도 똑같이 센다 — 다르게 굴면 그 차이로 가입 여부가 드러난다.
 */
export const LOGIN_FAIL_WINDOW_MS = 15 * 60_000;
export const LOGIN_FAIL_MAX = 10;
const MAX_TRACKED = 10_000;

const fails = new Map<string, { count: number; first: number }>();

function entry(email: string, now: number) {
  const f = fails.get(email);
  if (f && now - f.first > LOGIN_FAIL_WINDOW_MS) {
    fails.delete(email);
    return undefined;
  }
  return f;
}

/** 지금 이 이메일은 막혀 있는가 */
export function loginBlocked(email: string, now = Date.now()): boolean {
  return (entry(email, now)?.count ?? 0) >= LOGIN_FAIL_MAX;
}

export function noteLoginFailure(email: string, now = Date.now()): void {
  const f = entry(email, now);
  if (f) {
    f.count += 1;
    return;
  }
  // 오래된 것부터 버린다 — 아무 주소나 넣어 보는 요청으로 메모리가 끝없이 늘지 않게
  if (fails.size >= MAX_TRACKED) {
    for (const [k, v] of fails) {
      if (now - v.first > LOGIN_FAIL_WINDOW_MS) fails.delete(k);
    }
    if (fails.size >= MAX_TRACKED) fails.delete(fails.keys().next().value as string);
  }
  fails.set(email, { count: 1, first: now });
}

/** 로그인에 성공했거나 비밀번호를 재설정했다 */
export function clearLoginFailures(email: string): void {
  fails.delete(email);
}

/** 테스트용 */
export function resetLoginThrottle(): void {
  fails.clear();
}
