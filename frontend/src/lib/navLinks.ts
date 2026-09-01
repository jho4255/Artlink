import { Home, Building2, Image, Megaphone, MessageSquare, type LucideIcon } from 'lucide-react';

/**
 * 가운데 내비게이션 정의 — **한 곳**에서만 관리한다.
 *  · 데스크톱(lg↑): Navbar 상단 정중앙
 *  · 모바일(lg↓): 하단 고정 탭바(components/layout/BottomTabBar.tsx) — catch 앱 방식
 *
 * 여기 두는 것은 **누구나 볼 수 있고 다른 진입점이 없는 페이지**만.
 * (마이페이지는 로그인 전용이라 여기 없다 — 우측 사이드바/햄버거 안으로)
 */
export interface NavLink {
  path: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_LINKS: NavLink[] = [
  { path: '/', label: '홈', icon: Home },
  { path: '/galleries', label: '갤러리', icon: Building2 },
  { path: '/shows', label: '전시', icon: Image },
  { path: '/exhibitions', label: '모집공고', icon: Megaphone },
  { path: '/community', label: '커뮤니티', icon: MessageSquare },
];
