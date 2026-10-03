import prisma from './prisma';
import { LOCK_NS, withKeyLock } from './keyLock';
import { dayKey, kstDay, STATS_MAX_DAYS } from './visitStats';

/**
 * 포트폴리오 PDF 저장 기록 (2026-10-03, Admin [통계] 탭) — 기록과 집계를 한곳에 둔다.
 *
 * ## 왜 세는가
 * 포트폴리오 만들기 화면을 고치기 전에 조사해 보니 "몇 명이 PDF 를 저장했는가"를 알 길이 없었다 — 디자인을 바꾼 흔적(작품 있는 작가 47명 중 1명)과
 * 버전(0개)만 남아 있었다. 화면을 고친 효과를 보려면 저장 자체를 세야 한다.
 *
 * ## 세는 방법
 * - 한 줄 = **저장 한 번**. 화면(`frontend/src/lib/portfolioExport.ts logExport`)이 저장이 끝난 뒤에 보낸다.
 *   파일은 브라우저가 만들고 서버를 거치지 않는다 — 여기 남는 건 날짜·작가·쪽수·작품 수·방식뿐이다.
 * - 방식: `download`(바로 내려받기) · `print`(인쇄 창을 열었다 — 그 창에서 실제로 저장했는지는 알 수 없다) · `pptx`.
 * - 날짜는 **서버가 KST 로** 정한다(CLAUDE.md 14).
 * - ⚠️ 기록은 저장을 막지 않는다 — 한도를 넘으면 조용히 버린다(화면에 에러를 내지 않는다). 통계 때문에 PDF 를 못 받으면 안 된다.
 */
export const EXPORT_METHODS = ['download', 'print', 'pptx'] as const;
export type ExportMethod = (typeof EXPORT_METHODS)[number];
/** 한 작가가 하루에 남길 수 있는 줄 수 — 그 뒤로는 받되 적지 않는다(스크립트가 표를 불리지 못하게) */
export const EXPORT_DAILY_CAP = 100;

export interface ExportInput { method: ExportMethod; pages: number; works: number; uploaded: boolean }

/** 적었으면 true, 한도에 걸려 버렸으면 false */
export async function recordExport(userId: number, input: ExportInput, now: Date = new Date()): Promise<boolean> {
  const day = kstDay(now);
  // 세고 나서 쓰기를 그 사람 단위로 줄 세운다 — 안 그러면 동시에 몰린 요청이 같은 수를 보고 상한을 넘긴다(실측 104줄, lib/keyLock.ts)
  return withKeyLock(LOCK_NS.portfolioExports, userId, async (tx) => {
    const today = await tx.portfolioExport.count({ where: { userId, day } });
    if (today >= EXPORT_DAILY_CAP) return false;
    await tx.portfolioExport.create({ data: { day, userId, ...input } });
    return true;
  });
}

export interface DailyExportRow {
  date: string;
  /** 그날 저장 횟수(방식 합) */
  total: number;
  /** 그날 저장한 서로 다른 작가 수 */
  artists: number;
  download: number;
  print: number;
  pptx: number;
  /** 홈페이지에도 올린 횟수 */
  uploaded: number;
}

/**
 * 최근 `days` 일(오늘 포함)의 날짜별 저장. 기록이 없는 날도 0 으로 채운다(방문자 통계와 같은 이유 — 빠진 날을 두면 막대가 날짜와 어긋난다).
 * `since` = 집계를 시작한 날(그 전의 0 은 '저장 0' 이 아니라 '세지 않음'). `totals` = 집계 시작 이후 전체.
 */
export async function dailyExportStats(days: number, now: Date = new Date()): Promise<{
  rows: DailyExportRow[]; since: string | null; totals: { saves: number; artists: number };
}> {
  const n = Math.min(STATS_MAX_DAYS, Math.max(1, Math.floor(days)));
  const today = kstDay(now);
  const from = new Date(today.getTime() - (n - 1) * 86400000);

  const grouped = await prisma.$queryRaw<{ day: Date; total: bigint; artists: bigint; download: bigint; print: bigint; pptx: bigint; uploaded: bigint }[]>`
    SELECT e."day" AS day,
           COUNT(*) AS total,
           COUNT(DISTINCT e."userId") AS artists,
           COUNT(*) FILTER (WHERE e."method" = 'download') AS download,
           COUNT(*) FILTER (WHERE e."method" = 'print') AS print,
           COUNT(*) FILTER (WHERE e."method" = 'pptx') AS pptx,
           COUNT(*) FILTER (WHERE e."uploaded") AS uploaded
    FROM "PortfolioExport" e
    WHERE e."day" >= ${from}::date
    GROUP BY e."day"`;
  const byDay = new Map(grouped.map((g) => [dayKey(g.day), g]));

  const rows: DailyExportRow[] = [];
  for (let i = 0; i < n; i++) {
    const date = dayKey(new Date(from.getTime() + i * 86400000));
    const g = byDay.get(date);
    rows.push({
      date,
      total: Number(g?.total ?? 0), artists: Number(g?.artists ?? 0),
      download: Number(g?.download ?? 0), print: Number(g?.print ?? 0), pptx: Number(g?.pptx ?? 0),
      uploaded: Number(g?.uploaded ?? 0),
    });
  }

  const first = await prisma.portfolioExport.findFirst({ orderBy: { day: 'asc' }, select: { day: true } });
  const [saves, artists] = await Promise.all([
    prisma.portfolioExport.count(),
    prisma.portfolioExport.findMany({ where: { userId: { not: null } }, distinct: ['userId'], select: { userId: true } }).then((r) => r.length),
  ]);
  return { rows, since: first ? dayKey(first.day) : null, totals: { saves, artists } };
}
