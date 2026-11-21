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
import { getDday, capacityWithLimit, capacityLimit } from '@/lib/utils';
import { shortDate, daysUntil } from '@/lib/listings';
import { SELECTION_REMIND_DAYS } from '@/lib/applicationWindow';

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
  /** 접수 마감일 — 지나면 [모집 마감]을 안 눌렀어도 접수가 끝난 것이다(규칙 90: 그때부터 선정) */
  deadline?: string | null;
  /** 결정을 기다리는 지원 수(갤러리만 안다) — 공모만 진행하는 공고가 마감 뒤 '선정 중'인지 '선정 완료'인지 가른다 */
  pending?: number | null;
}

/** 접수가 끝났나 — 모집 마감을 눌렀거나 접수 마감일이 지났다(서버 `selectionStarted` 와 같은 규칙, 규칙 90) */
export function recruitmentOver(ex: { recruitmentClosed?: boolean | null; deadline?: string | null }, dday: DdayFn = getDday): boolean {
  return !!ex.recruitmentClosed || (!!ex.deadline && dday(ex.deadline) < 0);
}

export type StageKey =
  | 'review' | 'rejected'
  | 'recruiting' | 'selecting' | 'selected'
  | 'preparing' | 'confirmed' | 'running'
  | 'ended' | 'settling' | 'settled' | 'closed';

export interface StageView { key: StageKey; label: string; variant: ChipVariant }

/**
 * 지금 공모가 어느 단계인가 — 갤러리 카드·작가 카드·운영 화면이 **같은 이름**을 받는다.
 *
 *   모집 중 → 전시 준비 → 전시 확정 → 전시 중 → 전시 종료 → 정산 중 → 정산 완료
 *   (공모만 진행: 모집 중 → 선정 중 → 선정 완료)
 *
 * 수락은 **접수가 끝난 뒤**에 한다(2026-11-21, 규칙 90 — 모집 마감 또는 접수 마감일 경과, `recruitmentOver`). 그래서 공모만 진행하는 공고는
 * 그 뒤 결정을 기다리는 지원이 남아 있는 동안 '선정 중'이다(`pending` — 모르면 예전처럼 '선정 완료'). 전시까지 하는 공고는 그 기간이
 * '전시 준비'와 겹친다(수락된 작가는 곧바로 출품 자료를 낸다).
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

  const over = recruitmentOver(ex, dday);
  if (ex.recruitOnly) {
    if (ex.closed) return { key: 'closed', label: '종료', variant: 'done' };
    if (!over) return { key: 'recruiting', label: '모집 중', variant: 'neutral' };
    return (ex.pending ?? 0) > 0
      ? { key: 'selecting', label: '선정 중', variant: 'neutral' }
      : { key: 'selected', label: '선정 완료', variant: 'done' };
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
  if (over) return { key: 'preparing', label: '전시 준비', variant: 'neutral' };
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

/**
 * 할 일이 가리키는 곳 — 공모 한 건 화면의 탭(지원자 · 출품 자료 · 정산 · 공지 · 요약) 또는 단계 전환('stage').
 * 'stage' 면 그 단계에서 보는 탭이 열린다(`workspaceDefaultView`) — 버튼은 화면 위 할 일 줄에 있다.
 */
export type TaskTarget = 'applicants' | 'stage' | 'submissions' | 'settlement' | 'notices' | 'summary' | null;

/**
 * 할 일 줄의 **진짜 버튼**(2026-11-20 개편 — 예전엔 할 일 줄이 그 구역으로 '데려가기'만 했다).
 * 공모 한 건 화면이 id 를 보고 실행한다: 단계 전환은 확인창, 안내 보내기는 메시지 창, 정산은 정산 탭의 상태(저장 안 된 입력·이의)를 보고.
 */
export type TaskActionId =
  | 'close' | 'finish-selection' | 'confirm' | 'end'
  | 'remind-submissions'
  | 'request-settlement' | 'resend-settlement' | 'save-settlement' | 'complete-settlement' | 'remind-settlement';
export interface TaskAction { id: TaskActionId; label: string }

export interface NextTask {
  text: string;
  tone: ChipVariant;
  target: TaskTarget;
  /** 목록 줄의 버튼 이름 — 누르면 그 공모 한 건 화면의 `target` 탭으로 간다(`act` 가 있으면 도착해서 바로 연다) */
  action?: string;
  /** 목록에서 버튼을 눌러 왔을 때 도착해서 바로 실행할 것(확인창·메시지 창을 연다 — 실행은 그 창에서 사람이 한다) */
  act?: TaskActionId;
  /** 공모 한 건 화면 할 일 줄의 주 버튼(검정 하나) */
  primary?: TaskAction;
  /** 같은 줄의 보조 버튼(테두리) */
  secondary?: TaskAction;
  /** 문장 아래 작은 한 줄(공모 한 건 화면의 할 일 줄만) — '그날이 지나면 수락하지 않은 지원자는 미선정이 돼요' */
  note?: string;
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
  /** 선정 마감일(새 공고, 규칙 90) — 이날까지 수락하고, 지나면 남은 검토 대기는 미선정. 옛 공고는 null */
  selectionDeadline?: string | null;
  exhibitStartDate?: string | null;
  exhibitDate?: string | null;
  /** 결정을 기다리는 지원(접수) */
  pending: number;
  /** 수락한 작가 */
  accepted: number;
  /** 모집 인원(= 뽑을 수 있는 사람 수, 규칙 57). 모르면 null — 정원 안내를 건너뛴다 */
  capacity?: number | null;
  /** 공고에 0명·00명으로 적었으면 — 정원 문구에 '0명 — 최대 9명' 으로 */
  capacityMask?: string | null;
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
    return { text: '등록이 반려되었어요. 사유를 확인하고 새로 등록해 주세요.', tone: 'attention', target: null };
  }
  if (s.settled) return { text: '정산까지 모두 끝났어요.', tone: 'done', target: 'summary', action: '요약 보기' };

  const CLOSE: TaskAction = { id: 'close', label: '모집 마감' };
  /*
    정원(= 뽑을 수 있는 사람 수, 규칙 57)이 찼다. 접수 중엔 초대 코드로만 찰 수 있고, 접수가 끝나면 수락으로 찬다.
    더는 수락할 수 없다(서버가 막는다) — 더 뽑으려면 [모집 인원 변경]으로 늘린다.
  */
  const full = !!s.capacity && s.capacity > 0 && s.accepted >= s.capacity;
  const left = s.deadline ? ddayText('마감', s.deadline, dday) : null;

  /*
    접수 중 — **수락은 접수가 끝난 뒤에만**(2026-11-21 사용자 결정, 규칙 90). 작가가 지원서를 고치거나 취소할 수 있는 동안엔 결정하지 않는다.
    그래서 지원이 들어와도 지금 할 일이 아니다(기다리는 중). 접수 마감일이 지나면 [모집 마감]을 안 눌러도 선정이 시작된다.
  */
  if (!recruitmentOver(s, dday)) {
    if (full) {
      return {
        text: `정원(${capacityWithLimit(s)})이 찼어요${s.pending > 0 ? ` · 지원 ${s.pending}명` : ''}`,
        tone: 'attention', target: 'stage', action: '모집 마감', act: 'close', primary: CLOSE,
      };
    }
    const applied = s.pending > 0 ? ` · 지원 ${s.pending}명` : '';
    return { text: `지원을 받고 있어요${applied}${left ? ` · ${left}` : ''}`, tone: 'neutral', target: 'applicants', action: '지원자 보기', secondary: CLOSE };
  }

  /*
    접수가 끝났다 — 선정. 결정을 기다리는 지원이 있으면 그게 먼저다(작가들이 결과를 기다린다). 고르는 건 [지원자] 탭의 [수락하기] —
    거절은 따로 없다(사용자 결정 "안 뽑으면 그게 거절"). 다 골랐으면 **할 일 줄의 [선정 마치기]**(모든 공고, 2026-11-21 사용자 결정 —
    "마감일 전에 끝내거나 · 더 적게 뽑고 끝내거나 · 아무도 안 뽑을 때"). 목록 줄도 같은 버튼(눌러 오면 도착해서 확인창). [⋯] 메뉴엔 없다.
    안 누르면 새 공고는 선정 마감일이 지날 때, 옛 공고(날짜 없음)는 전시 확정·종료 때 끝난다. 정원을 다 뽑으면 서버가 그 자리에서 끝낸다.
  */
  if (s.pending > 0 && !s.ended) {
    const sel = s.selectionDeadline;
    const FINISH: TaskAction = { id: 'finish-selection', label: '선정 마치기' };
    const finish = { action: FINISH.label, act: FINISH.id, primary: FINISH } as const;
    if (full) {
      // 정원이 찼는데 검토 대기가 남았다 — 서버는 정원이 차면 선정을 끝내므로 잠깐(다시 받기 전) 또는 접수 중 코드로 찬 채 마감일이 지난 사이뿐이다
      return {
        text: `정원(${capacityWithLimit(s)})이 찼어요 · 검토 대기 ${s.pending}명`,
        tone: 'attention', target: 'applicants', ...finish,
        ...(sel ? { note: `${shortDate(sel)}이 지나면 검토 대기는 미선정이 돼요` } : {}),
      };
    }
    return {
      text: sel ? `${shortDate(sel)}까지 선정하세요 · 검토 대기 ${s.pending}명` : `지원자 ${s.pending}명이 검토를 기다리고 있어요`,
      tone: 'attention', target: 'applicants', ...finish,
      ...(sel ? { note: '그날이 지나면 수락하지 않은 지원자는 미선정이 돼요' } : {}),
    };
  }

  if (s.recruitOnly) return { text: '선정을 마쳤어요. 이 공고는 여기까지 진행합니다.', tone: 'done', target: 'applicants', action: '지원자 보기' };

  if (!s.ended) {
    const started = !!s.exhibitStartDate && dday(s.exhibitStartDate) <= 0;
    // 작가 자료가 잠겼는가 — 갤러리의 수동 확정 또는 전시 시작일 경과(서버 computeConfirmed 와 같은 규칙)
    const locked = s.confirmed || started;
    // 검토 대기가 없는데 수락한 작가도 없다 — 더 수락할 사람이 없다(결과가 난 지원은 바꾸지 않는다, 규칙 90)
    if (s.accepted === 0) return { text: '선정한 작가가 없어요.', tone: 'neutral', target: 'applicants', action: '지원자 보기' };
    if (s.exhibitDate && dday(s.exhibitDate) < 0) {
      return { text: '전시 기간이 끝났어요. 전시를 종료하고 정산을 시작하세요.', tone: 'attention', target: 'stage', action: '전시 종료', act: 'end', primary: { id: 'end', label: '전시 종료' } };
    }
    if (s.submissionsIncomplete > 0 && !locked) {
      return {
        text: `${SUBMISSION_TERM}를 아직 내지 않은 작가가 ${s.submissionsIncomplete}명 있어요`,
        tone: 'attention', target: 'submissions', action: '안내 보내기', act: 'remind-submissions',
        primary: { id: 'remind-submissions', label: `${s.submissionsIncomplete}명에게 안내 보내기` },
        secondary: { id: 'confirm', label: '전시 확정' },
      };
    }
    if (s.submissionsIncomplete > 0) {
      // 잠긴 뒤 — 작가는 더 못 낸다. 갤러리가 [대신 입력]으로 채운다(출품 자료 탭의 작가 줄)
      return { text: `${SUBMISSION_TERM}가 비어 있는 작가가 ${s.submissionsIncomplete}명 있어요`, tone: 'attention', target: 'submissions', action: '확인하기' };
    }
    if (started) {
      const until = s.exhibitDate ? ` · ${shortDate(s.exhibitDate)}까지` : '';
      return { text: `전시 중이에요${until}`, tone: 'neutral', target: 'submissions', action: '출품 자료 보기' };
    }
    if (!s.confirmed) return { text: `${SUBMISSION_TERM}가 모두 모였어요. 전시를 확정하세요.`, tone: 'attention', target: 'stage', action: '전시 확정', act: 'confirm', primary: { id: 'confirm', label: '전시 확정' } };
    const toStart = s.exhibitStartDate ? ddayText('시작', s.exhibitStartDate, dday) : null;
    return { text: `전시를 준비하고 있어요${toStart ? ` · ${toStart}` : ''}`, tone: 'neutral', target: 'submissions', action: '출품 자료 보기' };
  }

  if (!s.settlementRequested) {
    return {
      text: s.sales > 0 ? '판매 내역을 확인하고 작가에게 정산 확인을 요청하세요.' : '판매된 작품을 입력하고 작가에게 정산 확인을 요청하세요.',
      tone: 'attention', target: 'settlement', action: '정산하기',
      primary: { id: 'request-settlement', label: s.accepted > 0 ? `작가 ${s.accepted}명에게 확인 요청` : '작가에게 확인 요청' },
    };
  }
  if (s.approvals.issue > 0) {
    // 실제 버튼(저장하고 ○○ 님에게 다시 요청)은 정산 탭이 이름을 알고 정한다 — 여기선 목록 줄의 말
    return { text: `작가 ${s.approvals.issue}명이 정산에 이의를 남겼어요`, tone: 'attention', target: 'settlement', action: '이의 보기' };
  }
  if (s.approvals.total > 0 && s.approvals.approved >= s.approvals.total) {
    return {
      text: `작가 ${s.approvals.total}명이 모두 정산을 확인했어요.`,
      tone: 'attention', target: 'settlement', action: '정산 완료', act: 'complete-settlement',
      primary: { id: 'complete-settlement', label: '정산 완료' },
    };
  }
  const unanswered = Math.max(0, s.approvals.total - s.approvals.approved - s.approvals.issue);
  return {
    text: `작가의 정산 확인을 기다리고 있어요 · ${s.approvals.approved}/${s.approvals.total}명`,
    tone: 'neutral', target: 'settlement', action: '정산 보기',
    ...(unanswered > 0 ? { secondary: { id: 'remind-settlement' as const, label: `미응답 ${unanswered}명에게 다시 알리기` } } : {}),
  };
}

export interface ArtistSnapshot {
  status: string;
  recruitOnly: boolean;
  /** 접수가 끝났나 · 선정 마감일 — 심사 중 안내('○○까지 선정 결과가 나와요')에 쓴다(규칙 90) */
  recruitmentClosed?: boolean | null;
  deadline?: string | null;
  selectionDeadline?: string | null;
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
 * 심사 중인 작가에게 하는 한 줄 — 언제 결과가 나오는지. 미선정은 알림이 없으므로(규칙 90) '결과는 알림으로'라고 하지 않는다:
 * 선정 마감일이 있으면 그 날짜, 없으면(옛 공고) '선정되면 알림으로'.
 */
export function artistPendingText(s: { recruitmentClosed?: boolean | null; deadline?: string | null; selectionDeadline?: string | null }, dday: DdayFn = getDday): string {
  const when = s.selectionDeadline ? `${shortDate(s.selectionDeadline)}까지 선정 결과가 나와요.` : '선정되면 알림으로 알려 드려요.';
  return recruitmentOver(s, dday) ? `모집이 마감되어 갤러리가 선정하고 있어요. ${when}` : `접수가 끝나면 갤러리가 선정해요. ${when}`;
}

/**
 * 작가가 지금 해야 할 일. **할 일이 있을 때만** 돌려준다(null = 기다리면 된다) — 작가 카드엔 이미 일정 줄이 있어
 * 할 일이 없는데 문장을 또 적으면 잔소리가 된다. 접수 상태만 예외로 언제 결과가 나오는지(선정 마감일) 알려 준다 —
 * 미선정은 알림이 없어서 '결과는 알림으로' 라고 하지 않는다(규칙 90).
 */
export function artistNextTask(s: ArtistSnapshot, dday: DdayFn = getDday): NextTask | null {
  if (s.status === 'REJECTED') return null;
  if (s.status !== 'ACCEPTED') return { text: artistPendingText(s, dday), tone: 'neutral', target: null };
  if (s.recruitOnly || s.settled) return null;
  if (s.settlementRequested) {
    // 이미 답한 작가에게 '확인을 요청했어요' 를 계속 띄우면 확인이 안 된 줄 안다(2026-10-03 점검 P2).
    // 갤러리가 금액을 고치면 서버가 그 작가만 PENDING 으로 되돌리므로(규칙 26) 그때 다시 빨갛게 뜬다.
    if (s.mySettlementStatus === 'APPROVED') return null;
    if (s.mySettlementStatus === 'ISSUE') return { text: '이의를 보냈어요. 갤러리가 확인하고 있어요', tone: 'neutral', target: 'settlement', action: '정산 보기' };
    return { text: '정산 확인 요청이 왔어요', tone: 'attention', target: 'settlement', action: '확인하기' };
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

/* ─────────────────────────────────────────────────────────────
   진행 띠 — 갤러리·작가가 같은 다섯 칸을 본다 (2026-11-20 개편, 규칙 88)
   ───────────────────────────────────────────────────────────── */

/**
 * 칸은 **기간**이다(`stageOf` 와 같은 말) — 모집(작가는 '지원') · 전시 준비 · 전시 · 정산 · 마무리.
 * 모집 마감·전시 확정·전시 종료·정산 완료는 칸 사이를 넘기는 **버튼 이름**으로만 쓴다
 * (예전 운영 화면의 4칸은 버튼 이름이라, 동그라미는 '전시 확정'인데 아래 글은 '지금 · 전시 준비'였다).
 * 공모만 진행하는 공고는 두 칸: 모집 · 선정.
 * 사용자가 말하는 일곱 단계 — ①지원 ②심사 = 모집 · ③제출 ④취합 = 전시 준비 · ⑤요청 ⑥확인 = 정산 · ⑦끝 = 마무리.
 */
export type StripKey = 'recruit' | 'prepare' | 'show' | 'settle' | 'wrap' | 'select';
export interface StripCell {
  key: StripKey;
  label: string;
  state: 'done' | 'current' | 'todo';
  /** 그 칸의 숫자·상태 — '수락 2/4 · 대기 3' · '출품 자료 1/4' · '작가 확인 1/3' */
  value?: string;
  /** 날짜·기한 — '11.29(일) 마감' · '12.6(일)까지 · D-6' */
  note?: string;
  /** 지금 빨강으로 말할 것(7일 안 마감 · 이의 · 지난 기한) — 글자만 강조색 */
  hot?: boolean;
}

export interface StripInput extends StageInput {
  submissionDeadline?: string | null;
  /** 선정 마감일(새 공고) — 갤러리 화면의 모집 칸에 '선정 마감 11.30(월) · D-3'(3일 안이면 빨강) */
  selectionDeadline?: string | null;
  /** 전시 **종료일**(시작은 exhibitStartDate — 이름이 헷갈린다, schema 주석) */
  exhibitDate?: string | null;
  /** 갤러리: 수락 · 검토 대기 · 정원 */
  accepted?: number;
  pending?: number;
  capacity?: number | null;
  capacityMask?: string | null;
  /** 갤러리: 출품 자료 다 낸 작가 / 수락한 작가 */
  submissionsComplete?: number;
  submissionsRequired?: number;
  /** 갤러리: 판매 · 정산 확인 */
  sales?: number;
  approvals?: { total: number; approved: number; issue: number };
  /** 작가: 내 지원 상태 · 내 출품 자료 · 내 정산 답 */
  applicationStatus?: string | null;
  submissionComplete?: boolean;
  mySettlementStatus?: string | null;
}

const STRIP_INDEX: Partial<Record<StageKey, number>> = {
  recruiting: 0, preparing: 1, confirmed: 1, running: 2, ended: 3, settling: 3, closed: 3, settled: 4,
};

export function flowStrip(viewer: 'gallery' | 'artist', s: StripInput, now: Date = new Date()): StripCell[] {
  const dd = (d: string) => daysUntil(d, now);
  const ddayFn: DdayFn = (d) => daysUntil(d, now);
  const stage = stageOf(s, ddayFn);
  const over = recruitmentOver(s, ddayFn);
  const artistPending = viewer === 'artist' && s.applicationStatus !== 'ACCEPTED';
  const first = viewer === 'artist' ? '지원' : '모집';
  const recruitValue = (): string | undefined => {
    if (viewer === 'artist') return s.applicationStatus === 'ACCEPTED' ? '선정' : s.applicationStatus === 'REJECTED' ? '미선정' : '심사 중';
    if (s.accepted == null) return undefined;
    const cap = s.capacity ? `/${capacityLimit({ capacity: s.capacity, capacityMask: (s.capacityMask ?? null) as 'ONE' | 'TWO' | null })}` : '';
    const pending = s.pending ?? 0;
    // 접수 중엔 아직 아무도 결정하지 않는다(규칙 90) — 받은 지원 수. 초대 코드로 들어온 수락이 있으면 그것도
    if (!over) return s.accepted > 0 ? `수락 ${s.accepted}${cap} · 지원 ${pending}` : `지원 ${pending}`;
    return `수락 ${s.accepted}${cap}${pending > 0 ? ` · 대기 ${pending}` : ''}`;
  };
  const recruitNote = (): { note?: string; hot?: boolean } => {
    if (!over) {
      if (!s.deadline) return {};
      const left = dd(s.deadline);
      return { note: `${shortDate(s.deadline)} 마감`, hot: left >= 0 && left <= 7 };
    }
    // 선정 중(갤러리) — 선정 마감일까지 며칠. 3일 안이면 빨강(그때부터 알림도 간다, 규칙 90)
    if (viewer === 'gallery' && s.selectionDeadline && (s.pending ?? 0) > 0) {
      const left = dd(s.selectionDeadline);
      if (left >= 0) return { note: `선정 마감 ${shortDate(s.selectionDeadline)} · ${left === 0 ? '오늘' : `D-${left}`}`, hot: left <= SELECTION_REMIND_DAYS };
    }
    return {};
  };

  if (s.recruitOnly) {
    const doneAll = stage?.key === 'selected' || stage?.key === 'closed' || (viewer === 'artist' && s.applicationStatus === 'ACCEPTED');
    // 마감했고 결정을 기다리는 지원이 남았다 — 선정 칸이 지금이다(규칙 90)
    const selecting = stage?.key === 'selecting';
    const review = stage?.key === 'review' || stage?.key === 'rejected';
    return [
      { key: 'recruit', label: first, state: review ? 'todo' : doneAll || selecting ? 'done' : 'current', value: selecting ? undefined : recruitValue(), ...(over ? {} : recruitNote()) },
      { key: 'select', label: '선정', state: doneAll || selecting ? 'current' : 'todo', value: doneAll ? '선정 완료' : selecting ? recruitValue() : undefined, ...(selecting ? recruitNote() : {}) },
    ];
  }

  // 지금 칸 — 승인 전·반려면 -1(전부 앞으로 할 일). 작가는 선정되기 전까지 '지원' 칸에 있다
  let idx = stage ? (STRIP_INDEX[stage.key] ?? -1) : -1;
  if (artistPending) idx = stage && (stage.key === 'review' || stage.key === 'rejected') ? -1 : 0;
  const stateOf = (i: number): StripCell['state'] => (i < idx ? 'done' : i === idx ? 'current' : 'todo');

  // 전시 준비 — 출품 자료
  let prepValue: string | undefined;
  let prepNote: string | undefined;
  let prepHot = false;
  if (viewer === 'gallery') {
    if ((s.submissionsRequired ?? 0) > 0) prepValue = `출품 자료 ${s.submissionsComplete ?? 0}/${s.submissionsRequired}`;
    if (s.submissionDeadline) {
      const left = dd(s.submissionDeadline);
      const missing = (s.submissionsRequired ?? 0) > (s.submissionsComplete ?? 0);
      prepNote = `${shortDate(s.submissionDeadline)}까지${idx === 1 && left >= 0 ? ` · D-${left === 0 ? 'DAY' : left}` : ''}`;
      prepHot = idx === 1 && missing && left <= 3;
    }
  } else if (!artistPending) {
    prepValue = s.submissionComplete ? '제출 완료' : '출품 자료';
    if (s.submissionDeadline && !s.submissionComplete) {
      const left = dd(s.submissionDeadline);
      prepNote = left < 0 ? `${shortDate(s.submissionDeadline)} 마감 지남` : `${shortDate(s.submissionDeadline)}까지 · D-${left === 0 ? 'DAY' : left}`;
      prepHot = idx <= 1 && left <= 3;
    }
  }

  // 전시 — 기간
  const showValue = s.exhibitDate
    ? (s.exhibitStartDate ? `${shortDate(s.exhibitStartDate).replace(/\(.\)/, '')} – ${shortDate(s.exhibitDate).replace(/\(.\)/, '')}` : `${shortDate(s.exhibitDate)}까지`)
    : undefined;
  let showNote: string | undefined;
  if (s.exhibitStartDate && idx < 2) {
    const toStart = dd(s.exhibitStartDate);
    if (toStart > 0 && idx >= 1) showNote = `시작 D-${toStart}`;
  }
  if (idx === 2 && s.exhibitDate) showNote = `${shortDate(s.exhibitDate)}까지`;

  // 정산
  let settleValue: string | undefined;
  let settleNote: string | undefined;
  let settleHot = false;
  if (viewer === 'gallery') {
    const ap = s.approvals;
    if (s.settledAt) settleValue = ap && ap.total ? `작가 확인 ${ap.total}/${ap.total}` : '정산 완료';
    else if (s.settlementRequestedAt) {
      settleValue = ap ? `작가 확인 ${ap.approved}/${ap.total}` : '확인 요청 중';
      if (ap && ap.issue > 0) { settleNote = `이의 ${ap.issue}건`; settleHot = true; }
    } else if (idx === 3) settleValue = (s.sales ?? 0) > 0 ? `판매 ${s.sales}점` : '판매 입력 전';
  } else if (!artistPending) {
    if (s.settledAt) settleValue = '정산 완료';
    else if (s.settlementRequestedAt) {
      if (s.mySettlementStatus === 'APPROVED') settleValue = '확인함';
      else if (s.mySettlementStatus === 'ISSUE') settleValue = '이의 보냄';
      else { settleValue = '확인 요청'; settleHot = true; }
    }
  }

  return [
    { key: 'recruit', label: first, state: stateOf(0), value: recruitValue(), ...(idx <= 0 || (viewer === 'gallery' && over) ? recruitNote() : {}) },
    { key: 'prepare', label: '전시 준비', state: stateOf(1), value: prepValue, note: prepNote, hot: prepHot || undefined },
    { key: 'show', label: '전시', state: stateOf(2), value: showValue, note: showNote },
    { key: 'settle', label: '정산', state: stateOf(3), value: settleValue, note: settleNote, hot: settleHot || undefined },
    { key: 'wrap', label: '마무리', state: stateOf(4), value: s.settledAt ? shortDate(s.settledAt) : undefined },
  ];
}

/* ─────────────────────────────────────────────────────────────
   공모 한 건 화면의 탭
   ───────────────────────────────────────────────────────────── */

/** 운영자(갤러리·관리자)의 탭 — 주소 `view=` 와 알림 링크(서버 `lib/notifyLinks.ts OperationView`)가 같은 이름을 쓴다 */
export type WorkspaceView = 'summary' | 'applicants' | 'submissions' | 'settlement' | 'notices';
export const WORKSPACE_VIEWS: WorkspaceView[] = ['summary', 'applicants', 'submissions', 'settlement', 'notices'];

/**
 * 처음 열 탭 — 그 단계에서 일하는 곳. 모집 → 지원자 · 전시 준비~전시 → 출품 자료 · 정산 → 정산 · 마무리 → 요약.
 * 공모만 진행은 지원자(그 공고의 일은 거기서 끝난다).
 * 마감 뒤 결정을 기다리는 지원이 남았으면(`pending`) 전시 준비여도 지원자 — 선정이 먼저다(규칙 90).
 */
export function workspaceDefaultView(stage: StageKey | null | undefined, recruitOnly = false, pending = 0): WorkspaceView {
  if (recruitOnly) return 'applicants';
  if (stage === 'preparing' && pending > 0) return 'applicants';
  switch (stage) {
    case 'preparing': case 'confirmed': case 'running': return 'submissions';
    case 'ended': case 'settling': case 'closed': return 'settlement';
    case 'settled': return 'summary';
    default: return 'applicants';
  }
}

/** 작가 전시 화면의 탭 */
export type ArtistView = 'submissions' | 'settlement' | 'notices' | 'application';

/** 작가가 처음 볼 탭 — 할 일이 있으면 그 탭, 없으면 그 단계의 탭 */
export function artistDefaultView(s: ArtistSnapshot): ArtistView {
  if (s.status !== 'ACCEPTED') return 'application';
  if (s.recruitOnly) return 'notices';
  if (s.settlementRequested || s.settled) return 'settlement';
  return 'submissions';
}

/** 작가 목록의 '기다리는 중' 줄 — 할 일이 없을 때 지금 무엇을 기다리는지 한 줄 */
export function artistWaitText(s: ArtistSnapshot, dday: DdayFn = getDday): string {
  if (s.status === 'REJECTED') return '이번 공모에서는 선정되지 않았어요';
  if (s.status !== 'ACCEPTED') return s.selectionDeadline ? `${shortDate(s.selectionDeadline)}까지 선정 결과가 나와요` : '갤러리가 검토하고 있어요';
  if (s.recruitOnly) return '선정되었어요';
  if (s.settled) return '정산이 끝났어요';
  if (s.settlementRequested) return s.mySettlementStatus === 'ISSUE' ? '이의를 보냈어요' : '정산을 확인했어요 · 갤러리 마무리 대기';
  if (s.ended) return '전시가 끝났어요 · 정산을 기다리고 있어요';
  const started = !!s.exhibitStartDate && dday(s.exhibitStartDate) <= 0;
  if (started) return '전시 중이에요';
  const toStart = s.exhibitStartDate ? ddayText('시작', s.exhibitStartDate, dday) : null;
  return `출품 자료 제출 완료${toStart ? ` · ${toStart}` : ''}`;
}

/* ─────────────────────────────────────────────────────────────
   목록 줄·공모 한 건 화면 머리의 보조 글 — 굵은 단계 이름 옆 (2026-11-20)
   ───────────────────────────────────────────────────────────── */

export interface SubTextInput {
  stageKey?: StageKey | null;
  deadline?: string | null;
  submissionDeadline?: string | null;
  /** 선정 마감일 · 검토 대기(갤러리) — 선정 중이면 '선정 마감 D-3' 이 먼저다(규칙 90) */
  selectionDeadline?: string | null;
  pending?: number | null;
  exhibitStartDate?: string | null;
  exhibitDate?: string | null;
  settledAt?: string | null;
  settlementRequestedAt?: string | null;
  /** 갤러리만 — 공모를 올린 갤러리에게만 서버가 싣는다(규칙 63) */
  viewCount?: number | null;
}

/** 갤러리 — '마감 D-9 · 조회 124' · '출품 자료 마감 D-6' · '11.30(월)까지' · '확인 요청 11.18(수)' */
export function gallerySubText(s: SubTextInput, dday: DdayFn = getDday): string | null {
  const parts: (string | null)[] = [];
  switch (s.stageKey) {
    case 'recruiting':
      parts.push(ddayText('마감', s.deadline, dday));
      if (s.viewCount != null) parts.push(`조회 ${s.viewCount.toLocaleString('ko')}`);
      break;
    case 'selecting': case 'selected':
      if ((s.pending ?? 0) > 0) parts.push(ddayText('선정 마감', s.selectionDeadline, dday));
      if (s.viewCount != null) parts.push(`조회 ${s.viewCount.toLocaleString('ko')}`);
      break;
    case 'preparing': case 'confirmed':
      parts.push(((s.pending ?? 0) > 0 && s.stageKey === 'preparing' ? ddayText('선정 마감', s.selectionDeadline, dday) : null)
        ?? ddayText('출품 자료 마감', s.submissionDeadline, dday) ?? ddayText('전시 시작', s.exhibitStartDate, dday));
      break;
    case 'running':
      parts.push(s.exhibitDate ? `${shortDate(s.exhibitDate)}까지` : null);
      break;
    case 'ended': case 'settling': case 'closed':
      // 상태 이름이 이미 '전시 종료'라 날짜만(예전 '전시 종료 11.18(수) 전시 종료' 가 겹쳤다)
      parts.push(s.settlementRequestedAt ? `확인 요청 ${shortDate(s.settlementRequestedAt)}` : s.exhibitDate ? shortDate(s.exhibitDate) : null);
      break;
    case 'settled':
      parts.push(s.settledAt ? shortDate(s.settledAt) : null);
      break;
    default:
      break;
  }
  const text = parts.filter(Boolean).join(' · ');
  return text || null;
}

/** 작가 — '출품 자료 마감 D-6' · '출품 자료 제출 완료 · 시작 D-10' · '11.30(월)까지' · '확인함 · 갤러리 마무리 대기' */
export function artistSubText(s: SubTextInput & { applicationStatus: string; appliedAt?: string | null; submissionComplete?: boolean; mySettlementStatus?: string | null }, dday: DdayFn = getDday): string | null {
  if (s.applicationStatus !== 'ACCEPTED') return s.appliedAt ? `${shortDate(s.appliedAt)} 지원` : null;
  switch (s.stageKey) {
    case 'recruiting': case 'preparing': case 'confirmed': {
      if (!s.submissionComplete) return ddayText('출품 자료 마감', s.submissionDeadline, dday) ?? (s.submissionDeadline ? `출품 자료 마감 ${shortDate(s.submissionDeadline)}` : null);
      const toStart = ddayText('시작', s.exhibitStartDate, dday);
      return `출품 자료 제출 완료${toStart ? ` · ${toStart}` : ''}`;
    }
    case 'running': return s.exhibitDate ? `${shortDate(s.exhibitDate)}까지` : null;
    case 'ended': case 'settling': case 'closed':
      if (s.settlementRequestedAt) {
        if (s.mySettlementStatus === 'APPROVED') return '확인함 · 갤러리 마무리 대기';
        if (s.mySettlementStatus === 'ISSUE') return '이의를 보냄';
        return '정산 확인 요청';
      }
      return s.exhibitDate ? shortDate(s.exhibitDate) : null;
    case 'settled': return s.settledAt ? shortDate(s.settledAt) : null;
    case 'selecting': case 'selected': return '선정';
    default: return null;
  }
}

/** 목록 버튼으로 들어갈 탭 — 할 일의 target 을 탭 이름으로('stage'·null 은 단계 기본 탭) */
export function viewForTarget(target: TaskTarget): WorkspaceView | null {
  return target === 'applicants' || target === 'submissions' || target === 'settlement' || target === 'notices' || target === 'summary' ? target : null;
}
