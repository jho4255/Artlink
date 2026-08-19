/**
 * 정산 방치 재촉 알림 + 자동 종료 통보.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────
 * 전시가 끝나도 정산을 시작하지 않는 갤러리가 실제로 있다. 20일이 지나면 목록에서
 * 종료로 내려가는데(`exhibitionLifecycle.ts`), **아무 말 없이 사라지면** 갤러리는
 * 자기 공모가 어디 갔는지 모른다. 그래서 내려가기 전에 세 번 재촉하고, 내려간 뒤 한 번 알린다.
 *
 *   전시종료 → D+5 · D+10 · D+15 재촉 → D+20 종료 통보
 *
 * ── 어떻게 도는가 ───────────────────────────────────────────
 * 스케줄러가 없으므로 **읽기 요청에 얹어 훑는다** — 정산 무응답 자동 수락
 * (`operation.ts` 의 `autoApproveOverdue`)·알림 TTL 정리와 같은 방식이다.
 * 다만 그것들과 달리 "당사자가 화면을 열지 않아도" 나가야 하는 알림이라,
 * 트래픽이 있는 공개 목록에서도 부른다. 대신 프로세스당 `THROTTLE_MS` 간격으로만 실제로 돈다.
 *
 * ⚠️ 실패해도 원래 요청을 막지 않는다(best-effort). 알림이 늦는 것보다 목록이 죽는 게 나쁘다.
 * ⚠️ 같은 알림이 두 번 가지 않도록 `refKey` 로 막는다 — 읽기마다 도는 구조라
 *    이게 없으면 새로고침할 때마다 알림이 쌓인다.
 */
import prisma from './prisma';
import { startOfTodayKstAsUtc } from './kstDate';
import { operatorUserIds } from './exhibitionAccess';
import { STALE_AFTER_DAYS } from './exhibitionLifecycle';

const DAY_MS = 24 * 60 * 60 * 1000;
/** 재촉을 보낼 시점 (전시 종료 후 며칠째) */
export const REMIND_DAYS = [5, 10, 15];
const THROTTLE_MS = 5 * 60 * 1000;

let lastRunAt = 0;

/** 전시 종료 후 며칠 지났는지 (KST 달력 날짜 기준) */
export function daysSinceExhibit(exhibitDate: Date, now: Date = new Date()): number {
  const today = startOfTodayKstAsUtc(now).getTime();
  const end = startOfTodayKstAsUtc(exhibitDate).getTime();
  return Math.round((today - end) / DAY_MS);
}

/**
 * 오늘 보내야 할 알림 종류를 고른다.
 *  · 정확히 5·10·15일째 → 재촉
 *  · 20일째 이상        → 종료 통보 (하루 놓쳐도 나가도록 '이상'으로 잡는다. refKey 가 중복을 막는다)
 */
export function reminderFor(days: number): { kind: 'remind' | 'closed'; left: number } | null {
  if (days >= STALE_AFTER_DAYS) return { kind: 'closed', left: 0 };
  if (REMIND_DAYS.includes(days)) return { kind: 'remind', left: STALE_AFTER_DAYS - days };
  return null;
}

export async function sweepSettlementReminders(now: Date = new Date()): Promise<number> {
  if (now.getTime() - lastRunAt < THROTTLE_MS) return 0;
  lastRunAt = now.getTime();

  try {
    // 전시가 끝난 지 5일 이상 · 아직 정산이 안 끝난 승인 공모만 본다
    const from = new Date(startOfTodayKstAsUtc(now).getTime() - (STALE_AFTER_DAYS + 60) * DAY_MS);
    const to = new Date(startOfTodayKstAsUtc(now).getTime() - (REMIND_DAYS[0]! - 1) * DAY_MS);
    const candidates = await prisma.exhibition.findMany({
      where: {
        status: 'APPROVED',
        settledAt: null,
        settlementRequestedAt: null,   // 정산을 시작했으면 재촉할 이유가 없다
        exhibitDate: { gte: from, lt: to },
      },
      select: {
        id: true, title: true, exhibitDate: true, hostType: true,
        gallery: { select: { ownerId: true } },
        managers: { select: { gallery: { select: { ownerId: true } } } },
        _count: { select: { sales: true } },
      },
    });

    let sent = 0;
    for (const ex of candidates) {
      if (ex._count.sales > 0) continue;   // 금액을 입력했으면 이미 시작한 것
      const days = daysSinceExhibit(ex.exhibitDate, now);
      const plan = reminderFor(days);
      if (!plan) continue;

      // 같은 공모의 같은 단계 알림은 한 번만
      const refKey = plan.kind === 'closed'
        ? `settlement-closed:${ex.id}`
        : `settlement-remind:${ex.id}:${days}`;
      const already = await prisma.notification.findFirst({ where: { refKey }, select: { id: true } });
      if (already) continue;

      const message = plan.kind === 'closed'
        ? `"${ex.title}" 전시가 종료된 지 ${STALE_AFTER_DAYS}일이 지나 종료된 공모로 정리되었습니다. 정산은 [종료된 공모] 탭에서 이어서 하실 수 있습니다.`
        : `"${ex.title}" 전시가 끝났습니다. 판매·정산 내역을 입력해주세요. ${plan.left}일 뒤에는 종료된 공모로 정리됩니다.`;

      const targets = operatorUserIds(ex as any);
      if (targets.length === 0) continue;
      await prisma.notification.createMany({
        data: targets.map((userId) => ({
          userId,
          type: plan.kind === 'closed' ? 'SETTLEMENT_AUTO_CLOSED' : 'SETTLEMENT_REMINDER',
          message,
          linkUrl: `/exhibitions/${ex.id}/operation/new`,
          refKey,
        })),
      });
      sent += targets.length;
    }
    return sent;
  } catch {
    return 0;   // 알림 실패가 목록 조회를 막으면 안 된다
  }
}

/** 테스트에서 스로틀을 풀기 위한 훅 */
export function resetReminderThrottle() {
  lastRunAt = 0;
}
