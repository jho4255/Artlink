import { startKakaoLogin } from '@/lib/kakaoLogin';

/**
 * 카카오 로그인 버튼 — 로그인 화면과, 다른 창에서 돌아와 맞춰 보지 못한 콜백 화면이 같이 쓴다.
 * 누르면 `startKakaoLogin`(state 를 탭·브라우저 양쪽에 적고 카카오로). 화면 이름(aria-label)은 버튼 글자와 같다.
 * `onStart` 는 떠나기 직전에 — 회원가입 화면이 고른 역할을 적어 둔다(가입 정보 입력이 이어받는다, lib/signupRole.ts).
 */
export default function KakaoLoginButton({ label = '카카오로 시작하기', onStart }: { label?: string; onStart?: () => void }) {
  return (
    <button
      type="button"
      onClick={() => { onStart?.(); startKakaoLogin(); }}
      className="w-full h-12 flex items-center justify-center gap-2 rounded-lg bg-[#FEE500] text-[#191600] text-sm font-semibold hover:brightness-95 transition cursor-pointer"
      aria-label={label}
    >
      <svg width="18" height="18" viewBox="0 0 256 256" aria-hidden="true">
        <path fill="#191600" d="M128 36C70.6 36 24 72.9 24 118.4c0 29.4 19.6 55.2 49 69.6-1.6 5.6-8.5 30.2-9.1 33.4 0 0-.2 1.5.8 2.1.9.6 2.1.1 2.1.1 4.3-.6 33.9-22.2 41-27.4 6.5 1 13.2 1.5 20.2 1.5 57.4 0 104-36.9 104-82.4S185.4 36 128 36"/>
      </svg>
      {label}
    </button>
  );
}
