/**
 * 로그인 페이지 — 카카오 OAuth 전용
 * - "카카오로 시작하기" → state(CSRF) 생성·저장 → 카카오 인증 페이지로 이동
 * - 인증 후 /auth/kakao/callback (AuthCallbackPage)에서 처리
 */
const KAKAO_CLIENT_ID = import.meta.env.VITE_KAKAO_CLIENT_ID as string;

export default function LoginPage() {
  const handleKakaoLogin = () => {
    const state = crypto.randomUUID();
    sessionStorage.setItem('kakao_state', state);
    const redirectUri = `${window.location.origin}/auth/kakao/callback`;
    window.location.href = `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_CLIENT_ID}`
      + `&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-medium mb-2 font-serif">ArtLink 로그인</h1>
        <p className="text-sm text-gray-400 mb-10">갤러리와 아티스트를 잇다</p>

        <button
          onClick={handleKakaoLogin}
          className="w-full h-12 flex items-center justify-center gap-2 rounded-lg bg-[#FEE500] text-[#191600] text-sm font-semibold hover:brightness-95 transition cursor-pointer"
          aria-label="카카오로 시작하기"
        >
          <svg width="18" height="18" viewBox="0 0 256 256" aria-hidden="true">
            <path fill="#191600" d="M128 36C70.6 36 24 72.9 24 118.4c0 29.4 19.6 55.2 49 69.6-1.6 5.6-8.5 30.2-9.1 33.4 0 0-.2 1.5.8 2.1.9.6 2.1.1 2.1.1 4.3-.6 33.9-22.2 41-27.4 6.5 1 13.2 1.5 20.2 1.5 57.4 0 104-36.9 104-82.4S185.4 36 128 36"/>
          </svg>
          카카오로 시작하기
        </button>

        <p className="text-xs text-gray-400 mt-6 leading-relaxed">
          처음이시면 카카오 인증 후 역할(아티스트/갤러리)과<br />연락처를 입력해 가입을 완료할 수 있어요.
        </p>
      </div>
    </div>
  );
}
