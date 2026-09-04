import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { Menu, X, Bell, Mail } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import api from '@/lib/axios';
import { myPageTabs, tabHref, resolveTab, MYPAGE_PRIMARY_LINKS } from '@/lib/myPageMenu';
import { NAV_LINKS as navLinks } from '@/lib/navLinks';

// 가운데 메뉴 정의는 lib/navLinks.ts 하나뿐 — 데스크톱 상단 중앙과 모바일 하단 탭바(BottomTabBar)가 공유한다.
// 모바일에서는 이 5개(홈/갤러리/전시/모집공고/커뮤니티)가 **하단 고정 탭바**로 내려갔다(catch 앱 방식).
// 그래서 아래 모바일 [메뉴](햄버거)에는 이 목록을 넣지 않는다 — 마이페이지 탭 + 로그아웃만 둔다.

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const mobileBellRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, user, logout } = useAuthStore();
  const [searchParams] = useSearchParams();

  // lg 미만 [메뉴] 안에 들어갈 마이페이지 목록 — 사이드바와 같은 정의(lib/myPageMenu.ts)
  const myTabs = myPageTabs(user?.role);
  const myCurrentTab = resolveTab(user?.role, searchParams.get('tab'));

  const handleLogout = () => {
    // 로그아웃 시 모든 캐시 제거 (다음 유저 로그인 시 stale 데이터 방지)
    queryClient.clear();
    logout();
    setNotifOpen(false);
    setIsOpen(false);
    navigate('/login');
  };

  // 미읽음 알림 카운트
  const { data: unreadCount = 0 } = useQuery<number>({
    queryKey: ['unread-count'],
    queryFn: () => api.get('/notifications/unread-count').then(r => r.data.count),
    enabled: isAuthenticated,
    refetchInterval: 30000,
  });

  // 안 읽은 대화 수 — Admin 도 단톡에 들어갈 수 있으므로 역할로 막지 않는다
  const { data: unreadMsgCount = 0 } = useQuery<number>({
    queryKey: ['chat-unread'],
    queryFn: () => api.get('/chats/unread-count').then(r => r.data.count),
    enabled: isAuthenticated,
    refetchInterval: 30000,
  });

  // 최근 알림 목록
  const { data: notifications = [] } = useQuery<any[]>({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications?limit=10').then(r => r.data),
    enabled: isAuthenticated && notifOpen,
  });

  // 읽음 처리
  const readMutation = useMutation({
    mutationFn: (id: number) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });

  // 전체 읽음
  const readAllMutation = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });

  // 알림 드롭다운: ESC 키 + 바깥 클릭 닫기
  useEffect(() => {
    if (!notifOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNotifOpen(false);
    };
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // 모바일 벨 버튼은 notifRef 밖에 있어 예외 처리 — 재탭 시 닫힘(mousedown)→다시 열림(click) 방지
      const insideNotif = notifRef.current?.contains(target);
      const insideMobileBell = mobileBellRef.current?.contains(target);
      if (!insideNotif && !insideMobileBell) {
        setNotifOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [notifOpen]);

  const handleNotifClick = (notif: any) => {
    if (!notif.read) readMutation.mutate(notif.id);
    if (notif.linkUrl) navigate(notif.linkUrl);
    setNotifOpen(false);
  };

  return (
    <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
      {/*
        로고 왼쪽 끝이 본문 제목(홈의 ArtWorks 등)과 **정확히 맞아야** 한다.
        그러려면 네비바가 본문과 같은 기하를 써야 한다 — 두 가지를 맞춘다.
          ① 같은 컨테이너: max-w-7xl + px-6 md:px-12 (예전엔 px-4 sm:px-6 lg:px-8 이라 달랐다)
          ② 우측 사이드바 자리를 똑같이 비워둔다 — 로그인하면 본문이 224px 좁아지므로,
             안 비우면 1600px에서 로고가 본문보다 144px 오른쪽으로 밀린다(실측).
        ⚠️ 자리 비움 조건은 MyPageSideMenu 의 렌더 조건과 **반드시 같아야** 한다. 어긋나면
           로그인/로그아웃 때 로고가 좌우로 튄다.
      */}
      <div className="relative flex">
        <div className="flex-1 min-w-0">
          <div className="max-w-7xl mx-auto px-6 md:px-12">
        <div className="flex justify-between items-center h-16 lg:h-20">
          {/* 로고 (좌) */}
          {/* 로고는 홈 ArtWorks 제목보다 **확실히 커야 한다** — 회사 이름이 섹션 제목에 눌리면 안 된다.
              (로고 30/36px vs ArtWorks 20/24px, components/home/ArtWorks.tsx)
              ⚠️ lg 미만에서 네비바는 h-16(64px)뿐이다. 확대는 바가 h-20(80px)이 되는 lg 부터. */}
          <Link to="/" className="flex-none text-3xl lg:text-4xl font-bold tracking-tight text-gray-900 font-serif">
            Art<span className="text-[#dc3545]">Link</span>
          </Link>

          {/* 데스크탑 네비게이션 — 네비바 **전체 폭의 정중앙**.
              본문 컨테이너 안에서 flex 로 두면 로고와 우측 그룹의 폭 차이만큼 한쪽으로 쏠린다.
              (우측 그룹도 absolute 라 이 자리를 차지하지 않는다) */}
          <div className="hidden lg:flex items-center gap-2 absolute left-1/2 -translate-x-1/2 top-0 h-20">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={cn(
                  'px-4 py-2 text-base font-medium transition-all border-b-2',
                  location.pathname === link.path
                    ? 'text-gray-900 border-gray-900'
                    : 'text-gray-500 border-transparent hover:text-gray-900 hover:border-gray-300'
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/*
            우측: 쪽지 + 알림 + 유저 정보.
            **네비바 전체의 오른쪽 끝**에 붙인다 — `right-4`(16px)는 우측 사이드바 `nav` 의 `px-4` 와 같은 값이라
            [로그아웃] 오른쪽 끝이 사이드바 메뉴 항목의 오른쪽 끝과 정확히 맞는다.
            본문 컨테이너 안에 두면 사이드바 폭(224px)만큼 왼쪽으로 들어가 어긋난다.
          */}
          <div className="hidden lg:flex items-center gap-3 flex-none absolute right-4 top-0 h-20">
            {isAuthenticated && (
              <button
                onClick={() => navigate('/messages')}
                className="relative p-2 hover:bg-gray-100 rounded-full transition-colors"
                aria-label="대화"
              >
                <Mail size={20} className="text-gray-600" />
                {unreadMsgCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-[#c4302b] text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                    {unreadMsgCount > 99 ? '99+' : unreadMsgCount}
                  </span>
                )}
              </button>
            )}
            {isAuthenticated && (
              <div className="relative" ref={notifRef}>
                <button
                  onClick={() => setNotifOpen(!notifOpen)}
                  className="relative p-2 hover:bg-gray-100 rounded-full transition-colors"
                  aria-label="알림"
                >
                  <Bell size={20} className="text-gray-600" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>
                {/* 알림 드롭다운 */}
                <AnimatePresence>
                  {notifOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-1.5rem)] bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden z-50"
                    >
                      <div className="flex justify-between items-center px-4 py-3 border-b border-gray-100">
                        <span className="text-sm font-semibold text-gray-900">알림</span>
                        {unreadCount > 0 && (
                          <button
                            onClick={() => readAllMutation.mutate()}
                            className="text-xs text-gray-400 hover:text-gray-900"
                          >
                            전체 읽음
                          </button>
                        )}
                      </div>
                      <div className="max-h-80 overflow-y-auto">
                        {notifications.length === 0 ? (
                          <div className="text-center py-8 text-sm text-gray-400">알림이 없습니다.</div>
                        ) : (
                          notifications.map((notif: any) => (
                            <button
                              key={notif.id}
                              onClick={() => handleNotifClick(notif)}
                              className={cn(
                                'w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-50',
                                !notif.read && 'bg-gray-50'
                              )}
                            >
                              <p className="text-sm text-gray-800 line-clamp-2">{notif.message}</p>
                              <p className="text-xs text-gray-400 mt-1">
                                {new Date(notif.createdAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </button>
                          ))
                        )}
                        {/* 보관기간 고지 — 규칙을 코드에만 두지 않는다(읽은 알림은 90일 뒤 삭제된다) */}
                        {notifications.length > 0 && (
                          <p className="px-4 py-2.5 text-[11px] text-gray-400">읽은 알림은 90일 뒤 자동으로 삭제됩니다.</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
            {isAuthenticated ? (
              <>
                <span className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded">
                  {user?.name} ({user?.role})
                </span>
                {/* [마이페이지] 버튼은 없다 — 우측 세로 사이드바(MyPageSideMenu)가 각 탭으로 바로 보낸다 */}
                {/* 로그아웃은 여기 없다 — 우측 세로 사이드바 **맨 아래**로 옮겼다(MyPageSideMenu).
                    그래서 이 그룹의 마지막은 이름이고, 이름 오른쪽 끝이 사이드바 오른쪽 끝과 맞는다. */}
              </>
            ) : (
              <button
                onClick={() => navigate('/login')}
                className="px-4 py-1.5 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700 transition-colors cursor-pointer"
              >
                로그인
              </button>
            )}
          </div>

          {/* 모바일: 로그인 / 쪽지 + 알림 + 햄버거 */}
          <div className="flex items-center gap-1 lg:hidden">
            {!isAuthenticated && (
              <button
                onClick={() => navigate('/login')}
                className="px-3 min-h-[40px] mr-1 inline-flex items-center text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700 transition-colors"
              >
                로그인
              </button>
            )}
            {isAuthenticated && (
              <button
                onClick={() => navigate('/messages')}
                className="relative min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
                aria-label="대화"
              >
                <Mail size={20} />
                {unreadMsgCount > 0 && (
                  <span className="absolute top-0.5 right-0.5 min-w-[16px] h-[16px] bg-[#c4302b] text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
                    {unreadMsgCount > 99 ? '99+' : unreadMsgCount}
                  </span>
                )}
              </button>
            )}
            {isAuthenticated && (
              <button
                ref={mobileBellRef}
                onClick={() => setNotifOpen(!notifOpen)}
                className="relative min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
                aria-label="알림"
              >
                <Bell size={20} />
                {unreadCount > 0 && (
                  <span className="absolute top-0.5 right-0.5 min-w-[16px] h-[16px] bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
            )}
            {/* 햄버거는 로그인 시에만 — 안에 마이페이지 탭 + 로그아웃만 들어간다.
                비로그인은 하단 탭바로 이동하고 우측엔 [로그인] 버튼뿐이라 햄버거가 필요 없다. */}
            {isAuthenticated && (
              <button
                onClick={() => setIsOpen(!isOpen)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
                aria-label={isOpen ? '메뉴 닫기' : '메뉴 열기'}
              >
                {isOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            )}
          </div>
        </div>
          </div>
        </div>
        {/* 우측 사이드바가 차지할 폭만큼 비워둔다 (MyPageSideMenu 와 같은 조건) */}
        {isAuthenticated && myTabs.length > 0 && <div className="hidden lg:block w-56 shrink-0" aria-hidden />}
      </div>

      {/* 모바일 알림 드롭다운 */}
      <AnimatePresence>
        {notifOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="lg:hidden border-t border-gray-100 bg-white"
          >
            <div className="flex justify-between items-center px-4 py-3 border-b border-gray-100">
              <span className="text-sm font-semibold text-gray-900">알림</span>
              {unreadCount > 0 && (
                <button onClick={() => readAllMutation.mutate()} className="shrink-0 px-3 -mx-3 min-h-[44px] -my-2 inline-flex items-center text-xs text-blue-500">전체 읽음</button>
              )}
            </div>
            <div className="max-h-60 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="text-center py-6 text-sm text-gray-400">알림이 없습니다.</div>
              ) : (
                notifications.map((notif: any) => (
                  <button
                    key={notif.id}
                    onClick={() => handleNotifClick(notif)}
                    className={cn('w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-50', !notif.read && 'bg-gray-50')}
                  >
                    <p className="text-sm text-gray-800 line-clamp-2">{notif.message}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(notif.createdAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 모바일 메뉴 */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="lg:hidden border-t border-gray-100 bg-white"
          >
            <div className="px-4 py-2 space-y-1">
              {/* 홈/갤러리/전시/모집공고/커뮤니티는 모바일에서 하단 탭바(BottomTabBar)로 내려갔다.
                  여기(햄버거)에는 마이페이지 탭 + 로그아웃만 둔다. */}
              {/*
                lg 미만에서는 우측 세로 사이드바(MyPageSideMenu)가 렌더되지 않는다.
                그 목록을 **이 우측 상단 [메뉴] 버튼 안**으로 그대로 옮겨온다 — 그래야 좁은 화면에서도
                홈에서 바로 마이페이지 각 탭으로 갈 수 있다(artspoon 과 같은 방식).
                별도 버튼을 하나 더 두지 않는다 — 우측 상단에 햄버거가 둘이면 뭐가 뭔지 알 수 없다.
              */}
              {isAuthenticated && (
                <>
                  {/* ArtStory(소식) 등 마이페이지 주요 링크 — 역할 무관 */}
                  {MYPAGE_PRIMARY_LINKS.length > 0 && (
                    <div className="space-y-1">
                      {MYPAGE_PRIMARY_LINKS.map((link) => {
                        const Icon = link.icon;
                        return (
                          <Link
                            key={link.to}
                            to={link.to}
                            onClick={() => setIsOpen(false)}
                            className="flex items-center gap-2.5 px-4 py-3 text-sm font-medium rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-50"
                          >
                            {Icon && <Icon size={16} className="shrink-0" />}
                            <span className="min-w-0 truncate">
                              {link.brand
                                ? (<span className="font-bold tracking-tight font-serif">{link.brand[0]}<span className="text-[#dc3545]">{link.brand[1]}</span></span>)
                                : link.label}
                              {link.note && <span className="ml-1.5 text-[11px] text-gray-400 font-normal">{link.note}</span>}
                            </span>
                          </Link>
                        );
                      })}
                      <div className="border-t border-gray-100" />
                    </div>
                  )}
                </>
              )}
              {isAuthenticated && myTabs.length > 0 && (
                <>
                  <p className="px-4 pt-4 pb-1 mt-1 text-[11px] font-medium tracking-widest text-gray-300 uppercase border-t border-gray-100">
                    My Page
                  </p>
                  {myTabs.map(tab => {
                    const Icon = tab.icon;
                    // [홈페이지]처럼 바깥으로 나가는 항목은 그 페이지에 있을 때 강조
                    const active = tab.linkTo
                      ? location.pathname === tab.linkTo(user!.id)
                      : location.pathname === '/mypage' && myCurrentTab === tab.id;
                    return (
                      <Link
                        key={tab.id}
                        to={tabHref(tab, user?.id)}
                        onClick={() => setIsOpen(false)}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-2.5 px-4 py-3 text-sm font-medium rounded-lg',
                          active ? 'text-gray-900 bg-gray-100' : 'text-gray-500 hover:text-gray-900'
                        )}
                      >
                        <Icon size={16} className="shrink-0" />
                        <span className="min-w-0 truncate">
                          {tab.brand
                  ? (<span className="font-bold tracking-tight font-serif">{tab.brand[0]}<span className="text-[#dc3545]">{tab.brand[1]}</span></span>)
                  : tab.label}
                          {tab.note && <span className="ml-1.5 text-[11px] text-gray-400 font-normal">{tab.note}</span>}
                        </span>
                      </Link>
                    );
                  })}
                  <button
                    onClick={handleLogout}
                    className="block w-full text-left px-4 py-3 mt-1 text-sm font-medium text-gray-500 hover:text-gray-900 border-t border-gray-100"
                  >
                    로그아웃
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
