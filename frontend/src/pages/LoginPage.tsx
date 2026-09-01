import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { consumePostLoginRedirect } from '@/lib/postLoginRedirect';

/**
 * 로그인 페이지
 * - "카카오로 시작하기" → state(CSRF) 생성·저장 → 카카오 인증 페이지로 이동 → /auth/kakao/callback 처리
 * - 개발 모드(import.meta.env.DEV)에서만 시드 계정 빠른 로그인 버튼 노출 (백엔드도 non-production에서만 동작)
 */
const KAKAO_CLIENT_ID = import.meta.env.VITE_KAKAO_CLIENT_ID as string;

interface DevUser {
  id: number; name: string; nickname?: string | null; email: string;
  role: 'ARTIST' | 'GALLERY' | 'ADMIN'; workCount: number;
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
];

export default function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const login = useAuthStore((s) => s.login);

  const handleKakaoLogin = () => {
    const state = crypto.randomUUID();
    sessionStorage.setItem('kakao_state', state);
    const redirectUri = `${window.location.origin}/auth/kakao/callback`;
    window.location.href = `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_CLIENT_ID}`
      + `&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;
  };

  const enter = (data: any) => {
    queryClient.clear();
    login(data.token, data.user);
    // 로그인 전에 온 곳(예: 공모 지원)이 있으면 그리로 복귀, 없으면 마이페이지
    navigate(consumePostLoginRedirect() || '/mypage', { replace: true });
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
  const [role, setRole] = useState<'ARTIST' | 'GALLERY' | 'ADMIN' | ''>('ARTIST');
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
        {([['ARTIST', '작가'], ['GALLERY', '갤러리'], ['ADMIN', '관리자'], ['', '전체']] as const).map(([v, t]) => (
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
          <p className={`text-xs py-3 text-center ${error ? 'text-red-500' : 'text-gray-400'}`}>
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
              <span className="text-[11px] text-gray-400 ml-1.5">{u.role === 'ARTIST' ? '작가' : u.role === 'GALLERY' ? '갤러리' : '관리자'}</span>
            </span>
            {u.role === 'ARTIST' && <span className="text-[11px] text-gray-400 flex-none">작품 {u.workCount}</span>}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-gray-300 mt-2">작품 수 많은 순 · 최대 40명</p>
    </div>
  );
}
