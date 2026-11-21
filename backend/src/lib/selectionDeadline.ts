/**
 * 선정 마감일 (2026-11-21, CLAUDE.md 규칙 90) — **새로 올리는 공고부터** 받는다(이미 올라간 공고는 null 로 둔다, 사용자 결정).
 *
 *   접수 마감 → (갤러리가 수락만 한다) → 선정 마감일 → 남은 검토 대기는 미선정 · 더는 수락할 수 없다
 *
 * ① 날짜 순서 — 접수 마감 < 선정 마감 < 출품 자료 마감(KST 달력 날짜, 같은 날은 안 된다). 등록·[선정 마감일 변경]·
 *    출품 자료 마감 변경·날짜를 바꾸는 수정 요청이 전부 `assertSelectionOrder` 를 지난다.
 * ② 그날이 지나면(KST — 당일은 하루 종일 수락할 수 있다) 수락하지 않은 지원은 **알림 없이** 미선정(`closeOutExpiredSelections`).
 *    스케줄러가 없어 **읽기에 얹어 훑는다**(정산 재촉 `settlementReminder.ts` 와 같은 방식). 지원자 목록·내 지원 목록은
 *    읽기 직전에 그 공모를 바로 정리하고, 공개 목록 등은 프로세스당 1분 간격으로 전체를 훑는다.
 *    ⚠️ 훑기가 늦어도 늦게 수락되는 일은 없다 — 수락 라우트가 날짜로 막는다(`SELECTION_OVER`).
 * ③ 3일 전부터 마감일 당일까지 **매일 한 번** 공고 주인에게 알림(`SELECTION_DEADLINE`, 사용자 결정 "3일 전부터 알림").
 *    검토 대기가 남았고 접수가 끝났을 때만(아직 접수 중이면 수락할 수 없어 알릴 게 없다). 같은 날 두 번 가지 않게
 *    refKey `selection-deadline:<공모>:<선정 마감일 YYYY-MM-DD>:<D-n>` — 읽기마다 도는 구조라 이게 없으면 새로고침마다 쌓인다.
 *    날짜를 넣는 까닭: [선정 마감일 변경]으로 늦추면 새 날짜의 D-3 부터 다시 알려야 한다(날짜가 없으면 옛 날짜 때 보낸 D-3 에 막힌다).
 */
import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { AppError } from '../middleware/errorHandler';
import { startOfTodayKstAsUtc, isDeadlinePassedKst } from './kstDate';
import { exhibitionNotifyTargets } from './exhibitionAccess';
import { operationLink } from './notifyLinks';
import { selectionStarted } from './applicationWindow';

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** 며칠 전부터 알리나 — 화면(frontend `lib/applicationWindow.ts`)의 빨간 D-n 도 같은 값이다 */
export const SELECTION_REMIND_DAYS = 3;
const THROTTLE_MS = 60 * 1000;
let lastRunAt = 0;

/** KST 달력 날짜로 그날까지 며칠 남았나 — 오늘이면 0, 지났으면 음수 */
export function daysUntilKst(date: Date, now: Date = new Date()): number {
  return Math.round((startOfTodayKstAsUtc(date).getTime() - startOfTodayKstAsUtc(now).getTime()) / DAY_MS);
}

/** '2026-11-30' — 알림 열쇠(refKey)에 넣는 KST 날짜 */
export function kstYmd(date: Date): string {
  const k = new Date(date.getTime() + KST_OFFSET_MS);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`;
}

/** '11.30' — 알림 글에 쓰는 KST 월.일 */
export function kstMonthDay(date: Date): string {
  const k = new Date(date.getTime() + KST_OFFSET_MS);
  return `${k.getUTCMonth() + 1}.${k.getUTCDate()}`;
}

const kstDay = (d: Date) => startOfTodayKstAsUtc(d).getTime();

/** 받은 값을 날짜로 — 비었거나 이상하면 400 */
export function parseSelectionDeadline(raw: unknown): Date {
  if (typeof raw !== 'string' || !raw.trim()) throw new AppError('선정 마감일을 입력해 주세요.', 400);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new AppError('선정 마감일이 올바르지 않습니다.', 400);
  return d;
}

/**
 * 접수 마감 < 선정 마감 < 출품 자료 마감 (KST 달력 날짜, 같은 날 X). 출품 자료 마감이 없으면(공모만 진행 · 옛 공고) 앞쪽만 본다.
 * 화면 달력(frontend `lib/scheduleCalendar.ts` 의 gap 1)이 같은 간격으로 날짜를 막는다.
 */
export function assertSelectionOrder(selection: Date, deadline: Date, submissionDeadline: Date | null) {
  if (kstDay(selection) <= kstDay(deadline)) throw new AppError('선정 마감일은 접수 마감일보다 뒤여야 해요.', 400);
  if (submissionDeadline && kstDay(selection) >= kstDay(submissionDeadline)) {
    throw new AppError('선정 마감일은 출품 자료 제출 마감일보다 앞이어야 해요.', 400);
  }
}

/**
 * 선정 마감일이 지난 공모의 남은 검토 대기 → 미선정(`closedOutAt`). **알림 없음**. 바꾼 수를 돌려준다.
 * 거르기: `exhibitionIds`(지원자 목록 — 그 공모만) · `userId`(작가의 내 지원 목록 — 그 작가 것만) · 없으면 전체(훑기).
 * `closeOutPendingApplications`(선정 마치기·전시 확정·종료)와 같은 표시를 남긴다 — 화면은 둘을 가르지 않는다('미선정').
 */
export async function closeOutExpiredSelections(
  opts: { exhibitionIds?: number[]; userId?: number } = {},
  now: Date = new Date(),
): Promise<number> {
  if (opts.exhibitionIds && opts.exhibitionIds.length === 0) return 0;
  const cutoff = startOfTodayKstAsUtc(now);
  const byExhibition = opts.exhibitionIds ? Prisma.sql`AND e."id" IN (${Prisma.join(opts.exhibitionIds)})` : Prisma.empty;
  const byUser = opts.userId != null ? Prisma.sql`AND a."userId" = ${opts.userId}` : Prisma.empty;
  return prisma.$executeRaw`
    UPDATE "Application" a SET "status" = 'REJECTED', "closedOutAt" = NOW(), "updatedAt" = NOW()
    FROM "Exhibition" e
    WHERE a."exhibitionId" = e."id" AND a."status" IN ('SUBMITTED', 'REVIEWED')
      AND e."selectionDeadline" IS NOT NULL AND e."selectionDeadline" < ${cutoff}
      ${byExhibition} ${byUser}`;
}

/** 선정 마감 알림 글 — 오늘이면 '오늘이 지나면 미선정', 아니면 며칠 남았는지 */
export function selectionReminderMessage(title: string, selectionDeadline: Date, pending: number, now: Date = new Date()): string {
  const dday = daysUntilKst(selectionDeadline, now);
  return dday <= 0
    ? `"${title}" 선정 마감이 오늘이에요. 오늘이 지나면 검토 대기 ${pending}명은 미선정이 돼요.`
    : `"${title}" 선정 마감까지 ${dday}일 남았어요 (${kstMonthDay(selectionDeadline)}). 검토 대기 ${pending}명이 남아 있어요.`;
}

/** 오늘 보낼 선정 마감 알림을 보낸다(D-3 · D-2 · D-1 · 당일). 보낸 사람 수를 돌려준다 */
export async function sendSelectionReminders(now: Date = new Date()): Promise<number> {
  const today = startOfTodayKstAsUtc(now);
  const until = new Date(today.getTime() + (SELECTION_REMIND_DAYS + 1) * DAY_MS);
  const candidates = await prisma.exhibition.findMany({
    where: { status: 'APPROVED', ended: false, selectionDeadline: { gte: today, lt: until } },
    select: {
      id: true, title: true, deadline: true, recruitmentClosed: true, selectionDeadline: true, hostType: true,
      gallery: { select: { ownerId: true } },
      managers: { select: { gallery: { select: { ownerId: true } } } },
      _count: { select: { applications: { where: { status: { in: ['SUBMITTED', 'REVIEWED'] } } } } },
    },
  });
  let sent = 0;
  for (const ex of candidates) {
    if (!ex.selectionDeadline || isDeadlinePassedKst(ex.selectionDeadline, now)) continue;
    const pending = ex._count.applications;
    if (pending === 0) continue;                      // 다 정했으면 알릴 게 없다
    if (!selectionStarted(ex, now)) continue;          // 아직 접수 중 — 수락할 수 없으니 '선정하세요'는 틀린 말이다
    const dday = daysUntilKst(ex.selectionDeadline, now);
    const refKey = `selection-deadline:${ex.id}:${kstYmd(ex.selectionDeadline)}:${dday}`;
    const already = await prisma.notification.findFirst({ where: { refKey }, select: { id: true } });
    if (already) continue;
    // ⚠️ `exhibitionNotifyTargets` — 갤러리를 안 낀 아트링크 주최 공모는 운영자 목록이 비어 그때만 관리자 전원에게(규칙 22)
    const targets = await exhibitionNotifyTargets(ex as any);
    if (targets.length === 0) continue;
    await prisma.notification.createMany({
      data: targets.map((userId) => ({
        userId,
        type: 'SELECTION_DEADLINE',
        message: selectionReminderMessage(ex.title, ex.selectionDeadline!, pending, now),
        // 받는 사람이 운영자다 — 그 공모 화면의 [지원자] 탭으로(작가 링크로 바꾸지 말 것)
        linkUrl: operationLink(ex.id, 'applicants'),
        refKey,
      })),
    });
    sent += targets.length;
  }
  return sent;
}

/**
 * 읽기에 얹어 훑는다 — 지난 선정 마감 정리 + 오늘 알림. 프로세스당 1분에 한 번만 실제로 돈다.
 * ⚠️ 실패해도 원래 요청을 막지 않는다(best-effort) — 알림이 늦는 것보다 목록이 죽는 게 나쁘다.
 */
export async function sweepSelectionDeadlines(now: Date = new Date()): Promise<void> {
  if (now.getTime() - lastRunAt < THROTTLE_MS) return;
  lastRunAt = now.getTime();
  try {
    await closeOutExpiredSelections({}, now);
    await sendSelectionReminders(now);
  } catch { /* best-effort */ }
}

/** 테스트에서 스로틀을 풀기 위한 훅 */
export function resetSelectionSweepThrottle() {
  lastRunAt = 0;
}
