/**
 * 작가 홈페이지 편집 화면 — 묶음(탭)·들어오는 길·다음 작품 (2026-10-02)
 *
 * 편집 화면이 한 장짜리 긴 폼(스타일 → 약력 → 작가노트 → 한 줄 소개 → 경력 5칸 → 파일 → 작품)이던 때,
 * 가입 직후 도착한 작가의 첫 화면에 **작품 올리기가 없었다**(업로드 칸이 PC 2,518px · 모바일 2,747px 아래,
 * 그 앞에 입력칸 8개·버튼 33개). 실서버 작가 97명 중 50명이 작품 0점, 작품이 있는 47명 중 38명은 작품 정보가 전부 비어 있었다.
 * 그래서 홈페이지 탭과 같은 묶음 다섯으로 나누고 작품을 첫 화면으로 올렸다.
 *
 * 화면(`components/homepage-edit/`)은 여기 있는 순수 함수로 "어느 묶음인가 · 어디로 보내는가 · 다음 작품은 무엇인가"를 정한다.
 *
 * ⚠️ 편집 화면으로 보내는 링크는 **`editHref` 한 곳**으로 만든다(프로필 탭의 완성도 한 줄·로그인 팝업·PDF 탭·ArtLook·빈 홈페이지).
 *    주소를 손으로 적으면 묶음 이름을 바꿀 때 한 곳만 남아 조용히 [작품] 묶음으로 떨어진다.
 * ⚠️ 묶음은 **화면 상태**다 — 주소(`section=`)는 들어올 때만 읽는다. 탭을 누를 때마다 주소를 바꾸면(replace)
 *    `useUnsavedChanges` 가 쌓아 둔 가드 히스토리 항목의 표식이 지워져, 저장한 뒤 뒤로가기를 두 번 눌러야 한다.
 */
import { hasCaption, isCareerEmpty, museumCaption } from './artwork';
import { HOMEPAGE_EDIT_HREF } from './myPageMenu';
import type { HomepageTabId } from './homepageTabs';
import type { Career, PortfolioImage } from '@/types';

export type EditSectionId = 'works' | 'intro' | 'cv' | 'file' | 'style';

/**
 * 공개 홈페이지의 탭 → 그 내용을 고치는 묶음. 공개 페이지의 [수정] 이 **보던 탭의 묶음**으로 연다 —
 * 약력을 저장하고 [약력] 탭으로 돌아왔다가 다시 [수정] 을 눌렀는데 [작품] 이 열리면 한 번 더 찾아 들어가야 한다.
 */
export function editSectionForTab(tab: string | null | undefined): EditSectionId {
  if (tab === 'note') return 'intro';
  if (tab === 'cv') return 'cv';
  if (tab === 'file') return 'file';
  return 'works';   // 작품 · 방명록 · 모르는 값
}

/** 묶음 순서 = 홈페이지에서 보이는 순서(작품 → 글 → 이력 → 파일) + 맨 끝에 선택 사항(꾸미기) */
export const EDIT_SECTIONS: { id: EditSectionId; label: string }[] = [
  { id: 'works', label: '작품' },
  { id: 'intro', label: '소개' },
  { id: 'cv', label: '약력' },
  { id: 'file', label: '파일' },
  { id: 'style', label: '꾸미기' },
];

/** 들어오자마자 커서를 둘 칸 */
export type EditFocus = 'tagline' | 'statement' | 'biography' | 'handle';
const FOCUS_SECTION: Record<EditFocus, EditSectionId> = { tagline: 'intro', statement: 'intro', biography: 'cv', handle: 'style' };

/** 편집 화면의 바탕 주소 — 글자는 `myPageMenu.ts` 한 곳에만 적는다(숨은 탭 id 와 함께 바뀌어야 한다) */
export const HOMEPAGE_EDIT_BASE = HOMEPAGE_EDIT_HREF;

const isSection = (v: string | null): v is EditSectionId => EDIT_SECTIONS.some((s) => s.id === v);
// `in` 으로 보면 안 된다 — `toString` 같은 객체의 기본 이름이 칸으로 통과한다
const isFocus = (v: string | null): v is EditFocus => !!v && Object.prototype.hasOwnProperty.call(FOCUS_SECTION, v);

/**
 * 편집 화면 주소.
 *  - `focus` : 그 칸에 커서를 둔다(묶음은 칸에서 정해진다)
 *  - `info`  : 작품 묶음에서 정보 없는 첫 작품의 입력 창을 바로 연다("작품 정보 채우기"를 눌러 온 사람)
 *  - `work`  : `info` 와 함께 — **그 작품**의 입력 창을 연다(ArtLook 의 [크기 입력하기], 2026-10-04).
 *              제목만 있고 크기가 없는 작품은 '정보 없는 작품'이 아니라서, 없으면 엉뚱한 작품의 창이 열린다.
 */
export function editHref(section?: EditSectionId, opts: { focus?: EditFocus; info?: boolean; work?: number } = {}): string {
  const sec = opts.focus ? FOCUS_SECTION[opts.focus] : section;
  let href = HOMEPAGE_EDIT_BASE;
  if (sec) href += `&section=${sec}`;
  if (opts.focus) href += `&focus=${opts.focus}`;
  if (opts.info && (sec ?? 'works') === 'works') {
    href += '&do=info';
    if (Number.isInteger(opts.work) && (opts.work as number) > 0) href += `&work=${opts.work}`;
  }
  return href;
}

export interface EditEntry {
  section: EditSectionId; focus: EditFocus | null; info: boolean;
  /** `info` 로 열 작품 — 없으면 정보 없는 첫 작품 */
  work?: number | null;
}

/**
 * 주소에서 "어느 묶음으로 들어왔는가"를 읽는다. 모르는 값이면 첫 묶음(작품) — 빈 화면을 만들지 않는다.
 * 옛 링크 `…homepage-edit#artworks`(2026-10-02 이전의 체크리스트·북마크)도 `section` 이 없으니 작품 묶음으로 떨어진다.
 */
export function resolveEditEntry(search: string): EditEntry {
  const q = new URLSearchParams(search);
  const rawFocus = q.get('focus');
  const focus = isFocus(rawFocus) ? rawFocus : null;
  const rawSection = q.get('section');
  const section: EditSectionId = focus
    ? FOCUS_SECTION[focus]
    : isSection(rawSection) ? rawSection
    : 'works';
  const info = section === 'works' && q.get('do') === 'info';
  const w = Number(q.get('work'));
  return { section, focus, info, work: info && Number.isInteger(w) && w > 0 ? w : null };
}

/**
 * 묶음 탭의 ✓ — 그 묶음을 채웠는가. 꾸미기는 선택이라 ✓ 가 없다(안 골라도 완성이다).
 * [작품]은 작품이 있고 **정보 없는 작품이 없을 때** — 작품만 올려 두고 ✓ 가 붙으면, 바로 아래의
 * "작품 N점에 정보가 없어요" 와 서로 다른 말을 한다.
 */
export function sectionDone(v: {
  workCount: number;
  /** 작품 정보가 하나도 없는 작품 수 */
  uncaptioned?: number;
  statement?: string | null;
  biography?: string | null;
  career?: Career | null;
  portfolioFileUrl?: string | null;
}): Record<EditSectionId, boolean> {
  return {
    works: v.workCount > 0 && (v.uncaptioned ?? 0) === 0,
    intro: !!v.statement?.trim(),
    cv: !!v.biography?.trim() || !isCareerEmpty(v.career),
    file: !!v.portfolioFileUrl,
    style: false,
  };
}

/** 미리보기가 따라 열 홈페이지 탭. `null` = 지금 탭 그대로(한 줄 소개·주소는 탭이 아니라 이름 줄에 있다) */
export type EditField = EditFocus | 'series';
export function previewTabFor(section: EditSectionId, field?: EditField | null): HomepageTabId | null {
  switch (section) {
    case 'works': return 'works';
    case 'intro': return field === 'tagline' ? null : field === 'series' ? 'works' : 'note';
    case 'cv': return 'cv';
    case 'file': return 'file';
    case 'style': return field === 'handle' ? null : 'works';   // 대표작·색이 가장 잘 보이는 탭
  }
}

type Captionable = Pick<PortfolioImage, 'id' | 'title' | 'medium' | 'sizeText' | 'year'>;

/** 작품 정보(작품명·재료·크기·연도)가 하나도 없는 작품 수 */
export function uncaptionedCount(images: Captionable[]): number {
  return images.filter((i) => !hasCaption(i)).length;
}

/**
 * 들어오며 열 작품 정보 창 — 주소가 고른 작품(`work`)이 있으면 그것, 없거나 지워졌으면 정보 없는 첫 작품.
 */
export function entryInfoImageId(images: Captionable[], work: number | null | undefined): number | null {
  if (work != null && images.some((i) => i.id === work)) return work;
  return nextUncaptionedId(images, null);
}

/**
 * [저장하고 다음 작품] 이 열 작품 — `afterId` **다음부터** 순서대로 찾고, 끝에 닿으면 처음으로 돌아온다.
 * 방금 저장한 작품(`afterId`)은 뺀다(저장 전 목록으로 계산하므로 아직 '정보 없음'으로 보인다).
 * 더 없으면 null — 그때 창은 [저장]만 보여 준다.
 */
export function nextUncaptionedId(images: Captionable[], afterId: number | null): number | null {
  if (images.length === 0) return null;
  const start = afterId == null ? -1 : images.findIndex((i) => i.id === afterId);
  for (let step = 1; step <= images.length; step++) {
    const img = images[(start + step + images.length) % images.length]!;
    if (img.id !== afterId && !hasCaption(img)) return img.id;
  }
  return null;
}

/**
 * 이 작가가 이미 쓴 값(재료·연도) — 작품 정보 창이 칩으로 보여 줘 한 번에 채운다.
 * 회화 작가는 같은 재료·같은 해의 작품이 이어지는데, 27점에 "Oil on canvas" 를 27번 치게 했다.
 * 많이 쓴 순, 같으면 뒤에 올린 작품의 값이 먼저.
 */
export function recentValues(
  images: Pick<PortfolioImage, 'id' | 'medium' | 'year'>[],
  key: 'medium' | 'year',
  limit = 3,
  excludeId?: number | null,
): string[] {
  const seen = new Map<string, { count: number; last: number }>();
  images.forEach((img, idx) => {
    if (img.id === excludeId) return;
    const v = String(img[key] ?? '').trim();
    if (!v) return;
    const cur = seen.get(v);
    seen.set(v, { count: (cur?.count ?? 0) + 1, last: idx });
  });
  return [...seen.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last)
    .slice(0, limit)
    .map(([v]) => v);
}

/**
 * 작품 타일 아래 한 줄 — 홈페이지 캡션의 첫 줄(작품명, 연도). 작품명·연도가 없으면 재료·크기.
 * 정보가 하나도 없으면 null(타일이 '작품 정보 입력'을 대신 보여 준다).
 * ⚠️ `artworkTitle()` 을 쓰지 말 것 — 빈 제목에 '무제' 를 돌려줘, 정보를 안 넣은 작품이 넣은 것처럼 보인다.
 */
export function tileLabel(img: Pick<PortfolioImage, 'title' | 'medium' | 'sizeText' | 'year'>): string | null {
  const c = museumCaption(img);
  return c ? (c.head || c.medium || c.size) : null;
}
