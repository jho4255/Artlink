import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { peekPostLoginRedirect } from '@/lib/postLoginRedirect';
import { contextSignupRole, stashSignupRole, type SignupRole } from '@/lib/signupRole';
import KakaoLoginButton from '@/components/shared/KakaoLoginButton';
import RoleChoice from '@/components/shared/RoleChoice';

/**
 * 회원가입 `/signup` (2026-10-08 사용자 결정) — 로그인 화면의 [회원가입] 버튼에서 온다.
 * 로그인은 역할을 묻지 않고(가입했던 계정 그대로), **역할은 여기서** 고른다 → [카카오로 가입하기] / [이메일로 가입하기].
 *  - 카카오: 고른 역할을 적어 두고 떠난다 → 돌아온 '회원 정보 입력'이 그 역할을 골라 둔다(lib/signupRole.ts). 이미 가입한 카카오 계정이면 그냥 로그인된다.
 *  - 이메일: `/signup/email?role=` (그 화면에서도 역할을 바꿀 수 있다).
 * 공모 지원·초대 코드로 온 길이면 아티스트를 골라 둔다(광고 → 공모 → 지원 흐름에 한 번 더 누르게 하지 않는다). 그 밖에는 고르지 않는다.
 */
export default function SignupPage() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  useEffect(() => { if (isAuthenticated) navigate('/mypage', { replace: true }); }, [isAuthenticated, navigate]);
  const [role, setRole] = useState<SignupRole | null>(() => contextSignupRole(peekPostLoginRedirect()));

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <h1 className="mb-2 font-serif text-2xl font-medium">회원가입</h1>
        <p className="mb-10 text-sm text-gray-400">갤러리와 아티스트를 잇다</p>

        <p id="signup-role-label" className="mb-2 text-sm text-gray-500">어떤 회원이신가요?</p>
        <RoleChoice value={role} onChange={setRole} labelledBy="signup-role-label" />

        {role && (
          <div className="mt-6 space-y-2">
            {/* 고른 역할을 적어 두고 떠난다 — 카카오에서 돌아온 '회원 정보 입력'이 그 역할을 골라 둔다 */}
            <KakaoLoginButton label="카카오로 가입하기" onStart={() => stashSignupRole(role)} />
            <Link
              to={`/signup/email?role=${role}`}
              className="flex h-12 w-full items-center justify-center rounded-lg border border-gray-300 text-sm font-semibold text-gray-800 transition-colors hover:border-gray-900"
            >이메일로 가입하기</Link>
          </div>
        )}

        <p className="mt-8 text-xs text-gray-400">
          이미 회원이신가요? <Link to="/login" className="text-gray-700 underline underline-offset-2">로그인</Link>
        </p>
      </div>
    </div>
  );
}
