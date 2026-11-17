import type { Prisma } from '@prisma/client';
import prisma from './prisma';
import { endOfTodayKstAsUtc, startOfTodayKstAsUtc } from './kstDate';

/**
 * '모집 중' 공모 판정 — **한 곳**(2026-11-15). 모집공고 목록의 [모집 중](`GET /exhibitions`)과
 * 갤러리 목록 카드의 '모집 중' 한 줄(`GET /galleries`)이 같은 규칙을 본다. 둘이 다르면
 * 갤러리 카드엔 '모집 중'인데 모집공고에는 없는 공고가 생긴다.
 *
 * 승인됨 · 수동 모집마감 아님(전시 종료도 모집마감을 함께 건다) · 마감일이 오늘(KST) 이후 · 시작일이 없거나 오늘까지 지났다.
 * 날짜는 KST 달력 날짜로 가른다(규칙 14) — 마감일 당일은 종일 '모집 중'이다.
 *
 * ⚠️ 시작일 조건은 `AND` 안에 넣는다 — 부르는 쪽이 `OR`(검색어·갤러리 묶음)를 더 얹어도 서로 덮어쓰지 않게.
 */
export function openCallWhere(now: Date = new Date()): Prisma.ExhibitionWhereInput {
  return {
    status: 'APPROVED',
    recruitmentClosed: false,
    deadline: { gte: startOfTodayKstAsUtc(now) },
    AND: [{ OR: [{ deadlineStart: null }, { deadlineStart: { lte: endOfTodayKstAsUtc(now) } }] }],
  };
}

export interface GalleryOpenCall {
  /** 마감이 가장 가까운 공모 */
  id: number;
  title: string;
  deadline: string;
  /** 이 갤러리의 모집 중 공모 수(위 하나 포함) — 화면이 '외 N' 으로 쓴다 */
  count: number;
}

/**
 * 갤러리마다 지금 모집 중인 공모 — 갤러리 목록 카드의 '모집 중' 한 줄과 '모집 중 먼저' 정렬의 근거.
 * 갤러리 홈페이지 [모집 중] 탭과 같은 범위다: 그 갤러리가 주관한 공모(`galleryId`) + 아트링크 주최 공모 가운데
 * 운영을 맡은 것(`ExhibitionManager` — 위임은 아트링크 주최일 때만 인정한다, 규칙 22). 쿼리는 갤러리 수와 무관하게 하나.
 */
export async function galleryOpenCalls(galleryIds: number[], now: Date = new Date()): Promise<Map<number, GalleryOpenCall>> {
  const out = new Map<number, GalleryOpenCall>();
  if (galleryIds.length === 0) return out;
  const base = openCallWhere(now);
  const rows = await prisma.exhibition.findMany({
    where: {
      ...base,
      AND: [
        ...(base.AND as Prisma.ExhibitionWhereInput[]),
        { OR: [
          { galleryId: { in: galleryIds } },
          { hostType: 'ADMIN', managers: { some: { galleryId: { in: galleryIds } } } },
        ] },
      ],
    },
    orderBy: [{ deadline: 'asc' }, { id: 'asc' }],
    select: { id: true, title: true, deadline: true, galleryId: true, hostType: true, managers: { select: { galleryId: true } } },
  });
  const wanted = new Set(galleryIds);
  for (const e of rows) {
    const owners = new Set<number>();
    if (e.galleryId != null && wanted.has(e.galleryId)) owners.add(e.galleryId);
    if (e.hostType === 'ADMIN') for (const m of e.managers) if (wanted.has(m.galleryId)) owners.add(m.galleryId);
    for (const g of owners) {
      const cur = out.get(g);
      if (cur) cur.count += 1;   // 마감 순으로 오므로 처음 것이 가장 가깝다
      else out.set(g, { id: e.id, title: e.title, deadline: e.deadline.toISOString(), count: 1 });
    }
  }
  return out;
}
