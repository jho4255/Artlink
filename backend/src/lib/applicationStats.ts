import prisma from './prisma';

export interface GalleryApplicationStat {
  galleryApplicationCount: number;   // 이 작가가 해당 갤러리(소속 공모 전체)에 지원한 총 횟수
  galleryApplicationOrder: number;   // 이 지원이 그중 몇 번째인지(1-based, createdAt 오름차순)
  isFirstApplication: boolean;       // 첫 지원 여부(첫 방문)
}

/**
 * 특정 갤러리에 대해, 주어진 작가들의 "지원 횟수/순번/첫지원여부"를 지원 ID별로 계산.
 * - 갤러리 단위 = 해당 갤러리에 속한 모든 공모(exhibition)를 합산
 * - 반환: Map<applicationId, GalleryApplicationStat>
 *
 * ⚠️ `galleryId` 가 null 이면 **빈 Map** 을 돌려준다 — 아트링크 주최 공모는 주관 갤러리 없이 열 수 있고
 *    (2026-09-10), 그러면 "이 갤러리에 몇 번째 지원인가" 라는 물음 자체가 성립하지 않는다.
 *    호출부는 이미 `stats.get(id) ?? {count:1, order:1, isFirst:true}` 로 받으므로 화면은 '첫 지원'으로 뜬다.
 *    ⚠️ 여기서 임의로 전체 공모를 합산하지 말 것 — 갤러리 단위 통계가 아닌 다른 숫자가 같은 라벨로 나간다.
 */
export async function galleryApplicationStats(galleryId: number | null | undefined, userIds: number[]): Promise<Map<number, GalleryApplicationStat>> {
  const stats = new Map<number, GalleryApplicationStat>();
  if (galleryId == null) return stats;
  const uniqueUserIds = [...new Set(userIds)];
  if (uniqueUserIds.length === 0) return stats;

  const apps = await prisma.application.findMany({
    where: { userId: { in: uniqueUserIds }, exhibition: { galleryId } },
    select: { id: true, userId: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const byUser = new Map<number, { id: number }[]>();
  for (const a of apps) {
    const arr = byUser.get(a.userId) ?? [];
    arr.push({ id: a.id });
    byUser.set(a.userId, arr);
  }
  for (const arr of byUser.values()) {
    arr.forEach((a, i) => {
      stats.set(a.id, {
        galleryApplicationCount: arr.length,
        galleryApplicationOrder: i + 1,
        isFirstApplication: i === 0,
      });
    });
  }
  return stats;
}
