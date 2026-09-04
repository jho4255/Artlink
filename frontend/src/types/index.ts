// 공통 타입 정의

export interface User {
  id: number;
  name: string;
  nickname?: string | null;
  email: string;
  role: 'ARTIST' | 'GALLERY' | 'ADMIN';
  avatar?: string;
  phone?: string | null;
  instagramUrl?: string | null;
}

export interface Gallery {
  id: number;
  name: string;
  address: string;
  phone: string;
  description: string;
  detailDesc?: string;
  region: string;
  rating: number;
  reviewCount: number;
  viewCount?: number; // 상세 조회수 (Admin 전용 노출)
  status: string;
  rejectReason?: string;
  ownerName: string;
  mainImage?: string;
  instagramUrl?: string;
  email?: string;
  ownerId: number;
  images: GalleryImage[];
  isFavorited?: boolean;
}

export interface GalleryImage {
  id: number;
  url: string;
  order: number;
}

// 커스텀 질문 필드 (공모 등록 시 Gallery가 설정)
export interface CustomField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'multiselect' | 'file';
  required: boolean;
  options?: string[];
  maxLength?: number;       // 텍스트 글자수 제한 (0 = 무제한)
  maxSelect?: number;       // 선택형 최대 선택 수 (1 = 단일선택, 2+ = 복수선택, 0 = 무제한)
}

// 커스텀 질문 답변 (Artist 지원 시 입력)
export interface CustomAnswer {
  fieldId: string;
  value: string | string[];
}

export interface Exhibition {
  id: number;
  title: string;
  type: 'SOLO' | 'GROUP' | 'ART_FAIR';
  deadline: string;
  deadlineStart?: string;
  exhibitDate: string;
  exhibitStartDate?: string;
  /**
   * 마감 판정에 필요 — **마감일과 별개다.** 마감일이 남았는데 갤러리가 수동으로 모집을 닫거나
   * 전시를 종료한 경우가 있어, 마감일만 보면 그런 공고에 지원 경로가 열린 채로 남는다.
   * ([마감된 공고] 탭이 생기며 실제로 도달 가능해졌다)
   */
  recruitmentClosed?: boolean;
  ended?: boolean;
  imageUrl?: string;
  images?: ExhibitionImage[];
  customFields?: CustomField[] | null;
  capacity: number;
  region: string;
  description: string;
  status: string;
  viewCount?: number; // 상세 조회수 (Admin 전용 노출)
  galleryId: number;
  /** 'GALLERY'(갤러리 주최, 기본) | 'ADMIN'(아트링크 주최 — 운영은 managerGalleries 가 맡는다) */
  hostType?: 'GALLERY' | 'ADMIN';
  /** 아트링크 주최 공모의 운영 갤러리. 첫 번째가 주관(= gallery). 갤러리 주최면 빈 배열 */
  managerGalleries?: { id: number; name: string }[];
  /** 이 공모를 운영할 수 있는 계정인지 — 서버가 계산해 내려준다(상세 API 전용) */
  canOperate?: boolean;
  // reviewCount는 상세 API(include)에서만 내려옴 — 목록 API(select)에는 없어 optional
  gallery: Pick<Gallery, 'id' | 'name' | 'rating' | 'mainImage' | 'region'> & { reviewCount?: number };
  promoPhotos?: PromoPhoto[];
  isFavorited?: boolean;
}

export interface ExhibitionImage {
  id: number;
  url: string;
  order: number;
}

export interface PromoPhoto {
  id: number;
  url: string;
  caption?: string;
  exhibitionId: number;
  createdAt: string;
}

export interface HeroSlide {
  id: number;
  title: string;
  description?: string;
  imageUrl: string;
  linkUrl?: string;
  order: number;
}

export interface Review {
  id: number;
  rating: number;
  content: string;
  imageUrl?: string;
  anonymous: boolean;
  userId: number;
  galleryId: number;
  user: Pick<User, 'id' | 'name' | 'nickname' | 'avatar'>;
  exhibition?: { id: number; title: string } | null;
  createdAt: string;
}

export interface Favorite {
  id: number;
  galleryId?: number;
  exhibitionId?: number;
  showId?: number;
  gallery?: Pick<Gallery, 'id' | 'name' | 'mainImage' | 'rating'> & { reviewCount?: number };
  exhibition?: { id: number; title: string; gallery: { name: string } };
  show?: { id: number; title: string; posterImage: string; gallery: { name: string } };
}

export interface Benefit {
  id: number;
  title: string;
  description: string;
  imageUrl?: string;
  linkUrl?: string;
}

export interface GalleryOfMonth {
  id: number;
  galleryId: number;
  title?: string;
  expiresAt: string;
  gallery: Gallery;
}

/** 작품 판매 상태 — null이면 표기하지 않는다 */
export type ArtworkStatus = 'AVAILABLE' | 'SOLD' | 'NFS';

export interface PortfolioImage {
  id: number;
  url: string;
  order: number;
  showInExplore?: boolean;
  /** 받은 좋아요 수 (내 포트폴리오 조회 시 포함) */
  _count?: { likes: number };
  // ── 작품 정보 (전부 선택. 있는 항목만 캡션에 조립된다 — lib/artwork.ts) ──
  title?: string | null;
  medium?: string | null;
  sizeText?: string | null;
  year?: string | null;
  series?: string | null;
  description?: string | null;
  status?: ArtworkStatus | null;
}

/** 시리즈 설명 — 포맷 PDF의 시리즈 표지에 실린다 */
export interface SeriesInfo {
  name: string;
  note: string;
}

// 경력 항목 (연도 + 내용)
export interface CareerEntry {
  year: string;
  content: string;
}

// 경력. artFair/solo/group은 지원서와 공용이라 필수,
// education/award는 포트폴리오에서만 쓰는 확장이라 선택 (기존에 저장된 JSON에는 없다).
export interface Career {
  artFair: CareerEntry[];
  solo: CareerEntry[];
  group: CareerEntry[];
  education?: CareerEntry[];
  award?: CareerEntry[];
}

export type CareerKey = keyof Career;

/** normalizeCareer가 돌려주는, 모든 항목이 채워진 경력 */
export interface FullCareer extends Career {
  education: CareerEntry[];
  award: CareerEntry[];
}

export const EMPTY_CAREER: Career = { artFair: [], solo: [], group: [] };

// ===== 공모 운영 페이지 =====

// 출품작 1개
export interface ArtworkItem {
  image?: string;   // 작품 이미지 URL
  title: string;
  size: string;     // 크기 (예: 33.4×24.2 cm) — width/height로부터 합성, 캡션·PDF의 단일 출처
  width?: string;   // 가로 (cm) — 입력 분리용
  height?: string;  // 세로 (cm) — 입력 분리용
  medium: string;   // 재료 (예: Acrylic on Canvas)
  year: string;
  price: string;    // 가격 (자유 텍스트: 비매/협의/₩320,000)
  /**
   * 임시저장 여부. true면 작가 화면에만 보이고 갤러리·관리자에게는 노출되지 않는다
   * (백엔드 operation.ts의 publicSubmission/publishedArtworks에서 걸러짐).
   * 정식 [저장]을 누르면 false가 되어 제출물로 넘어간다.
   */
  draft?: boolean;
}

// 약력 항목 (연도 + 내용)
export interface CvEntry { year: string; content: string; }

// 작가 약력
export interface ArtistCv {
  nameKo: string;
  nameEn: string;
  birth: string;    // 출생년 (예: 1993, Seoul, Korea)
  tel: string;
  email: string;
  education: CvEntry[];  // 학력
  solo: CvEntry[];       // 개인전
  group: CvEntry[];      // 단체전
  artFair: CvEntry[];    // 아트페어/옥션
  award: CvEntry[];      // 수상 및 선정
}

export const EMPTY_CV: ArtistCv = {
  nameKo: '', nameEn: '', birth: '', tel: '', email: '',
  education: [], solo: [], group: [], artFair: [], award: [],
};

// 작가노트 섹션 (소제목 + 내용)
export interface NoteSection { title: string; body: string; }

// 작가노트
export interface ArtistNote {
  statement: string;        // 전체 작가노트
  sections: NoteSection[];  // 시리즈별 섹션
}

export const EMPTY_NOTE: ArtistNote = { statement: '', sections: [] };

// 작가 제출 정보 (운영 페이지)
export interface OperationSubmission {
  artworkList: ArtworkItem[];
  cv: ArtistCv | null;
  note: ArtistNote | null;
  representativeIndex?: number | null;  // 엽서용 대표작 인덱스 (작가 선택)
  /** 작가 본인이 아니라 갤러리/Admin 이 대신 입력한 자료인가 (작가가 직접 저장하면 해제된다) */
  proxyEdited?: boolean;
}

// 공모 운영 공지
export interface ExhibitionNotice {
  id: number;
  exhibitionId: number;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// 운영 페이지 접근 정보
export interface OperationAccess {
  exhibitionId: number;
  title: string;
  galleryName: string;
  isOwner: boolean;
  isAdmin: boolean;
  isAcceptedArtist: boolean;
  recruitmentClosed: boolean;
  confirmed: boolean;        // 수동 확정 또는 전시 시작일 경과
  manualConfirmed: boolean;  // 수동 확정 플래그
  ended: boolean;
  settlementRequested?: boolean;
  settlementRequestedAt?: string | null;
  settled?: boolean;         // 정산 완료(확정) — 운영페이지 수정 잠금 + 작가에게 정산 공개
  settledAt?: string | null;
  /** 전시 종료일 — 자동 정리(20일) 남은 기간을 계산하는 기준 */
  exhibitDate?: string | null;
  /** 전시 종료 후 이 기간 동안 정산을 시작하지 않으면 '종료된 공모' 로 정리된다 */
  autoCloseDays?: number;
  /** 갤러리가 정산에 손을 댔는가 (금액 입력 또는 확인 요청) — true 면 자동 정리 대상이 아니다 */
  settlementStarted?: boolean;
}

// ArtLook(작품 액자/목업) 홍보용 핸드오프 payload (localStorage 'artlook:works')
export interface ArtLookWork {
  url: string;
  title: string;
  artist?: string;      // 작가 표시명 (다운로드 파일명용)
  exhibition?: string;  // 공모명 (다운로드 파일명용)
}

// 정산: 작가 작품 1개
export interface SettlementWork {
  index: number;
  title: string;
  image?: string;
  size?: string;
  medium?: string;
  year?: string;
  listPrice: string;
  sold: boolean;
  soldPrice: number;
  paymentMethod?: 'CARD' | 'CASH';  // 결제수단 (카드/현금)
}
// 정산: 작가별
export interface SettlementArtist {
  user: { id: number; name: string; nickname?: string | null; email?: string };
  galleryRatio: number;
  artistRatio: number;
  works: SettlementWork[];
  total: number;
  /** 카드로 팔린 합계 / 현금으로 팔린 합계 */
  cardTotal?: number;
  cashTotal?: number;
  /** 카드 판매분에 붙는 수수료(원). 이걸 먼저 뺀 `settleBase` 를 비율로 나눈다 */
  cardFee?: number;
  settleBase?: number;
  galleryAmount: number;
  artistAmount: number;
}
// 정산 전체
export interface Settlement {
  exhibitionTitle: string;
  /** 카드 결제 수수료율(%) — 전시 하나에 하나 */
  cardFeeRate?: number;
  artists: SettlementArtist[];
  grand: {
    total: number; galleryAmount: number; artistAmount: number; soldCount: number;
    cardTotal?: number; cashTotal?: number; cardFee?: number; settleBase?: number;
  };
}

export interface Portfolio {
  id: number;
  biography?: string;
  exhibitionHistory?: string; // (구) 미사용
  career?: Career | null;
  portfolioFileUrl?: string | null;
  statement?: string | null;   // 작가노트
  tagline?: string | null;     // 한 줄 소개 (포맷 표지 부제)
  themeId?: string | null;     // 마지막으로 고른 포맷
  seriesInfo?: SeriesInfo[] | null;
  designConfig?: unknown; // 포트폴리오 PDF 가이드형 디자인(색감 팔레트 등) — normalizePdfDesign 통과시켜 사용
  images: PortfolioImage[];
}

export interface ExploreImage {
  id: number;
  url: string;
  artist: { id: number; name: string; nickname?: string | null; avatar?: string };
  likeCount: number;
  isLiked: boolean;
  /** 갤러리 계정으로 조회할 때만 내려온다 (본인 스크랩 여부 — 작가에게는 절대 노출 안 됨) */
  isScrapped?: boolean;
}

// 갤러리의 비공개 스크랩 (관심 작품 보드)
export interface ArtworkScrap {
  id: number;
  memo: string | null;
  createdAt: string;
  /** 확대 모달에 그대로 넘길 수 있도록 하트/북마크 상태까지 포함해 내려온다 */
  image: ExploreImage;
}

// 갤러리가 보낸 공모 초대 (작가가 받은 목록)
export interface ExhibitionInvite {
  id: number;
  message: string | null;
  status: 'SENT' | 'APPLIED' | 'DECLINED';
  createdAt: string;
  applied: boolean;
  closed: boolean;
  /** 정원이 찬 공모 — 지원하지 않은 초대는 서버가 목록에서 제외한다 */
  full?: boolean;
  exhibition: {
    id: number;
    title: string;
    type: string;
    region: string;
    deadline: string;
    imageUrl?: string | null;
    /** 간편 지원 모달에서 갤러리가 물은 추가 질문만 받기 위해 함께 내려온다 */
    customFields?: CustomField[] | null;
    gallery: { id: number; name: string };
  };
}

// 전시 참여 작가 (userId 있으면 ArtLink 유저 연동)
export interface ArtistEntry {
  name: string;
  userId?: number | null;
}

// 공개 포트폴리오 (인증 불필요)
export interface PublicPortfolio {
  id: number;
  biography?: string | null;
  exhibitionHistory?: string | null;
  career?: Career | null;
  portfolioFileUrl?: string | null;
  statement?: string | null;
  tagline?: string | null;
  themeId?: string | null;
  seriesInfo?: SeriesInfo[] | null;
  designConfig?: unknown;
  images: PortfolioImage[];
  user: { id: number; name: string; nickname?: string | null; avatar?: string; instagramUrl?: string | null };
}

export interface Show {
  id: number;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  openingHours: string;
  admissionFee: string;
  location: string;
  region: string;
  artists?: ArtistEntry[] | null;
  posterImage: string;
  status: string;
  rejectReason?: string;
  viewCount?: number; // 상세 조회수 (Admin 전용 노출)
  galleryId: number;
  gallery: Pick<Gallery, 'id' | 'name' | 'mainImage' | 'region'> & { ownerId?: number };
  images?: ShowImage[];
  isFavorited?: boolean;
}

export interface ShowImage {
  id: number;
  url: string;
  order: number;
}

export interface InstagramPost {
  id: string;
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  mediaUrl: string;
  thumbnailUrl?: string;
  permalink: string;
  timestamp: string;
}

export interface Message {
  id: number;
  subject: string;
  content: string;
  read: boolean;
  senderId: number;
  sender: { id: number; name: string; nickname?: string | null; role: string };
  receiverId: number;
  receiver: { id: number; name: string; nickname?: string | null; role: string };
  exhibitionId?: number | null;
  exhibition?: { id: number; title: string } | null;
  attachments?: string | null;
  createdAt: string;
  sanctioned?: boolean;
  reportedByMe?: boolean;
}

export interface MessageAttachment {
  url: string;
  name: string;
  type: string;
  size: number;
}

export interface Inquiry {
  id: number;
  subject: string;
  content: string;
  status: 'OPEN' | 'ANSWERED';
  reply?: string;
  repliedAt?: string;
  userId: number;
  user?: { id: number; name: string; role: string };
  createdAt: string;
  updatedAt: string;
}

/**
 * 하이라이트 — 스토리를 주제별로 묶어 프로필에 영구 보존한다(인스타그램 하이라이트).
 * `coverImage`/`storyCount` 는 서버가 계산해 내려주는 값이다 (DB 컬럼이 아니다).
 */
export interface StoryHighlight {
  id: number;
  userId: number;
  name: string;
  storyIds: number[];
  coverStoryId: number | null;
  isPublic: boolean;
  order: number;
  /** 담긴 스토리 중 **사진이 있는 첫 번째** 것. 전부 글뿐이면 null */
  coverImage: string | null;
  /** 지워진 스토리를 뺀 실제 개수 */
  storyCount: number;
  createdAt: string;
  updatedAt: string;
}
