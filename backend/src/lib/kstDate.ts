/**
 * KST(UTC+9) 달력 날짜 기준 경계 헬퍼.
 *
 * 배경: 프론트의 <input type="date">는 "YYYY-MM-DD"를 보내고 백엔드는 `new Date("YYYY-MM-DD")`로
 * 저장하는데, 이는 UTC 자정(=KST 09:00)이다. 따라서 `deadline >= new Date()`처럼 순수 UTC 순간으로
 * 비교하면 마감일 당일 오전 9시(KST)에 공모가 사라지는 오프바이원이 생긴다.
 *
 * 이 헬퍼는 "KST 달력 날짜" 단위로 경계를 잡아, 저장 규약(UTC 자정)을 바꾸지 않고도
 * 마감/만료 판정을 KST 하루 단위로 일관되게 만든다. (기존 데이터 마이그레이션 불필요)
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** KST 기준 '오늘의 시작(자정)' 순간을 실제 UTC Date로 반환. */
export function startOfTodayKstAsUtc(now: Date = new Date()): Date {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const midnightKstTicks = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
  return new Date(midnightKstTicks - KST_OFFSET_MS);
}

/** KST 기준 '오늘의 끝(23:59:59.999)' 순간을 실제 UTC Date로 반환. */
export function endOfTodayKstAsUtc(now: Date = new Date()): Date {
  return new Date(startOfTodayKstAsUtc(now).getTime() + DAY_MS - 1);
}

/**
 * 마감일(deadline)이 지났는지(= KST 달력 날짜 기준 오늘보다 이전인지) 판정.
 * 마감일 당일은 하루 종일 유효(false)로 취급한다.
 */
export function isDeadlinePassedKst(deadline: Date, now: Date = new Date()): boolean {
  return deadline < startOfTodayKstAsUtc(now);
}
