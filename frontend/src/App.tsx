import { Suspense, lazy, type ComponentType } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/layout/Layout';
import HomePage from '@/pages/HomePage';
import ProtectedRoute from '@/components/shared/ProtectedRoute';
import ErrorBoundary from '@/components/shared/ErrorBoundary';

// 새 배포로 청크 파일명(해시)이 바뀌면 예전 청크 import가 404 → 모바일에서 흰 화면 원인.
// 이때 한 번만 새로고침해 최신 index.html + 청크를 받게 한다(무한 새로고침 방지 가드).
function lazyWithReload<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(() =>
    factory().catch((err) => {
      const KEY = 'chunk-reload-at';
      const now = Date.now();
      const last = Number(sessionStorage.getItem(KEY) || 0);
      if (now - last > 15000) {
        sessionStorage.setItem(KEY, String(now));
        window.location.reload();
        return new Promise<{ default: T }>(() => {}); // 새로고침 동안 렌더 보류
      }
      throw err; // 재시도 후에도 실패 → ErrorBoundary가 복구 UI 표시
    }),
  );
}

// 페이지는 지연 로딩(코드 스플리팅) — 초기 번들 축소. 셸(Layout/ProtectedRoute)과 랜딩(HomePage)은 즉시 로드.
const GalleriesPage = lazyWithReload(() => import('@/pages/GalleriesPage'));
const GalleryDetailPage = lazyWithReload(() => import('@/pages/GalleryDetailPage'));
const ExhibitionsPage = lazyWithReload(() => import('@/pages/ExhibitionsPage'));
const ExhibitionDetailPage = lazyWithReload(() => import('@/pages/ExhibitionDetailPage'));
const ShowsPage = lazyWithReload(() => import('@/pages/ShowsPage'));
const ShowDetailPage = lazyWithReload(() => import('@/pages/ShowDetailPage'));
const PortfolioPage = lazyWithReload(() => import('@/pages/PortfolioPage'));
// 혜택 페이지는 당분간 비활성화 — 아래 /benefits 라우트가 홈으로 보낸다.
// 다시 켤 땐 이 import 와 라우트, Navbar navLinks, QuickActionCards 카드를 되살리면 된다.
// (Admin 마이페이지의 '혜택 관리' 탭과 백엔드 /api/benefits 는 그대로 살아 있다)
// const BenefitsPage = lazyWithReload(() => import('@/pages/BenefitsPage'));
const MyPage = lazyWithReload(() => import('@/pages/MyPage'));
const LoginPage = lazyWithReload(() => import('@/pages/LoginPage'));
const SupportPage = lazyWithReload(() => import('@/pages/SupportPage'));
const ExplorePage = lazyWithReload(() => import('@/pages/ExplorePage'));
const MessagesPage = lazyWithReload(() => import('@/pages/MessagesPage'));
const CommunityPage = lazyWithReload(() => import('@/pages/CommunityPage'));
const CommunityWritePage = lazyWithReload(() => import('@/pages/CommunityWritePage'));
const CommunityPostPage = lazyWithReload(() => import('@/pages/CommunityPostPage'));
const FeedPage = lazyWithReload(() => import('@/pages/FeedPage'));
const GalleryRegisterPage = lazyWithReload(() => import('@/pages/MyPage').then(m => ({ default: m.GalleryRegisterPage })));
const ExhibitionRegisterPage = lazyWithReload(() => import('@/pages/MyPage').then(m => ({ default: m.ExhibitionRegisterPage })));
const ShowRegisterPage = lazyWithReload(() => import('@/pages/MyPage').then(m => ({ default: m.ShowRegisterPage })));
const NotFoundPage = lazyWithReload(() => import('@/pages/NotFoundPage'));
const AuthCallbackPage = lazyWithReload(() => import('@/pages/AuthCallbackPage'));
const PrivacyPage = lazyWithReload(() => import('@/pages/PrivacyPage'));
const TermsPage = lazyWithReload(() => import('@/pages/TermsPage'));
const OperationPage = lazyWithReload(() => import('@/pages/OperationPage'));
const OperationClassicPage = lazyWithReload(() => import('@/pages/OperationClassicPage'));
const OperationPrintPage = lazyWithReload(() => import('@/pages/OperationPrintPage'));

// 인쇄 전용 라우트(레이아웃 없음)용 지연 로딩 폴백
function RouteFallback() {
  return (
    <div className="flex items-center justify-center py-24 text-gray-300">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-400" />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/explore" element={<ExplorePage />} />
        <Route path="/galleries" element={<GalleriesPage />} />
        <Route path="/galleries/new" element={<ProtectedRoute><GalleryRegisterPage /></ProtectedRoute>} />
        <Route path="/galleries/:id" element={<GalleryDetailPage />} />
        <Route path="/exhibitions" element={<ExhibitionsPage />} />
        <Route path="/exhibitions/new" element={<ProtectedRoute><ExhibitionRegisterPage /></ProtectedRoute>} />
        <Route path="/exhibitions/:id" element={<ExhibitionDetailPage />} />
        <Route path="/exhibitions/:id/operation/new" element={
          <ProtectedRoute><OperationPage /></ProtectedRoute>
        } />
        <Route path="/exhibitions/:id/operation" element={
          <ProtectedRoute><OperationClassicPage /></ProtectedRoute>
        } />
        <Route path="/shows" element={<ShowsPage />} />
        <Route path="/shows/new" element={<ProtectedRoute><ShowRegisterPage /></ProtectedRoute>} />
        <Route path="/shows/:id" element={<ShowDetailPage />} />
        <Route path="/portfolio/:userId" element={<PortfolioPage />} />
        {/* 혜택 비활성화 — 기존 링크·북마크·검색결과가 죽지 않게 404 대신 홈으로 */}
        <Route path="/benefits" element={<Navigate to="/" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/kakao/callback" element={<AuthCallbackPage provider="kakao" />} />
        {/* 대화는 역할로 막지 않는다 — 방에 들어가 있으면 누구든 쓴다(Admin 도 단톡 참여자가 될 수 있다) */}
        <Route path="/messages" element={
          <ProtectedRoute><MessagesPage /></ProtectedRoute>
        } />
        <Route path="/mypage" element={
          <ProtectedRoute><MyPage /></ProtectedRoute>
        } />
        {/* 공개 FAQ 조회 가능 — 1:1 문의 탭은 SupportPage 내부에서 로그인 게이팅 */}
        {/* 커뮤니티 — 읽기는 공개, 글쓰기/댓글은 페이지 내부에서 로그인 게이팅 */}
        <Route path="/community" element={<CommunityPage />} />
        <Route path="/community/write" element={<ProtectedRoute><CommunityWritePage /></ProtectedRoute>} />
        <Route path="/community/:id" element={<CommunityPostPage />} />
        <Route path="/feed" element={<ProtectedRoute><FeedPage /></ProtectedRoute>} />
        <Route path="/support" element={<SupportPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      {/* 인쇄 전용 (레이아웃 없음) */}
      <Route path="/exhibitions/:id/operation/print/:userId/:doc" element={
        <ProtectedRoute>
          <ErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
              <OperationPrintPage />
            </Suspense>
          </ErrorBoundary>
        </ProtectedRoute>
      } />
    </Routes>
  );
}
