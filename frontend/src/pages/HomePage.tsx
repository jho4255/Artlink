import HeroSlider from '@/components/home/HeroSlider';
import QuickActionCards from '@/components/home/QuickActionCards';
import GalleryOfMonthSection from '@/components/home/GalleryOfMonth';

export default function HomePage() {
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
    </div>
  );
}
