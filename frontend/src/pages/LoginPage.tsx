import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';

// 개발용 퀵 로그인 페이지 - 유저 선택 시 즉시 로그인
export default function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const login = useAuthStore((s) => s.login);
  const [loading, setLoading] = useState<number | null>(null);

  const { data: users = [], isLoading: usersLoading, isError, refetch } = useQuery({
    queryKey: ['dev-users'],
    queryFn: () => api.get('/auth/dev-users').then((r) => r.data),
    retry: 3,        // 로그인 페이지는 반드시 로딩되어야 하므로 재시도 3회
    staleTime: 0,    // 항상 최신 데이터
    retryDelay: 1000,
  });

  const loginMutation = useMutation({
    mutationFn: (userId: number) => api.post('/auth/dev-login', { userId }),
    onSuccess: (res) => {
      // 이전 유저의 캐시된 데이터 전체 제거 (유저 전환 시 stale 데이터 방지)
      queryClient.clear();
      login(res.data.token, res.data.user);
      navigate('/mypage');
    },
    onSettled: () => setLoading(null),
  });

  const handleLogin = (userId: number) => {
    setLoading(userId);
    loginMutation.mutate(userId);
  };

  // 카카오 OAuth — state(CSRF) 생성·저장 후 카카오 인증 페이지로 이동
  const handleKakaoLogin = () => {
    const state = crypto.randomUUID();
    sessionStorage.setItem('kakao_state', state);
    const redirectUri = `${window.location.origin}/auth/kakao/callback`;
    const clientId = import.meta.env.VITE_KAKAO_CLIENT_ID as string;
    window.location.href = `https://kauth.kakao.com/oauth/authorize?client_id=${clientId}`
      + `&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;
  };

  const roleIcons: Record<string, string> = {
    ARTIST: '\uD83C\uDFA8',
    GALLERY: '\uD83D\uDDBC\uFE0F',
    ADMIN: '\u2699\uFE0F',
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-medium text-center mb-2 font-serif">ArtLink 로그인</h1>
        <p className="text-sm text-gray-400 text-center mb-8">갤러리와 아티스트를 잇다</p>

        {/* 카카오 로그인 (정식) */}
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

        {/* 구분선 + 개발용 빠른 로그인 (운영 전환 후 제거 예정) */}
        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-gray-400">개발용 빠른 로그인</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* 로딩 스켈레톤 */}
        {usersLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-16 bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : isError ? (
          /* 에러 상태 — 재시도 버튼 */
          <div className="text-center py-8">
            <p className="text-red-500 mb-3">계정 목록을 불러오지 못했습니다.</p>
            <button
              onClick={() => refetch()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800"
            >
              <RefreshCw size={14} /> 다시 시도
            </button>
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-8 text-gray-400">등록된 계정이 없습니다.</div>
        ) : (
          <div className="space-y-3">
            {users.map((user: any) => (
              <button
                key={user.id}
                onClick={() => handleLogin(user.id)}
                disabled={loading !== null}
                className={`w-full p-4 rounded-lg border border-gray-200 bg-white hover:border-gray-400 text-left transition-all ${loading === user.id ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{roleIcons[user.role]}</span>
                  <div>
                    <div className="font-semibold text-gray-900">{user.name}</div>
                    <div className="text-xs text-gray-500">{user.email} · {user.role}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        <p className="text-xs text-gray-400 text-center mt-6">
          추후 OAuth/소셜 로그인으로 전환 예정
        </p>
      </div>
    </div>
  );
}
