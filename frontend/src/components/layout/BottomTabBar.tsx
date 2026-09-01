import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { NAV_LINKS } from '@/lib/navLinks';

/**
 * 모바일 전용 하단 고정 탭바 (catch 앱 방식).
 * 상단 가운데 5메뉴(홈/갤러리/전시/모집공고/커뮤니티)를 아래로 내렸다 —
 * 좁은 화면에서 엄지로 닿는 자리에 두는 게 이동에 제일 빠르다.
 *
 * · lg↑ 에서는 숨긴다(상단 네비 유지) → `lg:hidden`.
 * · Layout 이 본문 `pb` 로 이 바 높이만큼 비워둔다(안 그러면 푸터를 가린다).
 */
export default function BottomTabBar() {
  const { pathname } = useLocation();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 lg:hidden border-t border-gray-100 bg-white/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
      aria-label="하단 내비게이션"
    >
      <div className="mx-auto flex max-w-lg">
        {NAV_LINKS.map(({ path, label, icon: Icon }) => {
          const active = pathname === path;
          return (
            <Link
              key={path}
              to={path}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 transition-colors',
                active ? 'text-gray-900' : 'text-gray-400 hover:text-gray-700',
              )}
            >
              <Icon size={20} className={active ? 'stroke-[2.25]' : ''} />
              <span className="text-[10px] font-medium leading-none">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
