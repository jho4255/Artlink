/**
 * 온보딩 투어(코치마크) 정의
 *
 * TourOverlay(components/onboarding/TourOverlay.tsx)가 이 스텝 배열을 읽어
 * 스포트라이트 + 말풍선으로 하나씩 안내한다.
 *
 * - target: 강조할 요소의 data-tour 속성값. 생략하면 화면 중앙 카드(환영/마무리용).
 * - route: 이 스텝 진입 시 먼저 이동할 경로. 이동 후 target 요소가 나타날 때까지 대기.
 * - placement: 말풍선 위치(요소 기준). 기본 bottom, 공간 부족 시 자동으로 위로.
 * 요소를 끝내 못 찾으면 해당 스텝은 건너뛴다(뷰포트에 따라 없는 요소 대비).
 */
export interface TourStep {
  target?: string;
  route?: string;
  title: string;
  body: string;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  // 이 스텝은 이름(닉네임) 입력 카드. 입력값은 닉네임으로 저장되고 이후 스텝의 {name}에 치환된다.
  input?: { placeholder: string };
  // 카드 안에 표시할 목업 미리보기 종류 (신규 계정은 실제 내용이 비어 있어 감이 안 오므로)
  preview?: 'profile' | 'portfolio' | 'favorites' | 'reviews' | 'applications';
}

export const ARTIST_ONBOARDING_TOUR = 'artist-onboarding-v1';

// 신규 작가 가입 직후 전체 서비스 흐름 안내 (홈 → 모집공고 → 마이페이지)
export const artistOnboardingSteps: TourStep[] = [
  {
    title: '환영해요! 여기는 아트 플랫폼 ArtLink예요 🎨',
    body: '작가님을 뭐라고 불러드리면 좋을까요?',
    placement: 'center',
    route: '/',
    input: { placeholder: '이름을 입력하세요' },
  },
  {
    title: '환영해요, {name}작가님 🎨',
    body: 'ArtLink를 어떻게 쓰는지 30초만에 훑어볼게요. 언제든 건너뛸 수 있어요.',
    placement: 'center',
    route: '/',
  },
  {
    target: 'exhibition-card',
    route: '/exhibitions',
    title: '여기서 공모를 찾을 수 있어요',
    body: '진행 중인 공모를 둘러보고, 마음에 드는 곳에 지원하거나 찜해둘 수 있어요.',
    placement: 'bottom',
  },
  {
    target: 'mypage-tab-profile',
    route: '/mypage?tab=profile',
    title: '프로필을 관리해요',
    body: '닉네임·연락처·인스타그램을 등록하면 갤러리가 작가님께 연락할 수 있어요.',
    placement: 'bottom',
  },
  {
    target: 'mypage-tab-portfolio',
    route: '/mypage?tab=portfolio',
    title: '먼저 포트폴리오를 만들어 보세요',
    body: '약력·작품 사진을 등록해두면, 공모에 지원할 때 자동으로 불러올 수 있어요.',
    placement: 'bottom',
    preview: 'portfolio',
  },
  {
    target: 'mypage-tab-favorites',
    route: '/mypage?tab=favorites',
    title: '관심 공모는 찜해두세요',
    body: '찜한 갤러리·공모를 여기 모아 보고, 마감 전에 놓치지 않을 수 있어요.',
    placement: 'bottom',
    preview: 'favorites',
  },
  {
    target: 'mypage-tab-reviews',
    route: '/mypage?tab=reviews',
    title: '다녀온 갤러리에 리뷰를',
    body: '전시를 관람한 뒤 별점과 후기를 남길 수 있어요. 남긴 리뷰는 여기 모여요.',
    placement: 'bottom',
    preview: 'reviews',
  },
  {
    target: 'mypage-tab-applications',
    route: '/mypage?tab=applications',
    title: '지원 현황은 여기서',
    body: '지원한 공모가 접수·검토중·수락·거절 중 어떤 상태인지 한눈에 확인할 수 있어요.',
    placement: 'bottom',
    preview: 'applications',
  },
  {
    title: '이제 시작해볼까요?',
    body: '포트폴리오를 만들고 첫 공모에 지원해보세요. 궁금한점이 있다면 고객센터로 문의 부탁드립니다.',
    placement: 'center',
  },
];

// ===== 한 번만 노출 관리 (localStorage) =====
const seenKey = (tourId: string) => `tour_seen_${tourId}`;

export function hasSeenTour(tourId: string): boolean {
  try { return localStorage.getItem(seenKey(tourId)) === '1'; } catch { return false; }
}

export function markTourSeen(tourId: string): void {
  try { localStorage.setItem(seenKey(tourId), '1'); } catch { /* 무시 */ }
}
