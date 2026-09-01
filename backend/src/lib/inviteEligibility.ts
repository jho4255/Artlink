import prisma from './prisma';

/**
 * 갤러리가 이 작가를 공모에 초대할 자격이 있는가 — **관문**.
 *
 * 아무나 검색해서 부를 수 없게, 다음 둘 중 하나여야 한다:
 *  · 그 작가의 작품에 **좋아요(하트)** 를 눌렀거나, 또는
 *  · 서로 **이웃**(양방향 팔로우)이거나.
 *
 * 둘러보기 작품 모달에서 '바로 초대'하던 버튼을 없앤 뒤, 이 판정을 서버의 단일 관문으로 둔다.
 * (Admin 주최 공모는 큐레이션 성격이라 라우트 쪽에서 이 검사를 건너뛴다 — 여기선 순수 판정만)
 */
export async function canInviteArtist(galleryUserId: number, artistId: number): Promise<boolean> {
  const [liked, iFollow, followsMe] = await Promise.all([
    prisma.portfolioImageLike.findFirst({
      where: { userId: galleryUserId, image: { portfolio: { userId: artistId } } },
      select: { id: true },
    }),
    prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: galleryUserId, followingId: artistId } },
      select: { id: true },
    }),
    prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: artistId, followingId: galleryUserId } },
      select: { id: true },
    }),
  ]);
  return !!liked || (!!iFollow && !!followsMe);
}
