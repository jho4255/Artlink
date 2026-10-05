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
 * 공모 조회수를 볼 수 있는 사람 — **그 공모를 올린 갤러리 주인**과 관리자뿐(2026-10-05 사용자 요청).
 * 다른 갤러리·작가·비회원에게는 응답에서 뺀다(`maskExhibition` 이 `viewCount` 를 지운다).
 * ⚠️ 아트링크 주최 공모(`hostType='ADMIN'`)는 운영을 위임받은 갤러리라도 보지 못한다 — 올린 곳이 아트링크다.
 *    `canOperateExhibition`(운영 권한)과 다른 기준이라 그걸로 판정하지 말 것.
 */
export function canSeeExhibitionViews(
  ex: { hostType?: string | null; gallery?: { ownerId?: number | null } | null },
  viewer: Viewer | null,
): boolean {
  if (!viewer) return false;
  if (viewer.role === 'ADMIN') return true;
  return ex.hostType !== 'ADMIN' && ex.gallery?.ownerId != null && ex.gallery.ownerId === viewer.id;
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
