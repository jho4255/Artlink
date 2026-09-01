import HeroSlider from '@/components/home/HeroSlider';
import GalleryOfMonthSection from '@/components/home/GalleryOfMonth';
import ArtWorks from '@/components/home/ArtWorks';
import PopularPosts from '@/components/home/PopularPosts';
import OngoingShows from '@/components/home/OngoingShows';
import ClosingSoonExhibitions from '@/components/home/ClosingSoonExhibitions';

/**
 * 홈 구성 (2026-08-29 개편)
 *   ArtWorks → 배너(풀블리드 색 띠) → [1행: 좌 인기글 / 우 진행중인 전시]
 *                                   → [2행: 좌 마감임박 공모 / 우 주목할 갤러리, 1:1]
 *
 * - 최상단은 **작품**(ArtWorks). 배너는 그 아래.
 * - 배너는 화면 전체 폭의 색 띠(HeroSlider). 그 아래 두 줄로 네 블록을 배치.
 *
 * ⚠️ 본문 컨테이너는 다른 페이지와 같은 `max-w-7xl mx-auto px-6 md:px-12` 한 겹.
 */
export default function HomePage() {
  return (
    <div>
      {/* ArtWorks — 작가들의 작품 (최상단) */}
      <section className="max-w-7xl mx-auto px-6 md:px-12 py-10 md:py-16">
        <ArtWorks />
      </section>

      {/* 배너 — 풀블리드 색 띠, 슬라이딩 전환 (HeroSlider). 플립은 롤백함(2026-08-29). */}
      <div className="border-y border-gray-200">
        <HeroSlider />
      </div>

      <section className="max-w-7xl mx-auto px-6 md:px-12 py-12 md:py-16 space-y-12 md:space-y-14">
        {/* 1행 — 좌: 인기글 / 우: 진행중인 전시 (1:1, 아래 줄과 열 맞춤) */}
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-12">
          <div className="min-w-0"><PopularPosts /></div>
          <aside className="min-w-0"><OngoingShows /></aside>
        </div>

        {/* 2행 — 좌: 마감임박 공모 / 우: 주목할 갤러리 (1:1) */}
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-12">
          <div className="min-w-0"><ClosingSoonExhibitions /></div>
          <div className="min-w-0"><GalleryOfMonthSection variant="rail" /></div>
        </div>
      </section>
    </div>
  );
}
