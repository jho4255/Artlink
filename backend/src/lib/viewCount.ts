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
  ownerId: number,
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
