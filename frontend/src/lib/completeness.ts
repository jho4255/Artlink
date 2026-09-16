/**
 * 작가 홈페이지 완성도 (2026-09-16, 온보딩)
 *
 * 실서버 센서스(2026-09-16): 작품 캡션이 전부 빈 작품 76%, 작가노트 19%, 공개 작품이 있는 작가 31/81.
 * 결과물(PDF·홈페이지·스카우팅)의 품질이 전부 이 입력에 묶여 있는데, 무엇이 비었는지 알려주는 화면이 없었다.
 * 5칸 체크리스트 하나로 "다음에 할 일"을 보여준다. 다 채우면 사라진다.
 *
 * ⚠️ 항목을 늘리지 말 것 — 3~5개가 활성화 체크리스트의 관례다(그 이상은 숙제 목록이 된다).
 */
import { hasCaption } from './artwork';
import type { PortfolioImage } from '@/types';

export interface CompletenessInput {
  images: Pick<PortfolioImage, 'title' | 'medium' | 'sizeText' | 'year' | 'showInExplore'>[];
  statement?: string | null;
  biography?: string | null;
}

export interface CompletenessItem {
  key: 'works' | 'captions' | 'statement' | 'biography' | 'public';
  label: string;
  /** 왜 하는가 — 한 줄 */
  why: string;
  done: boolean;
  /** 진행 표시("3/27" 처럼). 없으면 done 만 */
  progress?: string;
  /** 눌렀을 때 갈 곳 */
  href: string;
}

export interface Completeness { items: CompletenessItem[]; done: number; total: number; percent: number; complete: boolean }

export const MIN_WORKS = 3;

export function computeCompleteness(p: CompletenessInput): Completeness {
  const images = p.images ?? [];
  const captioned = images.filter(hasCaption).length;
  const publicWorks = images.filter((i) => i.showInExplore).length;
  const items: CompletenessItem[] = [
    {
      key: 'works', label: `작품 ${MIN_WORKS}점 이상 올리기`, why: '홈페이지·PDF·액자 걸기가 전부 여기서 시작합니다.',
      done: images.length >= MIN_WORKS, progress: `${Math.min(images.length, MIN_WORKS)}/${MIN_WORKS}`, href: '/mypage?tab=homepage-edit#artworks',
    },
    {
      key: 'captions', label: '작품 정보 채우기', why: '제목·재료·크기·연도가 없으면 갤러리에게는 정보 없는 사진 더미로 보입니다.',
      done: images.length > 0 && captioned === images.length, progress: images.length ? `${captioned}/${images.length}` : undefined, href: '/mypage?tab=homepage-edit#artworks',
    },
    {
      key: 'statement', label: '작가노트 쓰기', why: '갤러리가 가장 먼저 읽는 글입니다.',
      done: !!p.statement?.trim(), href: '/mypage?tab=homepage-edit',
    },
    {
      key: 'biography', label: '약력 쓰기', why: '학력·전시·수상을 적으면 CV 페이지가 생깁니다.',
      done: !!p.biography?.trim(), href: '/mypage?tab=homepage-edit',
    },
    {
      key: 'public', label: '작품을 [작가] 탭에 공개하기', why: '공개한 작품이 한 점이라도 있어야 작가 목록과 홈 ArtWorks 에 나옵니다.',
      done: publicWorks > 0, progress: images.length ? `${publicWorks}/${images.length}` : undefined, href: '/mypage?tab=homepage-edit#artworks',
    },
  ];
  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length, percent: Math.round((done / items.length) * 100), complete: done === items.length };
}
