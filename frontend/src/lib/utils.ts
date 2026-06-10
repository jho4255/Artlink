import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Tailwind 클래스 병합 유틸리티
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 공개 표시명: 닉네임이 있으면 닉네임, 없으면 이름
export function displayName(user?: { name?: string | null; nickname?: string | null } | null): string {
  if (!user) return '';
  return (user.nickname && user.nickname.trim()) || user.name || '';
}

// 사용자 제공 URL을 href로 쓰기 전 스킴 검증 (javascript:/data: 등 XSS 차단)
// 상대경로(/uploads/..)와 http(s)만 허용, 그 외엔 null
export function safeHttpUrl(url?: string | null): string | null {
  if (!url) return null;
  const t = String(url).trim();
  if (!t) return null;
  if (t.startsWith('/')) return t; // 동일 출처 상대경로(업로드)
  try {
    const u = new URL(t, window.location.origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : null;
  } catch {
    return null;
  }
}

// 전화번호 입력 시 자동 하이픈 포맷 (한국 번호: 010-1234-5678, 02-123-4567 등)
export function formatPhoneNumber(value: string): string {
  const d = value.replace(/[^0-9]/g, '').slice(0, 11);
  if (d.startsWith('02')) {
    // 서울 지역번호 (02)
    if (d.length < 3) return d;
    if (d.length < 6) return `${d.slice(0, 2)}-${d.slice(2)}`;
    if (d.length < 10) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`;
  }
  // 휴대폰 및 기타 (010, 070, 031 등)
  if (d.length < 4) return d;
  if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`;
}

// 숫자를 한국어 금액 표기로 변환 (예: 230000 → "이십삼만원").
// 작품 가격 입력칸 옆에 연한 회색으로 보여주는 힌트용. 숫자가 아니거나 0이면 빈 문자열.
const KR_DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const KR_SMALL_UNITS = ['', '십', '백', '천'];
const KR_BIG_UNITS = ['', '만', '억', '조', '경'];

// 0~9999 → 한글 (예: 1234 → 천이백삼십사, 23 → 이십삼)
function readKrGroup(n: number): string {
  let s = '';
  const str = String(n).padStart(4, '0');
  for (let i = 0; i < 4; i++) {
    const d = Number(str[i]);
    if (d === 0) continue;
    const unit = KR_SMALL_UNITS[3 - i];
    // 십/백/천 자리의 1은 '일' 생략 (11 → 십일, 일십일 아님)
    s += d === 1 && unit ? unit : KR_DIGITS[d] + unit;
  }
  return s;
}

export function numberToKorean(num: number): string {
  if (!Number.isFinite(num) || num <= 0) return '';
  let n = Math.floor(num);
  let result = '';
  let gi = 0;
  while (n > 0) {
    const group = n % 10000;
    if (group > 0) {
      // 만 자리의 1은 생략 (10000 → 만), 억/조 이상은 유지 (1억 → 일억)
      const prefix = group === 1 && gi === 1 ? '' : readKrGroup(group);
      result = prefix + KR_BIG_UNITS[gi] + result;
    }
    n = Math.floor(n / 10000);
    gi++;
  }
  return result;
}

// 문자열/숫자에서 숫자만 추출해 "○○원" 한글 표기 반환 (숫자 없으면 '')
export function koreanWon(value: string | number | null | undefined): string {
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  const n = parseInt(digits, 10);
  if (!n) return '';
  const kr = numberToKorean(n);
  return kr ? `${kr}원` : '';
}

// 업로드 가능한 최대 이미지 용량 (백엔드 multer limit과 동일하게 유지)
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/**
 * 큰 이미지를 업로드 전에 캔버스로 다운스케일/재인코딩해 용량을 줄인다.
 * - 큰 사진(고해상도)이 용량 초과로 첨부 실패하는 문제 방지
 * - 충분히 작은 이미지(≤2MB & ≤maxDim)는 원본 그대로 반환
 * - GIF(애니메이션 손실)나 이미지가 아니면 원본 유지
 * - 어떤 이유로든 실패하면 원본을 반환(업로드 시도는 계속)
 */
export async function compressImage(file: File, maxDim = 2000, quality = 0.85): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const img: HTMLImageElement = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = dataUrl;
    });

    let { width, height } = img;
    // 이미 작으면 원본 사용
    if (width <= maxDim && height <= maxDim && file.size <= 2 * 1024 * 1024) return file;

    const scale = Math.min(1, maxDim / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, width, height);

    const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file; // 줄지 않았으면 원본 유지
    const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], newName, { type: 'image/jpeg' });
  } catch {
    return file;
  }
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
