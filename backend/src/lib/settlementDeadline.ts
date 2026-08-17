/**
 * 정산 확인 무응답 자동 수락 기한.
 *
 * ── 규칙 ─────────────────────────────────────────────────────
 * 갤러리가 확인을 요청한 뒤 작가가 **3일(KST 달력) 동안 아무 응답이 없으면** 수락으로 처리한다.
 * 응답이 없어 정산이 무기한 멈추는 걸 막기 위한 장치다.
 *
 * ── 기준점은 '마지막으로 물어본 때' ─────────────────────────
 * 공모 전체의 `settlementRequestedAt` 이 아니라 **작가별 `askedAt`** 을 본다.
 * 부분 재확인이 생기면서 작가마다 물어본 시점이 다르기 때문이다.
 * 그래서 아래 세 경우 모두 **기한이 새로 시작된다**:
 *   · [정산 확인 요청] — 새로 묻는 작가
 *   · [이 작가에게 다시 확인 요청] — 그 작가
 *   · 금액 수정 후 [정산 저장] — 금액이 바뀐 작가
 *
 * ⚠️ 특히 세 번째가 중요하다. 금액을 고쳤는데 기한이 안 늘어나면
 *    **마감 직전에 금액을 바꿔놓고 자동 수락시키는 것**이 가능해진다.
 *
 * ── 왜 시(hour)가 아니라 KST 달력 날짜인가 ──────────────────
 * "요청 후 72시간"으로 하면 밤 11시에 보낸 요청은 사흘 뒤 밤 11시에 끝나 하루를 손해 보는 느낌을 준다.
 * 달력 기준은 화면에 날짜 하나로 적을 수 있고(‘8월 20일까지’), 작가에게 시간이 더 간다.
 * 돈이 걸린 판정은 **작가에게 유리한 쪽**으로 반올림하는 게 맞다. (CLAUDE.md 14 — 날짜 경계는 KST)
 *
 * ⚠️ ISSUE(문제 제기)는 절대 자동 수락되지 않는다. 명시적으로 이의를 낸 사람을 침묵으로 간주하는 건
 *    이 장치의 취지와 정반대다. PENDING(무응답)만 대상이다.
 */
import { endOfTodayKstAsUtc } from './kstDate';

/** 자동 수락까지 주는 유예 기간(일). 바꾸려면 여기만 고치면 된다 */
export const AUTO_APPROVE_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 자동 수락 기한 — 물어본 날의 KST 자정 끝에서 3일 뒤.
 * 8/17 아무 때나 물었으면 → 8/20 23:59:59.999 (KST) 까지. 즉 온전한 3일이 남는다.
 */
export function autoApproveDeadline(askedAt: Date): Date {
  return new Date(endOfTodayKstAsUtc(askedAt).getTime() + AUTO_APPROVE_DAYS * DAY_MS);
}

/** 기한이 지났는가. `askedAt` 이 없으면(옛 데이터) 영원히 false — 소급 적용하지 않는다 */
export function isAutoApproveDue(askedAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!askedAt) return false;
  return now > autoApproveDeadline(askedAt);
}

/** 남은 일수 (0 = 오늘까지). 화면 안내용이라 음수는 0으로 깎는다 */
export function daysLeft(askedAt: Date | null | undefined, now: Date = new Date()): number | null {
  if (!askedAt) return null;
  const deadline = autoApproveDeadline(askedAt);
  const end = endOfTodayKstAsUtc(now);
  return Math.max(0, Math.round((deadline.getTime() - end.getTime()) / DAY_MS));
}
