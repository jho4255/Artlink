/**
 * 운영 조회의 공모 줄 — 단계 묶음 · 한 줄 사정 · 주최 글(2026-11-21, 규칙 89).
 * 단계 이름은 갤러리 [내 공모]와 같은 `stageOf`(lib/flowLabels.ts) — 여기서는 묶고 글로 바꾸기만 한다.
 */
import { stageOf, type StageKey } from '@/lib/flowLabels';
import { shortDate } from '@/lib/adminFormat';

export type StageGroup = 'all' | 'recruit' | 'prepare' | 'show' | 'settle' | 'wrap' | 'pending';

export const GROUP_OF: Record<StageKey, StageGroup> = {
  recruiting: 'recruit', selecting: 'recruit', selected: 'wrap',
  preparing: 'prepare', confirmed: 'prepare', running: 'show',
  ended: 'settle', settling: 'settle', settled: 'wrap', closed: 'wrap',
  review: 'pending', rejected: 'pending',
};

/** 운영 조회 공모 줄 — 서버 `adminExhibitionRows`(lib/adminConsole.ts) */
export interface OvRow {
  id: number; title: string; type: string; region: string; status: string; imageUrl: string | null; hostType: string; galleryId: number | null;
  recruitOnly: boolean; recruitmentClosed: boolean; confirmed: boolean; ended: boolean; settledAt: string | null; settlementRequestedAt: string | null;
  deadline: string; deadlineStart: string | null; exhibitStartDate: string | null; exhibitDate: string | null; submissionDeadline: string | null;
  capacity: number; capacityMask: string | null; viewCount: number; createdAt: string; reviewedAt: string | null; closed: boolean;
  gallery: { id: number; name: string } | null;
  managerGalleries: { id: number; name: string }[];
  counts: {
    apps: { total: number; submitted: number; accepted: number; rejected: number };
    submissions: { started: number; complete: number };
    sales: number;
    approvals: { total: number; approved: number; issue: number };
    favorites: number;
    attachmentDownloads: number;
  };
  stall: { kind: string; text: string } | null;
}

export function rowStage(r: OvRow) {
  return stageOf({ ...r, settlementStarted: r.counts.sales > 0 || !!r.settlementRequestedAt, pending: r.counts.apps.submitted })!;
}

/** 그 단계의 한 줄 사정 — 멈춘 사정이 있으면 그것 */
export function rowNote(r: OvRow): string {
  if (r.stall) return r.stall.text;
  const s = rowStage(r);
  const c = r.counts;
  switch (GROUP_OF[s.key]) {
    case 'recruit': return c.apps.submitted ? `검토 대기 ${c.apps.submitted}명` : `${shortDate(r.deadline)} 마감`;
    case 'prepare': return r.recruitOnly ? `선정 ${c.apps.accepted}명` : `출품 자료 ${c.submissions.complete}/${c.apps.accepted}`;
    case 'show': return r.exhibitDate ? `${shortDate(r.exhibitDate)}까지` : '전시 중';
    case 'settle': return c.approvals.total ? `작가 확인 ${c.approvals.approved}/${c.approvals.total}` : `판매 ${c.sales}건 · 정산 요청 전`;
    case 'wrap': return r.settledAt ? `정산 완료 ${shortDate(r.settledAt)}` : r.recruitOnly ? `선정 ${c.apps.accepted}명` : '종료';
    default: return s.key === 'review' ? `${shortDate(r.createdAt)} 등록` : '반려';
  }
}

export function hostLine(r: { hostType: string; gallery: { name: string } | null; managerGalleries?: { name: string }[]; recruitOnly?: boolean }): string {
  if (r.hostType === 'ADMIN') {
    const m = r.managerGalleries ?? [];
    const ops = m.length ? `${m[0].name}${m.length > 1 ? ` 외 ${m.length - 1}곳` : ''}` : '직접 운영';
    return `아트링크 주최 · ${ops}${r.recruitOnly ? ' · 공모만 진행' : ''}`;
  }
  return `${r.gallery?.name ?? '—'}${r.recruitOnly ? ' · 공모만 진행' : ''}`;
}

