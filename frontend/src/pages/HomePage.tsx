import HeroSlider from '@/components/home/HeroSlider';
import GalleryOfMonthSection from '@/components/home/GalleryOfMonth';
import ArtWorks from '@/components/home/ArtWorks';
import PopularPosts from '@/components/home/PopularPosts';
import OngoingShows from '@/components/home/OngoingShows';
import ClosingSoonExhibitions from '@/components/home/ClosingSoonExhibitions';
import HomeTabs from '@/components/home/HomeTabs';
import StoryRail from '@/components/story/StoryRail';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { HOME_TABS_MEDIA } from '@/lib/homeTabs';

/**
 * 홈 구성 (2026-09-05 개편, 2026-11-14 ArtStory 줄 추가·아래 칸 흐름 배치·휴대폰 탭)
 *
 * - **휴대폰·앱(768px 미만)**: 배너 → **탭 한 줄** [ArtWorks · ArtStory · 인기글 · 마감임박 공모] → 고른 칸 하나
 *   (`components/home/HomeTabs.tsx`, 규칙은 `lib/homeTabs.ts`). 칸이 세로로 이어져 3,225px(화면 3.8장)이던 것을 줄였다(사용자 결정).
 *   진행중인 전시·주목할 갤러리는 '일단' 탭에서 뺐다 — PC 에만 있다. ArtStory 칸은 카드 두 줄.
 * - **PC·태블릿**: 배너(풀블리드 색 띠) → ArtWorks → ArtStory 카드 줄 → 아래 칸들(2열로 흘러 채운다)
 *     [인기글 · 마감임박 공모] → [진행중인 전시 · 주목할 갤러리]
 *
 * - 최상단은 **배너**(HeroSlider), 그 아래가 작품(ArtWorks), 그 아래가 소식 줄(2026-11-19 사용자 요청 — 11-14~18 은 소식 줄이 위였다).
 *   ⚠️ 2026-08-27~09-04 는 작품이 배너보다도 위였다. 순서를 바꿀 땐 블록만 맞바꾸면 된다(휴대폰 탭 순서도 ArtWorks 가 먼저다).
 * - ⚠️⚠️ 아래 칸들은 **한 격자에 흘려 넣는다**(줄마다 짝을 못박지 않는다, 2026-11-14 사용자 지적).
 *   칸은 보여 줄 게 없으면 `null` 을 돌려주는데(진행중인 전시 0건 · 주목할 갤러리 0건 — 실서버가 그랬다),
 *   줄마다 [인기글 | 진행중인 전시] 로 묶어 두면 그 칸만 비어 **인기글 옆 반쪽이 통째로 빈다**.
 *   한 격자면 빈 칸이 아예 자리를 안 차지하고 다음 칸이 당겨 온다. 혼자 남은 마지막 칸은 두 칸 폭을 쓴다.
 *   그래서 각 칸을 div 로 감싸지 말 것 — 감싸면 null 이어도 빈 div 가 자리를 먹는다.
 * - ⚠️ 휴대폰·PC 를 CSS 로 둘 다 그려 놓고 감추지 말 것 — 칸이 두 벌 떠서 ArtWorks 가 시드 둘로 두 번 받아 온다.
 *
 * ⚠️ 본문 컨테이너는 다른 페이지와 같은 `max-w-7xl mx-auto px-6 md:px-12` 한 겹.
 */
export default function HomePage() {
  const phone = useMediaQuery(HOME_TABS_MEDIA);
  return (
    <div>
      {/* 배너 — 풀블리드 색 띠, 슬라이딩 전환 (HeroSlider). 플립은 롤백함(2026-08-29).
          ⚠️ 맨 위라 위쪽 테두리는 두지 않는다 — Navbar 가 이미 border-b 를 갖고 있어 선이 두 줄로 보인다. */}
      <div data-testid="home-hero" className="border-b border-gray-200">
        <HeroSlider />
      </div>

      {phone ? (
        <HomeTabs />
      ) : (
        <>
          {/* ArtWorks — 작가들의 작품. 배너 바로 아래(2026-11-19 사용자 요청 — 그 전엔 ArtStory 줄이 위였다) */}
          <section className="max-w-7xl mx-auto px-6 md:px-12 pt-8 md:pt-12">
            <ArtWorks />
          </section>

          {/* ArtStory — 이웃이 아니어도 모두의 소식(블라인드 스토리 방식, 2026-11-14 규칙 81). 누르면 화면 가득, 저절로 넘어간다 */}
          <div className="max-w-7xl mx-auto px-6 md:px-12 pt-10 md:pt-16">
            <StoryRail />
          </div>

          {/* 아래 칸들 — 인기글 옆에 마감임박 공모. 빈 칸은 자리를 안 차지한다(위 주석). 칸마다 min-w-0(규칙 27) */}
          <section
            data-testid="home-widgets"
            className="max-w-7xl mx-auto px-6 md:px-12 py-12 md:py-16 grid grid-cols-1 gap-12 md:grid-cols-2 md:gap-x-12 md:gap-y-14 [&>*]:min-w-0 md:[&>*:last-child:nth-child(odd)]:col-span-2"
          >
            <PopularPosts />
            <ClosingSoonExhibitions />
            <OngoingShows />
            <GalleryOfMonthSection variant="rail" />
          </section>
        </>
      )}
    </div>
  );
}
