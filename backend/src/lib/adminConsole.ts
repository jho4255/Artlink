import prisma from './prisma';
import { kstDay, dayKey } from './visitStats';
import { hasSubmissionContent } from './submission';
import { isExhibitionClosed, STALE_AFTER_DAYS } from './exhibitionLifecycle';

/**
 * 관리자 화면(2026-11-21 개편)의 공통 집계 — **처리할 일 수 · 멈춘 공모 · 공모 줄 데이터 · 첨부파일 받은 수**.
 *
 * 메뉴 배지(`GET /admin/todo-counts`) · 통계 [요약] 맨 위 '지금 처리할 일' · 운영 조회의 공모 표가 같은 함수를 쓴다 —
 * 화면마다 따로 세면 배지는 3인데 통계는 2 같은 어긋남이 생긴다.
 *
 * 날짜는 전부 KST 달력 날짜(규칙 14). 마감일·전시일은 `new Date('YYYY-MM-DD')` 로 저장돼 그 날짜의 UTC 자정이라
 * `kstDay()`(오늘 KST 날짜의 UTC 자정)와 그대로 맞대 비교한다.
 */

const DAY = 86400000;

/** 이 날짜(UTC 자정으로 저장된 달력 날짜)부터 오늘(KST)까지 며칠 — 오늘이면 0, 미래면 음수 */
export function daysSinceDate(date: Date, now: Date = new Date()): number {
  const d = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((kstDay(now).getTime() - d) / DAY);
}

/** 멈춘 공모로 볼 기준 — 화면 글에도 쓴다 */
export const STALL_RULES = {
  /** 전시가 끝나고 이만큼 지났는데 정산 확인을 안 보냈다 */
  settlementDays: 7,
  /** 접수 마감이 이만큼 지났는데 검토 대기 지원이 남았다 */
  reviewDays: 3,
  /** 3일 안에 마감 — 아트링크 주최 */
  closingDays: 3,
} as const;

export interface StallInput {
  status: string;
  recruitOnly: boolean;
  ended: boolean;
  settledAt: Date | null;
  settlementRequestedAt: Date | null;
  deadline: Date;
  /** 선정 마감일(새 공고, 규칙 90) — 있으면 그날 저절로 정리되므로 '검토 대기가 남았다'를 멈춘 것으로 보지 않는다 */
  selectionDeadline?: Date | null;
  exhibitDate: Date | null;
  pending: number;
  issues: number;
}

export interface Stall { kind: 'issue' | 'settlement' | 'end' | 'review'; text: string }

/** 이 공모가 멈춰 있는가 — 있으면 한 줄 사정. 순서가 곧 우선순위다(이의 → 정산 → 전시 종료 → 검토) */
export function stallOf(ex: StallInput, now: Date = new Date()): Stall | null {
  if (ex.status !== 'APPROVED' || ex.settledAt) return null;
  if (ex.settlementRequestedAt && ex.issues > 0) return { kind: 'issue', text: `정산 이의 ${ex.issues}건` };
  // 전시가 끝나고 20일이 지나도록 정산을 시작하지 않았으면 이미 '종료'로 정리된 공모다(lib/exhibitionLifecycle — 갤러리 [내 공모]와 같은 기준).
  // 그런 공모까지 멈춘 것으로 세면 몇 달째 같은 줄이 맨 위에 남아 정작 지금 챙길 공모가 묻힌다
  if (!ex.recruitOnly && ex.exhibitDate && !ex.settlementRequestedAt && daysSinceDate(ex.exhibitDate, now) >= STALE_AFTER_DAYS) return null;
  if (!ex.recruitOnly && ex.exhibitDate && !ex.settlementRequestedAt) {
    const d = daysSinceDate(ex.exhibitDate, now);
    if (d >= STALL_RULES.settlementDays) {
      return ex.ended
        ? { kind: 'settlement', text: `전시 종료 ${d}일째 · 정산 요청 전` }
        : { kind: 'end', text: `전시 끝난 지 ${d}일 · [전시 종료] 전` };
    }
  }
  if (ex.pending > 0 && !ex.ended && !ex.selectionDeadline) {
    const d = daysSinceDate(ex.deadline, now);
    if (d >= STALL_RULES.reviewDays) return { kind: 'review', text: `마감 지나 ${d}일 · 검토 대기 ${ex.pending}명` };
  }
  return null;
}

/** 공모별 숫자 — 지원(상태별) · 출품 자료(다 낸 사람) · 판매 · 정산 확인 · 찜 · 첨부 받음. 쿼리 수는 공모 수와 무관하다 */
export async function exhibitionCounts(ids: number[]) {
  const empty = () => ({
    apps: { total: 0, submitted: 0, accepted: 0, rejected: 0 },
    submissions: { started: 0, complete: 0 },
    /** 비회원 작가 수(규칙 91) — 지원이 아니라 apps 에는 없다. 출품 자료 칸의 '필요' 에만 더한다 */
    guests: 0,
    sales: 0,
    approvals: { total: 0, approved: 0, issue: 0 },
    favorites: 0,
    attachmentDownloads: 0,
  });
  const out = new Map<number, ReturnType<typeof empty>>();
  for (const id of ids) out.set(id, empty());
  if (!ids.length) return out;
  const [apps, subs, sales, approvals, favs, hits, guests] = await Promise.all([
    prisma.application.groupBy({ by: ['exhibitionId', 'status'], where: { exhibitionId: { in: ids } }, _count: { _all: true } }),
    prisma.exhibitionSubmission.findMany({ where: { exhibitionId: { in: ids } }, select: { exhibitionId: true, artworkList: true, cv: true, note: true } }),
    prisma.artworkSale.groupBy({ by: ['exhibitionId'], where: { exhibitionId: { in: ids } }, _count: { _all: true } }),
    prisma.settlementApproval.groupBy({ by: ['exhibitionId', 'status'], where: { exhibitionId: { in: ids } }, _count: { _all: true } }),
    prisma.favorite.groupBy({ by: ['exhibitionId'], where: { exhibitionId: { in: ids } }, _count: { _all: true } }),
    prisma.exhibitionAttachmentHit.groupBy({ by: ['exhibitionId'], where: { exhibitionId: { in: ids } }, _sum: { count: true } }),
    prisma.exhibitionGuestArtist.groupBy({ by: ['exhibitionId'], where: { exhibitionId: { in: ids } }, _count: { _all: true } }),
  ]);
  for (const a of apps) {
    const row = out.get(a.exhibitionId)!;
    const n = a._count._all;
    row.apps.total += n;
    if (a.status === 'ACCEPTED') row.apps.accepted += n;
    else if (a.status === 'REJECTED') row.apps.rejected += n;
    else row.apps.submitted += n;   // SUBMITTED(옛 REVIEWED 포함) = 검토 대기
  }
  const json = (raw: string | null) => { if (!raw) return null; try { return JSON.parse(raw); } catch { return null; } };
  for (const s of subs) {
    const row = out.get(s.exhibitionId)!;
    const works = json(s.artworkList);
    const hasArtwork = Array.isArray(works) && works.some((w: any) => !w?.draft);   // 임시저장 작품은 갤러리에 안 보인다(운영 요약과 같은 규칙)
    const hasCv = hasSubmissionContent(json(s.cv));
    const hasNote = hasSubmissionContent(json(s.note));
    if (hasArtwork || hasCv || hasNote) row.submissions.started += 1;
    if (hasArtwork && hasCv && hasNote) row.submissions.complete += 1;
  }
  for (const s of sales) out.get(s.exhibitionId)!.sales = s._count._all;
  for (const a of approvals) {
    const row = out.get(a.exhibitionId)!;
    row.approvals.total += a._count._all;
    if (a.status === 'APPROVED') row.approvals.approved += a._count._all;
    if (a.status === 'ISSUE') row.approvals.issue += a._count._all;
  }
  for (const f of favs) if (f.exhibitionId != null && out.has(f.exhibitionId)) out.get(f.exhibitionId)!.favorites = f._count._all;
  for (const h of hits) out.get(h.exhibitionId)!.attachmentDownloads = h._sum.count ?? 0;
  for (const g of guests) out.get(g.exhibitionId)!.guests = g._count._all;
  return out;
}

const ROW_SELECT = {
  id: true, title: true, type: true, region: true, status: true, imageUrl: true, hostType: true, galleryId: true,
  recruitOnly: true, recruitmentClosed: true, confirmed: true, ended: true, settledAt: true, settlementRequestedAt: true,
  deadline: true, deadlineStart: true, exhibitStartDate: true, exhibitDate: true, submissionDeadline: true, selectionDeadline: true,
  capacity: true, capacityMask: true, viewCount: true, createdAt: true, reviewedAt: true,
  gallery: { select: { id: true, name: true, ownerId: true } },
  managers: { select: { gallery: { select: { id: true, name: true } } } },
} as const;

/**
 * 운영 조회의 공모 줄 — 상태 무관 전체(승인 대기·반려 포함). 단계 이름은 화면이 `lib/flowLabels.ts` 로 정한다
 * (갤러리 [내 공모]와 같은 말을 써야 한다), 서버는 재료와 '멈춘 사정'만 준다.
 */
export async function adminExhibitionRows(opts: { q?: string; ids?: number[] } = {}, now: Date = new Date()) {
  const where: any = {};
  if (opts.q) where.title = { contains: opts.q, mode: 'insensitive' };
  if (opts.ids) where.id = { in: opts.ids };
  const list = await prisma.exhibition.findMany({ where, select: ROW_SELECT, orderBy: { createdAt: 'desc' } });
  const counts = await exhibitionCounts(list.map((e) => e.id));
  return list.map((e) => {
    const c = counts.get(e.id)!;
    const stall = stallOf({ ...e, pending: c.apps.submitted, issues: c.approvals.issue }, now);
    return {
      ...e,
      gallery: e.gallery ? { id: e.gallery.id, name: e.gallery.name } : null,
      managerGalleries: e.managers.map((m) => m.gallery),
      managers: undefined,
      counts: c,
      stall,
      // 진행 중/종료 — 갤러리 [내 공모]와 같은 기준(lib/exhibitionLifecycle.ts)
      closed: isExhibitionClosed({ ...e, saleCount: c.sales }),
    };
  });
}

/** 멈춘 공모 — 운영 조회 표와 '지금 처리할 일' 이 같은 판정을 쓴다 */
export async function stalledExhibitions(now: Date = new Date()) {
  const list = await prisma.exhibition.findMany({
    where: { status: 'APPROVED', settledAt: null },
    select: { id: true, title: true, status: true, recruitOnly: true, ended: true, settledAt: true, settlementRequestedAt: true, deadline: true, selectionDeadline: true, exhibitDate: true },
  });
  const ids = list.map((e) => e.id);
  if (!ids.length) return [];
  const [pend, issues] = await Promise.all([
    prisma.application.groupBy({ by: ['exhibitionId'], where: { exhibitionId: { in: ids }, status: { in: ['SUBMITTED', 'REVIEWED'] } }, _count: { _all: true } }),
    prisma.settlementApproval.groupBy({ by: ['exhibitionId'], where: { exhibitionId: { in: ids }, status: 'ISSUE' }, _count: { _all: true } }),
  ]);
  const p = new Map(pend.map((g) => [g.exhibitionId, g._count._all]));
  const i = new Map(issues.map((g) => [g.exhibitionId, g._count._all]));
  return list
    .map((e) => ({ id: e.id, title: e.title, stall: stallOf({ ...e, pending: p.get(e.id) ?? 0, issues: i.get(e.id) ?? 0 }, now) }))
    .filter((e) => e.stall);
}

/** 소식 신고 중 아직 확인하지 않은 것이 있는 소식 수 — [신고 관리] '확인할 것' 과 같은 기준(되살린 뒤 새로 온 신고만) */
async function pendingStoryReports(): Promise<number> {
  const stories = await prisma.story.findMany({
    where: { reports: { some: {} } },
    select: { reviewedAt: true, reports: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  return stories.filter((s) => s.reports[0] && (!s.reviewedAt || s.reports[0].createdAt > s.reviewedAt)).length;
}

export interface TodoCounts {
  approvals: number;
  approvalsByKind: { gallery: number; exhibition: number; show: number; edit: number; delete: number };
  reports: number;
  reportsByKind: { chat: number; story: number };
  inquiries: number;
  oldestInquiryAt: string | null;
  pendingApplications: number;
  closingSoon: number;
  closingSoonEmpty: number;
  stalled: number;
}

/** 메뉴 배지 · '지금 처리할 일' — 한 번에 센다 */
export async function todoCounts(now: Date = new Date()): Promise<TodoCounts> {
  const today = kstDay(now);
  const soon = new Date(today.getTime() + STALL_RULES.closingDays * DAY);
  const [g, e, s, reqs, chat, story, inquiries, oldest, pendingApps, closing, stalled] = await Promise.all([
    prisma.gallery.count({ where: { status: 'PENDING' } }),
    prisma.exhibition.count({ where: { status: 'PENDING' } }),
    prisma.show.count({ where: { status: 'PENDING' } }),
    prisma.approvalRequest.groupBy({ by: ['type'], where: { status: 'PENDING' }, _count: { _all: true } }),
    prisma.chatReport.count({ where: { status: 'OPEN' } }),
    pendingStoryReports(),
    prisma.inquiry.count({ where: { status: 'OPEN' } }),
    prisma.inquiry.findFirst({ where: { status: 'OPEN' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    // 아트링크가 직접 운영하는 공모(운영 갤러리 없음)의 검토 대기 — 수락은 관리자 몫이다.
    // 접수가 끝난(모집 마감 또는 접수 마감일 경과) 공모만(2026-11-21, 규칙 90 — 접수 중엔 수락할 수 없다)
    prisma.application.count({ where: { status: { in: ['SUBMITTED', 'REVIEWED'] }, exhibition: {
      hostType: 'ADMIN', galleryId: null, ended: false,
      OR: [{ recruitmentClosed: true }, { deadline: { lt: today } }],
    } } }),
    prisma.exhibition.findMany({
      where: { hostType: 'ADMIN', status: 'APPROVED', recruitmentClosed: false, deadline: { gte: today, lte: soon } },
      select: { id: true, _count: { select: { applications: true } } },
    }),
    stalledExhibitions(now),
  ]);
  const edit = reqs.filter((r) => r.type.endsWith('_EDIT')).reduce((n, r) => n + r._count._all, 0);
  const del = reqs.filter((r) => r.type.endsWith('_DELETE')).reduce((n, r) => n + r._count._all, 0);
  return {
    approvals: g + e + s + edit + del,
    approvalsByKind: { gallery: g, exhibition: e, show: s, edit, delete: del },
    reports: chat + story,
    reportsByKind: { chat, story },
    inquiries,
    oldestInquiryAt: oldest?.createdAt.toISOString() ?? null,
    pendingApplications: pendingApps,
    closingSoon: closing.length,
    closingSoonEmpty: closing.filter((x) => x._count.applications === 0).length,
    stalled: stalled.length,
  };
}

/**
 * 첨부파일을 받았다 — 날짜별 한 줄에 +1 (2026-11-21).
 * 관리자와 그 공모의 운영자(주관 갤러리 주인 · 운영 갤러리 주인)는 세지 않는다(조회수와 같은 취지 — 규칙 63).
 * 승인된 공모만. 실패해도 던지지 않는다(받는 사람의 내려받기를 막으면 안 된다).
 */
export async function recordAttachmentHit(exhibitionId: number, viewer: { id: number; role: string } | undefined, now: Date = new Date()): Promise<boolean> {
  try {
    if (viewer?.role === 'ADMIN') return false;
    const ex = await prisma.exhibition.findUnique({
      where: { id: exhibitionId },
      select: { status: true, gallery: { select: { ownerId: true } }, managers: { select: { gallery: { select: { ownerId: true } } } } },
    });
    if (!ex || ex.status !== 'APPROVED') return false;
    if (viewer && (ex.gallery?.ownerId === viewer.id || ex.managers.some((m) => m.gallery.ownerId === viewer.id))) return false;
    const day = dayKey(kstDay(now));
    // 확인하고 만들지 않는다(규칙 46) — 한 문장이 판정한다
    await prisma.$executeRaw`
      INSERT INTO "ExhibitionAttachmentHit" ("exhibitionId", "day", "count") VALUES (${exhibitionId}, ${day}::date, 1)
      ON CONFLICT ("exhibitionId", "day") DO UPDATE SET "count" = "ExhibitionAttachmentHit"."count" + 1`;
    return true;
  } catch {
    return false;
  }
}
