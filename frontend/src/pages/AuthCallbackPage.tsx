import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { consumePostLoginRedirect } from '@/lib/postLoginRedirect';

export default function AuthCallbackPage({ provider }: { provider: 'kakao' }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const login = useAuthStore((s) => s.login);

  const [phase, setPhase] = useState<'loading' | 'register'>('loading');
  const [tempToken, setTempToken] = useState('');
  const [profile, setProfile] = useState<{ name: string; email: string | null; avatar: string | null }>({ name: '', email: null, avatar: null });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'ARTIST' | 'GALLERY'>('ARTIST');
  const [error, setError] = useState('');

  const handleSuccess = (data: { token: string; user: any }) => {
    queryClient.clear();
    login(data.token, data.user);
    // 로그인/가입 전에 온 곳(예: 공모 지원)이 있으면 그리로 복귀, 없으면 마이페이지
    navigate(consumePostLoginRedirect() || '/mypage', { replace: true });
  };

  const oauthMutation = useMutation({
    mutationFn: (body: { code: string; redirectUri: string }) =>
      api.post(`/auth/${provider}`, body).then((r) => r.data),
    onSuccess: (data) => {
      if (data.needsRegistration) {
        setTempToken(data.tempToken);
        setProfile(data.profile);
        setName(data.profile.name || '');
        setEmail(data.profile.email || '');
        setPhase('register');
      } else {
        handleSuccess(data);
      }
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error || '로그인에 실패했습니다.';
      setError(msg);
      setTimeout(() => navigate('/login', { replace: true }), 5000);
    },
  });

  const registerMutation = useMutation({
    mutationFn: (body: { tempToken: string; role: string; name: string; email: string; phone: string }) =>
      api.post('/auth/complete-registration', body).then((r) => r.data),
    onSuccess: handleSuccess,
    onError: (err: any) => setError(err.response?.data?.error || '가입에 실패했습니다.'),
  });

  // StrictMode 이중 실행 방지 — code는 1회용이므로 교환은 한 번만 실행
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!code) {
      navigate('/login', { replace: true });
      return;
    }

    const savedState = sessionStorage.getItem(`${provider}_state`);
    if (savedState && state !== savedState) {
      setError('보안 검증에 실패했습니다.');
      setTimeout(() => navigate('/login', { replace: true }), 2000);
      return;
    }
    sessionStorage.removeItem(`${provider}_state`);

    const redirectUri = `${window.location.origin}/auth/${provider}/callback`;
    oauthMutation.mutate({ code, redirectUri });
  }, []);

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('이름을 입력해주세요.');
    if (!email.trim()) return setError('이메일을 입력해주세요.');
    if (!/^01[0-9]-?\d{3,4}-?\d{4}$/.test(phone.trim())) return setError('올바른 휴대폰 번호를 입력해주세요. (예: 010-1234-5678)');
    registerMutation.mutate({ tempToken, role, name: name.trim(), email: email.trim(), phone: phone.trim() });
  };

  if (phase === 'loading') {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center gap-3">
        {error ? (
          <p className="text-red-500 text-sm">{error}</p>
        ) : (
          <>
            <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
            <p className="text-sm text-gray-500">로그인 처리 중...</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-serif text-center mb-1">회원 정보 입력</h1>
        <p className="text-sm text-gray-400 text-center mb-8">가입을 완료해주세요</p>

        {profile.avatar && (
          <div className="flex justify-center mb-5">
            <img src={profile.avatar} alt="" className="w-16 h-16 rounded-full object-cover" />
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">이름</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-11 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
              required
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={profile.email ? '' : '이메일을 입력해주세요'}
              className="w-full h-11 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
              required
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">휴대폰 번호</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="010-1234-5678"
              className="w-full h-11 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
              required
            />
          </div>

          <div className="pt-1">
            <p className="text-xs text-gray-500 mb-2">역할 선택</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'ARTIST' as const, label: '아티스트', desc: '포트폴리오 · 공모 지원' },
                { value: 'GALLERY' as const, label: '갤러리', desc: '갤러리 · 공모 운영' },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRole(opt.value)}
                  className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                    role === opt.value
                      ? 'border-gray-900 bg-gray-50'
                      : 'border-gray-200 hover:border-gray-400'
                  }`}
                >
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={registerMutation.isPending}
            className="w-full h-11 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 cursor-pointer transition-colors"
          >
            {registerMutation.isPending ? '처리 중...' : '가입 완료'}
          </button>
        </form>
      </div>
    </div>
  );
}
