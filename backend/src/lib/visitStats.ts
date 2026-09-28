import prisma from './prisma';

/**
 * 일간 방문자 (2026-09-28, Admin [통계] 탭) — 기록과 집계를 한곳에 둔다.
 *
 * ## 세는 방법
 * - 한 줄 = **기기 × KST 날짜**. 기기 id 는 브라우저가 처음 들어올 때 만든 무작위 문자열(localStorage)이다.
 *   IP·브라우저 정보·주소는 남기지 않는다 — 방문자 수를 세는 데 필요 없다.
 * - 화면은 하루에 한 번(그리고 로그인·로그아웃으로 신원이 바뀔 때 한 번 더) `POST /api/visits` 를 보낸다.
 *   같은 줄이 이미 있으면 새로 만들지 않는다(unique(day, visitorId) + skipDuplicates — 규칙 46, 확인하고 만들지 말 것).
 * - 로그인해 있으면 그 줄에 userId 가 붙는다. 비회원으로 들어와 그날 로그인하면 **회원 1명**이다(두 번 세지 않는다).
 * - **회원** = 그날 서로 다른 userId 수(한 사람이 기기 둘로 들어와도 1명). **비회원** = userId 없는 기기 수.
 * - ⚠️ **Admin 은 회원 수에서 뺀다** — 운영자가 하루 종일 관리 화면을 열어 두면 그게 방문자 수를 부풀린다.
 *   기록은 하되(그 기기의 비회원 줄이 회원 줄로 바뀌어 비회원에서도 빠진다) 집계에서만 뺀다.
 * - JS 를 실행하지 않는 크롤러는 이 요청을 보내지 않으므로 자연히 빠진다.
 *
 * ⚠️ 날짜는 **서버가 KST 로** 정한다(CLAUDE.md 14) — 기기 시계를 믿으면 해외·틀린 시계 기기가 엉뚱한 날에 찍힌다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const VISITOR_ID_RE = /^[A-Za-z0-9-]{16,64}$/;
export const STATS_MAX_DAYS = 180;

/** KST 달력 날짜를 `@db.Date` 에 넣을 값으로 — 그 날짜의 UTC 자정 */
export function kstDay(now: Date = new Date()): Date {
  const k = new Date(now.getTime() + KST_OFFSET_MS);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
}

/** `@db.Date` 값 → 'YYYY-MM-DD' */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function recordVisit(visitorId: string, userId: number | null, now: Date = new Date()): Promise<void> {
  const day = kstDay(now);
  await prisma.dailyVisit.createMany({ data: [{ day, visitorId, userId }], skipDuplicates: true });
  // 비회원으로 먼저 찍힌 기기가 같은 날 로그인했으면 그 줄을 회원 줄로 바꾼다
  if (userId) {
    await prisma.dailyVisit.updateMany({ where: { day, visitorId, userId: null }, data: { userId } });
  }
}

export interface DailyVisitorRow { date: string; members: number; guests: number; total: number }

/**
 * 최근 `days` 일(오늘 포함)의 일간 방문자. 기록이 없는 날도 0 으로 채워 **끊기지 않는 날짜열**을 돌려준다 —
 * 빠진 날을 그대로 두면 차트의 막대 간격이 날짜와 어긋나 '어제'가 사흘 전 자리에 선다.
 */
export async function dailyVisitorStats(days: number, now: Date = new Date()): Promise<{ rows: DailyVisitorRow[]; since: string | null }> {
  const n = Math.min(STATS_MAX_DAYS, Math.max(1, Math.floor(days)));
  const today = kstDay(now);
  const from = new Date(today.getTime() - (n - 1) * 86400000);

  const grouped = await prisma.$queryRaw<{ day: Date; members: bigint; guests: bigint }[]>`
    SELECT v."day" AS day,
           COUNT(DISTINCT v."userId") FILTER (WHERE v."userId" IS NOT NULL AND u."role" <> 'ADMIN') AS members,
           COUNT(*) FILTER (WHERE v."userId" IS NULL) AS guests
    FROM "DailyVisit" v
    LEFT JOIN "User" u ON u."id" = v."userId"
    WHERE v."day" >= ${from}::date
    GROUP BY v."day"`;
  const byDay = new Map(grouped.map((g) => [dayKey(g.day), { members: Number(g.members), guests: Number(g.guests) }]));

  const rows: DailyVisitorRow[] = [];
  for (let i = 0; i < n; i++) {
    const date = dayKey(new Date(from.getTime() + i * 86400000));
    const v = byDay.get(date) ?? { members: 0, guests: 0 };
    rows.push({ date, ...v, total: v.members + v.guests });
  }

  // 집계를 언제부터 했는가 — 그 전 날짜의 0 은 '방문 0' 이 아니라 '기록 없음' 이다(화면이 구분해 보여 준다)
  const first = await prisma.dailyVisit.findFirst({ orderBy: { day: 'asc' }, select: { day: true } });
  return { rows, since: first ? dayKey(first.day) : null };
}
