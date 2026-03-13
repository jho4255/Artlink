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

// 전시(Show) 상태 계산
export function getShowStatus(startDate: string | Date, endDate: string | Date): 'upcoming' | 'ongoing' | 'ended' {
  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (now < start) return 'upcoming';
  if (now > end) return 'ended';
  return 'ongoing';
}

// 전시 상태 라벨
export const showStatusLabels: Record<string, string> = {
  upcoming: '예정',
  ongoing: '진행중',
  ended: '종료',
};

// 공모/전시 날짜 순서 검증
// 올바른 순서: 공모시작 ≤ 공모마감 ≤ 전시시작 ≤ 전시종료
export function validateExhibitionDates(dates: {
  deadlineStart?: string;
  deadline: string;
  exhibitStartDate?: string;
  exhibitDate: string;
}): string | null {
  const { deadlineStart, deadline, exhibitStartDate, exhibitDate } = dates;
  if (!deadline || !exhibitDate) return null;

  const dl = new Date(deadline);
  const ed = new Date(exhibitDate);

  if (deadlineStart) {
    const ds = new Date(deadlineStart);
    if (ds > dl) return '공모 시작일은 마감일 이전이어야 합니다.';
  }

  if (exhibitStartDate) {
    const es = new Date(exhibitStartDate);
    if (dl > es) return '공모 마감일은 전시 시작일 이전이어야 합니다.';
    if (es > ed) return '전시 시작일은 종료일 이전이어야 합니다.';
  } else {
    if (dl > ed) return '공모 마감일은 전시 종료일 이전이어야 합니다.';
  }

  return null;
}
