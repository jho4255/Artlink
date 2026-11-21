import prisma from './prisma';
import { kstDay, dayKey, dailyVisitorStats, STATS_MAX_DAYS } from './visitStats';
import { todoCounts, exhibitionCounts, stalledExhibitions, STALL_RULES } from './adminConsole';

/**
 * 관리자 [통계] 탭의 숫자(2026-11-21 개편) — 탭마다 하나: 요약 · 회원 · 공모·지원 · 갤러리·전시 · 기능 사용.
 * ([방문] 탭은 원래 있던 `dailyVisitorStats` · `guestStats` 를 그대로 쓴다.)
 *
 * 원칙
 * - **이미 쌓인 데이터만 센다**(새로 기록하는 건 승인 결정 시각 · 첨부 받은 수 둘뿐 — 규칙 89).
 * - 기간은 KST 달력 날짜 `days` 일(오늘 포함), 견줌은 **바로 앞의 같은 길이**.
 * - 전부 count · groupBy · 작은 select 로 — 행을 통째로 끌어오지 않는다(규칙 64 의 메모리 사고).
 * - 같은 기간은 1분 저장(테스트에선 끈다).
 * - 관리자 계정은 회원 수에서 뺀다(일간 방문자와 같은 규칙).
 */

const DAY = 86400000;
const KST = 9 * 3600000;
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (process.env.NODE_ENV === 'test') return fn();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function clampDays(raw: unknown, fallback = 30): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(STATS_MAX_DAYS, n);
}

/** KST 날짜(UTC 자정으로 든 값) → 그 날짜가 시작하는 순간 */
const startOf = (day: Date) => new Date(day.getTime() - KST);

/** 이번 기간 · 바로 앞 기간 — 날짜(@db.Date 비교용)와 순간(createdAt 비교용) 둘 다 */
export function periodOf(days: number, now: Date = new Date()) {
  const today = kstDay(now);
  const fromDay = new Date(today.getTime() - (days - 1) * DAY);
  const prevFromDay = new Date(fromDay.getTime() - days * DAY);
  return {
    days, today, fromDay, prevFromDay,
    from: startOf(fromDay), prevFrom: startOf(prevFromDay), to: now,
    label: { from: dayKey(fromDay), to: dayKey(today), prevFrom: dayKey(prevFromDay), prevTo: dayKey(new Date(fromDay.getTime() - DAY)) },
  };
}

/** 최근 n 주의 월요일(KST 날짜), 오래된 것부터 — 마지막이 이번 주 */
export function weekStarts(n: number, now: Date = new Date()): Date[] {
  const today = kstDay(now);
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * DAY);
  return Array.from({ length: n }, (_, i) => new Date(monday.getTime() - (n - 1 - i) * 7 * DAY));
}

/** 이 순간이 몇 번째 주 칸에 드는가(없으면 -1) */
function weekIndex(t: Date, starts: Date[]): number {
  const day = kstDay(t).getTime();
  for (let i = starts.length - 1; i >= 0; i--) if (day >= starts[i].getTime()) return day < starts[i].getTime() + 7 * DAY ? i : -1;
  return -1;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const notAdmin = { role: { not: 'ADMIN' } } as const;
const between = (from: Date, to: Date) => ({ gte: from, lt: to });

// ───────────────────────────────── 요약 ─────────────────────────────────

/** 공모 성과 표의 한 줄 재료 — 단계 이름은 화면이 정한다(flowLabels) */
async function callRows(where: any, take: number | undefined, p: ReturnType<typeof periodOf>) {
  const list = await prisma.exhibition.findMany({
    where: { status: 'APPROVED', ...where },
    select: {
      id: true, title: true, type: true, region: true, imageUrl: true, hostType: true, recruitOnly: true, recruitmentClosed: true, confirmed: true, ended: true,
      settledAt: true, settlementRequestedAt: true, deadline: true, deadlineStart: true, exhibitStartDate: true, exhibitDate: true, submissionDeadline: true,
      capacity: true, capacityMask: true, viewCount: true, createdAt: true,
      gallery: { select: { id: true, name: true } },
      managers: { select: { gallery: { select: { name: true } } } },
      attachments: true,
    },
    orderBy: [{ viewCount: 'desc' }, { id: 'desc' }],
    ...(take ? { take } : {}),
  });
  const ids = list.map((e) => e.id);
  const [counts, periodHits, periodApps] = await Promise.all([
    exhibitionCounts(ids),
    prisma.exhibitionAttachmentHit.groupBy({ by: ['exhibitionId'], where: { exhibitionId: { in: ids }, day: { gte: p.fromDay } }, _sum: { count: true } }),
    prisma.application.groupBy({ by: ['exhibitionId'], where: { exhibitionId: { in: ids }, createdAt: { gte: p.from } }, _count: { _all: true } }),
  ]);
  const ph = new Map(periodHits.map((h) => [h.exhibitionId, h._sum.count ?? 0]));
  const pa = new Map(periodApps.map((a) => [a.exhibitionId, a._count._all]));
  return list.map((e) => {
    const c = counts.get(e.id)!;
    const hasAttachments = Array.isArray(e.attachments) && (e.attachments as unknown[]).length > 0;
    return {
      ...e,
      attachments: undefined,
      hasAttachments,
      managerNames: e.managers.map((m) => m.gallery.name),
      managers: undefined,
      apps: c.apps.total, accepted: c.apps.accepted, pending: c.apps.submitted,
      favorites: c.favorites,
      attachmentDownloads: c.attachmentDownloads,
      periodAttachmentDownloads: ph.get(e.id) ?? 0,
      periodApps: pa.get(e.id) ?? 0,
      sales: c.sales,
      approvals: c.approvals,
      submissions: c.submissions,
    };
  });
}

/** 운영 속도 — 걸린 시간의 중간값(시간) · 건수 · 가장 오래 걸린 것 */
async function speeds(p: ReturnType<typeof periodOf>) {
  const inP = between(p.from, p.to);
  const [gal, ex, sh, reqs, inq, apps, reports, openInq] = await Promise.all([
    prisma.gallery.findMany({ where: { reviewedAt: inP }, select: { createdAt: true, reviewedAt: true } }),
    prisma.exhibition.findMany({ where: { reviewedAt: inP }, select: { createdAt: true, reviewedAt: true } }),
    prisma.show.findMany({ where: { reviewedAt: inP }, select: { createdAt: true, reviewedAt: true } }),
    prisma.approvalRequest.findMany({ where: { decidedAt: inP }, select: { createdAt: true, decidedAt: true } }),
    prisma.inquiry.findMany({ where: { repliedAt: inP }, select: { createdAt: true, repliedAt: true } }),
    // 지원 → 결과: 결정된 지원의 마지막 변경 시각(결정 뒤엔 고치지 않는다). 초대 코드로 들어온 참여(즉시 수락)는 뺀다
    prisma.application.findMany({
      where: { status: { in: ['ACCEPTED', 'REJECTED'] }, updatedAt: inP, OR: [{ joinedVia: null }, { joinedVia: { not: 'CODE' } }] },
      select: { createdAt: true, updatedAt: true },
    }),
    prisma.chatReport.findMany({ where: { reviewedAt: inP }, select: { createdAt: true, reviewedAt: true } }),
    prisma.inquiry.count({ where: { status: 'OPEN' } }),
  ]);
  const hours = (a: Date, b: Date | null) => (b ? Math.max(0, (b.getTime() - a.getTime()) / 3600000) : null);
  const pack = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return { count: v.length, medianHours: median(v), maxHours: v.length ? Math.max(...v) : null };
  };
  return {
    approvals: pack([...gal, ...ex, ...sh].map((r) => hours(r.createdAt, r.reviewedAt)).concat(reqs.map((r) => hours(r.createdAt, r.decidedAt)))),
    inquiries: { ...pack(inq.map((r) => hours(r.createdAt, r.repliedAt))), open: openInq },
    applications: pack(apps.map((r) => hours(r.createdAt, r.updatedAt))),
    reports: pack(reports.map((r) => hours(r.createdAt, r.reviewedAt))),
  };
}

export async function statsSummary(days: number, now: Date = new Date()) {
  return cached(`summary:${days}`, async () => {
    const p = periodOf(days, now);
    const cur = between(p.from, p.to);
    const prev = between(p.prevFrom, p.from);
    const weeks = weekStarts(8, now);

    const [todo, visitors, signups, prevSignups, providers, appsByStatus, prevApps, openNow, newCalls, returning, members, weekUsers, calls, speed, stalled] = await Promise.all([
      todoCounts(now),
      dailyVisitorStats(days * 2, now),
      prisma.user.groupBy({ by: ['role'], where: { ...notAdmin, createdAt: cur }, _count: { _all: true } }),
      prisma.user.count({ where: { ...notAdmin, createdAt: prev } }),
      prisma.user.groupBy({ by: ['provider'], where: { ...notAdmin, createdAt: cur }, _count: { _all: true } }),
      prisma.application.groupBy({ by: ['status'], where: { createdAt: cur }, _count: { _all: true } }),
      prisma.application.count({ where: { createdAt: prev } }),
      prisma.exhibition.groupBy({
        by: ['hostType'],
        where: { status: 'APPROVED', recruitmentClosed: false, deadline: { gte: p.today }, OR: [{ deadlineStart: null }, { deadlineStart: { lte: p.today } }] },
        _count: { _all: true },
      }),
      prisma.exhibition.count({ where: { status: 'APPROVED', createdAt: cur } }),
      prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM (
          SELECT v."userId" FROM "DailyVisit" v JOIN "User" u ON u."id" = v."userId"
          WHERE v."day" >= ${p.fromDay}::date AND u."role" <> 'ADMIN'
          GROUP BY v."userId" HAVING COUNT(DISTINCT v."day") >= 2) t`,
      prisma.user.count({ where: { ...notAdmin, deletedAt: null } }),
      prisma.user.findMany({ where: { ...notAdmin, createdAt: { gte: startOf(weeks[0]) } }, select: { createdAt: true, role: true } }),
      callRows({}, 8, p),
      speeds(p),
      stalledExhibitions(now),
    ]);

    const half = visitors.rows.length / 2;
    const curRows = visitors.rows.slice(half);
    const prevRows = visitors.rows.slice(0, half);
    const since = visitors.since;
    const avg = (rows: typeof curRows) => {
      const counted = rows.filter((r) => !since || r.date >= since);
      if (!counted.length) return null;
      return {
        total: counted.reduce((n, r) => n + r.total, 0) / counted.length,
        members: counted.reduce((n, r) => n + r.members, 0) / counted.length,
        guests: counted.reduce((n, r) => n + r.guests, 0) / counted.length,
        days: counted.length,
      };
    };

    const signupBy = Object.fromEntries(signups.map((s) => [s.role, s._count._all]));
    const signupTotal = signups.reduce((n, s) => n + s._count._all, 0);
    const appBy = Object.fromEntries(appsByStatus.map((s) => [s.status, s._count._all]));
    const appTotal = appsByStatus.reduce((n, s) => n + s._count._all, 0);
    const openBy = Object.fromEntries(openNow.map((o) => [o.hostType, o._count._all]));

    const weekly = weeks.map((w) => ({ week: dayKey(w), ARTIST: 0, GALLERY: 0, VISITOR: 0 }));
    for (const u of weekUsers) {
      const i = weekIndex(u.createdAt, weeks);
      if (i >= 0 && (u.role === 'ARTIST' || u.role === 'GALLERY' || u.role === 'VISITOR')) weekly[i][u.role] += 1;
    }

    return {
      period: p.label,
      todo,
      stalled: stalled.slice(0, 8),
      kpis: {
        visitors: { current: avg(curRows), previous: avg(prevRows) },
        signups: { current: signupTotal, previous: prevSignups, byRole: signupBy, byProvider: Object.fromEntries(providers.map((x) => [x.provider ?? 'LOCAL', x._count._all])) },
        applications: {
          current: appTotal, previous: prevApps,
          accepted: appBy.ACCEPTED ?? 0, rejected: appBy.REJECTED ?? 0, pending: (appBy.SUBMITTED ?? 0) + (appBy.REVIEWED ?? 0),
        },
        openCalls: { now: (openBy.ADMIN ?? 0) + (openBy.GALLERY ?? 0), admin: openBy.ADMIN ?? 0, gallery: openBy.GALLERY ?? 0, newInPeriod: newCalls },
        returning: { current: Number(returning[0]?.n ?? 0), members },
      },
      visitorsSince: since,
      weeklySignups: weekly,
      calls,
      speed,
    };
  });
}

// ───────────────────────────────── 회원 ─────────────────────────────────

export async function statsMembers(days: number, now: Date = new Date()) {
  return cached(`members:${days}`, async () => {
    const p = periodOf(days, now);
    const weeks = weekStarts(12, now);
    const first = startOf(weeks[0]);
    const [users, roleTotals, deleted, deletedPeriod, visits, since] = await Promise.all([
      prisma.user.findMany({ where: { ...notAdmin, createdAt: { gte: first } }, select: { id: true, createdAt: true, role: true, provider: true } }),
      prisma.user.groupBy({ by: ['role'], where: { deletedAt: null }, _count: { _all: true } }),
      prisma.user.count({ where: { deletedAt: { not: null } } }),
      prisma.user.count({ where: { deletedAt: between(p.from, p.to) } }),
      prisma.$queryRaw<{ userId: number; day: Date }[]>`
        SELECT DISTINCT v."userId" AS "userId", v."day" AS day FROM "DailyVisit" v JOIN "User" u ON u."id" = v."userId"
        WHERE v."day" >= ${weeks[0]}::date AND u."role" <> 'ADMIN'`,
      prisma.dailyVisit.findFirst({ orderBy: { day: 'asc' }, select: { day: true } }),
    ]);

    const weekly = weeks.map((w) => ({ week: dayKey(w), ARTIST: 0, GALLERY: 0, VISITOR: 0, KAKAO: 0, EMAIL: 0, active: 0 }));
    for (const u of users) {
      const i = weekIndex(u.createdAt, weeks);
      if (i < 0) continue;
      if (u.role === 'ARTIST' || u.role === 'GALLERY' || u.role === 'VISITOR') weekly[i][u.role] += 1;
      if (u.provider === 'KAKAO') weekly[i].KAKAO += 1; else weekly[i].EMAIL += 1;
    }
    // 주간 활성 회원 — 그 주에 하루라도 들어온 회원(관리자 제외)
    const activeSets = weeks.map(() => new Set<number>());
    const visitDays = new Map<number, number[]>();
    for (const v of visits) {
      const t = new Date(v.day).getTime();
      for (let i = weeks.length - 1; i >= 0; i--) {
        if (t >= weeks[i].getTime()) { if (t < weeks[i].getTime() + 7 * DAY) activeSets[i].add(v.userId); break; }
      }
      if (!visitDays.has(v.userId)) visitDays.set(v.userId, []);
      visitDays.get(v.userId)!.push(t);
    }
    activeSets.forEach((s, i) => { weekly[i].active = s.size; });

    // 가입 주차별 재방문 — 가입 7~13일 뒤(다음 주) · 28~34일 뒤(4주 뒤)에 하루라도 들어왔나.
    // 기록 시작(9-28) 전 가입 주차와 아직 그 기간이 안 지난 주차는 비운다(null) — 0% 로 읽히면 거짓말이다
    const sinceDay = since ? since.day.getTime() : null;
    const today = kstDay(now).getTime();
    const cohorts = weeks.slice(0, -1).map((w) => {
      const ws = w.getTime();
      const members = users.filter((u) => { const d = kstDay(u.createdAt).getTime(); return d >= ws && d < ws + 7 * DAY; });
      const back = (fromOff: number, toOff: number) => {
        if (sinceDay == null || ws < sinceDay) return null;
        if (today < ws + 6 * DAY + toOff * DAY) return null;   // 이 주의 마지막 가입자까지 그 기간이 다 지나야 센다
        if (!members.length) return null;
        const hit = members.filter((u) => {
          const d = kstDay(u.createdAt).getTime();
          return (visitDays.get(u.id) ?? []).some((t) => t >= d + fromOff * DAY && t <= d + toOff * DAY);
        }).length;
        return hit / members.length;
      };
      return { week: dayKey(w), size: members.length, week1: back(7, 13), week4: back(28, 34) };
    });

    return {
      period: p.label,
      weekly,
      cohorts,
      roleTotals: Object.fromEntries(roleTotals.map((r) => [r.role, r._count._all])),
      withdrawn: { total: deleted, inPeriod: deletedPeriod },
      visitsSince: since ? dayKey(since.day) : null,
    };
  });
}

// ─────────────────────────────── 공모·지원 ───────────────────────────────

export async function statsCalls(days: number, now: Date = new Date()) {
  return cached(`calls:${days}`, async () => {
    const p = periodOf(days, now);
    const weeks = weekStarts(12, now);
    const [apps, perUser, applicantsInPeriod, closedCalls, regionCalls, galleriesByRegion, rows] = await Promise.all([
      prisma.application.findMany({ where: { createdAt: { gte: startOf(weeks[0]) } }, select: { createdAt: true, status: true } }),
      prisma.application.groupBy({ by: ['userId'], _count: { _all: true } }),
      prisma.application.groupBy({ by: ['userId'], where: { createdAt: between(p.from, p.to) }, _count: { _all: true } }),
      // 정원 충족 — 모집이 끝난(마감했거나 마감일이 지난) 숫자 정원 공모
      prisma.exhibition.findMany({
        where: { status: 'APPROVED', capacityMask: null, OR: [{ recruitmentClosed: true }, { deadline: { lt: p.today } }], createdAt: { gte: startOf(new Date(p.today.getTime() - 180 * DAY)) } },
        select: { id: true, capacity: true, _count: { select: { applications: { where: { status: 'ACCEPTED' } } } } },
      }),
      prisma.exhibition.groupBy({ by: ['region', 'type'], where: { status: 'APPROVED', createdAt: between(p.from, p.to) }, _count: { _all: true }, _sum: { viewCount: true } }),
      prisma.gallery.groupBy({ by: ['region'], where: { status: 'APPROVED' }, _count: { _all: true } }),
      callRows({ OR: [{ createdAt: { gte: p.from } }, { recruitmentClosed: false, deadline: { gte: p.today } }] }, undefined, p),
    ]);

    const weekly = weeks.map((w) => ({ week: dayKey(w), total: 0, accepted: 0, rejected: 0, pending: 0 }));
    for (const a of apps) {
      const i = weekIndex(a.createdAt, weeks);
      if (i < 0) continue;
      weekly[i].total += 1;
      if (a.status === 'ACCEPTED') weekly[i].accepted += 1;
      else if (a.status === 'REJECTED') weekly[i].rejected += 1;
      else weekly[i].pending += 1;
    }
    const applicantsEver = perUser.length;
    const repeat = perUser.filter((u) => u._count._all >= 2).length;
    const periodApplicants = applicantsInPeriod.length;
    const periodApps = applicantsInPeriod.reduce((n, u) => n + u._count._all, 0);
    const fills = closedCalls.filter((c) => c.capacity > 0).map((c) => Math.min(1, c._count.applications / c.capacity));

    // 지역 — 이 기간에 올라온 공모 수·조회(누적)와, 그 지역 공모에 이 기간 들어온 지원
    const regionApps = await prisma.$queryRaw<{ region: string; n: bigint }[]>`
      SELECT e."region" AS region, COUNT(*) AS n FROM "Application" a JOIN "Exhibition" e ON e."id" = a."exhibitionId"
      WHERE a."createdAt" >= ${p.from} GROUP BY e."region"`;
    const regions = new Map<string, { region: string; calls: number; views: number; applications: number; galleries: number }>();
    const reg = (r: string) => {
      if (!regions.has(r)) regions.set(r, { region: r, calls: 0, views: 0, applications: 0, galleries: 0 });
      return regions.get(r)!;
    };
    const types = new Map<string, { type: string; calls: number; views: number }>();
    for (const g of regionCalls) {
      const r = reg(g.region);
      r.calls += g._count._all;
      r.views += g._sum.viewCount ?? 0;
      const t = types.get(g.type) ?? { type: g.type, calls: 0, views: 0 };
      t.calls += g._count._all; t.views += g._sum.viewCount ?? 0;
      types.set(g.type, t);
    }
    for (const a of regionApps) reg(a.region).applications = Number(a.n);
    for (const g of galleriesByRegion) reg(g.region).galleries = g._count._all;

    return {
      period: p.label,
      weekly,
      applicants: {
        inPeriod: periodApplicants,
        perApplicant: periodApplicants ? periodApps / periodApplicants : null,
        ever: applicantsEver,
        repeatRate: applicantsEver ? repeat / applicantsEver : null,
      },
      capacityFill: { calls: fills.length, average: fills.length ? fills.reduce((a, b) => a + b, 0) / fills.length : null, full: fills.filter((f) => f >= 1).length },
      regions: [...regions.values()].sort((a, b) => b.calls - a.calls || b.applications - a.applications),
      types: [...types.values()].sort((a, b) => b.calls - a.calls),
      rows,
    };
  });
}

// ─────────────────────────────── 갤러리·전시 ───────────────────────────────

export async function statsGalleries(days: number, now: Date = new Date()) {
  return cached(`galleries:${days}`, async () => {
    const p = periodOf(days, now);
    const inP = between(p.from, p.to);
    const [accounts, byStatus, newGalleries, withCall, withShow, activeOwners, postedOwners, showsByStatus, showsNow, topShows, settled, salesAll, salesPeriod] = await Promise.all([
      prisma.user.count({ where: { role: 'GALLERY', deletedAt: null } }),
      prisma.gallery.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.gallery.count({ where: { createdAt: inP } }),
      prisma.gallery.count({ where: { status: 'APPROVED', exhibitions: { some: {} } } }),
      prisma.gallery.count({ where: { status: 'APPROVED', shows: { some: {} } } }),
      // 이 기간에 들어온 갤러리 회원
      prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(DISTINCT v."userId") AS n FROM "DailyVisit" v JOIN "User" u ON u."id" = v."userId"
        WHERE v."day" >= ${p.fromDay}::date AND u."role" = 'GALLERY'`,
      // 이 기간에 공모나 전시를 올린 갤러리
      prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(DISTINCT g) AS n FROM (
          SELECT "galleryId" AS g FROM "Exhibition" WHERE "createdAt" >= ${p.from} AND "galleryId" IS NOT NULL
          UNION SELECT "galleryId" AS g FROM "Show" WHERE "createdAt" >= ${p.from}) t`,
      prisma.show.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.show.count({ where: { status: 'APPROVED', startDate: { lte: p.today }, endDate: { gte: p.today } } }),
      prisma.show.findMany({
        where: { status: 'APPROVED' },
        select: { id: true, title: true, viewCount: true, startDate: true, endDate: true, posterImage: true, gallery: { select: { name: true } } },
        orderBy: [{ viewCount: 'desc' }, { id: 'desc' }],
        take: 6,
      }),
      prisma.exhibition.count({ where: { settledAt: inP } }),
      prisma.artworkSale.aggregate({ where: { exhibition: { settledAt: { not: null } } }, _count: { _all: true }, _sum: { soldPrice: true } }),
      prisma.artworkSale.aggregate({ where: { exhibition: { settledAt: inP } }, _count: { _all: true }, _sum: { soldPrice: true } }),
    ]);
    // 갤러리 몫(카드 수수료 빼기 전) — 정산 완료 공모의 판매가 × 작가별 갤러리 비율
    const share = await prisma.$queryRaw<{ total: bigint | null; period: bigint | null }[]>`
      SELECT SUM(s."soldPrice" * st."galleryRatio" / 100) AS total,
             SUM(CASE WHEN e."settledAt" >= ${p.from} THEN s."soldPrice" * st."galleryRatio" / 100 ELSE 0 END) AS period
      FROM "ArtworkSale" s
      JOIN "Exhibition" e ON e."id" = s."exhibitionId" AND e."settledAt" IS NOT NULL
      LEFT JOIN "ArtistSettlement" st ON st."exhibitionId" = s."exhibitionId" AND st."artistUserId" = s."artistUserId"`;
    const status = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]));
    return {
      period: p.label,
      galleries: {
        accounts,
        registered: byStatus.reduce((n, s) => n + s._count._all, 0),
        approved: status.APPROVED ?? 0,
        pending: status.PENDING ?? 0,
        rejected: status.REJECTED ?? 0,
        newInPeriod: newGalleries,
        withCall,
        withShow,
        activeOwners: Number(activeOwners[0]?.n ?? 0),
        posted: Number(postedOwners[0]?.n ?? 0),
      },
      shows: {
        byStatus: Object.fromEntries(showsByStatus.map((s) => [s.status, s._count._all])),
        now: showsNow,
        top: topShows,
      },
      trade: {
        settledInPeriod: settled,
        all: { sales: salesAll._count._all, amount: salesAll._sum.soldPrice ?? 0, galleryShare: Number(share[0]?.total ?? 0) },
        period: { sales: salesPeriod._count._all, amount: salesPeriod._sum.soldPrice ?? 0, galleryShare: Number(share[0]?.period ?? 0) },
      },
    };
  });
}

// ─────────────────────────────── 기능 사용 ───────────────────────────────

export async function statsUsage(days: number, now: Date = new Date()) {
  return cached(`usage:${days}`, async () => {
    const p = periodOf(days, now);
    const pair = async (fn: (range: { gte: Date; lt: Date }) => Promise<number>) => {
      const [current, previous] = await Promise.all([fn(between(p.from, p.to)), fn(between(p.prevFrom, p.from))]);
      return { current, previous };
    };
    const [stories, storyLikes, storyComments, posts, postComments, postLikes, directChats, messages, homepageInquiries, artworkLikes, follows, favorites, reviews, guestbook, pdf, notes, push] = await Promise.all([
      pair((r) => prisma.story.count({ where: { createdAt: r } })),
      pair((r) => prisma.storyLike.count({ where: { createdAt: r } })),
      pair((r) => prisma.storyComment.count({ where: { createdAt: r } })),
      pair((r) => prisma.post.count({ where: { createdAt: r } })),
      pair((r) => prisma.postComment.count({ where: { createdAt: r } })),
      pair((r) => prisma.postLike.count({ where: { createdAt: r } })),
      pair((r) => prisma.chat.count({ where: { kind: 'DIRECT', createdAt: r, messages: { some: {} } } })),
      pair((r) => prisma.chatMessage.count({ where: { createdAt: r } })),
      pair((r) => prisma.homepageInquiry.count({ where: { createdAt: r } })),
      pair((r) => prisma.portfolioImageLike.count({ where: { createdAt: r } })),
      pair((r) => prisma.follow.count({ where: { createdAt: r } })),
      pair((r) => prisma.favorite.count({ where: { createdAt: r } })),
      pair((r) => prisma.review.count({ where: { createdAt: r } })),
      pair((r) => prisma.guestbookEntry.count({ where: { createdAt: r } })),
      pair((r) => prisma.portfolioExport.count({ where: { createdAt: r } })),
      prisma.notification.groupBy({ by: ['type', 'read'], where: { createdAt: between(p.from, p.to) }, _count: { _all: true } }),
      prisma.pushToken.count(),
    ]);
    const byType = new Map<string, { type: string; sent: number; read: number }>();
    for (const n of notes) {
      const row = byType.get(n.type) ?? { type: n.type, sent: 0, read: 0 };
      row.sent += n._count._all;
      if (n.read) row.read += n._count._all;
      byType.set(n.type, row);
    }
    return {
      period: p.label,
      features: { stories, storyLikes, storyComments, posts, postComments, postLikes, directChats, messages, homepageInquiries, artworkLikes, follows, favorites, reviews, guestbook, pdf },
      notifications: [...byType.values()].sort((a, b) => b.sent - a.sent),
      pushDevices: push,
    };
  });
}

export const STATS_STALL_RULES = STALL_RULES;
