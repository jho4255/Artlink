import prisma from './prisma';

/** 홈페이지 주소를 정하는 데 필요한 것만 — 부르는 쪽의 작성자 행이 이 모양을 품고 있으면 된다 */
export interface ProfileAuthor { id: number; role: string; handle?: string | null }

export interface AuthorProfile { homepage: string | null; intro: string | null }

/**
 * 여러 사람의 홈페이지·한 줄 소개를 한 번에 (2026-11-13 커뮤니티 → 2026-11-14 ArtStory 도 같이 쓴다).
 * 사람마다 쿼리를 돌리지 않는다 — 작가는 포트폴리오 한 줄 소개, 갤러리는 승인된 첫 갤러리.
 *  · 작가 → `/@handle` 또는 `/portfolio/:id`
 *  · 갤러리 → 승인된 첫 갤러리의 `/@handle` 또는 `/galleries/:id` (없으면 null)
 *  · 일반·운영 → null (홈페이지가 없다)
 * ⚠️ 익명 글·익명 댓글의 작성자는 넣지 말 것(부르는 쪽이 실명인 사람만 넘긴다).
 */
export async function authorProfiles(authors: ProfileAuthor[]): Promise<Record<number, AuthorProfile>> {
  const out: Record<number, AuthorProfile> = {};
  const uniq = [...new Map(authors.map((a) => [a.id, a])).values()];
  const artists = uniq.filter((a) => a.role === 'ARTIST');
  const galleryOwners = uniq.filter((a) => a.role === 'GALLERY');
  const [pfs, galleries] = await Promise.all([
    artists.length ? prisma.portfolio.findMany({ where: { userId: { in: artists.map((a) => a.id) } }, select: { userId: true, tagline: true } }) : [],
    galleryOwners.length
      ? prisma.gallery.findMany({ where: { ownerId: { in: galleryOwners.map((a) => a.id) }, status: 'APPROVED' }, orderBy: { createdAt: 'asc' }, select: { ownerId: true, id: true, handle: true, name: true } })
      : [],
  ]);
  const tagline = new Map(pfs.map((p) => [p.userId, p.tagline?.trim() || null]));
  for (const a of artists) out[a.id] = { homepage: a.handle ? `/@${a.handle}` : `/portfolio/${a.id}`, intro: tagline.get(a.id) ?? null };
  for (const a of galleryOwners) {
    const g = galleries.find((x) => x.ownerId === a.id);
    out[a.id] = g ? { homepage: g.handle ? `/@${g.handle}` : `/galleries/${g.id}`, intro: g.name } : { homepage: null, intro: null };
  }
  for (const a of uniq) if (!out[a.id]) out[a.id] = { homepage: null, intro: null };
  return out;
}
