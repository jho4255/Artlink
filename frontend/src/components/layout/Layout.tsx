import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';

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
        <Outlet />
      </main>
      <footer className="border-t border-gray-100 bg-white">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-4">
          {companyInfo.length > 0 ? (
            <p className="text-[11px] text-gray-300 leading-relaxed">
              {companyInfo.join(' | ')}
            </p>
          ) : (
            <p className="text-[11px] text-gray-300">&copy; 2026 ArtLink. All rights reserved.</p>
          )}
        </div>
      </footer>
    </div>
  );
}
