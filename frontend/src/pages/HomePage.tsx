import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import HeroSlider from '@/components/home/HeroSlider';
import QuickActionCards from '@/components/home/QuickActionCards';
import GalleryOfMonthSection from '@/components/home/GalleryOfMonth';

// 홈페이지 - Hero, Catchphrase, Quick Actions, Gallery of Month
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
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* 히어로 슬라이더 */}
      <HeroSlider />

      {/* 센터 캐치프레이즈 */}
      <section className="py-12 md:py-16 text-center px-4">
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="text-lg md:text-2xl font-light text-gray-800 tracking-wide font-serif"
        >
          갤러리와 아티스트를 잇다 : <span className="font-bold">ArtLink</span>
        </motion.p>
      </section>

      {/* 퀵 액션 카드 */}
      <section className="pb-12 px-4">
        <QuickActionCards />
      </section>

      {/* 이달의 갤러리 */}
      <GalleryOfMonthSection />

      {/* 푸터 — 회사 정보 (/terms/company-info.txt에서 로드) */}
      <footer className="border-t border-gray-100 bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 py-8">
          {companyInfo.length > 0 ? (
            <div className="space-y-1 text-xs text-gray-400 leading-relaxed">
              {/* 첫 줄: 회사명 */}
              <p className="text-sm font-medium text-gray-500">{companyInfo[0]}</p>
              {/* 중간: 정보 항목들 */}
              {companyInfo.slice(1, -1).map((line, i) => (
                <p key={i}>{line}</p>
              ))}
              {/* 마지막 줄: 면책 고지 */}
              {companyInfo.length > 1 && (
                <p className="mt-3 pt-3 border-t border-gray-200 text-gray-400">
                  {companyInfo[companyInfo.length - 1]}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center">&copy; 2026 ArtLink. All rights reserved.</p>
          )}
        </div>
      </footer>
    </motion.div>
  );
}
