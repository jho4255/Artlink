import { useState, useEffect, Suspense } from 'react';
import { Outlet, Link } from 'react-router-dom';
import Navbar from './Navbar';
import ErrorBoundary from '@/components/shared/ErrorBoundary';

// 공통 레이아웃 - 모든 페이지에 Navbar + Footer 표시
export default function Layout() {
  const [companyInfo, setCompanyInfo] = useState<string[]>([]);

  useEffect(() => {
    fetch('/terms/company-info.txt')
      .then(r => {
        if (!r.ok || r.headers.get('content-type')?.includes('text/html')) throw new Error();
        return r.text();
      })
      .then(text => {
        if (!text.trimStart().startsWith('<!')) {
          setCompanyInfo(text.split('\n').filter(line => line.trim()));
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Navbar />
      <main className="flex-1">
        {/* ErrorBoundary: 배포 후 이전 청크 404 등으로 페이지 로딩 실패 시 흰 화면 대신 복구 UI */}
        <ErrorBoundary>
          <Suspense fallback={
            <div className="flex items-center justify-center py-24 text-gray-300">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-400" />
            </div>
          }>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
      <footer className="border-t border-gray-100 bg-white">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-4">
          {companyInfo.length > 0 ? (
            <div className="space-y-0.5 text-[11px] text-gray-300 leading-relaxed">
              {companyInfo.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-gray-300">&copy; 2026 ArtLink. All rights reserved.</p>
          )}
          {/* 터치 히트영역 확보(py-2) — 시각 간격은 네거티브 마진으로 유지 */}
          <div className="mt-2 flex gap-2">
            <Link to="/privacy" className="text-[11px] text-gray-300 hover:text-gray-500 py-2 -my-2 px-1.5 -ml-1.5">개인정보처리방침</Link>
            <Link to="/terms" className="text-[11px] text-gray-300 hover:text-gray-500 py-2 -my-2 px-1.5">이용약관</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
