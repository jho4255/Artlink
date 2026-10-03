/**
 * 응답 정제(sanitize) 헬퍼 — 갤러리/리뷰를 외부에 내보내기 전 비밀·PII를 제거한다.
 * 갤러리를 포함하는 모든 응답, 리뷰를 포함하는 모든 응답에서 단일 소스로 사용.
 */

/**
 * 갤러리 객체에서 서버 전용 비밀(Instagram OAuth 토큰)만 제거.
 * - instagramAccessToken / instagramTokenExpiresAt 제거
 * - instagramUrl(인스타 주소)은 그대로 노출 — 갤러리가 직접 입력/표시하는 공개 정보
 * 갤러리를 직접/중첩으로 응답에 넣는 모든 경로(목록·상세·이달의갤러리·공모/전시 상세)에서 호출.
 */
export function maskGallery<T extends Record<string, any>>(g: T | null | undefined): any {
  if (!g) return g;
  // hiddenArtistIds — 갤러리가 [함께한 작가]에서 숨긴 작가 id. 숨긴 사람 목록이 공개 응답(공모 상세·전시 상세·목록·이달의 갤러리)에
  // 그대로 실려 나갔다(2026-10-03 점검 S4). 주인은 갤러리 상세의 `artists[].hidden` 으로 본다(규칙 50).
  const { instagramAccessToken, instagramTokenExpiresAt, hiddenArtistIds, ...rest } = g as any;
  void hiddenArtistIds;
  return rest;
}

/**
 * 공모를 **운영자가 아닌 사람**에게 내보낼 때 뺄 값 — 정산·심사 내부 정보(2026-10-03 점검 S4).
 *  - cardFeeRate · settlementRequestedAt : 정산 진행 정보(작가는 자기 정산 화면에서 따로 받는다)
 *  - rejectReason : 반려 사유(공개 목록은 승인된 것만이라 보통 비어 있지만, 비울 이유가 없다)
 * 운영자(주관·위임 갤러리)·관리자에게는 그대로 준다 — 공모 상세의 `canOperate` 로 가른다.
 */
const EXHIBITION_INTERNAL_KEYS = ['cardFeeRate', 'settlementRequestedAt', 'rejectReason'] as const;
export function maskExhibition<T extends Record<string, any>>(ex: T): Omit<T, (typeof EXHIBITION_INTERNAL_KEYS)[number]> {
  const out: Record<string, any> = { ...ex };
  for (const k of EXHIBITION_INTERNAL_KEYS) delete out[k];
  return out as any;
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
