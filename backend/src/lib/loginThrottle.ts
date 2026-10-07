/**
 * 로그인 실패 한도 (2026-10-08) — 비밀번호 로그인이 실서버에서 처음 열리면서 넣었다.
 *
 * 두 가지로 센다(자동 보안 검토 반영):
 *  ① **이메일 + 접속 주소**: 15분에 10번 틀리면 그 주소에서 그 이메일 로그인을 15분 막는다 — 한 곳에서 비밀번호를 계속 넣어 보는 것.
 *  ② **이메일 전체**: **하루(24시간)에 50번** — 여러 주소를 돌려 쓰는 무차별 대입. 15분 창으로 두면 하루 4,800번까지 넣어 볼 수 있어
 *     규칙만 겨우 맞춘 흔한 비밀번호('abcd1234' 같은)는 며칠이면 뚫린다(자동 보안 검토 지적). 하루 50번이면 흔한 비밀번호 몇십 개뿐이다.
 * ①만 있으면 주소를 바꿔 가며 끝없이 넣어 볼 수 있고, 이메일 하나로만(10번) 세면 **남이 일부러 틀려서 진짜 주인을 막을 수 있다**(잠금 악용).
 * 그래서 ①은 주인의 주소에 안 걸린다.
 * ⚠️ ②는 남이 채울 수 있다 — 한 주소로도 15분에 10번씩 한 시간 남짓이면 50번이고, 그러면 그 이메일의 비밀번호 로그인이 하루까지 막힌다.
 *    무차별 대입을 막는 값으로 감수했다. 주인은 **비밀번호 찾기**(메일 인증번호)로 바로 풀고 그 자리에서 로그인된다 —
 *    그래서 ②로 막혔을 때는 "15분 뒤에" 가 아니라 비밀번호 찾기를 알려 준다(`loginBlock` 이 어느 쪽인지 돌려준다).
 *    더 막으려면 '이 브라우저로 그 계정에 로그인한 적이 있으면 ②를 건너뛰는' 기기 표시가 정석이다(OWASP device cookie) — 아직 없다.
 *
 * ⚠️ 서버 메모리에 든다 — 실서버는 인스턴스가 하나(Render Starter)라 충분하다. 배포·재시작하면 비워진다(그 정도는 괜찮다).
 *    인스턴스를 여럿으로 늘리면 DB 로 옮길 것.
 * ⚠️ 기록 수는 `LOGIN_FAIL_MAX_TRACKED` 를 **절대 넘지 않는다**(자동 보안 검토 — 서로 다른 이메일로 쏟아부어 메모리를 늘리는 공격).
 *    차면 한 번에 `LOW_WATER` 까지 비운다: 기한 지난 것 → ① → 그래도 많으면 오래된 것부터 ②까지.
 *    ⚠️ 한 건씩만 비우지 말 것 — 찬 뒤로 실패 한 번마다 5만 건을 훑게 된다(실측: 상한 넘게 넣는 테스트가 100초).
 * ⚠️ 없는 계정의 실패도 똑같이 센다 — 다르게 굴면 그 차이로 가입 여부가 드러난다.
 */
export const LOGIN_FAIL_WINDOW_MS = 15 * 60_000;
/** 이메일 + 접속 주소 — 15분 */
export const LOGIN_FAIL_MAX = 10;
/** 이메일 전체(여러 주소 합) — 하루 */
export const LOGIN_FAIL_MAX_PER_EMAIL = 50;
export const LOGIN_FAIL_EMAIL_WINDOW_MS = 24 * 3600_000;
/** 들고 있을 기록 수 상한 — 한 건에 150바이트 남짓이라 5만 건이면 10MB 아래 */
export const LOGIN_FAIL_MAX_TRACKED = 50_000;
/** 차면 여기까지 한 번에 비운다 — 다음 정리는 5천 건 뒤라, 정리 비용이 실패 한 번에 몇 건꼴로 나뉜다 */
const LOW_WATER = Math.floor(LOGIN_FAIL_MAX_TRACKED * 0.9);

type Entry = { count: number; first: number };
// 넣은 순서 = 처음 실패한 시각 순서(기한이 지나 다시 셀 때는 지우고 새로 넣어 맨 뒤로 간다) — 오래된 것부터 지울 때 앞에서부터 본다
const fails = new Map<string, Entry>();
const pairKey = (email: string, ip: string) => `${email}|${ip}`;
const emailKey = (email: string) => `${email}|*`;
const isEmailKey = (key: string) => key.endsWith('|*');
const windowOf = (key: string) => (isEmailKey(key) ? LOGIN_FAIL_EMAIL_WINDOW_MS : LOGIN_FAIL_WINDOW_MS);

function current(key: string, now: number) {
  const f = fails.get(key);
  if (f && now - f.first > windowOf(key)) {
    fails.delete(key);
    return undefined;
  }
  return f;
}

function makeRoom(now: number) {
  for (const [k, v] of fails) if (now - v.first > windowOf(k)) fails.delete(k);
  // ②(이메일 전체)는 무차별 대입을 막는 마지막 장치라 ①부터 지운다
  for (const k of fails.keys()) {
    if (fails.size <= LOW_WATER) return;
    if (!isEmailKey(k)) fails.delete(k);
  }
  for (const k of fails.keys()) {
    if (fails.size <= LOW_WATER) return;
    fails.delete(k);
  }
}

function bump(key: string, now: number) {
  const f = current(key, now);
  if (f) {
    f.count += 1;
    return;
  }
  if (fails.size >= LOGIN_FAIL_MAX_TRACKED) makeRoom(now);
  fails.set(key, { count: 1, first: now });
}

/** 'ip' = ①(그 주소에서 15분이면 풀린다) · 'account' = ②(어디서든 하루 — 비밀번호 찾기로 푼다) */
export type LoginBlock = 'ip' | 'account';

/** 지금 이 주소에서 이 이메일로 로그인을 받지 않는가, 받지 않는다면 왜 — 둘 다면 ②(기다려도 안 풀린다) */
export function loginBlock(email: string, ip: string, now = Date.now()): LoginBlock | null {
  if ((current(emailKey(email), now)?.count ?? 0) >= LOGIN_FAIL_MAX_PER_EMAIL) return 'account';
  if ((current(pairKey(email, ip), now)?.count ?? 0) >= LOGIN_FAIL_MAX) return 'ip';
  return null;
}

export function loginBlocked(email: string, ip: string, now = Date.now()): boolean {
  return loginBlock(email, ip, now) !== null;
}

export function noteLoginFailure(email: string, ip: string, now = Date.now()): void {
  bump(pairKey(email, ip), now);
  bump(emailKey(email), now);
}

/**
 * 로그인에 성공했다 — **그 주소**의 기록과 이메일 전체 기록만 지운다. 다른 주소(남이 넣어 보던 곳)의 기록은 남긴다 —
 * 주인이 들어왔다고 그쪽 한도까지 새로 채워 줄 이유가 없다. 훑지 않는다(성공할 때마다 5만 건을 훑지 않게).
 */
export function clearLoginFailures(email: string, ip: string): void {
  fails.delete(pairKey(email, ip));
  fails.delete(emailKey(email));
}

/** 비밀번호를 재설정했다 — 그 이메일의 기록을 모두 지운다(주인의 다른 기기도 바로 들어오게). 메일 인증번호를 거친 드문 일이라 훑어도 된다 */
export function clearAllLoginFailures(email: string): void {
  const prefix = `${email}|`;
  for (const k of fails.keys()) if (k.startsWith(prefix)) fails.delete(k);
}

/** 테스트용 */
export function resetLoginThrottle(): void {
  fails.clear();
}
/** 테스트용 — 지금 들고 있는 기록 수 */
export function trackedLoginRecords(): number {
  return fails.size;
}
