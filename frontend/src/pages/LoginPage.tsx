import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
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

  const roleColors: Record<string, string> = {
    ARTIST: 'bg-blue-50 border-blue-200 hover:border-blue-400',
    GALLERY: 'bg-green-50 border-green-200 hover:border-green-400',
    ADMIN: 'bg-red-50 border-red-200 hover:border-red-400',
  };

  const roleIcons: Record<string, string> = {
    ARTIST: '\uD83C\uDFA8',
    GALLERY: '\uD83D\uDDBC\uFE0F',
    ADMIN: '\u2699\uFE0F',
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <h1 className="text-2xl font-bold text-center mb-2">로그인</h1>
        <p className="text-sm text-gray-400 text-center mb-8">개발용 퀵 로그인 - 계정을 선택하세요</p>

        {/* 로딩 스켈레톤 */}
        {usersLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
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
                className={`w-full p-4 rounded-xl border-2 text-left transition-all ${roleColors[user.role] || 'bg-gray-50 border-gray-200'} ${loading === user.id ? 'opacity-50' : ''}`}
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
      </motion.div>
    </div>
  );
}
