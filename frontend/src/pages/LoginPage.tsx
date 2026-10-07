import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { resolvePostLoginPath } from '@/lib/postLoginRedirect';
import { armHomepageNudge } from '@/lib/homepageNudge';
import KakaoLoginButton from '@/components/shared/KakaoLoginButton';
import { roleLabel } from '@/lib/utils';
import { authErrorMessage, looksLikeEmail, recalledEmailLogin, rememberEmailLogin } from '@/lib/emailAuth';
import { clearSignupRole } from '@/lib/signupRole';

/**
 * 로그인 페이지 — **역할을 묻지 않는다**(2026-10-08 사용자 결정). 가입했던 계정 그대로 로그인된다.
 * - [카카오로 로그인] → state(CSRF) 생성·저장 → 카카오 인증 페이지로 이동 → /auth/kakao/callback 처리
 *   (`KakaoLoginButton` → `lib/kakaoLogin.ts startKakaoLogin` — state 를 탭과 브라우저 양쪽에 적는다. 돌아오는 화면이 다른 탭일 수 있다)
 *   카카오 계정으로 아직 가입하지 않았으면 콜백이 '회원 정보 입력'(가입)을 연다 — 지금까지와 같다.
 * - 이메일 로그인 — 이메일로 가입한 계정(역할 무관). 이 브라우저에서 이메일로 로그인한 적이 있으면 주소를 채워 둔다. [비밀번호 찾기].
 * - [회원가입] — 따로 둔다(`/signup`). 역할은 거기서 고르고 카카오/이메일로 가입한다(lib/signupRole.ts).
 *   (잠깐 '로그인 화면에서 역할 먼저' 였다가, 어느 역할이든 카카오·이메일 둘 다라 로그인에서 고를 이유가 없어 가입으로 옮겼다)
 * - 개발 모드(import.meta.env.DEV)에서만 시드 계정 빠른 로그인 버튼 노출 (백엔드도 non-production에서만 동작)
 */

interface DevUser {
  id: number; name: string; nickname?: string | null; email: string;
  role: 'ARTIST' | 'GALLERY' | 'ADMIN' | 'VISITOR'; workCount: number;
}

/**
 * 빠른 로그인 버튼.
 *
 * ⚠️ 여기 적힌 이메일은 **시드 DB(artlink)에만** 있다. 실서버 복제본(artlink_prod)을 붙여 확인할 땐
 * 이 계정들이 없어서 전부 "해당 이메일의 계정이 없습니다"로 죽는다 — 실제로 그래서 로그인이 막혔다.
 * 그래서 404가 나면 같은 역할의 실제 계정으로 자동 대체한다(`role` 필드가 그 용도).
 */
const DEV_ACCOUNTS = [
  { email: 'admin@artlink.com', label: 'Admin', desc: '승인 · 운영', role: 'ADMIN' as const },
  { email: 'gallery@artlink.com', label: 'Gallery', desc: '갤러리 · 공모', role: 'GALLERY' as const },
  { email: 'artist1@artlink.com', label: 'Artist 1', desc: '포트폴리오 · 지원', role: 'ARTIST' as const },
  { email: 'artist2@artlink.com', label: 'Artist 2', desc: '포트폴리오 · 지원', role: 'ARTIST' as const },
  // 일반(VISITOR) — 작가도 갤러리도 아닌 사람이 보는 화면 확인용(2026-09-16). 지원·등록·리뷰는 서버가 막는다.
  { email: 'visitor@artlink.com', label: '일반', desc: '감상 · 찜 · 메시지', role: 'VISITOR' as const },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const login = useAuthStore((s) => s.login);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  // 로그인한 채로 /login 에 오면 로그인 화면이 그대로 떴다(2026-09-19)
  useEffect(() => { if (isAuthenticated) navigate('/mypage', { replace: true }); }, [isAuthenticated, navigate]);

  const enter = async (data: any) => {
    clearSignupRole();   // 가입하러 갔다 그만두고 로그인했다 — 적어 둔 가입 역할은 버린다(lib/signupRole.ts)
    queryClient.clear();
    login(data.token, data.user);
    // 로그인 전에 온 곳(예: 공모 지원)이 있으면 그리로 복귀, 없으면 마이페이지.
    // 작품이 0점인 작가는 홈페이지 편집(온보딩)으로 — 프로필 폼이 아니라 업로드가 첫 행동이어야 한다.
    const path = await resolvePostLoginPath(data.user?.role, () => api.get('/portfolio').then((r) => r.data));
    // 홈페이지에 빈 곳이 있는 작가에게 팝업을 예약한다 — 갈 곳을 정한 뒤에 켜야 중간 화면에서 번쩍이지 않는다(lib/homepageNudge.ts)
    armHomepageNudge(data.user);
    navigate(path, { replace: true });
  };

  // ── 이메일 로그인 ──
  const [loginEmail, setLoginEmail] = useState(() => recalledEmailLogin());
  const [loginPw, setLoginPw] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (!looksLikeEmail(loginEmail)) return setLoginError('이메일 주소를 확인해 주세요.');
    if (!loginPw) return setLoginError('비밀번호를 입력해 주세요.');
    setLoggingIn(true);
    try {
      const { data } = await api.post('/auth/login', { email: loginEmail.trim(), password: loginPw });
      rememberEmailLogin(data.user.email);
      await enter(data);
    } catch (err: any) {
      setLoginError(err.response?.status === 401
        ? '이메일 또는 비밀번호가 맞지 않아요. 카카오로 가입했다면 [카카오로 로그인]을 눌러 주세요.'
        : authErrorMessage(err, '로그인하지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally {
      setLoggingIn(false);
    }
  };

  const handleDevLogin = async (email: string) => {
    try {
      const { data } = await api.post('/auth/dev-login', { email });
      enter(data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || '개발자 로그인에 실패했습니다.');
    }
  };

  /**
   * 빠른 로그인 — 시드 계정이 없으면(실서버 복제본을 붙인 경우) 같은 역할의 실제 계정으로 대체한다.
   * 대체했을 땐 누구로 들어갔는지 반드시 알려준다. 모르고 쓰면 "왜 내 데이터가 아니지"로 헤맨다.
   */
  const handleQuickLogin = async (acc: (typeof DEV_ACCOUNTS)[number], index: number) => {
    try {
      const { data } = await api.post('/auth/dev-login', { email: acc.email });
      enter(data);
      return;
    } catch (err: any) {
      if (err.response?.status !== 404) {
        toast.error(err.response?.data?.error || '개발자 로그인에 실패했습니다.');
        return;
      }
    }
    try {
      const { data: users } = await api.get('/auth/dev-users', { params: { role: acc.role } });
      // Artist 1/2 는 서로 다른 계정이 되도록 목록에서 순서대로 고른다
      const pick = (users as DevUser[])[acc.label === 'Artist 2' ? 1 : 0];
      if (!pick) {
        toast.error(`${acc.role} 역할 계정이 DB에 없습니다.`);
        return;
      }
      const { data } = await api.post('/auth/dev-login', { email: pick.email });
      toast.success(`시드 계정이 없어 ${pick.name}(${pick.email})으로 로그인했습니다.`, { duration: 4000 });
      enter(data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || '개발자 로그인에 실패했습니다.');
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-medium mb-2 font-serif">ArtLink 로그인</h1>
        <p className="text-sm text-gray-400 mb-10">갤러리와 아티스트를 잇다</p>

        <KakaoLoginButton label="카카오로 로그인" />

        <div className="my-6 flex items-center gap-3 text-xs text-gray-400" aria-hidden>
          <span className="h-px flex-1 bg-gray-200" />또는<span className="h-px flex-1 bg-gray-200" />
        </div>

        {/* 이메일 로그인 — 이메일로 가입한 계정(역할 무관, 2026-10-08) */}
        <form onSubmit={handleEmailLogin} className="space-y-2 text-left" aria-label="이메일 로그인" noValidate>
          <input
            type="email"
            inputMode="email"
            autoComplete="username"
            aria-label="이메일"
            placeholder="이메일"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
            className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
          />
          <input
            type="password"
            autoComplete="current-password"
            aria-label="비밀번호"
            placeholder="비밀번호"
            value={loginPw}
            onChange={(e) => setLoginPw(e.target.value)}
            className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
          />
          {loginError && <p role="alert" className="break-keep text-sm text-accent">{loginError}</p>}
          <button
            type="submit"
            disabled={loggingIn}
            className="h-11 w-full cursor-pointer rounded-lg bg-gray-900 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
          >{loggingIn ? '로그인 중…' : '이메일로 로그인'}</button>
          <div className="pt-1 text-right text-xs text-gray-500">
            <Link to="/password/reset" className="underline-offset-2 hover:text-gray-900 hover:underline">비밀번호 찾기</Link>
          </div>
        </form>

        {/* 회원가입은 따로 — 역할은 가입 화면에서 고른다(lib/signupRole.ts) */}
        <div className="mt-8 border-t border-gray-100 pt-6">
          <p className="mb-2 text-sm text-gray-500">아직 회원이 아니신가요?</p>
          <Link
            to="/signup"
            className="flex h-12 w-full items-center justify-center rounded-lg border border-gray-300 text-sm font-semibold text-gray-800 transition-colors hover:border-gray-900"
          >회원가입</Link>
        </div>

        {import.meta.env.DEV && (
          <div className="mt-10 pt-6 border-t border-dashed border-gray-200 text-left">
            <p className="text-xs font-medium text-gray-400 mb-3 text-center">개발자 로그인 (로컬 전용)</p>
            <div className="grid grid-cols-2 gap-2">
              {DEV_ACCOUNTS.map((acc, i) => (
                <button
                  key={acc.email}
                  onClick={() => handleQuickLogin(acc, i)}
                  className="p-3 rounded-lg border border-gray-200 hover:border-gray-900 transition-colors text-left cursor-pointer"
                >
                  <div className="text-sm font-medium text-gray-900">{acc.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{acc.desc}</div>
                </button>
              ))}
            </div>
            <DevAccountPicker onPick={handleDevLogin} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 개발자 로그인 — DB에 있는 아무 계정이나 골라 로그인 (로컬 전용).
 *
 * 실서버 DB 복제본으로 화면을 확인할 때 시드 4계정만으로는 아무것도 볼 수 없다.
 * 백엔드 `/auth/dev-users`는 dev-login과 동일한 이중 차단(production 차단 + ENABLE_DEV_LOGIN 옵트인)이 걸려 있다.
 */
function DevAccountPicker({ onPick }: { onPick: (email: string) => void }) {
  const [q, setQ] = useState('');
  const [role, setRole] = useState<DevUser['role'] | ''>('ARTIST');
  const [users, setUsers] = useState<DevUser[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  // 실패를 빈 목록으로 삼키면 "계정이 없습니다"로 보인다 — 실제로는 429(요청 제한)인데도.
  // `/api/auth` 는 15분에 30회 제한이라 이것저것 눌러보다 보면 실제로 걸린다.
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.get('/auth/dev-users', { params: { q: q.trim(), role } })
        .then((r) => { if (alive) { setUsers(r.data); setError(null); } })
        .catch((err) => {
          if (!alive) return;
          setUsers([]);
          setError(err.response?.status === 429
            ? '요청이 너무 많습니다. (로그인 API 15분 30회 제한) 잠시 후 다시 시도하세요.'
            : err.response?.data?.error || '계정 목록을 불러오지 못했습니다.');
        })
        .finally(() => { if (alive) setLoading(false); });
    }, 250); // 타이핑 중 매 글자 요청하지 않도록
    return () => { alive = false; clearTimeout(t); };
  }, [q, role, open]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 w-full py-2 text-xs text-gray-500 hover:text-gray-900 border border-dashed border-gray-200 rounded-lg cursor-pointer"
      >
        다른 계정으로 로그인 (DB에서 고르기)
      </button>
    );
  }

  return (
    <div className="mt-3 border border-gray-200 rounded-lg p-3">
      <div className="flex gap-1.5 mb-2">
        {([['ARTIST', '작가'], ['GALLERY', '갤러리'], ['VISITOR', '일반'], ['ADMIN', '관리자'], ['', '전체']] as const).map(([v, t]) => (
          <button
            key={v || 'all'}
            onClick={() => setRole(v)}
            className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors cursor-pointer ${
              role === v ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-500 hover:border-gray-400'
            }`}
          >{t}</button>
        ))}
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="이름 또는 이메일로 검색"
        className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
      />
      <div className="mt-2 max-h-64 overflow-y-auto divide-y divide-gray-100">
        {loading && <p className="text-xs text-gray-400 py-3 text-center">불러오는 중…</p>}
        {!loading && users?.length === 0 && (
          <p className={`text-xs py-3 text-center ${error ? 'text-accent' : 'text-gray-400'}`}>
            {error ?? '계정이 없습니다.'}
          </p>
        )}
        {!loading && users?.map((u) => (
          <button
            key={u.id}
            onClick={() => onPick(u.email)}
            className="w-full py-2 flex items-center gap-2 text-left hover:bg-gray-50 cursor-pointer"
          >
            {/* 검색은 '이름'으로 하는데 닉네임만 보여주면 다른 사람으로 보인다 (김윤주 → 무지깨비). 관례대로 병기 */}
            <span className="text-sm text-gray-900 truncate flex-1 min-w-0">
              {u.name}
              {u.nickname && u.nickname !== u.name && <span className="text-gray-400"> ({u.nickname})</span>}
              <span className="text-[11px] text-gray-400 ml-1.5">{roleLabel(u.role)}</span>
            </span>
            {u.role === 'ARTIST' && <span className="text-[11px] text-gray-400 flex-none">작품 {u.workCount}</span>}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-gray-300 mt-2">작품 수 많은 순 · 최대 40명</p>
    </div>
  );
}
