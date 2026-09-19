import prisma from './prisma';

type Viewer = { id: number; role: string } | undefined;

/**
 * 상세 페이지 조회수 증가 (Admin 통계용).
 * - 관리자(ADMIN)와 해당 콘텐츠 소유자(owner)의 조회는 카운트하지 않아 통계 왜곡을 방지한다.
 * - best-effort: 증가 실패가 상세 조회 응답을 막지 않도록 예외를 삼킨다.
 */
export async function bumpViewCount(
  model: 'gallery' | 'exhibition' | 'show',
  id: number,
  // 주인이 없을 수 있다 — 아트링크가 갤러리를 안 끼고 여는 공모(2026-09-10). 그럼 '본인 조회 제외'가 없을 뿐이다.
  ownerId: number | null | undefined,
  viewer: Viewer
): Promise<void> {
  if (viewer && (viewer.role === 'ADMIN' || viewer.id === ownerId)) return;
  try {
    await (prisma[model] as any).update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });
  } catch {
    // 조회수는 부가 통계이므로 실패해도 무시한다.
  }
}

/**
 * 같은 사람(로그인 id 또는 IP)이 같은 대상을 30분 안에 다시 열어도 조회수를 안 센다 — 메모리 창(프로세스당).
 * 상세 페이지를 refetch 하는 조작(좋아요·댓글)이 조회수를 올리는 것을 막는다. 재시작하면 창이 비지만 통계용이라 충분하다.
 */
const VIEW_WINDOW_MS = 30 * 60 * 1000;
const recentViews = new Map<string, number>();
export function shouldCountView(target: string, viewer: string | number): boolean {
  if (process.env.NODE_ENV === 'test') return true;   // 테스트는 같은 사용자로 반복 조회해 조회수를 센다
  const key = `${target}|${viewer}`;
  const now = Date.now();
  if (recentViews.size > 50_000) {
    for (const [k, t] of recentViews) if (now - t > VIEW_WINDOW_MS) recentViews.delete(k);
  }
  const last = recentViews.get(key);
  if (last && now - last < VIEW_WINDOW_MS) return false;
  recentViews.set(key, now);
  return true;
}
