/**
 * Admin [통계] 탭의 일간 방문자 화면 계산 (2026-09-28) — 순수 함수만(화면은 `components/admin/AdminStatsSection.tsx`).
 * 서버 응답 `GET /api/admin/stats/visitors` 는 기록 없는 날도 0 으로 채운 끊기지 않는 날짜열이다.
 */
export interface VisitorRow { date: string; members: number; guests: number; total: number }

/**
 * 집계 시작일(`since`) 전의 날은 뺀다 — 그날의 0 은 '아무도 안 왔다'가 아니라 '아직 세지 않았다'다.
 * 그대로 그리면 기능을 켠 첫 주에 "지난 3주 방문자 0명" 처럼 읽힌다.
 */
export function trimBeforeSince(rows: VisitorRow[], since: string | null): VisitorRow[] {
  if (!since) return [];
  return rows.filter((r) => r.date >= since);
}

export interface VisitorSummary {
  today: VisitorRow | null;
  yesterday: VisitorRow | null;
  /** 최근 최대 7일(오늘 포함) 하루 평균 — 기록이 7일 안 되면 있는 날만 */
  avg: { days: number; members: number; guests: number; total: number } | null;
}

export function summarizeVisitors(rows: VisitorRow[]): VisitorSummary {
  const today = rows.length > 0 ? rows[rows.length - 1] : null;
  const yesterday = rows.length >= 2 ? rows[rows.length - 2] : null;
  const last = rows.slice(-7);
  const avg = last.length === 0 ? null : {
    days: last.length,
    members: last.reduce((s, r) => s + r.members, 0) / last.length,
    guests: last.reduce((s, r) => s + r.guests, 0) / last.length,
    total: last.reduce((s, r) => s + r.total, 0) / last.length,
  };
  return { today, yesterday, avg };
}

/** 세로축 끝 — 1·2·5×10ⁿ 중 가장 큰 막대 이상인 가장 작은 값(최소 5). 눈금은 0·절반·끝 셋 */
export function niceMax(n: number): number {
  if (n <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 5, 10]) if (m * p >= n) return m * p;
  return 10 * p;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
/** 'YYYY-MM-DD' → { md: '9/28', weekday: '일' } — 날짜 문자열 그대로 푼다(기기 시간대에 흔들리지 않게) */
export function dayLabel(date: string): { md: string; weekday: string } {
  const [y, m, d] = date.split('-').map(Number);
  return { md: `${m}/${d}`, weekday: WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] };
}

/** 평균 표시 — 정수면 정수로, 아니면 소수 한 자리 */
export function fmtAvg(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
