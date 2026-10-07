import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { resolvePostLoginPath } from '@/lib/postLoginRedirect';
import { armHomepageNudge } from '@/lib/homepageNudge';
import { authErrorMessage, passwordProblem, rememberEmailLogin } from '@/lib/emailAuth';
import EmailVerifyField from '@/components/shared/EmailVerifyField';

/**
 * 비밀번호 찾기 `/password/reset` (2026-10-08) — 이메일로 가입한 계정만(역할 무관). 가입 때와 같은 인증번호 메일로 확인하고 새 비밀번호를 정한다.
 * 없으면 비밀번호를 잊은 사람이 들어올 길이 없다(1:1 문의도 로그인이 필요하다).
 * 카카오로 가입한 계정은 서버가 "카카오로 로그인해 주세요" 라고 답한다(인증번호를 보내지 않는다).
 * 바꾸면 바로 로그인된다.
 */
export default function PasswordResetPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const login = useAuthStore((s) => s.login);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [verified, setVerified] = useState<{ email: string; token: string } | null>(null);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const finished = useRef(false);

  useEffect(() => {
    if (isAuthenticated && !finished.current) navigate('/mypage', { replace: true });
  }, [isAuthenticated, navigate]);

  const reset = useMutation({
    mutationFn: (body: { verificationToken: string; password: string }) => api.post('/auth/password/reset', body).then((r) => r.data),
    onSuccess: async (data: { token: string; user: any }) => {
      finished.current = true;
      rememberEmailLogin(data.user.email);
      queryClient.clear();
      login(data.token, data.user);
      toast.success('비밀번호를 바꿨어요.');
      const path = await resolvePostLoginPath(data.user?.role, () => api.get('/portfolio').then((r) => r.data));
      armHomepageNudge(data.user);
      navigate(path, { replace: true });
    },
    onError: (err: any) => {
      const msg = authErrorMessage(err, '바꾸지 못했어요. 잠시 후 다시 시도해 주세요.');
      setError(msg);
      if (/인증번호를 다시 받아/.test(msg)) setVerified(null);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!verified) return setError('이메일 인증을 먼저 해 주세요.');
    const pwProblem = passwordProblem(password);
    if (pwProblem) return setError(pwProblem);
    if (password !== password2) return setError('비밀번호 확인이 달라요. 같은 비밀번호를 한 번 더 넣어 주세요.');
    reset.mutate({ verificationToken: verified.token, password });
  };

  const inputCls = 'w-full h-11 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-gray-400';
  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center font-serif text-2xl">비밀번호 찾기</h1>
        <p className="mb-8 break-keep text-center text-sm text-gray-400">이메일로 가입한 계정의 비밀번호를 새로 정해요</p>

        <form onSubmit={submit} className="space-y-3" noValidate>
          <EmailVerifyField
            purpose="reset"
            verified={verified?.email ?? null}
            onVerified={(email, token) => { setVerified({ email, token }); setError(''); }}
            onReset={() => setVerified(null)}
          />
          <div>
            <label htmlFor="pr-password" className="mb-1 block text-xs text-gray-500">새 비밀번호</label>
            <input id="pr-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
            <p className="mt-1 text-xs text-gray-400">8자 이상, 영문과 숫자를 함께</p>
          </div>
          <div>
            <label htmlFor="pr-password2" className="mb-1 block text-xs text-gray-500">새 비밀번호 확인</label>
            <input id="pr-password2" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} className={inputCls} />
          </div>

          {error && <p role="alert" className="break-keep text-sm text-accent">{error}</p>}

          <button
            type="submit"
            disabled={reset.isPending}
            className="h-11 w-full cursor-pointer rounded-lg bg-gray-900 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
          >
            {reset.isPending ? '바꾸는 중…' : '비밀번호 바꾸기'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs leading-relaxed text-gray-400">
          카카오로 가입했다면 <Link to="/login" className="text-gray-700 underline underline-offset-2">로그인 화면</Link>에서 카카오로 로그인해요.
        </p>
      </div>
    </div>
  );
}
