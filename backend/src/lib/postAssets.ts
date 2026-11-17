import prisma from './prisma';
import { deleteUploadedFile } from './storage';
import { logger } from './logger';

/**
 * 커뮤니티 글 사진 파일 정리 (2026-11-13).
 *
 * 지우는 것은 **글쓰기 화면이 올린 사진·동영상(PostAsset)** 뿐이다. 글의 `images` 를 그대로 지우면 안 된다 —
 * API 로 남의 작품 사진 주소를 넣은 글을 지우는 순간 남의 파일이 지워진다(주소는 `ownFileUrl` 만 보므로 우리 저장소면 다 통과한다).
 * 그리고 **어느 글·작업본도 안 쓸 때만** 지운다(같은 사진을 다른 글에 복사해 넣었을 수 있다).
 */

/**
 * 이 파일들 가운데 아무 글·작업본도 안 쓰는 것 — 사진(`images`)과 동영상(`videos`) **둘 다** 본다.
 * ⚠️ 한쪽만 보면 쓰고 있는 동영상을 '안 쓰는 파일'로 보고 지운다(3일 뒤 정리에서 조용히).
 */
async function unusedUrls(urls: string[]): Promise<string[]> {
  if (urls.length === 0) return [];
  const used = new Set<string>();
  const [posts, drafts] = await Promise.all([
    prisma.post.findMany({ where: { OR: [{ images: { hasSome: urls } }, { videos: { hasSome: urls } }] }, select: { images: true, videos: true } }),
    prisma.postDraft.findMany({ where: { OR: [{ images: { hasSome: urls } }, { videos: { hasSome: urls } }] }, select: { images: true, videos: true } }),
  ]);
  for (const r of [...posts, ...drafts]) for (const u of [...r.images, ...r.videos]) used.add(u);
  return urls.filter((u) => !used.has(u));
}

/**
 * 글이 지워졌거나 고쳐서 사진이 빠졌을 때 — `ownerId` 가 글쓰기로 올린 것 가운데 이제 아무도 안 쓰는 파일만 지운다.
 * 실패해도 던지지 않는다(글 삭제·수정은 이미 끝났다).
 */
export async function cleanupPostImages(urls: string[], ownerId: number): Promise<number> {
  try {
    const uniq = [...new Set(urls.filter((u) => typeof u === 'string' && u))];
    if (uniq.length === 0) return 0;
    const owned = await prisma.postAsset.findMany({ where: { url: { in: uniq }, userId: ownerId }, select: { url: true } });
    const dead = await unusedUrls(owned.map((a) => a.url));
    if (dead.length === 0) return 0;
    await prisma.postAsset.deleteMany({ where: { url: { in: dead } } });
    await Promise.all(dead.map((u) => deleteUploadedFile(u)));
    return dead.length;
  } catch (e) {
    logger.warn('Community', `글 사진 정리 실패(무시): ${(e as Error).message}`);
    return 0;
  }
}

/** 올리고 나서 이만큼 지나도록 어느 글·작업본에도 안 들어간 사진은 버린 것으로 본다 */
export const ORPHAN_ASSET_MS = 3 * 24 * 60 * 60 * 1000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
let lastPrune = 0;

/**
 * 버려진 글 사진 정리 — 올리고 작업본에서 빼거나 쓰던 글을 버린 사진. 스케줄러 없이 등록·삭제 때 **한 시간에 한 번** 돈다.
 * ⚠️ 3일을 기다리는 이유: 이 기기에만 보관된(서버에 아직 못 보낸) 글이 그 사진을 들고 있을 수 있다.
 */
export async function prunePostAssets(now = Date.now(), force = false): Promise<number> {
  if (!force && now - lastPrune < PRUNE_EVERY_MS) return 0;
  lastPrune = now;
  try {
    const cutoff = new Date(now - ORPHAN_ASSET_MS);
    const rows = await prisma.$queryRaw<{ url: string }[]>`
      SELECT a."url" FROM "PostAsset" a
      WHERE a."createdAt" < ${cutoff}
        AND NOT EXISTS (SELECT 1 FROM "Post" p WHERE a."url" = ANY(p."images") OR a."url" = ANY(p."videos"))
        AND NOT EXISTS (SELECT 1 FROM "PostDraft" d WHERE a."url" = ANY(d."images") OR a."url" = ANY(d."videos"))
      ORDER BY a."createdAt" ASC
      LIMIT 200`;
    const dead = rows.map((r) => r.url);
    if (dead.length === 0) return 0;
    await prisma.postAsset.deleteMany({ where: { url: { in: dead } } });
    await Promise.all(dead.map((u) => deleteUploadedFile(u)));
    logger.info('Community', `버려진 글 사진 ${dead.length}장 정리`);
    return dead.length;
  } catch (e) {
    logger.warn('Community', `버려진 글 사진 정리 실패(무시): ${(e as Error).message}`);
    return 0;
  }
}
