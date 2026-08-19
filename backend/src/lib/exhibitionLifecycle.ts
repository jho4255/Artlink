/**
 * 공모가 "끝난 것" 인지 판정하는 단일 기준.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────
 * 원래는 **정산 완료(`settledAt`)** 만 종료로 봤다. 그런데 실서버를 보면
 * 갤러리가 [전시종료] 버튼조차 안 누른 채 방치된 공모가 있다
 * (#4 이색동행展 — 전시가 끝난 지 39일). 정산을 아예 안 쓰는 갤러리도 있다.
 * 그러면 작가·갤러리·Admin 목록 모두에서 **몇 년 전 전시가 영원히 '진행중'** 으로 쌓인다.
 *
 * 그래서 전시 종료일로부터 일정 기간이 지나면 자동으로 종료로 본다.
 *
 * ── 단, 정산을 시작한 공모는 건드리지 않는다 ────────────────
 * 판매 금액을 입력했거나 확인 요청을 보낸 공모는 **사람이 지금 쓰고 있는 것**이다.
 * 20일이 지났다고 목록에서 내리면 갤러리가 하던 일을 잃어버린다.
 * 방치를 정리하려는 규칙이 진행 중인 작업을 방해하면 안 된다(2026-08-19 결정).
 *
 * ⚠️ 이 파일은 **판정만** 한다. DB의 `ended` 플래그를 대신 켜지 않는다 —
 *    `ended` 는 갤러리가 누른 사실의 기록이고, 그걸 시스템이 조작하면
 *    "언제 종료했는가" 라는 기록이 사라진다. 목록 분류에서만 이 함수를 쓴다.
 */
import { startOfTodayKstAsUtc } from './kstDate';

/** 전시 종료 후 이 기간이 지나면 방치로 보고 종료 처리 */
export const STALE_AFTER_DAYS = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface LifecycleExhibition {
  /** 전시 종료일 — 갤러리가 [전시종료] 를 안 눌러도 이 날짜는 있다 */
  exhibitDate: Date | string | null;
  settledAt?: Date | string | null;
  settlementRequestedAt?: Date | string | null;
  /** 판매 입력 건수. 0보다 크면 갤러리가 정산을 시작한 것 */
  saleCount?: number;
}

const asDate = (v: Date | string | null | undefined): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** 갤러리가 정산에 손을 댔는가 (금액 입력 또는 확인 요청) */
export function isSettlementStarted(ex: LifecycleExhibition): boolean {
  return !!ex.settlementRequestedAt || (ex.saleCount ?? 0) > 0;
}

/**
 * 전시가 끝난 지 `STALE_AFTER_DAYS` 를 넘겼는가 (KST 달력 날짜 기준).
 * 종료일 당일은 0일차로 보고, 그로부터 20일이 **지난 다음날부터** true.
 */
export function isStaleAfterExhibit(ex: LifecycleExhibition, now: Date = new Date()): boolean {
  const end = asDate(ex.exhibitDate);
  if (!end) return false;
  const cutoff = new Date(startOfTodayKstAsUtc(now).getTime() - STALE_AFTER_DAYS * DAY_MS);
  return end < cutoff;
}

/**
 * 목록에서 '종료' 로 분류할 것인가.
 *
 *   정산 완료          → 종료 (원래 규칙)
 *   정산 진행 중       → 진행중 (기간과 무관하게 유지)
 *   전시 종료 20일 경과 → 종료 (방치 정리)
 */
export function isExhibitionClosed(ex: LifecycleExhibition, now: Date = new Date()): boolean {
  if (ex.settledAt) return true;
  if (isSettlementStarted(ex)) return false;
  return isStaleAfterExhibit(ex, now);
}
