// 공통 타입 정의

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'ARTIST' | 'GALLERY' | 'ADMIN';
  avatar?: string;
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
  status: string;
  rejectReason?: string;
  ownerName: string;
  mainImage?: string;
  instagramUrl?: string;
  instagramConnected?: boolean;
  instagramFeedVisible?: boolean;
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
  type: 'text' | 'textarea' | 'select' | 'file';
  required: boolean;
  options?: string[];
}

// 커스텀 질문 답변 (Artist 지원 시 입력)
export interface CustomAnswer {
  fieldId: string;
  value: string;
}

export interface Exhibition {
  id: number;
  title: string;
  type: 'SOLO' | 'GROUP' | 'ART_FAIR';
  deadline: string;
  deadlineStart?: string;
  exhibitDate: string;
  exhibitStartDate?: string;
  imageUrl?: string;
  customFields?: CustomField[] | null;
  capacity: number;
  region: string;
  description: string;
  status: string;
  galleryId: number;
  gallery: Pick<Gallery, 'id' | 'name' | 'rating' | 'mainImage' | 'region'>;
  promoPhotos?: PromoPhoto[];
  isFavorited?: boolean;
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
  user: Pick<User, 'id' | 'name' | 'avatar'>;
  createdAt: string;
}

export interface Favorite {
  id: number;
  galleryId?: number;
  exhibitionId?: number;
  showId?: number;
  gallery?: Pick<Gallery, 'id' | 'name' | 'mainImage' | 'rating'>;
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
  expiresAt: string;
  gallery: Gallery;
}

export interface Portfolio {
  id: number;
  biography?: string;
  exhibitionHistory?: string;
  images: { id: number; url: string; order: number }[];
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
  images: { id: number; url: string; order: number }[];
  user: { id: number; name: string; avatar?: string };
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
