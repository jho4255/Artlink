/**
 * 공모 일정 달력의 판단 — 날짜 계산·고를 수 있는 날·다음 칸 (2026-10-28 사용자 요청, Skyscanner 가는 날/오는 날 방식).
 * 화면은 `components/shared/SchedulePicker.tsx`.
 *
 * 규칙
 * - 칸(step)은 **일어나는 순서대로** 놓인다: 공모 시작 → 공모 마감 → 출품 자료 제출 마감 → 전시 시작 → 전시 종료.
 * - 한 칸을 고르면 **다음 칸으로 넘어간다**(가는 날을 고르면 바로 오는 날을 고르게 되는 것처럼). 마지막 칸이면 닫는다.
 * - 고를 수 있는 날 = 오늘(KST) 이후 + 앞에서 고른 날 + 그 칸의 간격(`gap`). 나머지는 흐리게, 누를 수 없다.
 *   간격은 서버 순서 규칙(`validateExhibitionDates`·`assertExhibitionDates`)과 같다 —
 *   시작 ≤ 마감(같은 날 됨) · 마감 < 자료 제출 < 전시 시작(같은 날 안 됨) · 전시 시작 ≤ 종료.
 * - 앞 칸을 다시 골라 뒤 칸이 순서에 안 맞게 되면 **뒤 칸을 비운다**(가는 날을 오는 날 뒤로 옮기면 오는 날이 지워지는 것처럼).
 *   막지 않는 이유: 막으면 앞 칸을 고치려고 뒤 칸부터 지워야 한다.
 *
 * 값은 `<input type="date">` 와 같은 'YYYY-MM-DD' 문자열이다 — 저장 형식·임시저장·서버가 그대로다.
 * ⚠️ 날짜 계산은 UTC 자정 기준으로만 한다(`Date.UTC`) — 지역 시간대로 하면 서머타임·자정 경계에서 하루가 밀린다(규칙 14).
 */

export type Ymd = string;
/** 폼 값 — 날짜 칸 말고 다른 칸이 섞여 있어도 된다(그 키만 읽는다) */
export type ScheduleValues = Record<string, unknown>;

export interface ScheduleStep {
  /** 폼 값의 키 — 'deadlineStart' 등 */
  key: string;
  /** 칸 이름 — '공모 시작일' */
  label: string;
  /** 달력의 그 날 아래 작은 글자 — '시작'·'마감'·'제출'·'전시'·'종료' */
  mark: string;
  /** 앞 칸과 최소 며칠 떨어져야 하나 — 0 = 같은 날 됨, 1 = 다음 날부터 */
  gap: 0 | 1;
  /** 칸 버튼 id — 잘못된 칸으로 스크롤·E2E 가 쓴다 */
  id?: string;
  /** 칸 아래 설명 */
  hint?: string;
  /** 두 칸 너비로(넓은 화면) — 자료 제출 마감처럼 짝이 없는 칸 */
  wide?: boolean;
}

/** 칠할 기간 — 지원 기간·전시 기간 */
export interface ScheduleRange { from: string; to: string; label: string }

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isYmd(v: unknown): v is Ymd {
  if (typeof v !== 'string') return false;
  const m = v.match(YMD_RE);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** 'YYYY-MM-DD…' 앞 10자 — 서버가 ISO 로 준 값('2026-10-28T00:00:00.000Z')도 받는다 */
export function toYmd(v?: unknown): Ymd | '' {
  if (typeof v !== 'string') return '';
  const s = v.slice(0, 10);
  return isYmd(s) ? s : '';
}

function parts(ymd: Ymd): [number, number, number] {
  const m = ymd.match(YMD_RE)!;
  return [+m[1], +m[2], +m[3]];
}

export function ymdOf(y: number, m0: number, d: number): Ymd {
  const t = new Date(Date.UTC(y, m0, d));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

export function addDays(ymd: Ymd, n: number): Ymd {
  const [y, m, d] = parts(ymd);
  return ymdOf(y, m - 1, d + n);
}

/** a − b (일) */
export function daysBetween(a: Ymd, b: Ymd): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 864e5);
}

/** 오늘 — **한국 날짜**(규칙 14). 기기 시간대와 무관하다 */
export function todayKst(now: number = Date.now()): Ymd {
  const k = new Date(now + 9 * 3600e3);
  return ymdOf(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate());
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

export function weekdayOf(ymd: Ymd): number {
  const [y, m, d] = parts(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 칸에 보이는 글자 — '2026. 10. 28 (수)' */
export function formatYmd(ymd: Ymd): string {
  const [y, m, d] = parts(ymd);
  return `${y}. ${m}. ${d} (${WEEK[weekdayOf(ymd)]})`;
}

/** 짧게 — '10월 29일(목)' (안내 문장 안에) */
export function shortYmd(ymd: Ymd): string {
  const [, m, d] = parts(ymd);
  return `${m}월 ${d}일(${WEEK[weekdayOf(ymd)]})`;
}

/** 스크린 리더·E2E 이름 — '2026년 10월 28일 수요일' */
export function spokenYmd(ymd: Ymd): string {
  const [y, m, d] = parts(ymd);
  return `${y}년 ${m}월 ${d}일 ${WEEK[weekdayOf(ymd)]}요일`;
}

export const WEEKDAY_LABELS = WEEK;

/** 'YYYY-MM' 달의 칸 — 일요일부터 한 주, 앞뒤 빈 칸은 null */
export function monthGrid(year: number, month0: number): (Ymd | null)[][] {
  const first = new Date(Date.UTC(year, month0, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const cells: (Ymd | null)[] = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(ymdOf(year, month0, d));
  while (cells.length % 7) cells.push(null);
  const weeks: (Ymd | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** 달 하나 = { y, m0 } — 앞뒤로 옮기기 */
export interface MonthRef { y: number; m0: number }
export function monthOf(ymd: Ymd): MonthRef {
  const [y, m] = parts(ymd);
  return { y, m0: m - 1 };
}
export function shiftMonth(ref: MonthRef, n: number): MonthRef {
  const t = new Date(Date.UTC(ref.y, ref.m0 + n, 1));
  return { y: t.getUTCFullYear(), m0: t.getUTCMonth() };
}
export function monthIndex(ref: MonthRef): number { return ref.y * 12 + ref.m0; }

/**
 * i 번째 칸에서 고를 수 있는 가장 이른 날.
 * 앞쪽에서 **고른 가장 가까운 칸** + 그 사이 간격의 합. 고른 칸이 없으면 오늘(`floor`).
 * (앞 칸이 비어 있으면 그 칸의 간격까지 더한다 — 마감을 비워 둔 채 자료 제출을 고르면 시작 + 0 + 1.)
 */
export function stepMin(steps: ScheduleStep[], values: ScheduleValues, i: number, floor: Ymd): Ymd {
  let gapSum = 0;
  for (let j = i; j > 0; j--) {
    gapSum += steps[j].gap;
    const v = toYmd(values[steps[j - 1].key]);
    if (v) {
      const fromPrev = addDays(v, gapSum);
      return fromPrev > floor ? fromPrev : floor;
    }
  }
  return floor;
}

export function canPick(steps: ScheduleStep[], values: ScheduleValues, i: number, day: Ymd, floor: Ymd): boolean {
  return day >= stepMin(steps, values, i, floor);
}

/**
 * i 번째 칸에 day 를 넣은 결과 — 바뀐 값만 돌려준다(뒤 칸이 순서에 안 맞으면 '' 로 비운다).
 * 다음에 고를 칸도 함께: 다음 칸이 있으면 그 칸, 마지막이면 null(닫는다).
 */
export function applyPick(
  steps: ScheduleStep[],
  values: ScheduleValues,
  i: number,
  day: Ymd,
  floor: Ymd,
): { patch: Record<string, string>; next: number | null } {
  const patch: Record<string, string> = { [steps[i].key]: day };
  const merged: ScheduleValues = { ...values, ...patch };
  for (let k = i + 1; k < steps.length; k++) {
    const v = toYmd(merged[steps[k].key]);
    if (v && v < stepMin(steps, merged, k, floor)) {
      patch[steps[k].key] = '';
      merged[steps[k].key] = '';
    }
  }
  return { patch, next: i + 1 < steps.length ? i + 1 : null };
}

/** 그날이 어느 기간 안인가 — 칠하기용. 양 끝을 다 고른 기간만(미리보기는 hover 로 따로) */
export function rangeOf(ranges: ScheduleRange[], values: ScheduleValues, day: Ymd): ScheduleRange | null {
  for (const r of ranges) {
    const a = toYmd(values[r.from]);
    const b = toYmd(values[r.to]);
    if (a && b && day >= a && day <= b) return r;
  }
  return null;
}

/** 기간의 날 수(양 끝 포함) — '15일' */
export function rangeDays(a: Ymd, b: Ymd): number { return daysBetween(b, a) + 1; }

/** 달력을 열 때 처음 보일 달 — 그 칸의 값 → 그 칸에서 고를 수 있는 첫날 */
export function openingMonth(steps: ScheduleStep[], values: ScheduleValues, i: number, floor: Ymd): MonthRef {
  const v = toYmd(values[steps[i].key]);
  return monthOf(v || stepMin(steps, values, i, floor));
}

/**
 * 공모 일정 칸 — 갤러리 공모 등록·아트링크 주최 공모 등록이 같이 쓴다(순서·간격·이름이 한 곳에).
 * 칸 아래 설명은 두지 않는다(2026-10-28 사용자 요청) — 고를 수 없는 날은 달력이 흐리게 막고, 순서가 틀리면 저장에서 알린다.
 * 공모만 진행(recruitOnly)이면 자료 제출·전시가 없다 — 칸 자체를 안 만든다(규칙: 비활성이 아니라 없앤다).
 */
export function exhibitionSchedule(recruitOnly: boolean, idPrefix = 'ex'): { steps: ScheduleStep[]; ranges: ScheduleRange[] } {
  const steps: ScheduleStep[] = [
    { key: 'deadlineStart', label: '공모 시작일', mark: '시작', gap: 0, id: `${idPrefix}-start` },
    { key: 'deadline', label: '공모 마감일', mark: '마감', gap: 0, id: `${idPrefix}-deadline` },
  ];
  const ranges: ScheduleRange[] = [{ from: 'deadlineStart', to: 'deadline', label: '지원 기간' }];
  if (!recruitOnly) {
    steps.push(
      {
        key: 'submissionDeadline', label: '출품 자료 제출 마감일', mark: '제출', gap: 1, id: `${idPrefix}-submission`, wide: true },
      { key: 'exhibitStartDate', label: '전시 시작일', mark: '전시', gap: 1, id: `${idPrefix}-show-start` },
      { key: 'exhibitDate', label: '전시 종료일', mark: '종료', gap: 0, id: `${idPrefix}-show-end` },
    );
    ranges.push({ from: 'exhibitStartDate', to: 'exhibitDate', label: '전시 기간' });
  }
  return { steps, ranges };
}
