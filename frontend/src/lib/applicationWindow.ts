import { getDday, kstDayNumber } from '@/lib/utils';

/**
 * 지원의 두 시기 (2026-11-21, CLAUDE.md 규칙 90) — 서버 `backend/src/lib/applicationWindow.ts`·`selectionDeadline.ts` 의 거울.
 *  - 접수 중: 작가가 **검토 대기**인 지원서를 고치거나 취소한다(공모 승인 · 접수 마감일 전(KST, 당일 포함) · 모집 마감 전 · 전시 종료 전).
 *    갤러리는 읽기만 한다.
 *  - 접수가 끝나면(모집 마감 **또는** 접수 마감일 경과) 선정 마감일까지 갤러리가 **수락만** 한다 — 거절 버튼은 없다
 *    (사용자 결정 "안 뽑으면 그게 거절"). 선정 마감일이 지나면 수락하지 않은 지원은 알림 없이 미선정 · 되돌릴 수 없다.
 *  - 선정 마감일이 없는 옛 공고는 [선정 마치기]([⋯] 메뉴)·전시 확정·종료 때 선정이 끝난다.
 * ⚠️ 한쪽만 고치지 말 것 — 버튼이 보이는데 서버가 400 이면 함정이고, 반대면 할 수 있는 일을 숨긴다(테스트가 서버 소스와 대조한다).
 */
export const DECIDE_AFTER_CLOSE = '접수가 끝난 뒤에 수락할 수 있어요.';
/** 선정 마감 며칠 전부터 빨갛게 · 알림 — 서버 `SELECTION_REMIND_DAYS` 와 같은 값 */
export const SELECTION_REMIND_DAYS = 3;

export interface SelectionExhibition {
  recruitmentClosed?: boolean | null;
  deadline?: string | null;
  selectionDeadline?: string | null;
}

/** 접수가 끝났나 — 모집 마감을 눌렀거나 접수 마감일이 지났다(KST). 이때부터 갤러리가 수락한다 */
export function selectionStarted(ex: SelectionExhibition | null | undefined): boolean {
  if (!ex) return false;
  return !!ex.recruitmentClosed || (!!ex.deadline && getDday(ex.deadline) < 0);
}

/** 선정 마감일이 지났나(KST, 당일 포함) — 날짜가 없는 옛 공고는 false */
export function selectionDeadlinePassed(ex: SelectionExhibition | null | undefined): boolean {
  return !!ex?.selectionDeadline && getDday(ex.selectionDeadline) < 0;
}

/** 지금 수락할 수 있는 때인가 — 접수가 끝났고 선정 마감일 전 */
export function selectionOpen(ex: SelectionExhibition | null | undefined): boolean {
  return selectionStarted(ex) && !selectionDeadlinePassed(ex);
}

/** 선정 마감일 날에 마감일이 지나 미선정이 된 지원인가 — 그때만 '선정 마감일(…)까지 수락하지 않아' 라고 말한다(전시 확정 등으로 일찍 끝났으면 아니다) */
export function closedOutByDeadline(closedOutAt: string | null | undefined, selectionDeadline: string | null | undefined): boolean {
  if (!closedOutAt || !selectionDeadline) return false;
  return kstDayNumber(closedOutAt) > kstDayNumber(selectionDeadline);
}

export interface WindowApplication { status?: string | null }
export interface WindowExhibition {
  status?: string | null;
  recruitmentClosed?: boolean | null;
  ended?: boolean | null;
  deadline?: string | null;
}

export const isPendingStatus = (s: string | null | undefined) => s === 'SUBMITTED' || s === 'REVIEWED';

export function canChangeApplication(app: WindowApplication | null | undefined, ex: WindowExhibition | null | undefined): boolean {
  if (!app || !ex || !isPendingStatus(app.status)) return false;
  if ((ex.status ?? 'APPROVED') !== 'APPROVED' || ex.recruitmentClosed || ex.ended) return false;
  return !!ex.deadline && getDday(ex.deadline) >= 0;
}
