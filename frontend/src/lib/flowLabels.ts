/**
 * 공모 흐름(등록 → 지원 → 선정 → 출품 자료 → 전시 → 정산)의 **이름과 다음 할 일** — 한 곳에서만 정한다 (2026-09-29).
 *
 * 점검에서 가장 많이 걸린 건 기능이 아니라 말이었다. 같은 것을 화면마다 다르게 불렀다:
 *   - 지원 결과: 갤러리 '수락', 작가 카드 '수락', 공모 상세 '선정되었습니다', 정원 문구 '수락(선정)'
 *   - 작가가 내는 것: 작가 자료 · 제출 자료 · 내 전시 정보 · 출품자료 · 작가 제출 정보 · 전시 정보 (6가지)
 *   - '확정' 이 단계 이름(전시 확정)과 지원 상태('수락 (확정)') 두 뜻
 *   - 같은 단계를 갤러리는 '정산 단계', 작가는 '정산중', 운영 화면은 '전시종료' 로
 * 그래서 단계·상태의 이름을 여기서 만들고, 화면은 받아서 그리기만 한다. 새 화면을 만들면 여기서 가져갈 것.
 *
 * 색은 셋뿐이다(`ChipVariant`) — neutral(흑백) · attention(빨강 = 지금 누군가 할 일이 있다) · done(✓, 옅게).
 * 단계마다 파랑·노랑·보라·초록을 달리했더니 무엇이 중요한지 안 보였다.
 *
 * ⚠️ 순수 함수만 둔다(`lib/settlement.ts` 와 같은 이유 — 화면 파일에 두면 fast-refresh 가 입력값을 날린다).
 */
import { getDday } from '@/lib/utils';

export type ChipVariant = 'neutral' | 'attention' | 'done';

/** 작가가 내는 자료의 이름 — 화면 어디서든 이 말을 쓴다 */
export const SUBMISSION_TERM = '출품 자료';

type DdayFn = (d: string | Date) => number;

/* ─────────────────────────────────────────────────────────────
   공모 진행 단계
   ───────────────────────────────────────────────────────────── */

export interface StageInput {
  /** 공모 승인 상태(PENDING/APPROVED/REJECTED). 작가 화면처럼 없으면 승인된 것으로 본다 */
  status?: string | null;
  recruitOnly?: boolean | null;
  recruitmentClosed?: boolean | null;
  confirmed?: boolean | null;
  ended?: boolean | null;
  settledAt?: string | null;
  settlementRequestedAt?: string | null;
  /** 갤러리가 정산에 손을 댔는가(판매 입력 또는 확인 요청) — '전시 종료' 와 '정산 중' 을 가른다 */
  settlementStarted?: boolean | null;
  /** 서버가 계산한 종료(정산 완료 또는 전시 종료 20일 경과) — `lib/exhibitionLifecycle.ts` */
  closed?: boolean | null;
  exhibitStartDate?: string | null;
}

export type StageKey =
  | 'review' | 'rejected'
  | 'recruiting' | 'selected'
  | 'preparing' | 'confirmed' | 'running'
  | 'ended' | 'settling' | 'settled' | 'closed';

export interface StageView { key: StageKey; label: string; variant: ChipVariant }

/**
 * 지금 공모가 어느 단계인가 — 갤러리 카드·작가 카드·운영 화면이 **같은 이름**을 받는다.
 *
 *   모집 중 → 전시 준비 → 전시 확정 → 전시 중 → 전시 종료 → 정산 중 → 정산 완료
 *   (공모만 진행: 모집 중 → 선정 완료)
 *
 * '모집 마감'·'전시 확정'·'전시 종료' 는 갤러리가 누르는 **동작**이고, 여기 이름은 그 뒤의 **기간**이다.
 * 그래서 모집을 마감한 뒤는 '전시 준비' — 갤러리에게도 수락된 작가에게도 그 기간이 맞는 말이다.
 *
 * ⚠️ 순서가 중요하다(예전 `myExhibitions.exhibitionStage` 에서 두 번 어긋났다):
 *  - 정산 완료가 자동 정리보다 먼저 — 정산까지 끝낸 공모를 '종료' 로 뭉개지 않는다
 *  - 자동 정리(closed && !ended)는 전시 확정보다 먼저 — [전시종료]를 안 눌러 ended=false 인 채 20일이 지나면
 *    '전시 확정' 으로 떠 있었다
 *  - 공모만 진행하면 `confirmed` 를 보지 않는다 — 서버가 전시 시작일 경과로 자동 true 를 준다(computeConfirmed)
 *  - 전시 시작은 **KST 달력 날짜**로(규칙 14). 예전엔 `new Date(start) <= new Date()` 라 시작일 09시 전엔 '확정' 이었다
 */
export function stageOf(ex: StageInput | null | undefined, dday: DdayFn = getDday): StageView | null {
  if (!ex) return null;
  if (ex.status === 'PENDING') return { key: 'review', label: '승인 대기', variant: 'neutral' };
  if (ex.status === 'REJECTED') return { key: 'rejected', label: '반려', variant: 'attention' };

  if (ex.recruitOnly) {
    if (ex.closed) return { key: 'closed', label: '종료', variant: 'done' };
    return ex.recruitmentClosed
      ? { key: 'selected', label: '선정 완료', variant: 'done' }
      : { key: 'recruiting', label: '모집 중', variant: 'neutral' };
  }

  if (ex.settledAt) return { key: 'settled', label: '정산 완료', variant: 'done' };
  if (ex.closed && !ex.ended) return { key: 'closed', label: '종료', variant: 'done' };
  if (ex.ended) {
    return ex.settlementStarted || ex.settlementRequestedAt
      ? { key: 'settling', label: '정산 중', variant: 'neutral' }
      : { key: 'ended', label: '전시 종료', variant: 'neutral' };
  }
  const started = !!ex.exhibitStartDate && dday(ex.exhibitStartDate) <= 0;
  if (started) return { key: 'running', label: '전시 중', variant: 'neutral' };
  if (ex.confirmed) return { key: 'confirmed', label: '전시 확정', variant: 'neutral' };
  if (ex.recruitmentClosed) return { key: 'preparing', label: '전시 준비', variant: 'neutral' };
  return { key: 'recruiting', label: '모집 중', variant: 'neutral' };
}

/* ─────────────────────────────────────────────────────────────
   지원 상태
   ───────────────────────────────────────────────────────────── */

/**
 * 지원 한 건의 상태 이름. **보는 사람에 따라 동사가 다르다** — 갤러리는 수락하고, 작가는 선정된다.
 * 한 사람이 보는 화면 안에서는 한 말만 쓴다(예전엔 작가 카드 '수락' · 공모 상세 '선정' 이 섞였다).
 * 'REVIEWED'(검토중)는 폐지된 옛 값이라 접수와 같게 본다.
 * ⚠️ '수락 (확정)' 을 되살리지 말 것 — '확정' 은 전시 단계 이름이다.
 */
export function applicationStatusView(status: string | null | undefined, viewer: 'gallery' | 'artist'): { label: string; variant: ChipVariant } {
  if (status === 'ACCEPTED') return viewer === 'gallery' ? { label: '수락됨', variant: 'done' } : { label: '선정', variant: 'done' };
  if (status === 'REJECTED') return viewer === 'gallery' ? { label: '거절', variant: 'neutral' } : { label: '미선정', variant: 'neutral' };
  return viewer === 'gallery' ? { label: '검토 대기', variant: 'neutral' } : { label: '심사 중', variant: 'neutral' };
}

/* ─────────────────────────────────────────────────────────────
   D-day — 무엇까지 남았는지 함께 쓴다
   ───────────────────────────────────────────────────────────── */

/**
 * `'마감 D-13'`, `'전시 D-DAY'`. 지난 날짜는 null(배지로 그리지 않는다 — 지난 일은 할 일 줄이 말한다).
 * 예전 배지는 'D-13' 만 적어서, 갤러리 카드는 공모 마감·작가 카드는 전시 시작을 가리키는데 둘이 같아 보였다.
 */
export function ddayText(prefix: string, date: string | null | undefined, dday: DdayFn = getDday): string | null {
  if (!date) return null;
  const d = dday(date);
  if (d < 0) return null;
  return `${prefix} ${d === 0 ? 'D-DAY' : `D-${d}`}`;
}

/* ─────────────────────────────────────────────────────────────
   다음 할 일 — 카드 한 줄 + 운영 화면 안내가 같은 문장을 쓴다
   ───────────────────────────────────────────────────────────── */

/** 할 일이 가리키는 곳 — 갤러리 카드의 [지원자] 탭 / [운영] 탭의 단계·출품 자료·정산 구역 */
export type TaskTarget = 'applicants' | 'stage' | 'submissions' | 'settlement' | null;

export interface NextTask {
  text: string;
  tone: ChipVariant;
  target: TaskTarget;
  /** 줄 끝 바로가기 이름(없으면 화살표만) */
  action?: string;
}

export interface GallerySnapshot {
  status: string;
  recruitOnly: boolean;
  recruitmentClosed: boolean;
  confirmed: boolean;
  ended: boolean;
  settled: boolean;
  settlementRequested: boolean;
  deadline?: string | null;
  exhibitStartDate?: string | null;
  exhibitDate?: string | null;
  /** 결정을 기다리는 지원(접수) */
  pending: number;
  /** 수락한 작가 */
  accepted: number;
  /** 모집 인원(= 뽑을 수 있는 사람 수, 규칙 57). 모르면 null — 정원 안내를 건너뛴다 */
  capacity?: number | null;
  /** 수락했지만 출품 자료(작품·약력·노트)가 다 차지 않은 작가 */
  submissionsIncomplete: number;
  sales: number;
  approvals: { total: number; approved: number; issue: number };
}

/**
 * 갤러리가 **지금** 해야 할 일 하나. 처음 쓰는 갤러리가 "그래서 뭘 누르지?" 에서 막히던 자리다.
 *
 * 규칙: 누군가 기다리고 있으면 attention(빨강), 기다리는 게 시간뿐이면 neutral, 끝났으면 done.
 * 같은 문장을 [내 공모] 카드와 운영 화면이 함께 쓴다 — 화면마다 다른 말을 하면 둘 중 하나를 의심하게 된다.
 */
export function galleryNextTask(s: GallerySnapshot, dday: DdayFn = getDday): NextTask {
  if (s.status === 'PENDING') {
    return { text: '관리자 승인을 기다리고 있어요. 승인되면 모집공고에 올라가고 알림으로 알려 드려요.', tone: 'neutral', target: null };
  }
  if (s.status === 'REJECTED') {
    return { text: '등록이 반려되었어요. 아래 사유를 확인하고 새로 등록해 주세요.', tone: 'attention', target: null };
  }
  if (s.settled) return { text: '정산까지 모두 끝났어요.', tone: 'done', target: 'settlement', action: '정산 내역' };

  const deadlinePassed = !!s.deadline && dday(s.deadline) < 0;
  const pendingText = `지원자 ${s.pending}명이 검토를 기다리고 있어요`;
  /*
    정원이 찼는데 모집 중 — 더는 수락할 수 없다(서버가 막는다). 검토 대기가 남아 있어도 '검토하세요' 를 띄우면
    눌러 보고 나서야 정원 안내를 받는다(2026-10-03 점검 P2). 작가 화면·지원은 그대로 둔다(사용자 결정 — 갤러리에게만 알린다).
    더 뽑으려면 [지원자] 의 [모집 인원 변경] 으로 늘린다.
  */
  const full = !!s.capacity && s.capacity > 0 && s.accepted >= s.capacity;
  const fullTask: NextTask = {
    text: `정원(${s.capacity}명)이 찼어요. 모집을 마감하세요${s.pending > 0 ? ` · 검토 대기 ${s.pending}명` : ''}`,
    tone: 'attention', target: 'stage', action: '모집 마감',
  };

  if (s.recruitOnly) {
    if (s.recruitmentClosed) return { text: '선정을 마쳤어요. 이 공고는 여기까지 진행합니다.', tone: 'done', target: 'applicants', action: '지원자 보기' };
    if (full) return fullTask;
    if (s.pending > 0) return { text: pendingText, tone: 'attention', target: 'applicants', action: '지원자 보기' };
    if (deadlinePassed) return { text: '모집 기간이 끝났어요. 선정을 마쳤다면 모집을 마감하세요.', tone: 'attention', target: 'stage', action: '모집 마감' };
    return { text: '지원을 받고 있어요.', tone: 'neutral', target: 'applicants', action: '지원자 보기' };
  }

  if (!s.recruitmentClosed) {
    if (full) return fullTask;
    if (s.pending > 0) return { text: pendingText, tone: 'attention', target: 'applicants', action: '지원자 보기' };
    if (deadlinePassed) return { text: '모집 기간이 끝났어요. 모집을 마감하고 전시를 준비하세요.', tone: 'attention', target: 'stage', action: '모집 마감' };
    return { text: '지원을 받고 있어요.', tone: 'neutral', target: 'applicants', action: '지원자 보기' };
  }

  if (!s.ended) {
    if (s.accepted === 0) return { text: '수락한 작가가 없어요. 지원자를 수락해 주세요.', tone: 'attention', target: 'applicants', action: '지원자 보기' };
    if (s.exhibitDate && dday(s.exhibitDate) < 0) {
      return { text: '전시 기간이 끝났어요. 전시를 종료하고 정산을 시작하세요.', tone: 'attention', target: 'stage', action: '전시 종료' };
    }
    if (s.submissionsIncomplete > 0) {
      return { text: `${SUBMISSION_TERM}를 아직 다 내지 않은 작가가 ${s.submissionsIncomplete}명 있어요`, tone: 'attention', target: 'submissions', action: '확인하기' };
    }
    const started = !!s.exhibitStartDate && dday(s.exhibitStartDate) <= 0;
    if (started) return { text: '전시 중이에요. 전시가 끝나면 전시를 종료하고 정산을 시작하세요.', tone: 'neutral', target: 'stage' };
    if (!s.confirmed) return { text: `${SUBMISSION_TERM}가 모두 모였어요. 전시를 확정하세요.`, tone: 'attention', target: 'stage', action: '전시 확정' };
    const left = s.exhibitStartDate ? ddayText('시작', s.exhibitStartDate, dday) : null;
    return { text: `전시를 준비하고 있어요${left ? ` · ${left}` : ''}`, tone: 'neutral', target: 'stage' };
  }

  if (!s.settlementRequested) {
    return {
      text: s.sales > 0 ? '판매 내역을 확인하고 작가에게 정산 확인을 요청하세요.' : '판매된 작품을 입력하고 작가에게 정산 확인을 요청하세요.',
      tone: 'attention', target: 'settlement', action: '정산하기',
    };
  }
  if (s.approvals.issue > 0) return { text: `작가 ${s.approvals.issue}명이 정산에 이의를 남겼어요`, tone: 'attention', target: 'settlement', action: '확인하기' };
  if (s.approvals.total > 0 && s.approvals.approved >= s.approvals.total) {
    // 버튼 이름을 '정산 완료' 로 두지 말 것 — 이 버튼은 정산 구역으로 데려갈 뿐인데, 그 구역의 진짜 [정산 완료]와 이름이 같아진다(2026-09-29)
    return { text: '작가 모두 정산을 확인했어요. 정산을 완료하세요.', tone: 'attention', target: 'settlement', action: '정산 마무리하기' };
  }
  return { text: `작가의 정산 확인을 기다리고 있어요 · ${s.approvals.approved}/${s.approvals.total}명`, tone: 'neutral', target: 'settlement' };
}

export interface ArtistSnapshot {
  status: string;
  recruitOnly: boolean;
  confirmed: boolean;
  ended: boolean;
  settled: boolean;
  settlementRequested: boolean;
  submissionComplete: boolean;
  submissionDeadline?: string | null;
  exhibitStartDate?: string | null;
  /** 정산 확인 요청에 **내가** 한 답(서버 `mySettlementStatus`). 없으면 아직 답하지 않은 것으로 본다 */
  mySettlementStatus?: string | null;
}

/**
 * 작가가 지금 해야 할 일. **할 일이 있을 때만** 돌려준다(null = 기다리면 된다) — 작가 카드엔 이미 일정 줄이 있어
 * 할 일이 없는데 문장을 또 적으면 잔소리가 된다. 접수 상태만 예외로 '결과는 알림으로' 를 알려 준다.
 */
export function artistNextTask(s: ArtistSnapshot, dday: DdayFn = getDday): NextTask | null {
  if (s.status === 'REJECTED') return null;
  if (s.status !== 'ACCEPTED') return { text: '갤러리가 검토하고 있어요. 결과는 알림으로 알려 드려요.', tone: 'neutral', target: null };
  if (s.recruitOnly || s.settled) return null;
  if (s.settlementRequested) {
    // 이미 답한 작가에게 '확인을 요청했어요' 를 계속 띄우면 확인이 안 된 줄 안다(2026-10-03 점검 P2).
    // 갤러리가 금액을 고치면 서버가 그 작가만 PENDING 으로 되돌리므로(규칙 26) 그때 다시 빨갛게 뜬다.
    if (s.mySettlementStatus === 'APPROVED') return null;
    if (s.mySettlementStatus === 'ISSUE') return { text: '이의를 전달했어요. 갤러리의 수정을 기다리고 있어요', tone: 'neutral', target: 'settlement' };
    return { text: '갤러리가 정산 확인을 요청했어요', tone: 'attention', target: 'settlement', action: '확인하기' };
  }
  if (s.ended) return null;
  if (!s.submissionComplete) {
    const locked = s.confirmed || (!!s.exhibitStartDate && dday(s.exhibitStartDate) <= 0);
    if (locked) return { text: `${SUBMISSION_TERM}가 다 차지 않은 채 전시가 확정되었어요. 갤러리에 문의해 주세요.`, tone: 'attention', target: 'submissions' };
    const left = ddayText('마감', s.submissionDeadline, dday);
    return { text: `${SUBMISSION_TERM}를 제출해 주세요${left ? ` · ${left}` : ''}`, tone: 'attention', target: 'submissions', action: '제출하기' };
  }
  return null;
}
