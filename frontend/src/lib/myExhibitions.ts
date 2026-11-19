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

/**
 * ⚠️ '받은 초대'(INVITED) 탭은 2026-11-19 에 없앴다 — 1:1 공모 초대 기능을 통째로 뗐다(사용자 결정, 실서버 사용 0건).
 *    이미 선정된 작가가 들어오는 길은 초대 **코드**(아래 '초대 코드가 있나요?')다. 되살리지 말 것.
 */
export type MyExhibitionBucket = 'REVIEWING' | 'ONGOING' | 'CLOSED';

/** 탭 이름은 갤러리 [내 공모]의 '진행 중 · 종료' 와 같은 말을 쓴다(2026-09-29 — 예전엔 '진행중·진행종료') */
export const MY_EXHIBITION_TABS: { key: MyExhibitionBucket; label: string }[] = [
  { key: 'REVIEWING', label: '심사 중' },
  { key: 'ONGOING', label: '진행 중' },
  { key: 'CLOSED', label: '종료' },
];

export const MY_EXHIBITION_EMPTY: Record<MyExhibitionBucket, string> = {
  REVIEWING: '결과를 기다리는 지원이 없어요.',
  ONGOING: '진행 중인 전시가 없어요.',
  CLOSED: '정산까지 끝난 전시가 없어요.',
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
 *   자료 미제출 · 마감 전  →  출품 자료 마감 D-3 (8/15) / 전시시작 D-9 (8/28)
 *   자료 미제출 · 마감 지남 →  ⚠ 출품 자료 마감 지남 (8/15) / 전시시작 D-9 (8/28)
 *   자료 제출 완료         →  출품 자료 제출 완료 / 전시시작 D-9 (8/28)
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
      rows.push({ label: '출품 자료 제출 완료', dday: null, date: shortDate(ex.submissionDeadline), tone: 'done' });
    } else {
      const d = getDdayFn(ex.submissionDeadline);
      rows.push({
        label: d < 0 ? '출품 자료 마감 지남' : '출품 자료 마감',
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

/*
 * 공모 진행 단계 배지는 `lib/flowLabels.ts` 의 `stageOf` 로 옮겼다(2026-09-29) — 갤러리 카드·운영 화면·작가 카드가
 * 같은 이름을 써야 해서다. 예전 `exhibitionStage` 가 지키던 규칙(전시 중 ≠ 확정, 정산 중 ≠ 전시 종료,
 * 자동 정리 = 종료, 공모만 진행은 모집 중 → 선정 완료)은 그대로 옮겼고 `flowLabels.test.ts` 가 지킨다.
 */

