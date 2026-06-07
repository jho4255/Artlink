import { Routes, Route } from 'react-router-dom';
import Layout from '@/components/layout/Layout';
import HomePage from '@/pages/HomePage';
import GalleriesPage from '@/pages/GalleriesPage';
import GalleryDetailPage from '@/pages/GalleryDetailPage';
import ExhibitionsPage from '@/pages/ExhibitionsPage';
import ExhibitionDetailPage from '@/pages/ExhibitionDetailPage';
import ShowsPage from '@/pages/ShowsPage';
import ShowDetailPage from '@/pages/ShowDetailPage';
import PortfolioPage from '@/pages/PortfolioPage';
import BenefitsPage from '@/pages/BenefitsPage';
import MyPage from '@/pages/MyPage';
import LoginPage from '@/pages/LoginPage';
import ProtectedRoute from '@/components/shared/ProtectedRoute';
import SupportPage from '@/pages/SupportPage';
import ExplorePage from '@/pages/ExplorePage';
import MessagesPage from '@/pages/MessagesPage';
import NotFoundPage from '@/pages/NotFoundPage';
import AuthCallbackPage from '@/pages/AuthCallbackPage';
import InstagramCallbackPage from '@/pages/InstagramCallbackPage';
import PrivacyPage from '@/pages/PrivacyPage';
import OperationPage from '@/pages/OperationPage';
import OperationPrintPage from '@/pages/OperationPrintPage';

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
        <Route path="/exhibitions/:id/operation" element={
          <ProtectedRoute><OperationPage /></ProtectedRoute>
        } />
        <Route path="/shows" element={<ShowsPage />} />
        <Route path="/shows/:id" element={<ShowDetailPage />} />
        <Route path="/portfolio/:userId" element={<PortfolioPage />} />
        <Route path="/benefits" element={<BenefitsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/kakao/callback" element={<AuthCallbackPage provider="kakao" />} />
        <Route path="/auth/instagram/callback" element={<InstagramCallbackPage />} />
        <Route path="/messages" element={
          <ProtectedRoute><MessagesPage /></ProtectedRoute>
        } />
        <Route path="/mypage" element={
          <ProtectedRoute><MyPage /></ProtectedRoute>
        } />
        <Route path="/support" element={
          <ProtectedRoute><SupportPage /></ProtectedRoute>
        } />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      {/* 인쇄 전용 (레이아웃 없음) */}
      <Route path="/exhibitions/:id/operation/print/:userId/:doc" element={
        <ProtectedRoute><OperationPrintPage /></ProtectedRoute>
      } />
    </Routes>
  );
}
