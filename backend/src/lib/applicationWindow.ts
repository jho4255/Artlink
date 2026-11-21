import { Prisma } from '@prisma/client';
import { isDeadlinePassedKst } from './kstDate';

/**
 * 지원의 두 시기 — **접수 중엔 작가가, 접수가 끝나면 갤러리가** 지원서를 다룬다 (2026-11-21, CLAUDE.md 규칙 90).
 *
 * ① 접수 중(승인 · 접수 마감일 전 · 모집 마감 전 · 전시 종료 전) — 작가는 검토 대기인 지원서를 고치거나 취소한다.
 *    갤러리는 읽기만 한다(수락은 400 `DECIDE_AFTER_CLOSE`). 화면(frontend `lib/applicationWindow.ts`)이 같은 규칙으로 버튼을 그린다.
 * ② 접수가 끝나면(모집 마감 **또는** 접수 마감일 경과 — 마감을 안 눌렀다고 아무도 못 뽑으면 안 된다) 갤러리가 **수락만** 한다.
 *    **거절은 따로 하지 않는다**(사용자 결정 — "안 뽑으면 그게 거절"). 수락은 검토 대기만 — 결과가 난 지원은 바꾸지 않는다.
 *    모집 마감은 되돌릴 수 없다. 두 시기가 겹치지 않으니 결정한 뒤에 지원서가 바뀌는 일이 없다.
 * ③ 선정이 끝나면 남은 검토 대기는 **알림 없이** 미선정(`closeOutPendingApplications`) — 되돌릴 수 없다.
 *    새 공고는 **선정 마감일**이 지날 때(lib/selectionDeadline.ts), 그 전에 올라간 공고(날짜 없음)는 [선정 마치기] 때.
 *    어느 쪽이든 [전시 확정]·[전시 종료]를 하면 그때 끝난다.
 *
 * ⚠️ 마감과 지원·수정·취소가 **동시에** 오면: 마감은 공모 행을 잠근 채(`UPDATE … WHERE recruitmentClosed = false`) 끝나고,
 *    지원·수정·취소는 같은 행을 `FOR SHARE` 로 잡고 '아직 열려 있나'를 다시 본다(`lockOpenExhibition`).
 *    먼저 잡은 쪽이 끝날 때까지 다른 쪽이 기다리므로, 마감된 공모의 지원서가 바뀌거나 새로 생기지 않는다.
 */
export const PENDING_STATUSES = ['SUBMITTED', 'REVIEWED'] as const;
export const isPendingStatus = (s: string | null | undefined) => s === 'SUBMITTED' || s === 'REVIEWED';

export const CLOSED_MESSAGE = '모집이 마감되어 지원서를 고치거나 취소할 수 없어요.';
export const DECIDED_MESSAGE = '이미 결과가 나온 지원은 고치거나 취소할 수 없어요.';
/** 접수 중엔 수락하지 않는다 — 화면(frontend `lib/applicationWindow.ts`)이 같은 말을 쓴다 */
export const DECIDE_AFTER_CLOSE = '접수가 끝난 뒤에 수락할 수 있어요.';
/** 선정 마감일이 지났다 — 남은 검토 대기는 미선정이 됐거나 곧 된다 */
export const SELECTION_OVER = '선정 마감일이 지나 더 수락할 수 없어요.';
/** 선정을 마쳐 미선정이 된 지원 */
export const SELECTION_FINISHED = '선정이 끝나 수락할 수 없어요.';
export const ALREADY_DECIDED = '이미 결과가 나온 지원이에요.';
/** 거절 버튼은 없다 — 옛 화면이 보내 와도 막는다 */
export const NO_REJECT = '거절은 따로 하지 않아요. 수락하지 않은 지원자는 선정이 끝나면 미선정이 돼요.';
export const FINISH_AFTER_CLOSE = '접수가 끝난 뒤에 선정을 마칠 수 있어요.';
export const FINISH_HAS_DEADLINE = '선정 마감일이 있는 공고는 그날이 지나면 선정이 끝나요.';

type WindowExhibition = { status: string; recruitmentClosed: boolean; ended: boolean; deadline: Date | string };
type SelectionExhibition = { recruitmentClosed: boolean; deadline: Date | string; selectionDeadline?: Date | string | null };

/** 접수가 끝났나 — 모집 마감을 눌렀거나 접수 마감일이 지났다(KST). 이때부터 갤러리가 수락한다 */
export function selectionStarted(ex: SelectionExhibition, now: Date = new Date()): boolean {
  return ex.recruitmentClosed || isDeadlinePassedKst(new Date(ex.deadline), now);
}

/** 선정 마감일이 지났나(KST, 당일 포함) — 날짜가 없는 옛 공고는 false */
export function selectionDeadlinePassed(ex: SelectionExhibition, now: Date = new Date()): boolean {
  return !!ex.selectionDeadline && isDeadlinePassedKst(new Date(ex.selectionDeadline), now);
}

/** 이 지원을 작가가 지금 고치거나 취소할 수 있나 — 못 하면 화면에 그대로 보일 이유 */
export function applicationChangeBlock(app: { status: string }, ex: WindowExhibition): string | null {
  if (!isPendingStatus(app.status)) return DECIDED_MESSAGE;
  if (ex.status !== 'APPROVED' || ex.recruitmentClosed || ex.ended || isDeadlinePassedKst(new Date(ex.deadline))) return CLOSED_MESSAGE;
  return null;
}

/**
 * 트랜잭션 안에서 공모 행을 `FOR SHARE` 로 잡고 '아직 지원을 받는가'(승인 · 모집 마감 전 · 전시 종료 전)를 본다.
 * 마감 요청이 먼저 행을 잡았으면 그 트랜잭션이 끝날 때까지 기다렸다가 바뀐 값으로 다시 본다(Postgres 의 행 잠금).
 */
export async function lockOpenExhibition(tx: Prisma.TransactionClient, exhibitionId: number): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: number }[]>`
    SELECT "id" FROM "Exhibition"
    WHERE "id" = ${exhibitionId} AND "status" = 'APPROVED' AND "recruitmentClosed" = false AND "ended" = false
    FOR SHARE`;
  return rows.length === 1;
}

/**
 * 선정을 마친다 — 남은 검토 대기를 미선정으로(`closedOutAt` 을 남긴다). **알림은 보내지 않는다**(2026-11-21 사용자 결정).
 * [선정 마치기] · 전시 확정·종료를 차지한 그 트랜잭션 안에서 부른다. 돌려준 수만큼 바꿨다. 수락·거절된 지원은 건드리지 않는다.
 */
export async function closeOutPendingApplications(tx: Prisma.TransactionClient, exhibitionId: number): Promise<number> {
  return tx.$executeRaw`
    UPDATE "Application" SET "status" = 'REJECTED', "closedOutAt" = NOW(), "updatedAt" = NOW()
    WHERE "exhibitionId" = ${exhibitionId} AND "status" IN ('SUBMITTED', 'REVIEWED')`;
}
