import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Tailwind 클래스 병합 유틸리티
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// D-day 계산
export function getDday(deadline: string | Date): number {
  const now = new Date();
  const target = new Date(deadline);
  const diff = target.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// 지역 라벨 매핑
export const regionLabels: Record<string, string> = {
  SEOUL: '서울',
  GYEONGGI_NORTH: '경기 북부',
  GYEONGGI_SOUTH: '경기 남부',
  DAEJEON: '대전',
  BUSAN: '부산',
};

// 전시 타입 라벨
export const exhibitionTypeLabels: Record<string, string> = {
  SOLO: '개인전',
  GROUP: '단체전',
  ART_FAIR: '아트페어',
};
