import { beginOAuthState } from './oauthState';
import { noteGuestOAuthStart } from './guestActivity';

/**
 * 카카오 로그인 시작 — 로그인 화면의 버튼과, 다른 창에서 돌아와 맞춰 보지 못한 콜백 화면의 [카카오로 계속하기] 가 같이 쓴다.
 * ⚠️ 카카오로 보내는 길은 여기 하나로 둘 것 — 한 곳에서 state 를 브라우저 저장소에 안 적으면 그 길로 시작한 로그인만
 *    다른 탭에서 돌아왔을 때 또 '보안 검증 실패'로 튕기고(`lib/oauthState.ts`), 비회원 방문도 거기서 끊긴다(`noteGuestOAuthStart`).
 * ⚠️ 사용자가 누른 순간에만 부를 것(자동으로 부르지 말 것) — 휴대폰에서 카카오톡 앱을 여는 데 사용자 동작이 필요하다.
 */
const KAKAO_CLIENT_ID = import.meta.env.VITE_KAKAO_CLIENT_ID as string;

export function kakaoAuthorizeUrl(state: string, origin: string, clientId: string = KAKAO_CLIENT_ID): string {
  const redirectUri = `${origin}/auth/kakao/callback`;
  return `https://kauth.kakao.com/oauth/authorize?client_id=${clientId}`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${encodeURIComponent(state)}`;
}

export function startKakaoLogin(): void {
  const state = beginOAuthState('kakao');
  noteGuestOAuthStart(state);
  window.location.href = kakaoAuthorizeUrl(state, window.location.origin);
}
