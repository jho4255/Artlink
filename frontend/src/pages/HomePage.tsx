import { useState, useEffect } from 'react';
import HeroSlider from '@/components/home/HeroSlider';
import QuickActionCards from '@/components/home/QuickActionCards';
import GalleryOfMonthSection from '@/components/home/GalleryOfMonth';

export default function HomePage() {
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
    <div>
      {/* Hero */}
      <HeroSlider />

      {/* 퀵 내비게이션 */}
      <section className="border-t border-gray-200 px-6 md:px-12">
        <QuickActionCards />
      </section>

      {/* Gallery of the Month */}
      <section className="border-t border-gray-200 px-6 md:px-12 py-16 md:py-24">
        <div className="max-w-7xl mx-auto">
          <GalleryOfMonthSection />
        </div>
      </section>

      {/* 푸터 */}
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
