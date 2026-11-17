import type { Prisma } from '@prisma/client';
import prisma from './prisma';

/**
 * 홈페이지 [소식] 탭 (2026-11-14, CLAUDE.md 규칙 82) — 작가·갤러리 홈페이지에 **그 사람이 올린 ArtStory** 를 보여 준다.
 *
 * 한 사람의 소식 가운데 '보는 사람에게 보이는 것'의 규칙은 **여기 하나**다. 쓰는 곳이 둘이다:
 *   1) `GET /api/stories/user/:userId` — ArtStory [내 소식] 탭 · 홈페이지 [소식] 탭의 카드 목록
 *   2) `GET /api/portfolio/:id` · `GET /api/galleries/:id` 의 `storyCount` — 탭을 그릴지(빈 탭은 만들지 않는다)
 * 둘이 갈라지면 탭은 있는데 눌러 보면 비어 있거나, 소식이 있는데 탭이 없다.
 *
 * 규칙(2026-11-14 ArtStory 홈 공개 때 정한 그대로):
 *  · 이웃 공개(NEIGHBORS) 소식은 **나를 이웃 추가한 사람**과 본인에게만
 *  · 운영이 내린 소식(hiddenAt)·탈퇴한 사람의 소식은 본인·관리자 말고는 없다
 *  · 공개 목록의 '최근 30일'(STORY_PUBLIC_DAYS)은 여기에 걸지 않는다 — 자기 홈페이지는 기록이다
 */
type Viewer = { id: number; role: string } | null | undefined;

export async function personStoryScope(viewer: Viewer, targetId: number): Promise<{ where: Prisma.StoryWhereInput; canSeeNeighbors: boolean }> {
  const me = viewer?.id;
  const isSelf = me === targetId;
  const staff = isSelf || viewer?.role === 'ADMIN';
  const isFollower = !isSelf && me
    ? !!(await prisma.follow.findUnique({ where: { followerId_followingId: { followerId: me, followingId: targetId } }, select: { id: true } }))
    : false;
  const canSeeNeighbors = isSelf || isFollower;
  return {
    where: {
      authorId: targetId,
      ...(canSeeNeighbors ? {} : { visibility: 'PUBLIC' }),
      ...(staff ? {} : { hiddenAt: null, author: { deletedAt: null } }),
    },
    canSeeNeighbors,
  };
}

/**
 * 홈페이지 [소식] 탭을 그릴지 — 보이는 소식 수와 **소식이 하나라도 남은** 공개 하이라이트 수.
 * 하이라이트는 `/stories/highlights/:userId` 와 같은 규칙(본인이 아니면 공개 것만, 내린 소식은 없는 것으로).
 * 소식을 다 지운 하이라이트만 남았으면 탭이 없다 — 눌러 봐야 빈 동그라미뿐이다.
 */
export async function homepageNewsCounts(viewer: Viewer, userId: number): Promise<{ storyCount: number; highlightCount: number }> {
  const isOwn = viewer?.id === userId;
  const { where } = await personStoryScope(viewer, userId);
  const [storyCount, highlights] = await Promise.all([
    prisma.story.count({ where }),
    prisma.storyHighlight.findMany({ where: { userId, ...(isOwn ? {} : { isPublic: true }) }, select: { storyIds: true } }),
  ]);
  const ids = [...new Set(highlights.flatMap((h) => h.storyIds))];
  if (ids.length === 0) return { storyCount, highlightCount: 0 };
  const live = new Set(
    (await prisma.story.findMany({ where: { id: { in: ids }, ...(isOwn ? {} : { hiddenAt: null }) }, select: { id: true } })).map((s) => s.id),
  );
  return { storyCount, highlightCount: highlights.filter((h) => h.storyIds.some((id) => live.has(id))).length };
}
