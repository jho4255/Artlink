import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { consumePostLoginRedirect } from '@/lib/postLoginRedirect';
import { useTourStore } from '@/stores/tourStore';
import { ARTIST_ONBOARDING_TOUR, artistOnboardingSteps } from '@/lib/tours';

/**
 * 로그인 페이지
 * - "카카오로 시작하기" → state(CSRF) 생성·저장 → 카카오 인증 페이지로 이동 → /auth/kakao/callback 처리
 * - 개발 모드(import.meta.env.DEV)에서만 시드 계정 빠른 로그인 버튼 노출 (백엔드도 non-production에서만 동작)
 */
const KAKAO_CLIENT_ID = import.meta.env.VITE_KAKAO_CLIENT_ID as string;

const DEV_ACCOUNTS = [
  { email: 'admin@artlink.com', label: 'Admin', desc: '승인 · 운영' },
  { email: 'gallery@artlink.com', label: 'Gallery', desc: '갤러리 · 공모' },
  { email: 'artist1@artlink.com', label: 'Artist 1', desc: '포트폴리오 · 지원' },
  { email: 'artist2@artlink.com', label: 'Artist 2', desc: '포트폴리오 · 지원' },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const login = useAuthStore((s) => s.login);
  const startTour = useTourStore((s) => s.start);

  const handleKakaoLogin = () => {
    const state = crypto.randomUUID();
    sessionStorage.setItem('kakao_state', state);
    const redirectUri = `${window.location.origin}/auth/kakao/callback`;
    window.location.href = `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_CLIENT_ID}`
      + `&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;
  };

  const handleDevLogin = async (email: string) => {
    try {
      const { data } = await api.post('/auth/dev-login', { email });
      queryClient.clear();
      login(data.token, data.user);
      // 로그인 전에 온 곳(예: 공모 지원)이 있으면 그리로 복귀, 없으면 마이페이지
      navigate(consumePostLoginRedirect() || '/mypage', { replace: true });
    } catch (err: any) {
      toast.error(err.response?.data?.error || '개발자 로그인에 실패했습니다.');
    }
  };

  // 개발자 신규 가입: 매번 갓 가입한 빈 계정을 만들어 실제 신규 가입 온보딩을 재현.
  // (작가면 온보딩 투어 자동 시작 → AuthCallbackPage의 신규 가입 경로와 동일 동작)
  const handleDevRegister = async (role: 'ARTIST' | 'GALLERY') => {
    try {
      const { data } = await api.post('/auth/dev-register', { role });
      queryClient.clear();
      login(data.token, data.user);
      consumePostLoginRedirect(); // 신규 가입은 투어로 안내하므로 복귀 경로는 폐기
      if (role === 'ARTIST') {
        startTour(ARTIST_ONBOARDING_TOUR, artistOnboardingSteps);
        navigate('/', { replace: true });
      } else {
        navigate('/mypage', { replace: true });
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || '개발자 가입에 실패했습니다.');
    }
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

        {import.meta.env.DEV && (
          <div className="mt-10 pt-6 border-t border-dashed border-gray-200">
            <p className="text-xs font-medium text-gray-400 mb-3">개발자 로그인 (로컬 전용)</p>
            <div className="grid grid-cols-2 gap-2">
              {DEV_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  onClick={() => handleDevLogin(acc.email)}
                  className="p-3 rounded-lg border border-gray-200 hover:border-gray-900 transition-colors text-left cursor-pointer"
                >
                  <div className="text-sm font-medium text-gray-900">{acc.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{acc.desc}</div>
                </button>
              ))}
            </div>

            <p className="text-xs font-medium text-gray-400 mt-6 mb-3">개발자 신규 가입 (빈 계정 · 온보딩 테스트)</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleDevRegister('ARTIST')}
                className="p-3 rounded-lg border border-dashed border-gray-300 hover:border-gray-900 transition-colors text-left cursor-pointer"
              >
                <div className="text-sm font-medium text-gray-900">작가로 신규 가입</div>
                <div className="text-xs text-gray-400 mt-0.5">빈 계정 + 온보딩 투어</div>
              </button>
              <button
                onClick={() => handleDevRegister('GALLERY')}
                className="p-3 rounded-lg border border-dashed border-gray-300 hover:border-gray-900 transition-colors text-left cursor-pointer"
              >
                <div className="text-sm font-medium text-gray-900">갤러리로 신규 가입</div>
                <div className="text-xs text-gray-400 mt-0.5">빈 계정 · 마이페이지</div>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
