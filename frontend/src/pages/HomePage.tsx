import { motion } from 'framer-motion';
import HeroSlider from '@/components/home/HeroSlider';
import QuickActionCards from '@/components/home/QuickActionCards';
import GalleryOfMonthSection from '@/components/home/GalleryOfMonth';

// 홈페이지 - Hero, Catchphrase, Quick Actions, Gallery of Month
export default function HomePage() {
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

      {/* 푸터 */}
      <footer className="py-8 text-center text-sm text-gray-400 border-t border-gray-100">
        &copy; 2026 ArtLink. All rights reserved.
      </footer>
    </motion.div>
  );
}
