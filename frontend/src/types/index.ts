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

export interface Exhibition {
  id: number;
  title: string;
  type: 'SOLO' | 'GROUP' | 'ART_FAIR';
  deadline: string;
  deadlineStart?: string;
  exhibitDate: string;
  exhibitStartDate?: string;
  imageUrl?: string;
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
  gallery?: Pick<Gallery, 'id' | 'name' | 'mainImage' | 'rating'>;
  exhibition?: { id: number; title: string; gallery: { name: string } };
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

export interface InstagramPost {
  id: string;
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  mediaUrl: string;
  thumbnailUrl?: string;
  permalink: string;
  timestamp: string;
}
