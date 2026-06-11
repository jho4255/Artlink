/**
 * 응답 정제(sanitize) 헬퍼 — 갤러리/리뷰를 외부에 내보내기 전 비밀·PII를 제거한다.
 * 갤러리를 포함하는 모든 응답, 리뷰를 포함하는 모든 응답에서 단일 소스로 사용.
 */

/**
 * 갤러리 객체에서 서버 전용 비밀(Instagram 액세스 토큰)을 제거하고 공개 안전한 형태로 변환.
 * - instagramAccessToken 제거 → instagramConnected(boolean)로 대체
 * - 프로필 비공개 시 instagramUrl 숨김
 * 갤러리를 직접/중첩으로 응답에 넣는 모든 경로(목록·상세·이달의갤러리·공모/전시 상세)에서 호출.
 */
export function maskGallery<T extends Record<string, any>>(g: T | null | undefined): any {
  if (!g) return g;
  const { instagramAccessToken, ...rest } = g as any;
  return {
    ...rest,
    instagramConnected: !!instagramAccessToken,
    instagramUrl: (g as any).instagramProfileVisible ? (g as any).instagramUrl : null,
  };
}

type ReviewLike = { anonymous?: boolean; userId?: number | null; user?: any };
type Viewer = { id: number; role: string } | null | undefined;

/**
 * 익명 리뷰의 작성자 신원(user 객체 + userId 스칼라)을 제3자에게 숨긴다.
 * - 본인(작성자) 또는 ADMIN: 그대로 노출(프론트가 "(익명)"으로 표기)
 * - 그 외: user=null, userId=null 로 마스킹 → 프론트는 "익명의 예술가 N"으로 표기
 * viewer가 필요하므로 호출부는 optionalAuth/authenticate로 req.user를 채워야 함.
 */
export function maskAnonymousReviews<R extends ReviewLike>(reviews: R[], viewer: Viewer): R[] {
  const isAdmin = viewer?.role === 'ADMIN';
  return reviews.map((r) => {
    if (!r.anonymous) return r;
    if (isAdmin || (viewer && r.userId === viewer.id)) return r;
    return { ...r, user: null, userId: null };
  });
}
