/**
 * 작가 홈페이지 완성도 (2026-09-16, 온보딩)
 *
 * 실서버 센서스(2026-09-16): 작품 캡션이 전부 빈 작품 76%, 작가노트 19%, 공개 작품이 있는 작가 31/81.
 * 결과물(PDF·홈페이지·스카우팅)의 품질이 전부 이 입력에 묶여 있는데, 무엇이 비었는지 알려주는 화면이 없었다.
 * 다섯 항목으로 "다음에 할 일"을 정한다. 다 채우면 사라진다.
 *
 * 이 판정을 보여 주는 곳은 셋이다(2026-10-02) — 로그인 팝업(`HomepageNudge`) · 홈페이지 편집 화면의 한 줄 · [프로필] 탭의 한 줄
 * (`CompletenessLine`). 예전의 상자형 체크리스트(프로필·포트폴리오·ArtLook 탭 위)는 없앴다.
 *
 * ⚠️ 항목을 늘리지 말 것 — 3~5개가 활성화 체크리스트의 관례다(그 이상은 숙제 목록이 된다).
 * ⚠️ 앞 네 칸(작품 3점·작품 정보·작가노트·약력)은 서버 `backend/src/lib/artistCompleteness.ts` 에 거울이 있다 — 그 수가 3 이상인 작가의 작품이
 *    홈 ArtWorks·[작가] 탭 격자에서 먼저 나온다(2026-10-06). 판정을 바꾸면 **둘 다** 고칠 것(안 그러면 다 채웠는데 안 올라간다).
 */
import { hasCaption, isCareerEmpty } from './artwork';
import { editHref } from './homepageEdit';
import type { Career, PortfolioImage } from '@/types';

export interface CompletenessInput {
  images: Pick<PortfolioImage, 'title' | 'medium' | 'sizeText' | 'year' | 'showInExplore'>[];
  statement?: string | null;
  biography?: string | null;
  /** 항목별 경력(학력·개인전…) — 약력 글이 없어도 이게 있으면 '약력'은 쓴 것이다 */
  career?: Career | null;
}

export interface CompletenessItem {
  key: 'works' | 'captions' | 'statement' | 'biography' | 'public';
  label: string;
  /** 짧은 이름 — 완성도 한 줄(`CompletenessLine`)의 칩에 쓴다. 긴 이름(label) 셋을 늘어놓으면 휴대폰에서 세 줄이 된다 */
  short: string;
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
      key: 'works', label: `작품 ${MIN_WORKS}점 이상 올리기`, short: `작품 ${MIN_WORKS}점`,
      done: images.length >= MIN_WORKS, progress: `${Math.min(images.length, MIN_WORKS)}/${MIN_WORKS}`, href: editHref('works'),
    },
    {
      key: 'captions', label: '작품 정보 채우기', short: '작품 정보',
      done: images.length > 0 && captioned === images.length, progress: images.length ? `${captioned}/${images.length}` : undefined,
      // 정보 없는 첫 작품의 입력 창을 바로 연다 — "채우기"를 눌렀는데 격자만 보이면 어디를 눌러야 할지 다시 찾아야 한다
      href: editHref('works', { info: images.length > 0 }),
    },
    {
      key: 'statement', label: '작가노트 쓰기', short: '작가노트',
      done: !!p.statement?.trim(), href: editHref('intro', { focus: 'statement' }),
    },
    {
      key: 'biography', label: '약력 쓰기', short: '약력',
      // 홈페이지 [약력] 탭은 약력 글과 항목별 경력을 함께 보여 준다 — 한쪽만 써도 그 탭이 생기므로 여기서도 쓴 것으로 본다
      done: !!p.biography?.trim() || !isCareerEmpty(p.career), href: editHref('cv', { focus: 'biography' }),
    },
    {
      // '공개'라고 부르지 않는다 — 작품은 올리는 순간 내 홈페이지에 보인다. 이건 [작가] 탭·홈 화면에**도** 내보낼지다(2026-10-02)
      key: 'public', label: '작품을 [작가] 탭에도 소개하기', short: '작가 탭 소개',
      done: publicWorks > 0, progress: images.length ? `${publicWorks}/${images.length}` : undefined, href: editHref('works'),
    },
  ];
  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length, percent: Math.round((done / items.length) * 100), complete: done === items.length };
}
