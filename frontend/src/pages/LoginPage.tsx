import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';

const KAKAO_CLIENT_ID = import.meta.env.VITE_KAKAO_CLIENT_ID;

export default function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const login = useAuthStore((s) => s.login);
  const [error, setError] = useState('');

  const handleSuccess = (data: { token: string; user: any }) => {
    queryClient.clear();
    login(data.token, data.user);
    navigate('/mypage');
  };

  const handleKakao = () => {
    if (!KAKAO_CLIENT_ID) return setError('카카오 로그인이 설정되지 않았습니다.');
    const redirectUri = `${window.location.origin}/auth/kakao/callback`;
    const state = crypto.randomUUID();
    sessionStorage.setItem('kakao_state', state);
    window.location.href =
      `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-serif text-center mb-1">ArtLink</h1>
        <p className="text-sm text-gray-400 text-center mb-10">갤러리와 아티스트를 잇다</p>

        <div className="space-y-2.5">
          <button
            onClick={handleKakao}
            className="w-full flex items-center justify-center gap-2.5 h-12 rounded-lg font-medium text-sm cursor-pointer transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#FEE500', color: '#000000' }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#000000" d="M9 1C4.58 1 1 3.79 1 7.21c0 2.17 1.45 4.08 3.63 5.18l-.93 3.44c-.08.3.26.54.52.37l4.1-2.72c.22.02.44.03.68.03 4.42 0 8-2.79 8-6.3C17 3.79 13.42 1 9 1"/></svg>
            카카오로 시작하기
          </button>

          <button
            disabled
            className="w-full flex items-center justify-center gap-2.5 h-12 rounded-lg font-medium text-sm border border-gray-200 text-gray-300 cursor-not-allowed"
          >
            네이버 로그인 (준비 중)
          </button>

          <button
            disabled
            className="w-full flex items-center justify-center gap-2.5 h-12 rounded-lg font-medium text-sm border border-gray-200 text-gray-300 cursor-not-allowed"
          >
            Google 로그인 (준비 중)
          </button>
        </div>

        {error && <p className="text-sm text-red-500 text-center mt-4">{error}</p>}

        {/* 개발용 퀵 로그인 */}
        {import.meta.env.DEV && <DevLogin onLogin={handleSuccess} />}
      </div>
    </div>
  );
}

function DevLogin({ onLogin }: { onLogin: (data: { token: string; user: any }) => void }) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<any[]>([]);

  const devLoginMutation = useMutation({
    mutationFn: (userId: number) => api.post('/auth/dev-login', { userId }).then((r) => r.data),
    onSuccess: onLogin,
  });

  const handleToggle = async () => {
    if (!open && users.length === 0) {
      const res = await api.get('/auth/dev-users');
      setUsers(res.data);
    }
    setOpen(!open);
  };

  return (
    <div className="mt-8">
      <button onClick={handleToggle} className="w-full text-xs text-gray-300 hover:text-gray-500 cursor-pointer text-center">
        {open ? '닫기' : '개발자 로그인'}
      </button>
      {open && (
        <div className="mt-3 space-y-1.5">
          {users.map((u: any) => (
            <button
              key={u.id}
              onClick={() => devLoginMutation.mutate(u.id)}
              disabled={devLoginMutation.isPending}
              className="w-full p-2.5 text-left text-xs border border-gray-100 rounded-lg hover:border-gray-300 cursor-pointer"
            >
              <span className="font-medium">{u.name}</span>
              <span className="text-gray-400 ml-2">{u.email} · {u.role}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
