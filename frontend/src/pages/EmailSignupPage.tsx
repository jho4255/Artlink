import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { consumePostLoginRedirect, peekPostLoginRedirect, resolvePostLoginPath } from '@/lib/postLoginRedirect';
import { armHomepageNudge } from '@/lib/homepageNudge';
import { noteGuestSignup } from '@/lib/guestActivity';
import { PHONE_RE, authErrorMessage, passwordProblem, rememberEmailLogin } from '@/lib/emailAuth';
import { clearSignupRole, contextSignupRole, isSignupRole, peekSignupRole, type SignupRole } from '@/lib/signupRole';
import EmailVerifyField from '@/components/shared/EmailVerifyField';
import SignupConsent from '@/components/shared/SignupConsent';
import RoleChoice from '@/components/shared/RoleChoice';

/**
 * 이메일 가입 `/signup/email` (2026-10-08 사용자 결정 — 카카오 말고 이메일·비밀번호로도 가입한다. 아티스트·갤러리·일반 모두).
 * 이메일 인증번호를 맞혀야 가입된다(서버 `POST /auth/email-signup` 이 인증 토큰을 확인한다).
 * 역할은 [회원가입] 화면에서 고른 것(`?role=`)이 골라져 있고 **여기서 바꿀 수 있다** — 잘못 고르고 들어와도 되돌아가지 않게.
 * 가입하면 바로 로그인된다. 갈 곳: 로그인 전에 온 곳 > 갤러리는 갤러리 등록(`/galleries/new`, 관리자가 승인할 때 가입 이메일을 본다)
 *   > 그 밖에는 로그인과 같은 규칙(작품 0점 작가는 홈페이지 편집, `resolvePostLoginPath`).
 */
export default function EmailSignupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const login = useAuthStore((s) => s.login);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [role, setRole] = useState<SignupRole | null>(() => {
    const q = searchParams.get('role');
    return isSignupRole(q) ? q : (peekSignupRole() ?? contextSignupRole(peekPostLoginRedirect()));
  });
  const [verified, setVerified] = useState<{ email: string; token: string } | null>(null);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [agree, setAgree] = useState({ agreeTerms: false, agreePrivacy: false });
  const [error, setError] = useState('');
  // 가입을 마쳐 로그인된 순간에는 아래 '이미 로그인했으면 마이페이지로' 가 끼어들지 않게
  const finished = useRef(false);

  useEffect(() => {
    if (isAuthenticated && !finished.current) navigate('/mypage', { replace: true });
  }, [isAuthenticated, navigate]);

  const signup = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/auth/email-signup', body).then((r) => r.data),
    onSuccess: async (data: { token: string; user: any }) => {
      finished.current = true;
      noteGuestSignup();   // 비회원 둘러보기 — 이 방문은 '가입'으로 끝났다(lib/guestActivity.ts)
      rememberEmailLogin(data.user.email);
      clearSignupRole();
      queryClient.clear();
      login(data.token, data.user);
      const remembered = consumePostLoginRedirect();
      const path = remembered
        ?? (data.user.role === 'GALLERY' ? '/galleries/new' : await resolvePostLoginPath(data.user.role, () => api.get('/portfolio').then((r) => r.data)));
      armHomepageNudge(data.user);
      toast.success(data.user.role === 'GALLERY' && !remembered
        ? '가입했어요. 이제 갤러리를 등록해 주세요 — 관리자가 확인하면 공모를 올릴 수 있어요.'
        : '가입했어요.', { duration: 5000 });
      navigate(path, { replace: true });
    },
    onError: (err: any) => {
      const msg = authErrorMessage(err, '가입하지 못했어요. 잠시 후 다시 시도해 주세요.');
      setError(msg);
      // 인증이 만료됐거나 이미 썼다 — 이메일 칸을 처음으로 되돌려 번호를 다시 받게 한다
      if (/인증번호를 다시 받아/.test(msg)) setVerified(null);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!role) return setError('어떤 회원인지 골라 주세요.');
    if (!verified) return setError('이메일 인증을 먼저 해 주세요.');
    const pwProblem = passwordProblem(password);
    if (pwProblem) return setError(pwProblem);
    if (password !== password2) return setError('비밀번호 확인이 달라요. 같은 비밀번호를 한 번 더 넣어 주세요.');
    if (!name.trim()) return setError('이름을 입력해 주세요.');
    if (!PHONE_RE.test(phone.trim())) return setError('올바른 휴대폰 번호를 입력해 주세요. (예: 010-1234-5678)');
    if (!agree.agreeTerms) return setError('이용약관을 끝까지 읽고 동의해 주세요.');
    if (!agree.agreePrivacy) return setError('개인정보 처리방침을 끝까지 읽고 동의해 주세요.');
    signup.mutate({ verificationToken: verified.token, role, password, name: name.trim(), phone: phone.trim(), ...agree });
  };

  const inputCls = 'w-full h-11 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-gray-400';
  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center font-serif text-2xl">이메일로 가입</h1>
        <p className="mb-8 text-center text-sm text-gray-400">인증번호로 이메일을 확인해요</p>

        <form onSubmit={submit} className="space-y-3" noValidate>
          <div>
            <p id="signup-role-label" className="mb-1.5 text-xs text-gray-500">어떤 회원이신가요?</p>
            <RoleChoice value={role} onChange={(r) => { setRole(r); setError(''); }} labelledBy="signup-role-label" />
          </div>

          <EmailVerifyField
            purpose="signup"
            verified={verified?.email ?? null}
            onVerified={(email, token) => { setVerified({ email, token }); setError(''); }}
            onReset={() => setVerified(null)}
          />

          <div>
            <label htmlFor="es-password" className="mb-1 block text-xs text-gray-500">비밀번호</label>
            <input id="es-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
            <p className="mt-1 text-xs text-gray-400">8자 이상, 영문과 숫자를 함께</p>
          </div>
          <div>
            <label htmlFor="es-password2" className="mb-1 block text-xs text-gray-500">비밀번호 확인</label>
            <input id="es-password2" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="es-name" className="mb-1 block text-xs text-gray-500">{role === 'GALLERY' ? '이름 (담당자)' : '이름'}</label>
            <input id="es-name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="es-phone" className="mb-1 block text-xs text-gray-500">휴대폰 번호</label>
            <input id="es-phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-1234-5678" className={inputCls} />
          </div>

          <SignupConsent agreeTerms={agree.agreeTerms} agreePrivacy={agree.agreePrivacy} onChange={setAgree} />

          {error && <p role="alert" className="break-keep text-sm text-accent">{error}</p>}

          <button
            type="submit"
            disabled={signup.isPending}
            className="h-11 w-full cursor-pointer rounded-lg bg-gray-900 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
          >
            {signup.isPending ? '가입하는 중…' : '가입하기'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-400">
          이미 가입했나요? <Link to="/login" className="text-gray-700 underline underline-offset-2">로그인</Link>
        </p>
      </div>
    </div>
  );
}
