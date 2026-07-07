import { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from '@/components/layout/Layout';
import HomePage from '@/pages/HomePage';
import ProtectedRoute from '@/components/shared/ProtectedRoute';

// 페이지는 지연 로딩(코드 스플리팅) — 초기 번들 축소. 셸(Layout/ProtectedRoute)과 랜딩(HomePage)은 즉시 로드.
const GalleriesPage = lazy(() => import('@/pages/GalleriesPage'));
const GalleryDetailPage = lazy(() => import('@/pages/GalleryDetailPage'));
const ExhibitionsPage = lazy(() => import('@/pages/ExhibitionsPage'));
const ExhibitionDetailPage = lazy(() => import('@/pages/ExhibitionDetailPage'));
const ShowsPage = lazy(() => import('@/pages/ShowsPage'));
const ShowDetailPage = lazy(() => import('@/pages/ShowDetailPage'));
const PortfolioPage = lazy(() => import('@/pages/PortfolioPage'));
const BenefitsPage = lazy(() => import('@/pages/BenefitsPage'));
const MyPage = lazy(() => import('@/pages/MyPage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const SupportPage = lazy(() => import('@/pages/SupportPage'));
const ExplorePage = lazy(() => import('@/pages/ExplorePage'));
const MessagesPage = lazy(() => import('@/pages/MessagesPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));
const AuthCallbackPage = lazy(() => import('@/pages/AuthCallbackPage'));
const PrivacyPage = lazy(() => import('@/pages/PrivacyPage'));
const TermsPage = lazy(() => import('@/pages/TermsPage'));
const OperationPage = lazy(() => import('@/pages/OperationPage'));
const OperationClassicPage = lazy(() => import('@/pages/OperationClassicPage'));
const OperationPrintPage = lazy(() => import('@/pages/OperationPrintPage'));
const ApplicantsPage = lazy(() => import('@/pages/ApplicantsPage'));

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
        <Route path="/galleries/:id" element={<GalleryDetailPage />} />
        <Route path="/exhibitions" element={<ExhibitionsPage />} />
        <Route path="/exhibitions/:id" element={<ExhibitionDetailPage />} />
        <Route path="/exhibitions/:id/operation/new" element={
          <ProtectedRoute><OperationPage /></ProtectedRoute>
        } />
        <Route path="/exhibitions/:id/operation" element={
          <ProtectedRoute><OperationClassicPage /></ProtectedRoute>
        } />
        <Route path="/exhibitions/:id/applicants" element={
          <ProtectedRoute><ApplicantsPage /></ProtectedRoute>
        } />
        <Route path="/shows" element={<ShowsPage />} />
        <Route path="/shows/:id" element={<ShowDetailPage />} />
        <Route path="/portfolio/:userId" element={<PortfolioPage />} />
        <Route path="/benefits" element={<BenefitsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/kakao/callback" element={<AuthCallbackPage provider="kakao" />} />
        <Route path="/messages" element={
          <ProtectedRoute><MessagesPage /></ProtectedRoute>
        } />
        <Route path="/mypage" element={
          <ProtectedRoute><MyPage /></ProtectedRoute>
        } />
        {/* 공개 FAQ 조회 가능 — 1:1 문의 탭은 SupportPage 내부에서 로그인 게이팅 */}
        <Route path="/support" element={<SupportPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      {/* 인쇄 전용 (레이아웃 없음) */}
      <Route path="/exhibitions/:id/operation/print/:userId/:doc" element={
        <ProtectedRoute>
          <Suspense fallback={<RouteFallback />}>
            <OperationPrintPage />
          </Suspense>
        </ProtectedRoute>
      } />
    </Routes>
  );
}
