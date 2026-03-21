/**
 * 중복 리뷰 정리 스크립트
 * 같은 유저가 같은 갤러리에 남긴 중복 리뷰 중 가장 최신 1개만 유지, 나머지 삭제
 *
 * 실행: cd backend && npx tsx prisma/cleanup-duplicate-reviews.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 중복 리뷰 그룹 찾기
  const duplicates = await prisma.$queryRaw<{ userId: number; galleryId: number; cnt: bigint }[]>`
    SELECT "userId", "galleryId", COUNT(*) as cnt
    FROM "Review"
    GROUP BY "userId", "galleryId"
    HAVING COUNT(*) > 1
  `;

  console.log(`중복 리뷰 그룹: ${duplicates.length}개`);

  let totalDeleted = 0;

  for (const dup of duplicates) {
    // 각 그룹에서 가장 최신 리뷰 1개만 유지
    const reviews = await prisma.review.findMany({
      where: { userId: dup.userId, galleryId: dup.galleryId },
      orderBy: { createdAt: 'desc' },
    });

    const toDelete = reviews.slice(1); // 첫 번째(최신) 제외 나머지 삭제
    console.log(`  userId=${dup.userId}, galleryId=${dup.galleryId}: ${reviews.length}개 중 ${toDelete.length}개 삭제`);

    for (const r of toDelete) {
      await prisma.review.delete({ where: { id: r.id } });
      totalDeleted++;
    }

    // 평점 재계산
    const agg = await prisma.review.aggregate({
      where: { galleryId: dup.galleryId },
      _avg: { rating: true },
      _count: { rating: true },
    });
    await prisma.gallery.update({
      where: { id: dup.galleryId },
      data: { rating: agg._avg.rating || 0, reviewCount: agg._count.rating },
    });
  }

  console.log(`\n완료: 총 ${totalDeleted}개 중복 리뷰 삭제`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
