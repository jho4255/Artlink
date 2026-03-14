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

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/galleries" element={<GalleriesPage />} />
        <Route path="/galleries/:id" element={<GalleryDetailPage />} />
        <Route path="/exhibitions" element={<ExhibitionsPage />} />
        <Route path="/exhibitions/:id" element={<ExhibitionDetailPage />} />
        <Route path="/shows" element={<ShowsPage />} />
        <Route path="/shows/:id" element={<ShowDetailPage />} />
        <Route path="/portfolio/:userId" element={<PortfolioPage />} />
        <Route path="/benefits" element={<BenefitsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/mypage" element={
          <ProtectedRoute><MyPage /></ProtectedRoute>
        } />
      </Route>
    </Routes>
  );
}
