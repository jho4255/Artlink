/**
 * 알림에서 "이 사람" 을 가리키는 주소 — **역할에 따라 다르다** (2026-09-19).
 *
 * 이웃 추가(`NEIGHBOR_FOLLOW`)·작품 좋아요(`ARTWORK_LIKE`) 알림이 행위자 링크를 `/portfolio/<id>` 로 못박고 있었는데,
 * 그 라우트는 작가가 아니면 404 다. 하트 스카우팅(2026-08-28)의 주체가 **갤러리**라 작가가 "누가 좋아했지" 하고 누르면
 * 404 로 갔다 — '맞방문 유도' 라는 의도와 정반대. '일반'(VISITOR) 역할도 같다.
 *
 * - ARTIST  → `/@handle` 이 있으면 그것, 없으면 `/portfolio/<id>`
 * - GALLERY → 그 사람이 소유한 승인 갤러리(첫 번째) — `/@handle` 또는 `/galleries/<id>`
 * - 그 외(VISITOR·ADMIN) → 갈 곳이 없다 → `''` (알림은 남되 눌러도 이동하지 않는다; `Notification.linkUrl` 은 non-null)
 */
import prisma from './prisma';

export async function profileLinkFor(userId: number): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, handle: true } });
  if (!u) return '';
  if (u.role === 'ARTIST') return u.handle ? `/@${u.handle}` : `/portfolio/${userId}`;
  if (u.role === 'GALLERY') {
    const g = await prisma.gallery.findFirst({
      where: { ownerId: userId, status: 'APPROVED' },
      orderBy: { id: 'asc' },
      select: { id: true, handle: true },
    });
    if (g) return g.handle ? `/@${g.handle}` : `/galleries/${g.id}`;
  }
  return '';
}
