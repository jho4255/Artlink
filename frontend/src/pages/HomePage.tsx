import HeroSlider from '@/components/home/HeroSlider';
import GalleryOfMonthSection from '@/components/home/GalleryOfMonth';
import ArtWorks from '@/components/home/ArtWorks';
import PopularPosts from '@/components/home/PopularPosts';
import OngoingShows from '@/components/home/OngoingShows';
import ClosingSoonExhibitions from '@/components/home/ClosingSoonExhibitions';

/**
 * 홈 구성 (2026-09-05 개편)
 *   배너(풀블리드 색 띠) → ArtWorks → [1행: 좌 인기글 / 우 진행중인 전시]
 *                                   → [2행: 좌 마감임박 공모 / 우 주목할 갤러리, 1:1]
 *
 * - 최상단은 **배너**(HeroSlider), 그 아래가 작품(ArtWorks).
 *   ⚠️ 2026-08-27~09-04 는 반대 순서였다(작품이 위). 되돌릴 땐 두 블록만 맞바꾸면 된다.
 * - 배너는 화면 전체 폭의 색 띠. 그 아래 두 줄로 네 블록을 배치.
 *
 * ⚠️ 본문 컨테이너는 다른 페이지와 같은 `max-w-7xl mx-auto px-6 md:px-12` 한 겹.
 */
export default function HomePage() {
  return (
    <div>
      {/* 배너 — 풀블리드 색 띠, 슬라이딩 전환 (HeroSlider). 플립은 롤백함(2026-08-29).
          ⚠️ 맨 위라 위쪽 테두리는 두지 않는다 — Navbar 가 이미 border-b 를 갖고 있어 선이 두 줄로 보인다. */}
      <div data-testid="home-hero" className="border-b border-gray-200">
        <HeroSlider />
      </div>

      {/* ArtWorks — 작가들의 작품 */}
      <section className="max-w-7xl mx-auto px-6 md:px-12 py-10 md:py-16">
        <ArtWorks />
      </section>

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
