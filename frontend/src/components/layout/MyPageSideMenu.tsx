import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import { MessageCircle } from 'lucide-react';
import { myPageTabs, tabHref, resolveTab, footerLinksFor, MYPAGE_PRIMARY_LINKS } from '@/lib/myPageMenu';
import { useAdminTodo, badgeCount } from '@/hooks/useAdminTodo';
import MenuBadge from '@/components/layout/MenuBadge';
import AdSlot from '@/components/shared/AdSlot';

/**
 * 전 페이지 우측 세로 메뉴 (lg 1024px 이상)
 *
 * 홈·갤러리 목록 어디에 있든 마이페이지 각 탭으로 바로 들어갈 수 있게 앱 셸에 고정한다
 * (artspoon.io 참고 — 그쪽은 좌측, 우리는 우측).
 *
 * - **로그인했을 때만** 뜬다. 비로그인에겐 갈 곳이 없다.
 * - lg 미만에서는 아예 렌더하지 않는다 → 대신 Navbar 우측 상단 [메뉴] 버튼이 같은 목록을 연다.
 * - 강조는 마이페이지에 있을 때만 한다. 홈에서까지 '프로필'이 눌린 것처럼 보이면 지금 위치를 잘못 알려준다.
 *
 * 항목 정의는 `lib/myPageMenu.ts` 하나뿐이다 — Navbar·MyPage 와 같은 것을 쓴다.
 */
export default function MyPageSideMenu() {
  const { isAuthenticated, user, logout } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const onLogout = () => {
    // 로그아웃 시 모든 캐시 제거 (다음 유저 로그인 시 stale 데이터 방지) — Navbar 와 같은 절차
    queryClient.clear();
    logout();
    navigate('/login');
  };

  const tabs = myPageTabs(user?.role);
  // 관리자 메뉴 배지(2026-11-21) — 훅이라 아래 return 위에
  const { data: todo } = useAdminTodo();
  if (!isAuthenticated || tabs.length === 0) return null;

  const onMyPage = location.pathname === '/mypage';
  const currentTab = onMyPage ? resolveTab(user?.role, searchParams.get('tab')) : null;

  return (
    <aside className="hidden lg:block w-56 shrink-0 border-l border-gray-200">
      {/* 네비바 h-20(80px) + 16px. 네비바 높이를 바꾸면 여기도 맞출 것 */}
      <nav className="sticky top-24 px-4 py-6 space-y-1">
        {/* ArtTalk 은 여기 없다 — 상단바 종 옆 말풍선 아이콘(2026-11-20 사용자 결정, Navbar) */}
        <p className="px-3 pb-2 text-[11px] font-medium tracking-widest text-gray-300 uppercase">
          My Page
        </p>
        {tabs.map((tab, i) => {
          const Icon = tab.icon;
          // [홈페이지]처럼 바깥으로 나가는 항목은 그 페이지에 있을 때 강조한다
          const active = tab.linkTo
            ? location.pathname === tab.linkTo(user!.id)
            : onMyPage && currentTab === tab.id;
          const badge = badgeCount(todo, tab.badge);
          // 묶음 머리말(관리자 메뉴, 2026-11-21) — 앞 항목과 묶음이 바뀌는 자리에
          const head = tab.group && tab.group !== tabs[i - 1]?.group
            ? <p key={`g-${tab.group}`} className="px-3 pt-4 pb-1 text-xs font-semibold text-gray-500 first:pt-0">{tab.group}</p>
            : null;
          return [head, (
            <Link
              key={tab.id}
              to={tabHref(tab, user?.id, user?.role)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors',
                active
                  ? 'bg-gray-100 text-gray-900 font-medium'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900',
              )}
            >
              <Icon size={16} className="shrink-0" />
              {/* 브랜드 이름(ArtLook)은 로고와 같은 색 규칙으로, 설명은 옆에 작게 */}
              <span className="min-w-0 truncate">
                {tab.brand
                  ? (<span className="font-bold tracking-tight font-serif">{tab.brand[0]}<span className="text-accent">{tab.brand[1]}</span></span>)
                  : <span>{tab.label}</span>}
                {tab.note && <span className="ml-1.5 text-[11px] text-gray-400 font-normal">{tab.note}</span>}
              </span>
              {badge != null && <MenuBadge count={badge} className="ml-auto" />}
            </Link>
          )];
        })}

        {/* ArtStory(소식) 등 자주 쓰는 링크 — 역할 메뉴 바로 아래, **구분선 위**(문의/로그아웃 묶음보다 위) */}
        {MYPAGE_PRIMARY_LINKS.map(l => {
          const Icon = l.icon ?? MessageCircle;
          return (
            <Link
              key={l.to}
              to={l.to}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors',
                location.pathname === l.to
                  ? 'bg-gray-100 text-gray-900 font-medium'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900',
              )}
            >
              <Icon size={16} className="shrink-0" />
              <span className="min-w-0 truncate">
                {l.brand
                  ? <span className="font-bold tracking-tight font-serif">{l.brand[0]}<span className="text-accent">{l.brand[1]}</span></span>
                  : l.label}
                {l.note && <span className="ml-1.5 text-[11px] text-gray-400 font-normal">{l.note}</span>}
              </span>
            </Link>
          );
        })}

        {/*
          로그아웃 — 메뉴 **맨 아래**에 작고 조용하게.
          예전엔 네비바 우측에 테두리 버튼으로 있었는데, 화면에서 제일 자주 보는 자리에
          '나가기'가 놓여 있을 이유가 없다. 여기 두면 필요할 때만 눈에 들어온다.
          ⚠️ lg 미만에서는 이 사이드바가 렌더되지 않는다 — 그쪽 로그아웃은 Navbar 햄버거 메뉴에 있다.
        */}
        {/* 1:1 문의 · 로그아웃 — 맨 아래 **한 줄**, 작고 조용하게(2026-11-19 사용자 결정) */}
        <div className="pt-3 mt-2 border-t border-gray-100 flex items-center justify-between">
          {footerLinksFor(user?.role).map(l => (
            <Link
              key={l.to}
              to={l.to}
              aria-current={location.pathname + location.search === l.to || location.pathname === l.to ? 'page' : undefined}
              className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-900 transition-colors"
            >
              {l.label}
            </Link>
          ))}
          <button
            onClick={onLogout}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-900 transition-colors cursor-pointer"
          >
            로그아웃
          </button>
        </div>

        {/* 광고 — 로그아웃 아래 자리(블라인드 우측 하단 배너 참고). Admin 이 [광고 관리]에서 넣는다. */}
        <AdSlot className="mt-3" />
      </nav>
    </aside>
  );
}
