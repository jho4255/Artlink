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
      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 md:px-12 py-8">
          {companyInfo.length > 0 ? (
            <div className="space-y-2 text-base text-gray-400 leading-relaxed">
              <p className="text-lg text-gray-500">{companyInfo[0]}</p>
              {companyInfo.slice(1, -1).map((line, i) => (
                <p key={i}>{line}</p>
              ))}
              {companyInfo.length > 1 && (
                <p className="mt-3 pt-3 border-t border-gray-200 text-gray-400">
                  {companyInfo[companyInfo.length - 1]}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-400">&copy; 2026 ArtLink. All rights reserved.</p>
          )}
        </div>
      </footer>
    </div>
  );
}
