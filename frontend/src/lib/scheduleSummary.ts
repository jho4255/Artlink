/**
 * 공모 등록 폼 아래 한 줄 일정 요약 — `지원 9/27–10/11 · 자료 제출 ~10/21 · 전시 11/1–11/15` (2026-09-29).
 *
 * 폼의 날짜 다섯 칸은 각각 따로 보여서 순서가 한눈에 안 들어왔다(예전엔 칸 순서마저 공모 → 전시 → 자료제출이었다).
 * 칸을 시간순으로 옮기고, 채운 만큼 이 한 줄이 이어지게 했다.
 *
 * 입력은 `<input type="date">` 값('YYYY-MM-DD')이다. `new Date()` 로 바꾸지 않고 문자열에서 바로 월/일을 뗀다 —
 * UTC 자정으로 해석돼 날짜가 하루 밀리는 일을 원천적으로 없앤다(규칙 14).
 */
export interface ScheduleInput {
  deadlineStart?: string | null;
  deadline?: string | null;
  submissionDeadline?: string | null;
  exhibitStartDate?: string | null;
  exhibitDate?: string | null;
  recruitOnly?: boolean;
}

/** 'YYYY-MM-DD…' → 'M/D'. 형식이 아니면 '' */
export function md(value?: string | null): string {
  const m = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[2])}/${Number(m[3])}` : '';
}

function range(a?: string | null, b?: string | null): string {
  const x = md(a), y = md(b);
  if (x && y) return `${x}–${y}`;
  if (y) return `~${y}`;
  if (x) return `${x}~`;
  return '';
}

/** 채운 칸만으로 만든 요약. 하나도 없으면 '' */
export function scheduleSummary(s: ScheduleInput): string {
  const parts: string[] = [];
  const apply = range(s.deadlineStart, s.deadline);
  if (apply) parts.push(`지원 ${apply}`);
  if (!s.recruitOnly) {
    const sub = md(s.submissionDeadline);
    if (sub) parts.push(`자료 제출 ~${sub}`);
    const show = range(s.exhibitStartDate, s.exhibitDate);
    if (show) parts.push(`전시 ${show}`);
  }
  return parts.join(' · ');
}
