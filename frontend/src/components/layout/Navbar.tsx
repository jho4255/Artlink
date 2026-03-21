import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Menu, X, Bell } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import api from '@/lib/axios';

const navLinks = [
  { path: '/', label: '홈' },
  { path: '/galleries', label: '갤러리' },
  { path: '/shows', label: '전시' },
  { path: '/exhibitions', label: '모집공고' },
  { path: '/benefits', label: '혜택' },
  { path: '/mypage', label: '마이페이지' },
];

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuthStore();

  // 미읽음 알림 카운트
  const { data: unreadCount = 0 } = useQuery<number>({
    queryKey: ['unread-count'],
    queryFn: () => api.get('/notifications/unread-count').then(r => r.data.count),
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

  const handleNotifClick = (notif: any) => {
    if (!notif.read) readMutation.mutate(notif.id);
    if (notif.linkUrl) navigate(notif.linkUrl);
    setNotifOpen(false);
  };

  return (
    <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16 md:h-20">
          {/* 로고 (좌) */}
          <Link to="/" className="flex-none text-xl font-bold tracking-tight text-gray-900 font-serif">
            ArtLink
          </Link>

          {/* 데스크탑 네비게이션 (중앙) */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={cn(
                  'px-4 py-2 text-sm font-medium transition-all border-b-2',
                  location.pathname === link.path
                    ? 'text-gray-900 border-gray-900'
                    : 'text-gray-500 border-transparent hover:text-gray-900 hover:border-gray-300'
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* 우측: 알림 + 유저 정보 */}
          <div className="hidden md:flex items-center gap-3 flex-none">
            {isAuthenticated && (
              <div className="relative">
                <button
                  onClick={() => setNotifOpen(!notifOpen)}
                  className="relative p-2 hover:bg-gray-100 rounded-full transition-colors"
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
                      className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden z-50"
                    >
                      <div className="flex justify-between items-center px-4 py-3 border-b border-gray-100">
                        <span className="text-sm font-semibold text-gray-900">알림</span>
                        {unreadCount > 0 && (
                          <button
                            onClick={() => readAllMutation.mutate()}
                            className="text-xs text-blue-500 hover:text-blue-600"
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
                                !notif.read && 'bg-blue-50/50'
                              )}
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
              </div>
            )}
            {isAuthenticated && (
              <span className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded">
                {user?.name} ({user?.role})
              </span>
            )}
          </div>

          {/* 모바일: 알림 + 햄버거 */}
          <div className="flex items-center gap-1 md:hidden">
            {isAuthenticated && (
              <button
                onClick={() => setNotifOpen(!notifOpen)}
                className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100"
              >
                <Bell size={20} />
                {unreadCount > 0 && (
                  <span className="absolute top-0.5 right-0.5 min-w-[16px] h-[16px] bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
            )}
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
            >
              {isOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>
      </div>

      {/* 모바일 알림 드롭다운 */}
      <AnimatePresence>
        {notifOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden border-t border-gray-100 bg-white"
          >
            <div className="flex justify-between items-center px-4 py-3 border-b border-gray-100">
              <span className="text-sm font-semibold text-gray-900">알림</span>
              {unreadCount > 0 && (
                <button onClick={() => readAllMutation.mutate()} className="text-xs text-blue-500">전체 읽음</button>
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
                    className={cn('w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-50', !notif.read && 'bg-blue-50/50')}
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
            className="md:hidden border-t border-gray-100 bg-white"
          >
            <div className="px-4 py-2 space-y-1">
              {navLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  onClick={() => setIsOpen(false)}
                  className={cn(
                    'block px-4 py-3 text-sm font-medium rounded-lg',
                    location.pathname === link.path
                      ? 'text-gray-900 bg-gray-100'
                      : 'text-gray-500 hover:text-gray-900'
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
