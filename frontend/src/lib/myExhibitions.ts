/**
 * 작가 마이페이지 [내 전시] 탭의 분류 (구 '지원 내역').
 *
 * ── 왜 이름이 '내 전시' 인가 ─────────────────────────────────
 * 이 목록은 지원 기록만 있는 게 아니라 **지원 → 수락 → 자료제출 → 전시 → 정산** 전 과정을 담는다.
 * 정상 상태에서 남는 건 대부분 '내가 참여하는 전시' 라서, 작가가 실제로 쓰는 말에 맞췄다.
 * (갤러리 탭의 `내 전시`(Show)와는 다른 것이다 — 그쪽은 갤러리가 여는 전시 소개다)
 *
 * ── 세 갈래 ─────────────────────────────────────────────────
 *   심사중   아직 결과를 못 받은 지원 + **거절된 지원**
 *   진행중   수락됐고 아직 정산이 끝나지 않은 전시 (전시 종료 후 정산 대기도 여기)
 *   진행종료 정산까지 끝난 전시
 *
 * 거절을 '심사중' 에 두는 건 사용자 선택이다(2026-08-19). 거절은 [확인]을 눌러야 목록에서
 * 사라지므로, 눈에 잘 띄는 앞쪽 탭에 두는 편이 확인을 놓치지 않는다.
 *
 * ⚠️ 순수 함수로 둔 이유는 `lib/settlement.ts` 와 같다 — 화면 컴포넌트 안에 두면
 *    Vite fast-refresh 가 그 파일을 통째로 새로 고쳐 입력 중이던 값이 날아간다.
 */

export type MyExhibitionBucket = 'REVIEWING' | 'ONGOING' | 'CLOSED';

export const MY_EXHIBITION_TABS: { key: MyExhibitionBucket; label: string }[] = [
  { key: 'REVIEWING', label: '심사중' },
  { key: 'ONGOING', label: '진행중' },
  { key: 'CLOSED', label: '진행종료' },
];

export const MY_EXHIBITION_EMPTY: Record<MyExhibitionBucket, string> = {
  REVIEWING: '결과를 기다리는 지원이 없습니다.',
  ONGOING: '진행 중인 전시가 없습니다.',
  CLOSED: '정산까지 끝난 전시가 없습니다.',
};

/** 분류에 필요한 최소 정보 */
export interface MyApplicationLike {
  status: string;
  exhibition?: {
    settledAt?: string | null;
    /**
     * 서버가 계산한 종료 여부 (`lib/exhibitionLifecycle.ts`).
     * 정산 완료 **또는** 전시 종료 20일 경과(정산을 시작하지 않은 경우).
     * 갤러리가 [전시종료]조차 안 누른 공모가 영원히 '진행중' 으로 쌓이는 걸 막는다.
     */
    closed?: boolean;
  } | null;
}

export const isRejected = (a: MyApplicationLike) => a.status === 'REJECTED';
/**
 * 종료 판정은 **서버 값(`closed`)을 우선**한다 — 20일 규칙은 정산 시작 여부까지 봐야 해서
 * 화면이 가진 정보만으로는 다시 계산할 수 없다. 옛 응답(필드 없음)은 정산 완료로만 판정한다.
 */
export const isSettled = (a: MyApplicationLike) => a.exhibition?.closed ?? !!a.exhibition?.settledAt;

/**
 * 지원 한 건이 어느 탭에 속하는가.
 *
 * ⚠️ 정산 완료 판정을 **수락 여부보다 먼저** 보면 안 된다 — 거절된 지원의 공모가 나중에 정산되면
 *    거절당한 작가의 화면에 '진행종료' 로 뜬다. 반드시 거절 → 미수락 → 정산 순으로 본다.
 */
export function bucketOf(a: MyApplicationLike): MyExhibitionBucket {
  if (isRejected(a)) return 'REVIEWING';        // 결과는 나왔지만 [확인] 전이라 여기 남긴다
  if (a.status !== 'ACCEPTED') return 'REVIEWING';
  return isSettled(a) ? 'CLOSED' : 'ONGOING';   // 전시가 끝나도 정산 전이면 '진행중'(작가는 아직 대금을 기다린다)
}

export function groupMyExhibitions<T extends MyApplicationLike>(apps: T[]): Record<MyExhibitionBucket, T[]> {
  const out: Record<MyExhibitionBucket, T[]> = { REVIEWING: [], ONGOING: [], CLOSED: [] };
  for (const a of apps) out[bucketOf(a)].push(a);
  return out;
}

/* ─────────────────────────────────────────────────────────────
   '다음 일정' — 진행중 카드에 붙는 두 줄
   ───────────────────────────────────────────────────────────── */

export type NextScheduleTone = 'normal' | 'urgent' | 'done';
export interface NextScheduleRow {
  label: string;
  /** 'D-3' / 'D-DAY' / '지남' / null(완료 표시라 D-day 가 없는 줄) */
  dday: string | null;
  /** 'M/D' */
  date: string;
  tone: NextScheduleTone;
}

/** 'YYYY-MM-DD...' → 'M/D' (KST 달력 날짜 그대로. 로컬 타임존 변환을 타지 않는다) */
export function shortDate(value: string | Date): string {
  const iso = value instanceof Date ? value.toISOString() : String(value);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${Number(m[2])}/${Number(m[3])}`;
}

const ddayLabel = (d: number) => (d === 0 ? 'D-DAY' : d > 0 ? `D-${d}` : '지남');

export interface NextScheduleInput {
  submissionDeadline?: string | null;
  exhibitStartDate?: string | null;
  exhibitDate?: string | null;
}

/**
 * 진행중인 전시의 다음 일정 두 줄을 만든다.
 *
 *   자료 미제출 · 마감 전  →  자료제출 마감 D-3 (8/15) / 전시시작 D-9 (8/28)
 *   자료 미제출 · 마감 지남 →  ⚠ 자료제출 마감 지남 (8/15) / 전시시작 D-9 (8/28)
 *   자료 제출 완료         →  자료제출 완료 / 전시시작 D-9 (8/28)
 *
 * ⚠️ D-day 계산은 반드시 `getDday`(KST 달력 날짜)를 쓴다. 순수 `new Date()` 비교를 쓰면
 *    마감일 당일 오전 9시에 '지남' 으로 바뀐다(CLAUDE.md 14).
 * ⚠️ 마감이 지났어도 줄을 **지우지 않는다** — 늦었어도 내야 하는 일이라 숨기면 작가가 모른다.
 * ⚠️ 자료제출 마감일이 없는 옛 공모는 그 줄을 아예 만들지 않는다(없는 기한을 지어내지 않는다).
 */
export function nextSchedule(
  ex: NextScheduleInput,
  submissionComplete: boolean,
  getDdayFn: (d: string | Date) => number,
): NextScheduleRow[] {
  const rows: NextScheduleRow[] = [];

  if (ex.submissionDeadline) {
    if (submissionComplete) {
      rows.push({ label: '자료제출 완료', dday: null, date: shortDate(ex.submissionDeadline), tone: 'done' });
    } else {
      const d = getDdayFn(ex.submissionDeadline);
      rows.push({
        label: d < 0 ? '자료제출 마감 지남' : '자료제출 마감',
        dday: d < 0 ? null : ddayLabel(d),
        date: shortDate(ex.submissionDeadline),
        // 마감 지남뿐 아니라 사흘 안쪽도 붉게 — 그때 알려야 아직 낼 수 있다
        tone: d < 0 || d <= 3 ? 'urgent' : 'normal',
      });
    }
  }

  const start = ex.exhibitStartDate || ex.exhibitDate;
  if (start) {
    const d = getDdayFn(start);
    // 전시가 이미 시작했으면 시작 D-day 는 의미가 없다
    if (d >= 0) rows.push({ label: '전시시작', dday: ddayLabel(d), date: shortDate(start), tone: 'normal' });
  }

  return rows;
}

/**
 * 처음 열었을 때 보여줄 탭.
 *
 * '전체' 탭을 없앴으므로 기본값이 비어 있으면 **가진 게 있는데도 아무것도 없는 화면**이 된다.
 * 그래서 진행중 → 심사중 → 진행종료 순으로 내용이 있는 첫 탭을 고른다.
 */
export function defaultBucket(apps: MyApplicationLike[]): MyExhibitionBucket {
  const g = groupMyExhibitions(apps);
  if (g.ONGOING.length) return 'ONGOING';
  if (g.REVIEWING.length) return 'REVIEWING';
  if (g.CLOSED.length) return 'CLOSED';
  return 'ONGOING';
}

/**
 * 공모 진행 단계 배지 ([내 전시] 표시용)
 *
 *   모집중 → 전시 준비중 → 확정 → 전시 진행중 → 전시종료 → 정산중 → 정산완료
 *                                              └ 종료(자동)
 *
 * '모집마감' 이 아니라 '전시 준비중' 이다 — 그건 갤러리가 누르는 **동작** 이름이고,
 * 수락된 작가에게는 그때부터 전시를 준비하는 기간이다. 갤러리 운영페이지의 단계 이름은 그대로 둔다.
 *
 * ⚠️ **'확정' 과 '전시 진행중' 을 구분한다.** 예전엔 전시가 이미 열렸는데도 '확정' 이라
 *    작가 입장에서 지금 전시가 하는 중인지 알 수 없었다.
 * ⚠️ **'전시종료' 와 '정산중' 을 구분한다.** 둘 다 '전시종료' 로만 뜨면 진행중 탭에 있는
 *    이유를 알 수 없다 — 정산이 돌아가고 있다는 게 진행중에 남아 있는 근거다.
 * ⚠️ **'종료(자동)'** 은 갤러리가 [전시종료]를 누른 적조차 없이 20일이 지나 정리된 것.
 *    실제로는 종료됐는데 `ended` 플래그가 false 라 그냥 두면 '확정' 으로 잘못 뜬다.
 */
export function exhibitionStage(ex: any): { label: string; cls: string } | null {
  if (!ex) return null;
  const startPassed = ex.exhibitStartDate && new Date(ex.exhibitStartDate) <= new Date();
  if (ex.settledAt) return { label: '정산완료', cls: 'bg-green-100 text-green-700' };
  // 자동 정리된 방치 공모 — 갤러리가 종료를 누르지 않았으므로 ended 로는 잡히지 않는다
  if (ex.closed && !ex.ended) return { label: '종료(자동)', cls: 'bg-gray-200 text-gray-600' };
  if (ex.ended && ex.settlementStarted) return { label: '정산중', cls: 'bg-indigo-100 text-indigo-700' };
  if (ex.ended) return { label: '전시종료', cls: 'bg-red-100 text-red-600' };
  if (startPassed) return { label: '전시 진행중', cls: 'bg-emerald-100 text-emerald-700' };
  if (ex.confirmed) return { label: '확정', cls: 'bg-blue-100 text-blue-700' };
  if (ex.recruitmentClosed) return { label: '전시 준비중', cls: 'bg-sky-100 text-sky-700' };
  return { label: '모집중', cls: 'bg-amber-100 text-amber-700' };
}

