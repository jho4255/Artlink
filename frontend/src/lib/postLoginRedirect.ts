/**
 * 로그인 후 복귀 경로(returnTo) 관리
 *
 * 비로그인 상태에서 "로그인하고 지원하기" 등을 눌러 로그인 페이지로 보낼 때,
 * 로그인 완료 후 원래 있던 페이지(+의도)로 돌아오게 하기 위한 sessionStorage 저장소.
 *
 * - sessionStorage를 쓰는 이유: 카카오 OAuth 왕복(외부 → /auth/kakao/callback)과
 *   신규 가입 단계까지 같은 탭에서 값이 유지되기 때문. (kakao_state와 동일한 메커니즘)
 * - 오픈 리다이렉트 방지: 내부 절대경로("/...")만 허용하고 프로토콜상대경로("//...")는 차단.
 *
 * 사용처:
 *  - 저장: ExhibitionDetailPage '로그인하고 지원하기' 버튼
 *  - 소비: LoginPage(개발자 로그인), AuthCallbackPage(카카오 로그인/가입 완료)
 */
const KEY = 'post_login_redirect';

function isSafeInternalPath(path: string | null): path is string {
  return !!path && path.startsWith('/') && !path.startsWith('//');
}

/** 로그인 후 돌아갈 앱 내부 경로 저장 (내부 절대경로만 허용) */
export function setPostLoginRedirect(path: string): void {
  if (isSafeInternalPath(path)) sessionStorage.setItem(KEY, path);
}

/** 저장된 복귀 경로를 읽고 즉시 삭제. 없거나 유효하지 않으면 null */
export function consumePostLoginRedirect(): string | null {
  const path = sessionStorage.getItem(KEY);
  sessionStorage.removeItem(KEY);
  return isSafeInternalPath(path) ? path : null;
}

/**
 * 로그인·가입 직후 갈 곳 (2026-09-16, 온보딩).
 * 기억해 둔 곳이 있으면 거기(예: 작가 홈페이지에서 [이웃 추가]를 눌러 로그인한 경우).
 * 없으면 마이페이지인데, **작품이 0점인 작가는 홈페이지 편집 화면**으로 — 프로필 폼이 아니라 업로드가 첫 행동이어야 한다.
 * 확인 API 가 실패하면 조용히 마이페이지(온보딩은 거기서도 보인다).
 */
export async function resolvePostLoginPath(role: string | undefined, fetchPortfolio: () => Promise<{ images?: unknown[] } | null>): Promise<string> {
  const remembered = consumePostLoginRedirect();
  if (remembered) return remembered;
  if (role !== 'ARTIST') return '/mypage';
  try {
    const p = await fetchPortfolio();
    if (!p || !p.images || p.images.length === 0) return '/mypage?tab=homepage-edit';
  } catch { /* 판단 못 하면 기본 */ }
  return '/mypage';
}
