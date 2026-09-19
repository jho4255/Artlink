import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { setPostLoginRedirect } from '@/lib/postLoginRedirect';

interface Props {
  children: React.ReactNode;
  roles?: string[];
}

// 인증 보호 라우트 - 미인증 시 로그인 페이지로 리다이렉트
export default function ProtectedRoute({ children, roles }: Props) {
  const { isAuthenticated, user } = useAuthStore();
  const location = useLocation();

  if (!isAuthenticated) {
    // 알림·공유 링크로 들어온 사람이 로그인 뒤 그 자리로 돌아오게(2026-09-19). 그 전엔 로그인하면 마이페이지로 떨어졌다.
    setPostLoginRedirect(location.pathname + location.search);
    return <Navigate to="/login" replace />;
  }

  if (roles && user && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
