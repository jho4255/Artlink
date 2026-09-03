/**
 * 작가 포트폴리오 포맷 — 실제 작가들이 쓰는 포트폴리오 4종을 그대로 만들어 주는 엔진.
 *
 * ## 왜 새로 만들었나
 * 기존 `portfolioPdf.ts`(이 커밋에서 삭제)는 A4 세로 **이력서**였다. 약력·경력 다음에 작품을 340px 정사각형으로
 * **크롭해서** 6장씩 붙였다. 실제 작가 포트폴리오(레퍼런스 5종)와 비교하면 세 가지가 결정적으로 달랐다.
 *   1) 작품마다 [제목/재료/크기/연도] 캡션이 있다 — 5종 전부. 없으면 "정보 없는 이미지 더미"로 읽힌다.
 *   2) 작품을 **자르지 않는다**. 중립 배경 위에 원본 비율 그대로 놓는다(회화를 정사각으로 자르는 건 금기).
 *   3) 시리즈 단위로 묶고, 시리즈마다 설명 페이지를 둔다. 표지와 연락처 페이지로 시작·끝을 맺는다.
 *
 * ## 엔진 구조 (operationPdf의 htmlToPdfBlob과 다른 점)
 * `htmlToPdfBlob`은 **긴 세로 한 장**을 렌더해 잘라내는 방식이라 페이지마다 다른 레이아웃을 못 준다.
 * 여기서는 반대로 **페이지 하나 = HTML 하나**를 정확한 판형 크기(px)로 렌더해 1:1로 넣는다.
 * 덕분에 표지·시리즈 표지·작품 페이지가 각각 다른 구성을 가질 수 있고, 미리보기 화면도
 * 같은 HTML을 그대로 축소해 보여주면 되므로 **미리보기와 PDF가 절대 어긋나지 않는다**.
 *
 * ## 이미지
 * `imageSrc()`(= proxied)로 blob: URL을 쓴다. 렌더 전에 반드시 prefetch를 돌려야 네트워크가 0이 된다.
 * 안 하면 페이지 수만큼 프록시 요청이 붙어 "안 끝나는" 상태가 된다(operationPdf 주석 참고).
 */
import { displayName } from '@/lib/utils';
import { esc, proxied, safeName, triggerDownload } from '@/lib/operationPdf';
import { prefetchImages, recoverFailed } from '@/lib/imageFetch';
import { resolvePalette, bestTextKey, isBgKey, isTextKey, isAccentKey, mixHex } from '@/lib/portfolioColors';
import {
  artworkTitle, captionInline, captionLines, careerLineText, hasTitle,
  groupBySeries, normalizeCareer, statusLabel,
} from '@/lib/artwork';
import { artworkFacts } from '@/lib/artworkAnalysis';
import type { CareerKey, PortfolioImage, PublicPortfolio, SeriesInfo } from '@/types';

export type PortfolioThemeId = 'gallery' | 'studio' | 'story' | 'archive';

export interface PortfolioTheme {
  id: PortfolioThemeId;
  name: string;
  /** 선택 화면에 뜨는 한 줄 스타일 설명 */
  summary: string;
  /** 판형 라벨 (예: 와이드 16:9) */
  sizeLabel: string;
  /** 페이지 픽셀 크기 + PDF mm 크기 */
  page: { w: number; h: number; mmW: number; mmH: number };
  worksPerPage: number;
  bg: string;
  ink: string;
  sub: string;
  accent: string;
  line: string;
  /** 표지·큰 제목용 글꼴 스택 */
  display: string;
  /** 본문 글꼴 스택 (applyDesign 이 넣는다). 없으면 SANS */
  bodyFont?: string;
  /** 제목이 명조 계열인가 — 제목 글자 스타일(굵기·자간) 결정용. applyDesign 이 넣는다 */
  titleSerif?: boolean;
  /** 본문(산문) 정렬 — justify|left|right. applyDesign 이 넣는다. 없으면 left */
  proseAlign?: 'justify' | 'left' | 'right';
}

const SANS = `'Pretendard Variable',Pretendard,system-ui,sans-serif`;
// 명조는 index.html에서 Nanum Myeongjo를 함께 받는다. 못 받은 환경에서도 무너지지 않게 시스템 명조로 폴백.
const SERIF = `'Nanum Myeongjo','Apple SD Gothic Neo',Georgia,'Times New Roman',serif`;

// ── 글꼴 프리셋 (제목 + 본문 페어링) ──
// 추가 한글 웹폰트(노토명조·고운바탕·플렉스·나눔고딕)는 화면(PortfolioFormatPicker)이 열릴 때 지연 로드한다.
const F_NOTO_SERIF = `'Noto Serif KR','Nanum Myeongjo',serif`;
const F_GOWUN = `'Gowun Batang','Nanum Myeongjo',serif`;
const F_PLEX = `'IBM Plex Sans KR',Pretendard,sans-serif`;
const F_NANUM_GOTHIC = `'Nanum Gothic',Pretendard,sans-serif`;

export type FontKey = 'myeongjo' | 'gothic' | 'noto' | 'gowun' | 'plex' | 'nanum';
export interface FontPreset { key: FontKey; label: string; title: string; body: string; serif: boolean }
export const FONT_PRESETS: FontPreset[] = [
  { key: 'myeongjo', label: '명조',   title: SERIF,        body: SANS,          serif: true },
  { key: 'gothic',   label: '고딕',   title: SANS,         body: SANS,          serif: false },
  { key: 'noto',     label: '노토명조', title: F_NOTO_SERIF, body: F_NOTO_SERIF,  serif: true },
  { key: 'gowun',    label: '고운바탕', title: F_GOWUN,      body: SANS,          serif: true },
  { key: 'plex',     label: '플렉스',  title: F_PLEX,       body: F_PLEX,        serif: false },
  { key: 'nanum',    label: '나눔고딕', title: F_NANUM_GOTHIC, body: F_NANUM_GOTHIC, serif: false },
];
const FONT_BY_KEY: Record<string, FontPreset> = Object.fromEntries(FONT_PRESETS.map((p) => [p.key, p]));
/** 화면에서 지연 로드할 구글 폰트 (Pretendard·Nanum Myeongjo 는 index.html 에 이미 있음) */
export const PORTFOLIO_FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;600;700&family=Gowun+Batang:wght@400;700&family=IBM+Plex+Sans+KR:wght@400;600;700&family=Nanum+Gothic:wght@400;700;800&display=swap';

export const PORTFOLIO_THEMES: PortfolioTheme[] = [
  {
    id: 'gallery',
    name: '포맷 A',
    summary: '아이보리 배경에 명조체. 작품 1~2점을 크게',
    sizeLabel: '와이드 16:9',
    page: { w: 1600, h: 900, mmW: 297, mmH: 167 },
    worksPerPage: 2,
    bg: '#EDEBE6', ink: '#2E2A24', sub: '#7A7268', accent: '#8A7350', line: '#D6D2C8',
    display: SERIF,
  },
  {
    id: 'studio',
    name: '포맷 B',
    summary: '차콜·오렌지. 큰 시리즈 제목과 3점 그리드',
    sizeLabel: 'A4 가로',
    page: { w: 1414, h: 1000, mmW: 297, mmH: 210 },
    worksPerPage: 3,
    bg: '#FFFFFF', ink: '#1B1B1F', sub: '#8A8A93', accent: '#FF6A00', line: '#E4E4E8',
    display: SANS,
  },
  {
    id: 'story',
    name: '포맷 C',
    summary: '왼쪽에 작품, 오른쪽에 이야기. 매 장 하단에 연락처',
    sizeLabel: 'A4 가로',
    page: { w: 1414, h: 1000, mmW: 297, mmH: 210 },
    worksPerPage: 1,
    bg: '#FFFFFF', ink: '#1A1A1A', sub: '#8A8A8A', accent: '#c4302b', line: '#E8E8E8',
    display: SANS,
  },
  {
    id: 'archive',
    name: '포맷 D',
    summary: '흰 여백과 얇은 테두리. 명조체 문서형',
    sizeLabel: 'A4 세로',
    page: { w: 1000, h: 1414, mmW: 210, mmH: 297 },
    worksPerPage: 2,
    bg: '#FCFBF9', ink: '#232020', sub: '#8B8580', accent: '#5C5550', line: '#E2DED8',
    display: SERIF,
  },
];

export const themeById = (id?: string | null): PortfolioTheme =>
  PORTFOLIO_THEMES.find((t) => t.id === id) ?? PORTFOLIO_THEMES[0];

// ── 가이드형 디자인: 색(배경·글자·강조) · 표지 · 글꼴 · 판형 · 밀도 · 설명 ──────
// ⚠️ 색은 **높이에 영향이 없어** overflow 위험 0. applyDesign 은 파생 테마만 만들고 레이아웃 코드는 안 건드린다.
export type PageKey = 'a4-portrait' | 'a4-landscape' | 'wide';
export type Density = 1 | 2 | 4;
export type DescDepth = 'none' | 'short' | 'full';
/**
 * 작품 페이지 레이아웃(도록 스타일).
 *   hero:대형 단독 / label:뮤지엄 라벨(작품+옆 캡션) / full:전면 /
 *   feature:1점 크게 + 2점 작게(비대칭) / duo:2점 / grid:4점 / index:6점
 */
export type WorksLayout = 'hero' | 'label' | 'full' | 'feature' | 'duo' | 'grid' | 'index';
/** 작품 캡션(글) 배치 — below: 이미지 아래 가운데 / left: 아래 왼쪽 정렬 / minimal: 제목만 */
export type WorksCaption = 'below' | 'left' | 'minimal';
/** 본문(산문) 정렬 — 작가노트·약력·시리즈 소개 등 읽는 글 전체 */
export type ProseAlign = 'justify' | 'left' | 'right';
// ── 표지 = 디자인된 레이아웃(구성) + 자유 재스타일(색·글꼴·글요소 표시) ──
// ⚠️ "자유 축 조합"(이미지 배치/글 위치/정렬을 독립 축으로)은 **폐기**했다 — 대부분 조합이 구성이 죽어
//    "존나 병신같은" 표지가 나왔다(사용자 실측 지적). 표지는 손으로 구성한 레이아웃이 책임진다.
export type CoverLayout =
  // 타이포(이미지 없음)
  | 'serifCenter' | 'stacked' | 'nameplate'
  // 단일 이미지
  | 'bandTop' | 'bandBottom' | 'matted' | 'fullTint' | 'squareHero' | 'side'
  // 여러 작품
  | 'grid2x2' | 'mosaic'
  // 색
  | 'accentField' | 'colorBand' | 'split'
  // 미니멀
  | 'ruleFrame';
export interface PdfDesign {
  /** 색 — 배경/글자/강조를 따로(키). sub·line 은 자동 도출(lib/portfolioColors) */
  bg: string;
  ink: string;
  accent: string;
  /** 글꼴 프리셋(제목+본문) */
  font: FontKey;
  /** 판형(종이 크기) — 표지와 **독립**, 항상 명시값 */
  page: PageKey;
  /** 작품 페이지 레이아웃(도록 스타일). 한 페이지 작품 수도 이걸로 정해진다. */
  worksLayout: WorksLayout;
  /** 작품 설명 깊이 */
  desc: DescDepth;
  /** 작품 캡션(글) 배치 */
  worksCaption: WorksCaption;
  // ── 표지(디자인 레이아웃) ──
  /** 레이아웃 = 표지의 구성(위치·크기·관계). 6종 중 하나. */
  coverLayout: CoverLayout;
  // 글 요소 표시/숨김 — 세팅 메뉴에서 뺐다. 기본 전부 표시, **미리보기 표지에서 인라인으로** 끈다.
  coverEyebrow: boolean;   // "ARTWORK PORTFOLIO" 머리말
  /** 인라인 편집: 영문 머리말 문구 override(없으면 기본 'ARTWORK PORTFOLIO') */
  coverEyebrowText: string | null;
  /** 인라인 편집: 표지 그림이 자기 영역을 채우는 비율(0.6~1.0) */
  coverImageScale: number;
  /** 인라인 편집: 표지 이름/글자 크기 배율(0.8~1.25) */
  coverTextScale: number;
  coverYear: boolean;      // 연도
  /** 이름 색: 강조색 사용 (인라인 편집) */
  coverNameAccent: boolean;
  /** 인라인 편집: 표지 슬롯에 넣을 작품 id를 **순서대로**. 비어 있으면 포트폴리오 순서(자동).
   *  단일 표지는 [0]이 대표작, 여러작품 표지는 앞에서부터 각 칸. 슬롯을 지우면 이 배열에서 빠진다. */
  coverImageIds: number[];
  /** 본문(산문) 정렬 — 전체 읽는 글에 적용 */
  proseAlign: ProseAlign;
  // ── 아트디렉션 ────────────────────────────────────────────────────
  /**
   * 자동 편집(아트디렉션) 여부.
   *
   * `true` 면 **작품 배치를 페이지마다 시스템이 정한다** — `worksLayout` 은 무시된다.
   * 작품 수·시리즈 길이·비율에 맞춰 대형/비대칭/격자를 섞어 리듬을 만든다(`planWorkPages`).
   * 표지·색·글꼴·판형은 그대로 사용자 값(방향이 정한 값)을 쓴다.
   *
   * ⚠️ **저장된 옛 설정을 함부로 auto 로 켜지 말 것.** 이미 `worksLayout`/`coverLayout` 을
   *    고른 사람은 그게 의도다 — `normalizePdfDesign` 이 "저장값이 있으면 false" 로 눕힌다.
   *    새로 만드는 사람에게만 기본 true 다.
   */
  auto: boolean;
  /** 고른 디자인 방향 키(lib/portfolioDirection). 화면 표시용 — 엔진은 안 본다. */
  direction: string | null;
}

export const PAGE_DIMS: Record<PageKey, PortfolioTheme['page']> = {
  'a4-portrait':  { w: 1000, h: 1414, mmW: 210, mmH: 297 },
  'a4-landscape': { w: 1414, h: 1000, mmW: 297, mmH: 210 },
  'wide':         { w: 1600, h: 900,  mmW: 297, mmH: 167 },
};

/** 저장값(문자열/객체/null/오염) → 항상 유효한 PdfDesign. 알 수 없으면 기본값. 옛 `palette`(white/ivory/dark)도 마이그레이션. */
export function normalizePdfDesign(raw: unknown): PdfDesign {
  let v: any = raw;
  if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { v = null; } }
  const o = v && typeof v === 'object' ? v : {};
  // 옛 palette → 배경/글자 마이그레이션 (bg 가 없을 때만)
  const legacy: Record<string, { bg: string; ink: string }> = {
    white: { bg: 'white', ink: 'black' }, ivory: { bg: 'ivory', ink: 'brown' }, dark: { bg: 'ink', ink: 'white' },
  };
  const mig = !isBgKey(o.bg) && typeof o.palette === 'string' ? legacy[o.palette] : undefined;
  const bg = isBgKey(o.bg) ? o.bg : (mig?.bg ?? 'white');
  const inList = <T,>(list: readonly T[], v: unknown): v is T => list.includes(v as T);
  // 표지 레이아웃 — 명시값이 없으면 bandTop(기본). 옛 이미지없음 토글 → serifCenter(타이포). 옛 6키는 새 키로 매핑.
  const layouts = [
    'serifCenter', 'stacked', 'nameplate',
    'bandTop', 'bandBottom', 'matted', 'fullTint', 'squareHero', 'side',
    'grid2x2', 'mosaic', 'accentField', 'colorBand', 'split', 'ruleFrame',
  ] as const;
  // 없어진 표지 키 → **같은 그룹에서 가장 가까운 현행 표지**.
  // ⚠️ 기본값(bandTop)으로 떨어뜨리지 말 것 — 고른 사람 입장에서 '사진 없는 타이포 표지'가
  //    갑자기 '사진 표지'로 바뀌는 건 사고로 보인다. 표지를 없앨 땐 여기 한 줄을 반드시 추가할 것.
  const RETIRED: Record<string, CoverLayout> = {
    // 옛 6프리셋 (2026-08 이전)
    editorial: 'bandTop', gallery: 'matted', minimal: 'serifCenter', frame: 'ruleFrame', band: 'colorBand',
    overlap: 'fullTint',                             // 이름 겹침 (2026-08-30 삭제)
    // 2026-09-04 삭제분
    editorialLeft: 'stacked', baseline: 'stacked',   // 큰 이름 타이포 → 가운데(여백)
    poster: 'fullTint',                              // 큰 이름+사진 → 사진 크게
    triptych: 'grid2x2', filmstrip: 'grid2x2',       // 3점 가로 · 이름+작품 띠 → 4점 격자
    corner: 'ruleFrame',                             // 구석·여백 → 얇은 테두리
  };
  const noImage = o.coverImage === false || o.coverImagePlace === 'none';
  const coverLayout: CoverLayout = inList(layouts, o.coverLayout) ? o.coverLayout
    : (typeof o.coverLayout === 'string' && RETIRED[o.coverLayout]) ? RETIRED[o.coverLayout]
    : (noImage ? 'serifCenter' : 'bandTop');
  return {
    bg,
    ink: isTextKey(o.ink) ? o.ink : (mig?.ink ?? bestTextKey(bg)),
    accent: isAccentKey(o.accent) ? o.accent : 'red',
    font: (typeof o.font === 'string' && o.font in FONT_BY_KEY) ? o.font : (o.font === 'sans' ? 'gothic' : 'myeongjo'),
    page: (['a4-portrait', 'a4-landscape', 'wide'] as const).includes(o.page) ? o.page : 'a4-portrait',
    // 작품 레이아웃 — 명시값 없으면 hero(대형 단독). 옛 density(1/2/4) → hero/duo/grid 마이그레이션.
    worksLayout: inList(['hero', 'label', 'full', 'feature', 'duo', 'grid', 'index'] as const, o.worksLayout) ? o.worksLayout
      : (o.density === 1 ? 'hero' : o.density === 4 ? 'grid' : o.density === 2 ? 'duo' : 'hero'),
    desc: (['none', 'short', 'full'] as const).includes(o.desc) ? o.desc : 'none',
    worksCaption: (['below', 'left', 'minimal'] as const).includes(o.worksCaption) ? o.worksCaption : 'below',
    coverLayout,
    coverEyebrow: o.coverEyebrow !== false,
    coverEyebrowText: typeof o.coverEyebrowText === 'string' ? o.coverEyebrowText : null,
    coverImageScale: typeof o.coverImageScale === 'number' ? Math.min(1, Math.max(0.6, o.coverImageScale)) : 1,
    coverTextScale: typeof o.coverTextScale === 'number' ? Math.min(1.25, Math.max(0.8, o.coverTextScale)) : 1,
    coverYear: o.coverYear !== false,
    coverNameAccent: typeof o.coverNameAccent === 'boolean' ? o.coverNameAccent : false,
    coverImageIds: Array.isArray(o.coverImageIds)
      ? o.coverImageIds.filter((n: unknown): n is number => typeof n === 'number')
      : (typeof o.coverImageId === 'number' ? [o.coverImageId] : []), // 옛 단일값 마이그레이션
    proseAlign: (['justify', 'left', 'right'] as const).includes(o.proseAlign) ? o.proseAlign : 'left',
    // ⚠️ 하위호환: **이미 저장된 설정이 있으면 auto 를 켜지 않는다.** 그 사람은 배치를 직접 골랐고,
    //    갑자기 다른 배치로 바뀌면 "내가 만든 게 사라졌다"가 된다. 아무것도 저장 안 된 새 사용자만 auto.
    auto: typeof o.auto === 'boolean' ? o.auto : !hasSavedChoice(o),
    direction: typeof o.direction === 'string' ? o.direction : null,
  };
}

/** 사용자가 실제로 뭔가 고른 적이 있는 저장값인가 — auto 기본값 판정용 */
function hasSavedChoice(o: Record<string, unknown>): boolean {
  return ['worksLayout', 'coverLayout', 'density', 'palette', 'bg', 'font', 'page', 'desc']
    .some((k) => o[k] !== undefined && o[k] !== null);
}

/** 디자인을 입힌 **파생 테마** — 색(배경/글자/강조)·판형·밀도·글꼴을 갈아끼운다. 여백(PAD)·표지는 스타일 것 유지. */
export function applyDesign(theme: PortfolioTheme, design?: PdfDesign | null): PortfolioTheme {
  const d = design ?? normalizePdfDesign(null);
  const colors = resolvePalette(d.bg, d.ink, d.accent);
  const page = PAGE_DIMS[d.page] ?? PAGE_DIMS['a4-portrait'];
  const fp = FONT_BY_KEY[d.font] ?? FONT_BY_KEY['myeongjo'];
  return { ...theme, ...colors, page, worksPerPage: WORKS_PER_PAGE[d.worksLayout], display: fp.title, bodyFont: fp.body, titleSerif: fp.serif, proseAlign: d.proseAlign };
}
/** 작품 레이아웃별 한 페이지 작품 수 */
export const WORKS_PER_PAGE: Record<WorksLayout, number> = { hero: 1, label: 1, full: 1, feature: 3, duo: 2, grid: 4, index: 6 };

// ── 입력 데이터 ──
export interface PortfolioBookData {
  user: { name: string; nickname?: string | null; email?: string | null; phone?: string | null; instagramUrl?: string | null };
  tagline?: string | null;
  statement?: string | null;
  biography?: string | null;
  career?: PublicPortfolio['career'];
  seriesInfo?: SeriesInfo[] | null;
  images: PortfolioImage[];
  /** 표지에 찍히는 연도 (미지정 시 올해) */
  year?: string;
  /**
   * 사진 비율 실측값 (url → 가로/세로). `lib/artworkAnalysis` 의 `measureAspects` 가 채운다.
   *
   * ⚠️ **없어도 문서는 그대로 나온다** — 전부 정사각으로 보고 배치할 뿐이다(옛 동작).
   *    빌더가 순수 동기 함수여야 미리보기와 PDF 가 어긋나지 않으므로(이 파일 머리말),
   *    측정은 밖에서 하고 결과만 여기로 넘긴다.
   */
  aspects?: Record<string, number> | null;
}

export interface PortfolioPage {
  /** 미리보기 썸네일 아래 라벨 */
  label: string;
  html: string;
  /**
   * 이 장이 어떤 성격인가 — 화면의 **전체 구성 보기**(§24)와 "왜 이렇게 배치했는지"(§25) 안내에 쓴다.
   * 페이지 HTML 을 다시 파싱해 알아내는 건 못 미덥다(빌더가 아는 사실을 그대로 넘긴다).
   */
  kind?: 'cover' | 'prose' | 'works' | 'cv' | 'contact';
  /** 이 장에 실린 작품 수 (kind==='works' 또는 시리즈 여는 장) */
  works?: number;
  /** 쓰인 배치 이름 (kind==='works') */
  composition?: WorksLayout;
}

const CV_ORDER: { key: CareerKey; label: string; en: string }[] = [
  { key: 'education', label: '학력', en: 'EDUCATION' },
  { key: 'solo', label: '개인전', en: 'SOLO EXHIBITIONS' },
  { key: 'group', label: '단체전', en: 'GROUP EXHIBITIONS' },
  { key: 'artFair', label: '아트페어', en: 'ART FAIRS' },
  { key: 'award', label: '수상 및 선정', en: 'AWARDS' },
];

// instagram.com/handle → @handle
function igLabel(url?: string | null): string {
  if (!url) return '';
  const m = url.match(/instagram\.com\/([^/?#]+)/i);
  return m ? `@${m[1]}` : url;
}

const contactList = (u: PortfolioBookData['user']) =>
  [u.email, u.phone, igLabel(u.instagramUrl)].map((s) => String(s ?? '').trim()).filter(Boolean);

// ── 긴 글 나누기 ──
// 페이지가 고정 크기라 글이 길면 **넘치는 만큼 그대로 잘려 나간다**(표시도 없이).
// 실서버에 작가노트 3,316자짜리 작가가 있었고, 4개 포맷 전부에서 최대 1,154px가 잘리고 있었다.
// 빌더가 DOM 없는 순수 함수라 실측이 불가능하므로 **넉넉하게 추정**한다 — 남는 건 괜찮고 넘치면 글이 사라진다.

/** 한글은 글자 하나가 거의 1em을 먹는다. 라틴/공백이 섞이면 더 좁아지므로 이 값이면 보수적이다. */
const CHAR_W_RATIO = 0.95;

/** 문단 하나의 높이 추정 (줄바꿈 포함) */
export function estimateParaH(text: string, fontPx: number, lineH: number, colW: number, gap: number): number {
  const perLine = Math.max(1, Math.floor(colW / (fontPx * CHAR_W_RATIO)));
  const lines = text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
  return lines * lineH + gap;
}

/**
 * 문단들을 페이지 용량에 맞춰 나눈다.
 * 한 문단이 통째로 한 페이지보다 크면 그 문단은 줄 단위로 쪼갠다(안 그러면 영원히 안 들어간다).
 */
export function splitParagraphs(
  paras: string[], firstCap: number, restCap: number,
  fontPx: number, lineH: number, colW: number, gap: number,
): string[][] {
  const perLine = Math.max(1, Math.floor(colW / (fontPx * CHAR_W_RATIO)));
  const pages: string[][] = [];
  let cur: string[] = [];
  let used = 0;
  let cap = firstCap;
  const flush = () => { if (cur.length) { pages.push(cur); cur = []; } used = 0; cap = restCap; };

  /**
   * 문단에서 `maxLines` 줄만큼 떼어낸다.
   *
   * ⚠️ 문단 안의 `\n` 은 화면에서 `<br/>` 로 그대로 줄을 바꾼다. 그래서 **글자 수로만 자르면 안 된다** —
   * 빈 줄 없이 줄바꿈만 여러 번 쓴 약력(작가들이 흔히 이렇게 쓴다)에서 떼어낸 조각의 실제 줄 수가
   * 예상보다 훨씬 많아져 마지막 장이 100px 넘게 넘쳤다(실측). 줄 단위로 세어가며 떼어낸다.
   */
  const takeLines = (text: string, maxLines: number): { head: string; rest: string } => {
    const src = text.split('\n');
    const head: string[] = [];
    let lines = 0;
    for (let i = 0; i < src.length; i++) {
      const need = Math.max(1, Math.ceil(src[i]!.length / perLine));
      if (lines + need <= maxLines) { head.push(src[i]!); lines += need; continue; }
      // 이 줄은 일부만 들어간다 — 가능하면 공백에서 끊어 단어가 갈라지지 않게
      const room = maxLines - lines;
      if (room > 0) {
        const cut = room * perLine;
        const sp = src[i]!.slice(0, cut).lastIndexOf(' ');
        const at = sp > cut * 0.6 ? sp : cut;
        head.push(src[i]!.slice(0, at).trimEnd());
        src[i] = src[i]!.slice(at).trimStart();
      }
      return { head: head.join('\n'), rest: src.slice(i).join('\n') };
    }
    return { head: head.join('\n'), rest: '' };
  };

  for (const raw of paras) {
    let text = raw;
    while (text) {
      const h = estimateParaH(text, fontPx, lineH, colW, gap);
      if (used + h <= cap) { cur.push(text); used += h; break; }
      // 남은 공간에 들어갈 만큼만 잘라 넣는다
      const room = cap - used - gap;
      const fitLines = Math.floor(room / lineH);
      if (fitLines >= 2) {
        const { head, rest } = takeLines(text, fitLines);
        if (head) cur.push(head);
        text = rest;
      }
      flush();
      if (fitLines < 2 && used === 0 && cap <= gap) break; // 안전장치 (용량이 비정상)
    }
  }
  flush();
  return pages.length ? pages : [[]];
}


/**
 * 작품 이미지 태그.
 *
 * ⚠️ **작품은 절대 자르거나 늘리지 않는다.** 회화에서 비율은 작품 그 자체다.
 * 그래서 여기서 `object-fit`을 강제로 `contain`으로 고정한다 — 호출부가 `cover`/`fill`을 적어도 무시된다.
 * (표지를 예쁘게 만들려다 `cover`로 깔아 그림이 잘린 적이 있다. 실수로도 못 하게 막는다.
 *  회귀 방지 테스트: `portfolioFormats.test.ts` — 모든 페이지 HTML에 cover/fill이 없어야 통과)
 * 크기는 반드시 `max-width`/`max-height`로만 주고, `width`/`height`를 함께 못 박지 말 것.
 */
/**
 * 이미지 주소 결정 방식. `buildPortfolioPages`가 시작할 때 정하고 그 **동기 실행 동안만** 유효하다.
 *  - 'display'(미리보기): 원본 주소를 그대로 쓴다. 화면에 그리는 것뿐이라 프록시가 필요 없다.
 *    예전엔 미리보기도 프록시를 태웠는데, 페이지 수만큼 백엔드 왕복이 생기고
 *    프록시가 설정 안 된 환경에서는 **사진이 통째로 깨졌다**(로컬에서 실서버 데이터 볼 때).
 *  - 'pdf': prefetch가 만들어 둔 blob(동일 출처 → canvas taint 없음), 없으면 프록시로 폴백.
 */
let imgMode: 'display' | 'pdf' = 'display';
// 표지 이미지 채움 비율(0.6~1.0) — 표지 렌더 동안만 설정, 끝나면 1로 복원. heroBox/gridCell/cImg(표지 전용)만 참조.
let coverImgScale = 1;

const img = (url: string, style: string) => {
  const pdf = imgMode === 'pdf';
  // ⚠️ 미리보기에는 crossorigin을 붙이면 안 된다.
  // 같은 사진을 화면 어딘가(작품 그리드 등)에서 **crossorigin 없는 <img>** 로 먼저 그리면
  // 브라우저 캐시에 'CORS 정보 없는' 항목이 남는다. 그 뒤 crossorigin="anonymous" 로 같은 주소를
  // 요청하면 그 캐시 항목을 재사용하며 **차단**된다(서버 헤더는 정상인데도). 그러면 미리보기에서
  // 사진이 통째로 안 뜬다 — 실제로 그랬다. CLAUDE.md 제약 16의 <img> 버전.
  // 화면에 그리는 데는 CORS가 필요 없으므로 PDF 경로에서만 붙인다.
  return `<img src="${esc(pdf ? proxied(url) : url)}"${pdf ? ' crossorigin="anonymous"' : ''} style="${style};object-fit:contain"/>`;
};

// ── 페이지 껍데기 ──
// 모든 페이지는 정확히 판형 크기의 박스다. 여기서 배경·기본 글꼴·러닝 요소(머리말/꼬리말)를 씌운다.
interface Chrome {
  /** 좌상단 러닝 라벨 (시리즈명 등) */
  running?: string;
  /** 러닝 요소를 아예 끄는 페이지(표지 등) */
  bare?: boolean;
}

/**
 * 판형별 본문 영역(패딩). 페이지 안 내용의 세로 크기는 반드시 이 값에서 계산해야 한다 —
 * 상수를 각자 손으로 적었더니 아카이브에서 머리말과 작품이 겹치고, 스토리 전시전경이
 * 하단 연락처 줄을 뚫고 나갔다. 한 곳에서만 정의한다.
 */
// ⚠️ **여백은 비율이어야 한다 — 상수로 두면 판형을 바꿀 때 작품이 조용히 작아진다.**
// 예전엔 테마별 픽셀 상수 하나였는데, `applyDesign` 이 판형(page)만 갈아끼우므로 그 값이
// 크기가 다른 지면에 그대로 쓰였다. 상하 224px 은 A4 세로(1414)에서 15.8% 지만
// 와이드(900)에서는 **24.9%** — 같은 설정인데 지면의 4분의 1이 여백이 된다.
// 레퍼런스(실제 작가 포트폴리오 5종·작품 319점) 실측 최소여백은 **짧은 변의 6%**(중앙값),
// 하위 25% 는 재단선까지 나간다. 우리가 넓었고 그만큼 작품이 작았다.
// 비율의 분모는 **각 테마의 원래 판형**이라 그 판형에서는 기존 픽셀값이 그대로 재현된다(회귀 없음).
const PAD_RATIO: Record<PortfolioThemeId, { top: number; bottom: number; x: number; refW: number; refH: number }> = {
  gallery: { top: 76, bottom: 70, x: 96, refW: 1600, refH: 900 },
  // 하단에 룰 + 러닝 푸터가 앉는다
  studio: { top: 72, bottom: 96, x: 78, refW: 1414, refH: 1000 },
  story: { top: 112, bottom: 108, x: 84, refW: 1414, refH: 1000 },
  // 상단 머리말(runTop + 룰)을 반드시 지나야 한다
  archive: { top: 132, bottom: 92, x: 82, refW: 1000, refH: 1414 },
};
/** 러닝 요소(머리말·꼬리말)가 앉는 자리. 이것도 지면에 비례해야 여백과 함께 움직인다. */
const runTop = (theme: PortfolioTheme, base: number) =>
  Math.round(base * (theme.page.h / PAD_RATIO[theme.id].refH));
/** 러닝 머리말 덩어리의 실제 높이(11.5px 글자 + 아래 여백 + 룰). 글꼴 크기가 고정이라 안 줄어든다. */
const RUN_H = 27;

/** 판형에 맞춘 본문 여백. 머리말과 겹치지 않도록 위쪽에 바닥을 둔다. */
const PAD = (theme: PortfolioTheme): { top: number; bottom: number; x: number } => {
  const r = PAD_RATIO[theme.id];
  const { w, h } = theme.page;
  // 머리말은 고정 높이라 지면이 짧아져도 안 줄어든다 — 비율만 믿으면 겹친다.
  const floor = runTop(theme, 56) + RUN_H + 14;
  return {
    top: Math.max(floor, Math.round(r.top * (h / r.refH))),
    bottom: Math.round(r.bottom * (h / r.refH)),
    x: Math.round(r.x * (w / r.refW)),
  };
};
/** 본문에 실제로 쓸 수 있는 세로 크기 */
const availH = (theme: PortfolioTheme) => { const p = PAD(theme); return theme.page.h - p.top - p.bottom; };

// ── 캡션 높이 상수 (전부 실측) ──
// ⚠️ 지어내지 말 것. 아래 값은 글꼴 6종 전부에서 잰 것이다(capmeasure).
//   제목 한 줄 21(고딕)~26(명조) · 보조 한 줄 15~17 + 위 여백 5 · 설명 한 줄 20 · 블록 위 여백 18.
//   예전 상수(제목 28 · 보조 23 · 기본 20)는 실제보다 커서 **그 차이만큼 작품이 작아졌다** —
//   격자에서 캡션 예약이 한 행의 40% 를 먹었고 실제 캡션은 그 3분의 2였다.
//   ⚠️ SAFETY(24)는 줄이지 말 것 — 글꼴 버전·기기 편차용 쿠션이라 별개다(CLAUDE.md 19번).
const CAP_TOP = 18;          // 캡션 블록 위 여백(margin-top)
const CAP_TITLE_LINE = 27;   // 제목 한 줄 (명조 26 + 1)
const CAP_META_LINE = 22;    // 보조 한 줄 (17 + 위 여백 5)
const CAP_DESC_TOP = 8;      // 설명 블록 위 여백

function page(theme: PortfolioTheme, data: PortfolioBookData, inner: string, chrome: Chrome = {}): string {
  const { w, h } = theme.page;
  const shell = (content: string, bg = theme.bg) =>
    `<div style="position:relative;width:${w}px;height:${h}px;background:${bg};font-family:${theme.bodyFont ?? SANS};color:${theme.ink};overflow:hidden;box-sizing:border-box">${content}</div>`;

  if (chrome.bare) return shell(inner);

  const name = displayName(data.user);
  const p = PAD(theme);
  let deco = '';
  let pad = `padding:${p.top}px ${p.x}px ${p.bottom}px`;

  if (theme.id === 'gallery') {
    // 무장식. 여백 자체가 이 포맷의 성격이다.
    deco = chrome.running
      ? `<div style="position:absolute;top:40px;left:${p.x}px;font-size:12px;letter-spacing:0.26em;color:${theme.sub}">${esc(chrome.running.toUpperCase())}</div>`
      : '';
  } else if (theme.id === 'studio') {
    // 하단 얇은 룰 + 러닝 푸터만. 시리즈 제목은 페이지 '내용'이 직접 그린다(worksPages) —
    // 머리말 장식에 시리즈명을 넣어두면 시리즈를 안 쓰는 작가에게 **내용 없는 빈 띠**만 남는다.
    deco = `
      <div style="position:absolute;left:${p.x}px;right:${p.x}px;bottom:44px">
        <div style="height:1px;background:${theme.line}"></div>
        <div style="margin-top:13px;display:flex;justify-content:space-between;align-items:center;
                    font-size:11.5px;letter-spacing:0.2em;color:${theme.sub}">
          <span style="display:flex;align-items:center;gap:9px">
            <span style="display:inline-block;width:9px;height:9px;background:${theme.accent}"></span>
            <span style="color:${theme.ink};font-weight:700;letter-spacing:0.06em">${esc(name)}</span>
          </span>
          <span>${esc((chrome.running || '').toUpperCase())}</span>
        </div>
      </div>`;
  } else if (theme.id === 'story') {
    // 좌상단 레드 대시 + 러닝 제목, 하단 연락처 스트립 — 어느 장을 캡처해 공유해도 연락처가 함께 남는다
    const cs = contactList(data.user);
    deco = `
      <div style="position:absolute;top:52px;left:${p.x}px;display:flex;align-items:center;gap:14px">
        <span style="display:inline-block;width:34px;height:7px;background:${theme.accent}"></span>
        <span style="font-size:26px;font-weight:800;letter-spacing:-0.01em">${esc(chrome.running || name)}</span>
      </div>
      <div style="position:absolute;bottom:0;left:0;width:${w}px;padding:0 ${p.x}px 34px;box-sizing:border-box">
        <div style="border-top:1px solid ${theme.line};padding-top:16px;display:flex;gap:34px;font-size:14px;color:${theme.sub}">
          <span style="color:${theme.ink};font-weight:700">${esc(name)}</span>
          ${cs.map((c) => `<span>${esc(c)}</span>`).join('')}
        </div>
      </div>`;
  } else {
    // archive — 얇은 상단 룰과 하단 러닝 라인. 문서다운 정숙함.
    // ⚠️ 머리말 자리도 **여백과 같은 비율로** 내린다. 여백만 비례시키고 이걸 56px 로 두면
    //    짧은 판형(와이드 900)에서 머리말이 본문 시작선을 넘어 작품과 겹친다.
    deco = `
      <div style="position:absolute;top:${runTop(theme, 56)}px;left:${p.x}px;right:${p.x}px;display:flex;justify-content:space-between;
                  border-bottom:1px solid ${theme.line};padding-bottom:12px;font-size:11.5px;letter-spacing:0.2em;color:${theme.sub}">
        <span>${esc((chrome.running || 'PORTFOLIO').toUpperCase())}</span>
        <span>${esc(name)}</span>
      </div>`;
  }

  return shell(`${deco}<div style="position:relative;width:${w}px;height:${h}px;box-sizing:border-box;${pad};display:flex;flex-direction:column">${inner}</div>`);
}

// ── 표지 = 디자인된 레이아웃(20종) ──
// ⚠️ 대표작은 어디서도 자르지 않는다(object-fit:contain via img()). 크롭 금지 — 회귀 테스트가 잡는다.
// 각 레이아웃은 손으로 구성한 '진짜 디자인'이다(위계·균형·여백). 색·글꼴은 theme 토큰이라 자유 재스타일.
// ⚠️ 실서버 40명 조사 결과: 한줄소개 0명·작가노트 대부분 없음·작품 중앙 8점. 그래서 표지는
//    **이름 + (선택)대표작/여러작품 + 연도**만으로 아름다워야 한다(태그라인 의존 금지, 있으면 보너스).
// 안전: 표지는 고정 page(overflow:hidden) 안 absolute라 페이지를 못 넘긴다. 이름은 fitTitle 로 자동 축소,
//    한 줄 소개는 line-clamp 로 바운드. 회귀는 cover-layout-audit.mjs(전 레이아웃×최악콘텐츠) 로 0 확인.

interface CoverArgs {
  name: string; year: string; hero?: string; images: string[]; eyebrow: string;
  showEyebrow: boolean; showYear: boolean; nameAccent: boolean; textScale: number;
}

const EYEBROW = 'ARTWORK PORTFOLIO';
// 이름 글자 크기를 슬롯 폭에 맞춘다 — basePx 에서 시작해 maxLines 안에 들어올 때까지 줄인다(minPx 하한).
function fitTitle(name: string, basePx: number, slotW: number, maxLines: number, minPx = 32): number {
  let px = basePx;
  while (px > minPx && Math.ceil((name.length * px * 0.98) / Math.max(1, slotW)) > maxLines) px -= 2;
  return px;
}
// 슬라이더(글자 크기 배율) 적용 후 fit — base·min 을 textScale 로 늘리거나 줄인다. 여전히 폭·줄수로 바운드(안전).
function ft(v: CoverArgs, base: number, slotW: number, maxLines: number, minPx = 32): number {
  return fitTitle(v.name, Math.round(base * v.textScale), slotW, maxLines, Math.max(18, Math.round(minPx * v.textScale)));
}
// 표지 전용 이미지 — coverImgScale(그림 크기 슬라이더) 반영. body 는 이 헬퍼를 안 쓴다.
const cImg = (url: string, maxWpct: number, maxHpct: number, extra = '') =>
  img(url, `max-width:${Math.round(maxWpct * coverImgScale)}%;max-height:${Math.round(maxHpct * coverImgScale)}%;display:block${extra}`);
// 이미지 + **주변 음영(패널)이 함께** 축소되게 — 그림 크기 슬라이더가 이미지만 줄이면 패널이 남아 어색했다.
// 패널을 영역의 coverImgScale% 로 만들고 그 안을 이미지가 100% 채운다(비율 유지). 패널·그림이 같이 줄어든다.
const fillImg = (url: string) => img(url, 'max-width:100%;max-height:100%;display:block');
const panelBox = (bg: string | undefined, inner: string) =>
  `<div style="width:${Math.round(100 * coverImgScale)}%;height:${Math.round(100 * coverImgScale)}%;display:flex;align-items:center;justify-content:center;${bg ? `background:${bg};` : ''}box-sizing:border-box;overflow:hidden">${inner}</div>`;
const titleCss = (theme: PortfolioTheme, px: number, color: string, ls: string) =>
  `font-family:${theme.display};font-size:${px}px;line-height:1.06;font-weight:${theme.titleSerif ? 400 : 800};letter-spacing:${ls};color:${color};word-break:keep-all;overflow-wrap:anywhere`;
const heroBox = (hero: string, x: string, panel?: string) =>
  `<div style="position:absolute;${x};display:flex;align-items:center;justify-content:center;box-sizing:border-box">
     ${panelBox(panel, fillImg(hero))}</div>`;
// 여러 작품 그리드 셀 — contain(크롭 금지), 소프트 패널 위에. url 이 비면 **빈 칸**(패널만).
const gridCell = (theme: PortfolioTheme, url: string) =>
  `<div style="display:flex;align-items:center;justify-content:center;overflow:hidden">${panelBox(softPanel(theme), url ? fillImg(url) : '')}</div>`;

type CoverRender = (theme: PortfolioTheme, data: PortfolioBookData, v: CoverArgs) => string;

// 소프트 패널색 — 이미지 뒤에 까는 옅은 면(배경과 살짝 다르게). 글자색을 배경에 5% 섞는다.
// ⚠️ **CSS `color-mix()` 로 쓰지 말 것.** 크롬은 이걸 `color(srgb …)` 로 계산해 내리는데
//    html2canvas 1.4.1 이 `color()` 를 파싱하다 던져 **PDF 저장이 통째로 실패**한다
//    (표지 21종 중 13종 · 작품 레이아웃 6종 중 4종이 이 함수를 쓴다 = 조합의 87%).
//    PPTX 는 더 나쁘다 — `hexOf()` 가 `rgba?()` 만 받아 null 이 되고 배경 도형이 조용히 빠진다.
//    화면(크롬)에서는 둘 다 멀쩡해 보여서 눈으로는 절대 안 잡힌다. hex 로 미리 섞어 둘 것.
const softPanel = (theme: PortfolioTheme) => mixHex(theme.ink, theme.bg, 0.95);
const nc = (theme: PortfolioTheme, v: CoverArgs) => (v.nameAccent ? theme.accent : theme.ink);
const metaLine = (v: CoverArgs) => [v.showEyebrow ? esc(v.eyebrow) : '', v.showYear ? esc(v.year) : ''].filter(Boolean).join(' · ');
const shell = (theme: PortfolioTheme, data: PortfolioBookData, inner: string) =>
  page(theme, data, `<div style="position:absolute;inset:0;background:${theme.bg}"></div>${inner}`, { bare: true });

// ── 타이포(이미지 없음) ──
const coverSerifCenter: CoverRender = (t, d, v) => { const { w } = t.page; const px = ft(v, 92, w - 260, 2);
  return shell(t, d, `<div style="position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;padding:0 130px;box-sizing:border-box">
    ${v.showEyebrow ? `<div style="font-size:12px;letter-spacing:0.5em;color:${t.sub}">${esc(v.eyebrow)}</div>` : ''}
    <div style="margin-top:40px;${titleCss(t, px, nc(t, v), '0.1em')};text-align:center">${esc(v.name)}</div>
    <div style="margin:38px auto 0;width:64px;height:2px;background:${t.accent}"></div>
    ${v.showYear ? `<div style="margin-top:34px;font-size:15px;letter-spacing:0.4em;color:${t.sub}">${esc(v.year)}</div>` : ''}
</div>`); };

const coverStacked: CoverRender = (t, d, v) => { const P = 96, px = ft(v, 118, t.page.w - 2 * P, 2);
  return shell(t, d, `
    ${v.showEyebrow ? `<div style="position:absolute;left:${P}px;right:${P}px;top:120px;font-size:12px;letter-spacing:0.5em;color:${t.sub}">${esc(v.eyebrow)}</div>` : ''}
    <div style="position:absolute;left:${P}px;right:${P}px;top:46%;transform:translateY(-50%);text-align:center"><div style="${titleCss(t, px, nc(t, v), '0.14em')};text-align:center">${esc(v.name)}</div>
</div>
    <div style="position:absolute;left:${P}px;right:${P}px;bottom:120px;display:flex;justify-content:space-between;font-size:13px;letter-spacing:0.34em;color:${t.sub}"><span>SELECTED WORKS</span>${v.showYear ? `<span>${esc(v.year)}</span>` : '<span></span>'}</div>`); };


const coverNameplate: CoverRender = (t, d, v) => { const px = ft(v, 72, t.page.w - 400, 2);
  return shell(t, d, `<div style="position:absolute;left:170px;right:170px;top:50%;transform:translateY(-50%);border:1px solid ${t.line};padding:64px 34px;text-align:center;box-sizing:border-box">
    ${v.showEyebrow ? `<div style="font-size:12px;letter-spacing:0.46em;color:${t.sub};margin-bottom:26px">${esc(v.eyebrow)}</div>` : ''}
    <div style="${titleCss(t, px, nc(t, v), '0.08em')};text-align:center">${esc(v.name)}</div>
    <div style="margin:26px auto 0;width:50px;height:2px;background:${t.accent}"></div>
    ${v.showYear ? `<div style="margin-top:24px;font-size:13px;letter-spacing:0.4em;color:${t.sub}">${esc(v.year)}</div>` : ''}</div>`); };

// ── 단일 이미지 ──
// ⚠️ **사진 높이를 고정하고 글을 그 아래 붙이지 말 것 — 아래가 통째로 빈다.**
// 예전엔 사진이 `height: h*0.5`, 글 블록이 `top: 100+imgH+56` 이라 A4 세로에서 하단 **28.7%**(414px)가
// 빈 채로 남았다(위는 7.1%). 한 줄 소개가 있으면 그 자리를 메우게 돼 있었는데 —
// **실서버 작가 81명 중 한 줄 소개를 채운 사람은 0명**이다. 즉 예외가 아니라 **전원**이 그 표지를 받았다.
// 지금은 위아래를 다 잡은 flex 기둥이다: 글은 바닥에 앉고 사진이 남는 높이를 **전부** 가져간다.
// 소개가 있든 없든 구성이 안 무너진다. 21종을 전수 측정해 비대칭인 건 이것 하나였다
// (`serifCenter`·`nameplate`·`accentField` 는 위아래가 같이 비는 **가운데 정렬**이라 의도된 구성 — 건드리지 말 것).
const coverBandTop: CoverRender = (t, d, v) => { const { w, h } = t.page; const P = 84, slotW = w - 2 * P, px = ft(v, 80, slotW, 2);
  const top = Math.round(h * 0.071), bot = Math.round(h * 0.085);   // 고정 px 금지 — 판형에 비례
  return shell(t, d, `
    <div style="position:absolute;left:${P}px;right:${P}px;top:${top}px;bottom:${bot}px;display:flex;flex-direction:column">
      <div style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center">
        ${v.hero ? panelBox(softPanel(t), fillImg(v.hero)) : ''}
      </div>
      <div style="flex:0 0 auto;margin-top:56px">
        <div style="width:56px;height:4px;background:${t.accent};margin-bottom:22px"></div>
        ${metaLine(v) ? `<div style="font-size:12px;letter-spacing:0.42em;color:${t.sub};margin-bottom:16px">${metaLine(v)}</div>` : ''}
        <div style="${titleCss(t, px, nc(t, v), '0.02em')}">${esc(v.name)}</div>
      </div>
    </div>`); };

const coverBandBottom: CoverRender = (t, d, v) => { const { w, h } = t.page; const P = 90, px = ft(v, 78, w - 2 * P, 2);
  return shell(t, d, `
    <div style="position:absolute;left:${P}px;right:${P}px;top:120px;text-align:center">
      ${v.showEyebrow ? `<div style="font-size:12px;letter-spacing:0.5em;color:${t.sub};margin-bottom:24px">${esc(v.eyebrow)}</div>` : ''}
      <div style="${titleCss(t, px, nc(t, v), '0.06em')};text-align:center">${esc(v.name)}</div>
      <div style="margin:26px auto 0;width:56px;height:2px;background:${t.accent}"></div></div>
    ${v.hero ? heroBox(v.hero, `left:${P}px;right:${P}px;top:${Math.round(h * 0.42)}px;bottom:110px`, softPanel(t)) : ''}
    ${v.showYear ? `<div style="position:absolute;left:0;right:0;bottom:60px;text-align:center;font-size:13px;letter-spacing:0.4em;color:${t.sub}">${esc(v.year)}</div>` : ''}`); };

const coverMatted: CoverRender = (t, d, v) => { const px = ft(v, 70, t.page.w - 200, 2);
  return shell(t, d, `
    <div style="position:absolute;left:0;right:0;top:130px;text-align:center;padding:0 100px;box-sizing:border-box">
      ${v.showEyebrow ? `<div style="font-size:12px;letter-spacing:0.5em;color:${t.sub};margin-bottom:22px">${esc(v.eyebrow)}</div>` : ''}
      <div style="${titleCss(t, px, nc(t, v), '0.08em')};text-align:center">${esc(v.name)}</div></div>
    ${v.hero ? heroBox(v.hero, `left:160px;right:160px;top:420px;bottom:200px;border:1px solid ${t.line};padding:44px`) : ''}
    ${v.showYear ? `<div style="position:absolute;left:0;right:0;bottom:110px;text-align:center;font-size:14px;letter-spacing:0.4em;color:${t.sub}">${esc(v.year)}</div>` : ''}`); };

const coverFullTint: CoverRender = (t, d, v) => { const px = ft(v, 72, t.page.w - 220, 2);
  return page(t, d, `<div style="position:absolute;inset:0;background:${softPanel(t)}"></div>
    ${v.hero ? `<div style="position:absolute;left:0;right:0;top:60px;bottom:260px;display:flex;align-items:center;justify-content:center">${cImg(v.hero, 82, 100)}</div>` : ''}
    <div style="position:absolute;left:0;right:0;bottom:110px;text-align:center;padding:0 110px;box-sizing:border-box">
      <div style="${titleCss(t, px, nc(t, v), '0.06em')};text-align:center">${esc(v.name)}</div>
      ${metaLine(v) ? `<div style="margin-top:18px;font-size:13px;letter-spacing:0.42em;color:${t.sub}">${metaLine(v)}</div>` : ''}</div>`, { bare: true }); };

const coverSquareHero: CoverRender = (t, d, v) => { const { w, h } = t.page; const P = 96, px = ft(v, 60, w - 200, 2);
  const areaH = h - 96 - 320; const sq = Math.round(Math.max(200, Math.min(w - 2 * P, areaH)) * coverImgScale);
  return shell(t, d, `
    ${v.hero ? `<div style="position:absolute;left:0;right:0;top:96px;bottom:320px;display:flex;align-items:center;justify-content:center"><div style="width:${sq}px;height:${sq}px;background:${softPanel(t)};display:flex;align-items:center;justify-content:center">${fillImg(v.hero)}</div></div>` : ''}
    <div style="position:absolute;left:0;right:0;bottom:60px;height:236px;text-align:center;padding:0 100px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center">
      <div style="${titleCss(t, px, nc(t, v), '0.08em')};text-align:center">${esc(v.name)}</div>
      <div style="margin:20px auto 0;width:54px;height:2px;background:${t.accent}"></div>
      ${metaLine(v) ? `<div style="margin-top:16px;font-size:13px;letter-spacing:0.42em;color:${t.sub}">${metaLine(v)}</div>` : ''}
</div>`); };

const coverSide: CoverRender = (t, d, v) => { const { w, h } = t.page; const iw = Math.round(w * 0.52); const slotW = Math.round(w * 0.4) - 6; const px = ft(v, 74, slotW, 3);
  return shell(t, d, `
    ${v.hero ? heroBox(v.hero, `right:0;top:0;height:${h}px;width:${iw}px;padding:60px`, softPanel(t)) : ''}
    <div style="position:absolute;left:90px;width:${Math.round(w * 0.4)}px;top:50%;transform:translateY(-50%)">
      ${v.showEyebrow ? `<div style="font-size:12px;letter-spacing:0.42em;color:${t.accent};font-weight:700;margin-bottom:20px">${esc(v.eyebrow)}</div>` : ''}
      <div style="${titleCss(t, px, nc(t, v), '0.02em')};line-height:1.04">${esc(v.name)}</div>
      <div style="margin-top:26px;width:56px;height:3px;background:${t.accent}"></div>
      ${v.showYear ? `<div style="margin-top:22px;font-size:13px;letter-spacing:0.4em;color:${t.sub}">${esc(v.year)}</div>` : ''}
</div>`); };


const coverGrid2x2: CoverRender = (t, d, v) => { const P = 96, px = ft(v, 56, t.page.w - 2 * P, 2); const g = v.images.slice(0, 4);
  return shell(t, d, `
    <div style="position:absolute;left:${P}px;right:${P}px;top:96px;bottom:300px;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:16px">${g.map((u) => gridCell(t, u)).join('')}</div>
    <div style="position:absolute;left:${P}px;right:${P}px;bottom:60px;height:210px;display:flex;flex-direction:column;justify-content:center">
      <div style="width:56px;height:4px;background:${t.accent};margin-bottom:18px"></div>
      <div style="${titleCss(t, px, nc(t, v), '0.02em')}">${esc(v.name)}</div>
      ${metaLine(v) ? `<div style="margin-top:14px;font-size:12px;letter-spacing:0.42em;color:${t.sub}">${metaLine(v)}</div>` : ''}
</div>`); };


const coverMosaic: CoverRender = (t, d, v) => { const P = 96, px = ft(v, 60, t.page.w - 2 * P, 2); const g = v.images.slice(0, 3);
  return shell(t, d, `
    <div style="position:absolute;left:${P}px;right:${P}px;top:96px;bottom:300px;display:grid;grid-template-columns:2fr 1fr;grid-template-rows:1fr 1fr;gap:16px">
      <div style="grid-row:1 / span 2;overflow:hidden;display:flex;align-items:center;justify-content:center">${panelBox(softPanel(t), g[0] ? fillImg(g[0]) : '')}</div>
      ${gridCell(t, g[1] ?? '')}${gridCell(t, g[2] ?? '')}</div>
    <div style="position:absolute;left:${P}px;right:${P}px;bottom:60px;height:210px;display:flex;flex-direction:column;justify-content:center">
      <div style="${titleCss(t, px, nc(t, v), '0.02em')}">${esc(v.name)}</div>
      ${metaLine(v) ? `<div style="margin-top:14px;font-size:12px;letter-spacing:0.42em;color:${t.sub}">${metaLine(v)}</div>` : ''}
</div>`); };


const coverAccentField: CoverRender = (t, d, v) => { const px = ft(v, 92, t.page.w - 260, 2);
  return page(t, d, `<div style="position:absolute;inset:0;background:${t.accent}"></div>
    <div style="position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;color:${t.bg};padding:0 120px;box-sizing:border-box">
      ${v.showEyebrow ? `<div style="font-size:12px;letter-spacing:0.5em;opacity:.9">${esc(v.eyebrow)}</div>` : ''}
      <div style="margin-top:36px;${titleCss(t, px, t.bg, '0.1em')};text-align:center">${esc(v.name)}</div>
      <div style="margin:34px auto 0;width:60px;height:2px;background:${t.bg};opacity:.8"></div>
      ${v.showYear ? `<div style="margin-top:30px;font-size:14px;letter-spacing:0.4em;opacity:.9">${esc(v.year)}</div>` : ''}
</div>`, { bare: true }); };

const coverColorBand: CoverRender = (t, d, v) => { const { w, h } = t.page; const P = 90, bandH = Math.round(h * 0.32), px = ft(v, 80, w - 2 * P, 2);
  return shell(t, d, `
    <div style="position:absolute;left:0;top:0;width:${w}px;height:${bandH}px;background:${t.accent};color:${t.bg};display:flex;flex-direction:column;justify-content:center;padding:0 ${P}px;box-sizing:border-box">
      ${metaLine(v) ? `<div style="font-size:12px;letter-spacing:0.4em;opacity:.9;margin-bottom:16px">${metaLine(v)}</div>` : ''}
      <div style="${titleCss(t, px, t.bg, '0.02em')}">${esc(v.name)}</div></div>
    ${v.hero ? heroBox(v.hero, `left:${P}px;right:${P}px;top:${bandH + 56}px;bottom:90px`, softPanel(t)) : ''}`); };

const coverSplit: CoverRender = (t, d, v) => { const { w, h } = t.page; const lw = Math.round(w * 0.46); const px = ft(v, 74, lw - 120, 3);
  return shell(t, d, `
    <div style="position:absolute;left:0;top:0;height:${h}px;width:${lw}px;background:${t.accent};color:${t.bg};display:flex;flex-direction:column;justify-content:center;padding:0 60px;box-sizing:border-box">
      ${v.showEyebrow ? `<div style="font-size:12px;letter-spacing:0.4em;opacity:.9;margin-bottom:20px">${esc(v.eyebrow)}</div>` : ''}
      <div style="${titleCss(t, px, t.bg, '0.02em')};line-height:1.05">${esc(v.name)}</div>
      <div style="margin-top:28px;width:56px;height:3px;background:${t.bg};opacity:.85"></div>
      ${v.showYear ? `<div style="margin-top:22px;font-size:13px;letter-spacing:0.4em;opacity:.9">${esc(v.year)}</div>` : ''}</div>
    ${v.hero ? heroBox(v.hero, `right:0;top:0;height:${h}px;left:${lw}px;padding:56px`, softPanel(t)) : ''}`); };

// ── 미니멀 ──

const coverRuleFrame: CoverRender = (t, d, v) => { const { h } = t.page; const px = ft(v, 64, t.page.w - 320, 2);
  return shell(t, d, `
    <div style="position:absolute;inset:52px;border:1px solid ${t.line}"></div>
    <div style="position:absolute;inset:60px;border:1px solid ${t.line}"></div>
    <div style="position:absolute;left:0;right:0;top:150px;text-align:center;padding:0 150px;box-sizing:border-box">
      ${v.showEyebrow ? `<div style="font-size:12px;letter-spacing:0.46em;color:${t.sub};margin-bottom:20px">${esc(v.eyebrow)}</div>` : ''}
      <div style="${titleCss(t, px, nc(t, v), '0.08em')};text-align:center">${esc(v.name)}</div></div>
    ${v.hero ? heroBox(v.hero, `left:150px;right:150px;top:${Math.round(h * 0.32)}px;bottom:210px`) : ''}
    ${v.showYear ? `<div style="position:absolute;left:0;right:0;bottom:110px;text-align:center;font-size:13px;letter-spacing:0.4em;color:${t.sub}">${esc(v.year)}</div>` : ''}`); };

// 라벨·그룹명은 **눈에 보이는 걸 그대로** 쓴다(디자이너 용어 금지 — 작가가 뭘 얻을지 바로 알게).
export type CoverGroup = '사진 없이' | '대표작 1점' | '여러 작품' | '색 배경' | '심플';
export const COVER_LAYOUTS: { key: CoverLayout; label: string; group: CoverGroup; minImages: number; render: CoverRender }[] = [
  { key: 'serifCenter', label: '가운데 정렬', group: '사진 없이', minImages: 0, render: coverSerifCenter },
  { key: 'stacked', label: '가운데(여백)', group: '사진 없이', minImages: 0, render: coverStacked },
  { key: 'nameplate', label: '명패(테두리)', group: '사진 없이', minImages: 0, render: coverNameplate },
  { key: 'bandTop', label: '사진 위·이름 아래', group: '대표작 1점', minImages: 1, render: coverBandTop },
  { key: 'bandBottom', label: '이름 위·사진 아래', group: '대표작 1점', minImages: 1, render: coverBandBottom },
  { key: 'matted', label: '가운데 액자', group: '대표작 1점', minImages: 1, render: coverMatted },
  { key: 'fullTint', label: '사진 크게', group: '대표작 1점', minImages: 1, render: coverFullTint },
  { key: 'squareHero', label: '정사각 사진', group: '대표작 1점', minImages: 1, render: coverSquareHero },
  { key: 'side', label: '사진 오른쪽', group: '대표작 1점', minImages: 1, render: coverSide },
  { key: 'grid2x2', label: '4점 격자', group: '여러 작품', minImages: 4, render: coverGrid2x2 },
  { key: 'mosaic', label: '1점 크게+2점', group: '여러 작품', minImages: 3, render: coverMosaic },
  { key: 'accentField', label: '색 꽉 채움', group: '색 배경', minImages: 0, render: coverAccentField },
  { key: 'colorBand', label: '색 띠+사진', group: '색 배경', minImages: 1, render: coverColorBand },
  { key: 'split', label: '반색·반사진', group: '색 배경', minImages: 1, render: coverSplit },
  { key: 'ruleFrame', label: '얇은 테두리', group: '심플', minImages: 1, render: coverRuleFrame },
];
const COVER_META: Record<string, { minImages: number; render: CoverRender }> = Object.fromEntries(COVER_LAYOUTS.map((c) => [c.key, { minImages: c.minImages, render: c.render }]));


function coverHtml(theme: PortfolioTheme, data: PortfolioBookData, design: PdfDesign): string {
  // 인라인 편집: 표지 슬롯에 넣을 작품 id를 순서대로. `0`(또는 없는 id)은 **빈 칸**.
  // 사용자가 편집(명시 목록 있음)하면 그 레이아웃 그대로 — 빈 칸은 폴백하지 않고 빈 자리로 둔다(전부 비어도).
  const byId = new Map(data.images.map((i) => [i.id, i] as const));
  const explicit = design.coverImageIds.length > 0;

  let key: CoverLayout = design.coverLayout;
  if (!COVER_META[key]) key = 'bandTop';
  const need = COVER_META[key].minImages;

  let images: string[];
  if (explicit) {
    images = Array.from({ length: need }, (_, i) => {
      const id = design.coverImageIds[i] ?? 0;
      return (id ? byId.get(id)?.url : '') || '';
    });
  } else {
    // 자동(미편집): 포트폴리오 순서. 이미지가 부족하면 빈 표지가 되지 않게 폴백.
    images = data.images.map((i) => i.url).filter(Boolean);
    if (images.length < need) key = images.length >= 1 ? 'bandTop' : 'serifCenter';
  }
  const v: CoverArgs = {
    name: displayName(data.user),
    year: data.year || String(new Date().getFullYear()),
    eyebrow: (design.coverEyebrowText ?? '').trim() || EYEBROW,
    hero: images[0] || '',
    images,
    showEyebrow: design.coverEyebrow, showYear: design.coverYear,
    nameAccent: design.coverNameAccent, textScale: design.coverTextScale,
  };
  // 그림 크기 슬라이더 — 표지 렌더 동안만 모듈 변수 설정, 끝나면 복원(body 는 1로).
  coverImgScale = design.coverImageScale;
  const out = COVER_META[key].render(theme, data, v);
  coverImgScale = 1;
  return out;
}

// ── 글 페이지 (작가노트 / 시리즈 소개) ──
function prosePages(
  theme: PortfolioTheme, data: PortfolioBookData,
  eyebrow: string, title: string, body: string, label: string,
): PortfolioPage[] {
  const isSerif = theme.titleSerif ?? (theme.display === SERIF);
  const titleStyle = (isSerif
    ? `font-family:${theme.display};font-size:38px;letter-spacing:0.04em`
    : `font-size:36px;font-weight:800;letter-spacing:-0.02em`) + ';overflow-wrap:anywhere';
  const fontPx = theme.id === 'archive' ? 15 : 17;
  const lineH = Math.round(fontPx * 2.05);
  const bodyStyle = `margin:0 0 20px;font-size:${fontPx}px;line-height:2.05;color:${theme.ink};word-break:keep-all;overflow-wrap:anywhere;text-align:${theme.proseAlign ?? 'left'}`;
  const contentW = theme.page.w - PAD(theme).x * 2;
  const colW = theme.id === 'archive' ? contentW : Math.min(1080, contentW);
  const maxW = theme.id === 'archive' ? '100%' : '1080px';

  // 첫 장은 아이브로우 + 제목 + 룰이 자리를 먹는다. 이어지는 장은 작은 머리말만.
  // 여유분 24px — 추정이 맞아떨어져도 기기·글꼴 버전에 따라 몇 px씩 어긋난다. 마지막 줄이 가장자리에
  // 딱 붙으면 그런 오차에 바로 잘리므로 쿠션을 둔다(쪽수가 조금 늘어나는 건 감수).
  const SAFETY = 24;
  const firstCap = availH(theme) - (18 + 16 + 46 + 22 + 3 + 34) - SAFETY;
  const restCap = availH(theme) - (18 + 16 + 30 + 24) - SAFETY;
  const paras = String(body).split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);

  // ── 짧은 글은 '장을 여는 페이지'로 ──────────────────────────────────
  // ⚠️ 예전엔 시리즈 소개 한 문장이 **본문 크기(15px)** 그대로 지면 가운데 놓였다. 세로 중앙
  //    정렬은 돼 있었지만 글이 작아서 A4 한 장의 90% 가 아무것도 아닌 채로 남았다 —
  //    실측(마은영 시리즈 5개): 소개 5장이 전부 그랬다. 빈 자리를 장식으로 메우는 게 아니라
  //    (§17) **글자를 지면에 맞게 키워** 그 자리가 '여는 장'이라는 뜻을 갖게 한다(§11 리듬).
  //    긴 글은 그대로 읽는 컬럼(아래)으로 간다 — 크게 만들면 쪽수만 늘어난다.
  const openerBodyPx = theme.id === 'archive' ? 19 : 20;
  const openerH = paras.reduce((h, t) => h + estimateParaH(t, openerBodyPx, Math.round(openerBodyPx * 2), Math.min(660, colW), 22), 0);
  if (openerH > 0 && openerH <= availH(theme) * 0.4) {
    const titlePx = fitTitle(title, theme.id === 'archive' ? 62 : 72, Math.min(760, colW), 2, 30);
    return [{
      label,
      html: page(theme, data, `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
          <div style="font-size:12px;letter-spacing:0.5em;color:${theme.accent};font-weight:${isSerif ? 400 : 700}">${esc(eyebrow)}</div>
          <div style="margin-top:34px;${titleCss(theme, titlePx, theme.ink, isSerif ? '0.04em' : '-0.02em')};text-align:center;max-width:${Math.min(760, colW)}px">${esc(title)}</div>
          <div style="margin:36px auto 0;width:56px;height:2px;background:${theme.accent}"></div>
          <div style="margin-top:36px;max-width:${Math.min(660, colW)}px;width:100%">
            ${paras.map((t) => `<p style="margin:0 0 22px;font-size:${openerBodyPx}px;line-height:2.0;color:${theme.ink};word-break:keep-all;overflow-wrap:anywhere;text-align:${theme.proseAlign ?? 'left'}">${esc(t).replace(/\n/g, '<br/>')}</p>`).join('')}
          </div>
        </div>`),
    }];
  }

  const pageParas = splitParagraphs(paras, firstCap, restCap, fontPx, lineH, colW, 20);
  const multi = pageParas.length > 1;

  return pageParas.map((ps, i) => ({
    label: i === 0 ? label : `${label} (${i + 1})`,
    html: page(theme, data, `
      <div style="flex:1;display:flex;flex-direction:column;justify-content:${multi ? 'flex-start' : 'center'}">
        <div style="max-width:${maxW};margin:0 auto;width:100%">
          <div style="font-size:12px;letter-spacing:0.34em;color:${theme.accent};font-weight:700">${esc(eyebrow)}${i > 0 ? ' (계속)' : ''}</div>
          ${i === 0
            ? `<div style="margin-top:16px;${titleStyle}">${esc(title)}</div>
               <div style="margin-top:22px;width:64px;height:3px;background:${theme.accent}"></div>`
            : `<div style="margin-top:16px;font-size:20px;font-weight:${isSerif ? 400 : 700};font-family:${theme.display};color:${theme.sub};overflow-wrap:anywhere">${esc(title)}</div>`}
          <div style="margin-top:34px">${ps.map((t) => `<p style="${bodyStyle}">${esc(t).replace(/\n/g, '<br/>')}</p>`).join('')}</div>
        </div>
      </div>`),
  }));
}

// 작가노트 — 짧으면 세로 중앙 + 대형 인용(우아하게), 길면 읽기 좋은 컬럼(prosePages 폴백).
// 예전엔 짧은 노트도 상단에 붙어 페이지 90%가 텅 비었다.
function statementPages(theme: PortfolioTheme, data: PortfolioBookData, statement: string): PortfolioPage[] {
  const paras = statement.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  const px = PAD(theme).x;
  const fontPx = 18, lineH = 38;
  const colW = theme.page.w - px * 2 - 160;         // 우아하게 좁은 폭(가운데 정렬)
  const totalH = paras.reduce((h, p) => h + estimateParaH(p, fontPx, lineH, colW, 24), 0);
  const room = availH(theme) - 240;                 // 머리말+룰+여백 예약(넉넉히 — 넘치면 폴백)
  const isSerif = theme.titleSerif ?? (theme.display === SERIF);
  if (totalH <= room) {
    // 블록은 가운데(좁은 컬럼·세로중앙)로 우아하게, 글 정렬은 proseAlign 을 따른다.
    const align = theme.proseAlign ?? 'left';
    return [{ label: '작가노트', html: page(theme, data, `
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center">
        <div style="font-size:12px;letter-spacing:0.5em;color:${theme.accent};font-weight:${isSerif ? 400 : 700}">ARTIST STATEMENT</div>
        <div style="margin:40px auto;width:56px;height:2px;background:${theme.line}"></div>
        <div style="max-width:${colW}px;width:100%">${paras.map((p) => `<p style="margin:0 0 24px;font-size:${fontPx}px;line-height:2.1;color:${theme.ink};word-break:keep-all;overflow-wrap:anywhere;text-align:${align}">${esc(p).replace(/\n/g, '<br/>')}</p>`).join('')}</div>
      </div>`) }];
  }
  return prosePages(theme, data, 'ARTIST STATEMENT', '작가노트', statement, '작가노트');
}

// ── 캡션 ──
/**
 * 캡션 줄 수 — 높이 추정과 렌더가 **같은 규칙**을 보게 하는 단일 출처.
 * `title` 은 실제로 제목 줄을 그리는가(= 제목이 입력됐는가), `meta` 는 보조 줄 수.
 */
/**
 * 캡션 상세도.
 *   full     제목 + [재료 / 크기 / 연도] 세 줄 (칸이 넓을 때 — 도록 관례)
 *   compact  제목 + "재료 · 크기 · 연도" **한 줄** (촘촘한 격자)
 *   minimal  제목만
 *
 * ⚠️ `compact` 는 장식이 아니라 **자리 문제**다. 세 줄 캡션은 22px×3 + 여백 = 90px 인데,
 *    2행 격자면 그게 **두 번** 들어가 A4 가로(본문 842px)의 32% 를 먹는다. 실측:
 *    4점 격자@A4가로에서 작품 점유가 21% 밖에 안 나왔고 원인이 이거였다.
 *    한 줄로 접으면 같은 지면에서 작품이 28% 로 커진다. 정보는 하나도 안 버린다.
 */
export type CaptionDetail = 'full' | 'compact' | 'minimal';

function captionParts(a: PortfolioImage, detail: CaptionDetail | boolean) {
  const d: CaptionDetail = detail === true ? 'minimal' : detail === false ? 'full' : detail;
  const title = hasTitle(a);
  const status = !!statusLabel(a);
  const meta = d === 'minimal' ? [] : d === 'compact' ? [captionInline(a)].filter(Boolean) : captionLines(a);
  // 제목이 없고 상태만 있으면 상태가 제목 줄 자리를 대신한다(빈 줄을 남기지 않게).
  return { title, status, meta, titleLines: title || status ? 1 : 0, empty: !title && !status && meta.length === 0 };
}

function captionHtml(theme: PortfolioTheme, a: PortfolioImage, align: 'center' | 'left', detail: CaptionDetail | boolean = 'full'): string {
  const st = statusLabel(a);
  const isSerif = theme.titleSerif ?? (theme.display === SERIF);
  const p = captionParts(a, detail);
  // ⚠️ **제목이 없으면 제목 줄 자체를 그리지 않는다.** `artworkTitle()` 은 빈 제목에 '무제' 를
  //    돌려주므로 그대로 쓰면 캡션이 '무제' 로 도배된다 — 실서버 작품 372점 중 제목이 있는 건
  //    10점(2.7%) 뿐이고, **361점(97%)은 제목·재료·크기·연도가 전부 비어 있다**.
  //    26점짜리 포트폴리오가 26쪽 내내 '무제' 한 단어만 달고 나왔다(2026-08-31 실데이터 확인).
  //    공개 홈페이지는 이미 `hasTitle()` 로 걸러 왔는데 PDF 만 안 걸렀다 — 규칙을 맞춘다.
  //    (편집 화면은 반대다 — 거기선 '무제'/'정보 없음' 을 보여줘야 작가가 빠진 걸 안다)
  if (p.empty) return '';
  const badge = st
    ? `<span style="font-size:12px;font-weight:700;color:${theme.accent};letter-spacing:0.06em">● ${esc(st)}</span>`
    : '';
  // ⚠️ 목록(minimal)에서는 제목을 **한 줄로 잘라야 한다.** 6점 격자는 행이 3줄이라 캡션 높이를
  //    행 수만큼 물고, 긴 제목이 두 줄로 접히면 그것만으로 지면의 7% 가 사라진다(실측: 칸 301→274px).
  //    목록에 붙는 건 도록 캡션이 아니라 **라벨**이라 한 줄이 관례에도 맞다.
  const oneLine = p.meta.length === 0
    ? 'display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;'
    : '';
  const titleLine = p.title
    ? `<div style="${oneLine}font-size:18px;font-weight:${isSerif ? 400 : 700};font-family:${theme.display};letter-spacing:${isSerif ? '0.06em' : '-0.01em'};overflow-wrap:anywhere">
        ${esc(artworkTitle(a))}${badge ? `<span style="margin-left:10px">${badge}</span>` : ''}
      </div>`
    : (badge ? `<div>${badge}</div>` : '');
  const meta = p.meta
    .map((l) => `<div style="margin-top:5px;font-size:13px;color:${theme.sub};letter-spacing:${isSerif ? '0.12em' : '0.02em'}">${esc(l)}</div>`)
    .join('');
  return `<div style="text-align:${align};margin-top:18px">${titleLine}${meta}</div>`;
}

// ── 작품 페이지 ──
// ── 작품 페이지 (밀도 기반 일반 그리드) — 판형×밀도×설명을 한 로직으로 ──
// 높이 안전: 페이지는 height:avail 고정, 행/칸이 그 안을 나눠 갖고 이미지는 imgH 로 못박는다
// (캡션 높이는 captionH 실측표 + 설명 2줄). overflow 회귀는 e2e/_pdfaudit.mjs(실측)로 잡는다.
const DESC_LINE_H = 21;

/** 짧은 설명(2줄) — 폭 기준 글자수로 잘라 2줄을 넘지 않게(조용한 잘림 방지).
 *  `block` = 글상자 위치(center 면 좁은 상자 가운데). **글자 정렬은 본문 정렬(proseAlign)을 따른다** —
 *  양쪽맞춤 선택이 작품설명에 안 먹던 문제(세로 지적). 캡션(제목·재료)은 별도(worksCaption). */
const DESC_FONT = 12.5;
function shortDescHtml(theme: PortfolioTheme, a: PortfolioImage, cellW: number, block: 'center' | 'left' = 'left'): string {
  const desc = String(a.description ?? '').trim();
  if (!desc) return '';
  // ⚠️ 글자폭을 `13 * 0.62`(=8.06px)로 잡았는데 **실측은 12.1px** 이었다(12.5px 한글).
  //    55% 과대평가라 "2줄" 컷이 실제로는 3줄을 통과시켰다 — 전 판형 실측에서 60px(예약 42px의 1.43배).
  //    넘침이 안 났던 건 SAFETY 24px 쿠션이 그 초과분을 먹고 있었기 때문이다. 즉 글꼴 버전
  //    편차용 쿠션이 산수 오류에 이미 소진돼 있었다. 글 전체가 쓰는 CHAR_W_RATIO 로 통일한다.
  const perLine = Math.max(8, Math.floor(cellW / (DESC_FONT * CHAR_W_RATIO)));
  const max = perLine * 2;
  const one = desc.replace(/\s*\n\s*/g, ' ');
  const clipped = one.length > max ? one.slice(0, max - 1).trimEnd() + '…' : one;
  const box = block === 'center' ? 'margin-left:auto;margin-right:auto;max-width:min(100%,640px);' : '';
  return `<div style="margin-top:8px;${box}font-size:${DESC_FONT}px;line-height:1.6;color:${theme.sub};text-align:${theme.proseAlign ?? 'left'};word-break:keep-all;overflow-wrap:anywhere">${esc(clipped)}</div>`;
}

/**
 * 격자 페이지의 **공유 기하**. 페이지마다 따로 계산하면 같은 설정인데 장마다 작품 크기가
 * 달라져 책이 흔들린다(§27 일관성). 그래서 기준 비율은 **포트폴리오 전체**에서 한 번 뽑는다.
 */
export interface GridGeometry {
  /** 작품 → 가로/세로 (사진 실측 → 실치수 → 1.0) */
  aspectOf: (a: PortfolioImage) => number;
  /** 전체 작품의 중앙 비율 — 칸 높이의 기준 */
  median: number;
  /**
   * 포트폴리오의 **모든** 작품. 캡션 예약 높이를 전체에서 뽑으려고 들고 있다.
   * ⚠️ 페이지의 작품만 보고 예약하면 **장마다 작품 크기가 달라진다** — 실측에서 같은
   *    4점 격자인데 어느 장은 272px, 어느 장은 294px 였다(캡션 긴 작품이 있는 장만 작아짐).
   *    격자는 격자여야 한다(§27).
   */
  all: PortfolioImage[];
}

/**
 * 격자(2·4·6점) 페이지.
 *
 * ## 예전: 똑같은 칸에 작품을 우겨넣었다
 * 칸은 `cellW × imgH` 로 **고정**이고 작품은 그 안에 contain 됐다. 그래서 세로 그림은
 * 좌우가, 가로 그림은 위아래가 남았다 — 남은 자리에 회색 패널이 그려지니 **비어 있다는 사실이
 * 눈에 보였다**. 같은 크기 칸이 나란히 놓이는 것이 곧 "템플릿을 채웠다"는 인상의 정체다.
 *
 * ## 지금: 행 안에서 **높이를 맞추고 폭을 비율대로** 나눈다 (justified row)
 * 한 행의 작품들이 **같은 높이**를 갖고, 폭은 각자의 비율만큼 가져간다. 그러면
 *   - 칸의 빈 자리가 사라진다(작품이 상자를 정확히 채운다)
 *   - 가로 그림은 넓게, 세로 그림은 좁게 — **크기 차이가 내용에서 나온다**(§9 위계)
 *   - 아래 선이 저절로 맞는다(도록이 실제로 쓰는 방식)
 *
 * ⚠️ 기준 높이는 **가득 찬 행**(maxCols × 전체 중앙비율)에서 뽑는다. 행마다 제 비율로
 *    높이를 정하면 마지막에 한 점만 남았을 때 그 한 점이 혼자 커진다(사용자 지적 "달빛아래만 크게").
 *    행이 기준보다 넓어질 때만 그 행을 줄인다 — 절대 키우지 않는다.
 * ⚠️ 캡션 높이는 칸 **폭**에 달렸는데 폭은 높이에서 나온다(순환). 최대 3회 수렴시키되
 *    캡션 예약은 **본 것 중 최대값**으로만 올린다 — 예약이 커지는 쪽은 안전(작품이 작아질 뿐),
 *    작아지는 쪽은 조용한 잘림이다.
 */
/**
 * 격자 기하 풀이 — **배치를 그리는 쪽과 고르는 쪽이 같은 계산을 본다**.
 *
 * 자동 편집이 "이 지면에서 2점씩이 나은가 4점씩이 나은가"를 판단하려면 렌더러와 **같은 산수**를
 * 써야 한다. 따로 어림하면 판단과 결과가 어긋난다 — 그게 이 파일이 반복해서 겪은 사고다.
 */
interface GridSolve { cols: number; rows: number; H: number; capH: number; detail: CaptionDetail; coverage: number }

function solveGrid(per: number, theme: PortfolioTheme, design: PdfDesign, geom: GridGeometry, forceMinimal: boolean): GridSolve {
  const avail = availH(theme);
  const availW = theme.page.w - PAD(theme).x * 2;
  const landscape = theme.page.w >= theme.page.h;
  const colGap = landscape ? 56 : 44;
  const rowGap = Math.max(20, Math.round(40 * (theme.page.h / 1414)));
  const descOn = design.desc !== 'none' && !forceMinimal;
  const detail: CaptionDetail = (design.worksCaption === 'minimal' || forceMinimal) ? 'minimal' : per >= 4 ? 'compact' : 'full';
  const minimalCap = detail === 'minimal';

  const estCaptionH = (a: PortfolioImage, w: number) => {
    const p = captionParts(a, detail);
    if (p.empty && !(descOn && String(a.description ?? '').trim())) return 0;
    // 제목 줄 수 — 목록(메타 없음)은 렌더가 한 줄로 자르므로 추정도 한 줄이다
    const tCap = p.meta.length === 0 ? 1 : 3;
    const tLines = p.title ? Math.min(tCap, Math.max(1, Math.ceil((artworkTitle(a).length * 18) / w))) : p.titleLines;
    const mLines = Math.min(5, p.meta.reduce((n, l) => n + Math.max(1, Math.ceil((l.length * 13) / w)), 0));
    return CAP_TOP + tLines * CAP_TITLE_LINE + mLines * CAP_META_LINE
      + (descOn ? CAP_DESC_TOP + DESC_LINE_H * 2 : 0) + 24; // +24 SAFETY 쿠션
  };

  const arrange = (capH: number) => {
    let best: { cols: number; rows: number; H: number; score: number } | null = null;
    for (let cols = 1; cols <= per; cols++) {
      const rows = Math.ceil(per / cols);
      const rowBudget = (avail - (rows - 1) * rowGap) / rows;
      const H = Math.min(rowBudget - capH, (availW - (cols - 1) * colGap) / (cols * geom.median));
      const cellW = H * geom.median;
      // 칸이 너무 작으면 캡션이 안 읽히고 작품도 우표가 된다 — 후보에서 뺀다.
      if (H < 90 || cellW < 150) continue;
      const area = per * H * cellW;
      // ⚠️ **면적만 보면 안 된다.** 실측: '2점씩'@A4세로에서 2열×1행(313k)이 1열×2행(304k)보다
      //    3% 넓다고 뽑혔는데, 결과는 지면 위쪽에 작품 둘이 붙고 **아래 절반이 통째로 비는** 페이지였다.
      //    남은 여백이 뜻이 있으면 여백이고 없으면 사고다(§16) — 채운 높이를 점수에 넣는다.
      const usedH = rows * (H + capH) + (rows - 1) * rowGap;
      const score = area * (0.5 + 0.5 * Math.min(1, usedH / avail));
      // 근소한 차이(2% 이내)면 **열이 적은 쪽**(먼저 온 후보)을 남긴다 — 결정적이고 차분하다.
      if (!best || score > best.score * 1.02) best = { cols, rows, H, score };
    }
    return best ?? { cols: 1, rows: per, H: 90, score: 0 };
  };

  // 캡션 예약 ↔ 칸 폭의 순환을 수렴시킨다(예약은 최대값으로만 올린다 = 안전한 쪽).
  // ⚠️ 예약은 **포트폴리오 전체**에서 뽑는다 — 이 장의 작품만 보면 장마다 칸이 달라진다.
  const src = geom.all;
  const wide = availW / Math.max(1, Math.min(per, 3));
  const anyCaption = src.some((a) => estCaptionH(a, wide) > 0);
  let capH = 0, H = 0, cols = 1, rows = per;
  for (let pass = 0; pass < 3; pass++) {
    const w = (a: PortfolioImage) => (H > 0 ? H * geom.aspectOf(a) : wide);
    const est = Math.max(0, ...src.map((a) => estCaptionH(a, Math.max(80, w(a)))));
    const next = est === 0 ? 0 : Math.max(minimalCap ? 44 : 60, est);
    if (next <= capH && pass > 0) break;
    capH = Math.max(capH, next);
    const a = arrange(capH);
    H = a.H; cols = a.cols; rows = a.rows;
  }
  if (!anyCaption) { capH = 0; const a = arrange(0); H = a.H; cols = a.cols; rows = a.rows; }
  H = Math.max(60, H);
  return { cols, rows, H, capH, detail, coverage: (per * H * H * geom.median) / (theme.page.w * theme.page.h) };
}

function gridWorksPage(
  theme: PortfolioTheme, data: PortfolioBookData, items: PortfolioImage[],
  label: string, running: string | undefined, composition: WorksLayout, design: PdfDesign, geom: GridGeometry,
): PortfolioPage[] {
  const avail = availH(theme);
  const availW = theme.page.w - PAD(theme).x * 2;
  const landscape = theme.page.w >= theme.page.h;
  const per = WORKS_PER_PAGE[composition];

  const colGap = landscape ? 56 : 44;
  // ⚠️ 행 사이 여백은 **지면 높이에 비례**해야 한다. 격자는 작품이 높이로 제한되므로 세로 여백이
  //    곧 작품 크기다 — 40px 은 A4 세로(1414)에서 2.8% 지만 와이드(900)에서는 4.4% 다.
  const rowGap = Math.max(20, Math.round(40 * (theme.page.h / 1414)));
  // 인덱스(6점)는 칸이 작아 캡션은 제목만·설명 없음(강제 minimal)
  const isIndex = composition === 'index';
  const descOn = design.desc !== 'none' && !isIndex;
  const capAlign: 'center' | 'left' = design.worksCaption === 'left' ? 'left' : 'center';
  // ⚠️ 배열·칸 높이·캡션 예약은 **정원(per) 기준으로 한 번만** 푼다(장마다 다시 풀면 쪽마다
  //    작품 크기가 달라진다, §27). 자동 편집이 구성을 고를 때도 **이 함수를 그대로** 부른다.
  const { cols, H, detail } = solveGrid(per, theme, design, geom, isIndex);
  // 행 자체를 균형 있게 나눈다 — 3열 격자에 4점이면 [3,1] 이 아니라 [2,2].
  const rowsItems = take(items, balancedSplit(items.length, cols));

  // ⚠️ 상자와 작품 비율이 같으면 패널은 안 보인다(작품이 정확히 채운다). 그래도 남겨 두는 이유:
  //    비율을 모르는 작품(사진 미측정)은 정사각으로 가정하므로 그때 남는 자리를 받아 준다.
  const panel = softPanel(theme);
  const cell = (a: PortfolioImage, w: number, h: number) => `
    <div style="flex:0 0 ${Math.round(w)}px;max-width:${Math.round(w)}px;min-width:0;display:flex;flex-direction:column;justify-content:flex-start">
      <div style="height:${Math.round(h)}px;width:100%;display:flex;align-items:center;justify-content:center;background:${panel}">
        ${img(a.url, `max-width:100%;max-height:100%;object-fit:contain;display:block`)}
      </div>
      ${captionHtml(theme, a, capAlign, detail)}
      ${descOn ? shortDescHtml(theme, a, Math.round(w), capAlign) : ''}
    </div>`;

  // ── 세로 기준선(칼럼)에 맞춘다 ────────────────────────────────────────
  // ⚠️ 예전엔 한 행의 작품을 **폭만큼만 차지하게 붙여 놓고 행 전체를 가운데 정렬**했다.
  //    그러면 행마다 총 폭이 달라(비율 합이 다르니까) 좌우 끝과 작품 사이 이음매가
  //    장마다 제각각인 자리에 와서 **삐뚤빼뚤해 보인다**(사용자 지적).
  //    지금은 열을 **같은 폭의 칸(track)** 으로 고정하고 작품을 그 안에서 가운데 둔다 —
  //    이음매와 좌우 끝이 모든 행에서 같은 x 에 온다. 작품 크기는 여전히 비율을 따르므로
  //    (칸을 채우는 게 아니라 칸 안에 놓는다) 위계는 그대로다.
  // ⚠️ 칸보다 넓어지는 작품이 있으면 **그 행만** 높이를 낮춰 칸에 들어오게 한다.
  //    행 전체를 늘려 맞추면(justify) 다시 이음매가 어긋난다.
  const rowHtml = (r: PortfolioImage[]) => {
    // 칸 폭은 **그 행의 점수**로 본문 폭을 똑같이 나눈 값. 행이 덜 찼으면(2점만 남은 4점 격자 등)
    // 남은 칸을 비워 두지 않고 나눠 갖는다 — 그래도 좌우가 대칭이라 중앙선은 그대로 맞는다.
    // 높이는 여전히 기준 H 를 넘지 않으므로 마지막 한 점이 혼자 커지지 않는다.
    const trackW = (availW - (r.length - 1) * colGap) / r.length;
    const widest = Math.max(...r.map(geom.aspectOf));
    const h = Math.max(60, Math.min(H, trackW / Math.max(0.01, widest)));
    return `<div style="display:flex;gap:${colGap}px;align-items:flex-start;justify-content:center;width:100%">${
      r.map((a) => `<div style="flex:0 0 ${Math.round(trackW)}px;max-width:${Math.round(trackW)}px;display:flex;justify-content:center">${
        cell(a, h * geom.aspectOf(a), h)}</div>`).join('')}</div>`;
  };
  const inner = `
    <div style="display:flex;flex-direction:column;gap:${rowGap}px;height:${avail}px;justify-content:center">
      ${rowsItems.map(rowHtml).join('')}
    </div>`;
  return [{ label, html: page(theme, data, inner, { running: running || undefined }) }];
}

/**
 * 시리즈 여는 장 — **제목·소개 + 대표작 한 점**을 한 장에.
 *
 * ## 왜
 * 예전엔 시리즈마다 [소개만 있는 장] + [작품 첫 장] 이 따로 나왔다. 소개는 대개 한두 문장이라
 * 그 장의 3분의 2가 빈 채로 남았고, 시리즈가 다섯이면 **거의 빈 장이 다섯**이었다
 * (실측 마은영 23쪽 중 5쪽). 빈 자리를 장식으로 메우지 않고(§17) **그 자리가 일을 하게** 한다 —
 * 잡지·도록의 장 여는 페이지가 정확히 이 구성이다(제목 + 대표 도판).
 *
 * ⚠️ 소개가 길어 그림 자리가 안 남으면 **null 을 돌려** 예전처럼 글 페이지로 보낸다.
 *    억지로 한 장에 넣으면 글이 잘린다(이 파일이 반복해 겪은 사고).
 * ⚠️ 자동 편집에서만 쓴다 — 수동은 사용자가 고른 구성이 곧 의도라 첫 작품을 마음대로
 *    다른 배치로 바꾸지 않는다(§32).
 */
function seriesOpenerPage(
  theme: PortfolioTheme, data: PortfolioBookData, name: string, note: string,
  work: PortfolioImage | undefined, design: PdfDesign, geom: GridGeometry,
): PortfolioPage | null {
  if (!work?.url) return null;
  const avail = availH(theme);
  const availW = theme.page.w - PAD(theme).x * 2;
  const landscape = theme.page.w >= theme.page.h;
  const isSerif = theme.titleSerif ?? (theme.display === SERIF);
  const paras = note.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);

  const colW = landscape ? Math.round(availW * 0.34) : Math.min(620, availW);
  const titlePx = fitTitle(name, landscape ? 44 : 54, colW, 3, 28);
  const noteH = paras.reduce((h, t) => h + estimateParaH(t, 15, 30, colW, 18), 0);
  const headH = 18 + 20 + Math.ceil((name.length * titlePx) / colW) * Math.round(titlePx * 1.14) + 26 + noteH + 24;

  const cp = captionParts(work, false);
  const capH = cp.empty ? 0 : CAP_TOP + cp.titleLines * CAP_TITLE_LINE + cp.meta.length * CAP_META_LINE + 16;
  const gap = landscape ? 56 : 40;

  const head = `
    <div style="font-size:12px;letter-spacing:0.5em;color:${theme.accent};font-weight:${isSerif ? 400 : 700}">SERIES</div>
    <div style="margin-top:20px;${titleCss(theme, titlePx, theme.ink, isSerif ? '0.03em' : '-0.02em')}">${esc(name)}</div>
    <div style="margin-top:26px;width:48px;height:2px;background:${theme.accent}"></div>
    <div style="margin-top:24px">${paras.map((t) => `<p style="margin:0 0 16px;font-size:15px;line-height:2.0;color:${theme.ink};word-break:keep-all;overflow-wrap:anywhere;text-align:${theme.proseAlign ?? 'left'}">${esc(t).replace(/\n/g, '<br/>')}</p>`).join('')}</div>`;

  const shot = (w: number, h: number) => `
    <div style="width:${Math.round(w)}px;display:flex;flex-direction:column">
      <div style="height:${Math.round(h)}px;width:100%;display:flex;align-items:center;justify-content:center;background:${softPanel(theme)}">
        ${img(work.url, 'max-width:100%;max-height:100%;object-fit:contain;display:block')}
      </div>
      ${captionHtml(theme, work, 'center')}
    </div>`;

  const a = geom.aspectOf(work);
  if (landscape) {
    const imgW = availW - colW - gap;
    const h = Math.min(avail - capH, imgW / a);
    if (h < 200) return null;
    return { label: `${name} 소개`, html: page(theme, data, `
      <div style="display:flex;gap:${gap}px;align-items:center;height:${avail}px">
        <div style="width:${colW}px;flex:0 0 ${colW}px">${head}</div>
        <div style="flex:1;min-width:0;display:flex;justify-content:center">${shot(Math.min(imgW, h * a), h)}</div>
      </div>`, { running: name }) };
  }
  const h = Math.min(avail - headH - gap - capH, availW / a);
  // 그림이 이만큼도 안 남으면 여는 장으로 삼을 이유가 없다 — 글 페이지로 돌린다.
  if (h < 260) return null;
  return { label: `${name} 소개`, html: page(theme, data, `
    <div style="height:${avail}px;display:flex;flex-direction:column;justify-content:center;gap:${gap}px">
      <div>${head}</div>
      <div style="display:flex;justify-content:center">${shot(Math.min(availW, h * a), h)}</div>
    </div>`, { running: name }) };
}

/**
 * 비대칭 — **한 점을 크게, 나머지를 작게**. 자동 편집의 리듬을 만드는 핵심 구성.
 *
 * 왜 필요한가: 같은 크기 칸만 반복하면(§33-2 "equal-sized grid addiction") 어느 작품이
 * 중요한지 알 수 없고 책 전체가 한 장처럼 읽힌다. 지면에 큰 것 하나와 작은 것 둘을 두면
 * 눈이 들어갈 자리가 생기고, 다음 장의 격자가 '쉼'으로 읽힌다.
 *
 * 배치는 판형을 따른다 — 세로 지면은 위/아래, 가로 지면은 좌/우. 주 작품은 자기 비율대로
 * 놓이고(자르지 않는다), 보조 두 점은 같은 높이로 맞춰 아래 선을 맞춘다.
 */
function featureWorksPage(
  theme: PortfolioTheme, data: PortfolioBookData, items: PortfolioImage[],
  label: string, running: string | undefined, design: PdfDesign, geom: GridGeometry,
): PortfolioPage[] {
  const [main, ...rest] = items;
  if (!main) return [];
  if (rest.length === 0) return heroWorksPage(theme, data, main, label, running, design);

  const avail = availH(theme);
  const availW = theme.page.w - PAD(theme).x * 2;
  const landscape = theme.page.w >= theme.page.h;
  const gap = landscape ? 52 : 44;
  const minimalCap = design.worksCaption === 'minimal';
  const capAlign: 'center' | 'left' = design.worksCaption === 'left' ? 'left' : 'center';
  // 캡션 예약 — **줄바꿈까지 세야 한다.**
  // ⚠️ 예전엔 `titleLines`(=1)를 그대로 썼는데, 그건 "제목 줄을 그리는가"이지 "몇 줄이 되는가"가 아니다.
  //    보조 작품 칸은 지면의 3분의 1쯤이라 긴 제목(특히 공백 없는 한글 장문)이 3~4줄로 접힌다.
  //    채점 하니스가 잡았다 — stress 작가에서 **17px 이 조용히 잘려 나갔다**(overflow:hidden).
  //    격자(`solveGrid`)와 같은 규칙으로 폭을 보고 센다.
  const capOf = (a: PortfolioImage, w: number, maxMeta: number) => {
    const p = captionParts(a, minimalCap ? 'minimal' : 'full');
    if (p.empty) return 0;
    const tLines = p.title ? Math.min(3, Math.max(1, Math.ceil((artworkTitle(a).length * 18) / Math.max(80, w)))) : p.titleLines;
    const mLines = p.meta.slice(0, maxMeta).reduce((n, l) => n + Math.max(1, Math.ceil((l.length * 13) / Math.max(80, w))), 0);
    return CAP_TOP + tLines * CAP_TITLE_LINE + Math.min(5, mLines) * CAP_META_LINE + 12;
  };

  const panel = softPanel(theme);
  const box = (a: PortfolioImage, w: number, h: number, cap: number) => `
    <div style="flex:0 0 ${Math.round(w)}px;max-width:${Math.round(w)}px;min-width:0;display:flex;flex-direction:column">
      <div style="height:${Math.round(h)}px;width:100%;display:flex;align-items:center;justify-content:center;background:${panel}">
        ${img(a.url, `max-width:100%;max-height:100%;object-fit:contain;display:block`)}
      </div>
      ${cap > 0 ? captionHtml(theme, a, capAlign, minimalCap) : ''}
    </div>`;

  let inner: string;
  if (landscape) {
    // 좌: 주 작품(폭 58%) / 우: 보조 세로로 쌓기
    const mainW = Math.round(availW * 0.58);
    const subW = availW - mainW - gap;
    const mainCap = capOf(main, mainW, 3);
    const subCap = Math.max(0, ...rest.map((a) => capOf(a, subW, minimalCap ? 0 : 2)));
    const mainH = Math.max(80, Math.min(avail - mainCap, mainW / geom.aspectOf(main)));
    const subEach = (avail - (rest.length - 1) * gap) / rest.length;
    const subH = Math.max(60, Math.min(subEach - subCap, subW / Math.max(0.01, Math.max(...rest.map(geom.aspectOf)))));
    inner = `
      <div style="display:flex;gap:${gap}px;align-items:center;height:${avail}px">
        ${box(main, Math.min(mainW, mainH * geom.aspectOf(main)), mainH, mainCap)}
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:${gap}px;align-items:flex-start;justify-content:center">
          ${rest.map((a) => box(a, Math.min(subW, subH * geom.aspectOf(a)), subH, subCap)).join('')}
        </div>
      </div>`;
  } else {
    // 위: 주 작품(높이 60%) / 아래: 보조 나란히 — 같은 높이라 아래 선이 맞는다
    // ⚠️ 주 작품이 가로로 넓으면(파노라마) 폭에서 먼저 걸려 60% 칸을 다 못 쓴다. 그 **남는 높이를
    //    보조 줄에 넘겨야** 한다 — 안 넘기면 지면 한가운데가 이유 없이 빈다.
    const mainSlot = Math.round(avail * 0.6);
    const mainCap = capOf(main, availW, 3);
    const mainH = Math.max(80, Math.min(mainSlot - mainCap, availW / geom.aspectOf(main)));
    const subSlot = avail - (mainH + mainCap) - gap;
    const track = (availW - (rest.length - 1) * gap) / rest.length;
    const widest = Math.max(...rest.map(geom.aspectOf));
    // 보조 칸의 폭은 높이에서 나오고 캡션 높이는 폭에서 나온다 — 두 번 돌려 수렴시킨다
    // (예약은 커지는 쪽으로만 = 작품이 작아질 뿐, 잘리지 않는다).
    let subCap = Math.max(0, ...rest.map((a) => capOf(a, track, minimalCap ? 0 : 2)));
    let subH = Math.max(60, Math.min(subSlot - subCap, track / Math.max(0.01, widest)));
    for (let pass = 0; pass < 2; pass++) {
      const next = Math.max(0, ...rest.map((a) => capOf(a, subH * geom.aspectOf(a), minimalCap ? 0 : 2)));
      if (next <= subCap) break;
      subCap = next;
      subH = Math.max(60, Math.min(subSlot - subCap, track / Math.max(0.01, widest)));
    }
    // 보조 줄도 **같은 폭의 칸**에 앉힌다 — 붙여 놓고 가운데 정렬하면 두 작품 사이 이음매가
    // 지면 중앙선에서 벗어나 주 작품과 어긋나 보인다(격자와 같은 이유).
    const subTrack = (availW - (rest.length - 1) * gap) / rest.length;
    inner = `
      <div style="display:flex;flex-direction:column;gap:${gap}px;height:${avail}px;justify-content:center;align-items:center">
        ${box(main, Math.min(availW, mainH * geom.aspectOf(main)), mainH, mainCap)}
        <div style="display:flex;gap:${gap}px;align-items:flex-start;justify-content:center;width:100%">
          ${rest.map((a) => `<div style="flex:0 0 ${Math.round(subTrack)}px;max-width:${Math.round(subTrack)}px;display:flex;justify-content:center">${
            box(a, Math.min(subTrack, subH * geom.aspectOf(a)), subH, subCap)}</div>`).join('')}
        </div>
      </div>`;
  }
  return [{ label, html: page(theme, data, inner, { running: running || undefined }) }];
}

// ══ 페이지 전략(Page Strategy) — "몇 점인가"가 아니라 "어떻게 편집할 것인가" ═══════════
//
// ## 무엇이 문제였나
// 예전엔 `chunk(images, worksPerPage)` 한 줄이 전부였다. 즉 **작품 수를 상수로 나눈 것**이
// 곧 편집이었고, 그래서 두 가지가 늘 따라왔다.
//
//   ① **꼬리 페이지가 텅 빈다.** 시리즈마다 따로 잘랐으므로 7점을 6점씩 담으면 6+1 이 되고,
//      남은 1점은 6칸짜리 격자의 **한 칸 크기 그대로** 혼자 한 장을 차지했다(지면의 5%).
//      실측(마은영 27점·6점목록): 17장 중 3장이 그 꼴이었다.
//   ② **같은 구성이 끝없이 반복된다.** 27점을 hero 로 뽑으면 똑같이 생긴 27장이 나온다.
//      낱장은 멀쩡한데 책이 기계로 찍어낸 것처럼 읽힌다.
//
// ## 지금
//   - `balancedSplit` 이 **고아 페이지를 만들지 않게** 나눈다(7@6 → 4+3).
//     다만 꽉 찬 페이지가 더 보기 좋으므로 **남는 게 정원의 60% 이상이면 그대로 둔다**(11@6 → 6+5).
//   - 자동 편집(`design.auto`)이면 **페이지마다 구성이 달라진다** — 시리즈 첫 장은 대형(hero),
//     이후는 밀도에 맞춘 패턴을 돈다. 무작위가 아니라 **정해진 순서**라 같은 입력이면 같은 결과다(§31).

export interface WorkPagePlan { composition: WorksLayout; items: PortfolioImage[] }

/**
 * 격자·비대칭 페이지가 공유하는 기하 — 작품 비율과 그 중앙값.
 * ⚠️ 중앙값은 **포트폴리오 전체**에서 뽑는다(페이지별이 아니라). 그래야 어느 장을 펴도
 *    작품이 같은 크기로 앉는다.
 */
export function gridGeometry(data: PortfolioBookData): GridGeometry {
  const aspects = data.aspects ?? null;
  const cache = new Map<number, number>();
  const aspectOf = (a: PortfolioImage) => {
    const hit = cache.get(a.id);
    if (hit !== undefined) return hit;
    const v = Math.min(4, Math.max(0.25, artworkFacts(a, aspects).aspect));
    cache.set(a.id, v);
    return v;
  };
  const sorted = data.images.map(aspectOf).sort((x, y) => x - y);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 1;
  return { aspectOf, median, all: data.images };
}

/**
 * n 점을 정원 `per` 로 나눈다 — **고아(거의 빈 마지막 장)를 만들지 않는다.**
 * 남는 수가 정원의 60% 미만일 때만 고르게 다시 나눈다(꽉 찬 페이지의 밀도를 지키려고).
 */
export function balancedSplit(n: number, per: number): number[] {
  if (n <= 0) return [];
  if (per <= 1) return Array(n).fill(1);
  const pages = Math.ceil(n / per);
  if (pages === 1) return [n];
  const rest = n % per;
  if (rest === 0 || rest >= per * 0.6) {
    return Array.from({ length: pages }, (_, i) => (i < pages - 1 ? per : rest || per));
  }
  const base = Math.floor(n / pages);
  const extra = n % pages;
  return Array.from({ length: pages }, (_, i) => base + (i < extra ? 1 : 0));
}

const take = (items: PortfolioImage[], sizes: number[]): PortfolioImage[][] => {
  const out: PortfolioImage[][] = [];
  let i = 0;
  for (const s of sizes) { out.push(items.slice(i, i + s)); i += s; }
  return out;
};

/**
 * 남은 점수에 어울리는 구성으로 갈아탄다 — 1점은 대형, 2점은 비대칭(또는 2점씩).
 *
 * ⚠️ **2점이 남았을 때 '2점씩'(duo)은 지면을 못 채운다.** A4 세로에 정사각 두 점을 위아래로
 *    쌓으면 각 점이 지면 폭의 44% 밖에 못 쓰고(높이 예산에 걸린다) 좌우가 통째로 빈다 —
 *    실측 지면점유 27%. 같은 두 점을 '크게+작게'로 놓으면 32% 이고 무엇보다 **의도가 보인다**.
 *    사용자가 '2점씩'을 직접 고른 경우(want==='duo')는 그대로 존중한다(§32).
 */
const fitComposition = (want: WorksLayout, n: number): WorksLayout =>
  n >= WORKS_PER_PAGE[want] ? want
    : n === 1 ? (want === 'label' || want === 'full' ? want : 'hero')
      : n === 2 ? (want === 'duo' ? 'duo' : 'feature') : want;

/**
 * 이 지면·이 작품 비율에서 **작품이 가장 크게 실리는 격자**를 재서 고른다.
 *
 * ⚠️ 격자의 좋고 나쁨은 판형과 작품 비율의 **조합**으로 정해진다. 실측(정사각이 많은 작가):
 *      '2점씩'@A4세로 21%  ·  '4점씩'@A4세로 44%
 *      '2점씩'@A4가로 45%  ·  '4점씩'@A4가로 21%
 *    같은 '2점씩'이 판형만 바꿔도 두 배 넘게 차이 난다. 자동 편집이 이걸 모르고
 *    '2점씩'을 고르면 **지면 절반이 이유 없이 비는 장**이 리듬이랍시고 반복된다.
 *    렌더러와 **같은 풀이**(`solveGrid`)로 재기 때문에 판단과 결과가 어긋나지 않는다.
 */
function rankGrids(theme: PortfolioTheme, design: PdfDesign, geom: GridGeometry): WorksLayout[] {
  return (['duo', 'grid', 'index'] as const)
    .map((k) => ({ k, c: solveGrid(WORKS_PER_PAGE[k], theme, design, geom, k === 'index').coverage }))
    .sort((a, b) => b.c - a.c)
    .map((x) => x.k);
}

/**
 * 자동 편집의 **리듬 패턴**. 작품이 많을수록 촘촘하게, 적을수록 넉넉하게.
 * 시리즈 첫 장은 항상 대형(hero) — 시리즈에 얼굴을 준다.
 *
 * ⚠️ 밀도는 **포트폴리오 전체 작품 수**로 정한다. 시리즈 하나만 보면 안 된다 —
 *    27점을 5개 시리즈로 나눈 작가는 시리즈마다 "6점이니 넉넉하게"가 되어
 *    **결국 27장이 전부 같은 구성**으로 나온다(실측: 같은 구성 20장 연속).
 * ⚠️ 무작위 금지(§12). 패턴은 고정이고 순서대로 돈다.
 */
function autoCadence(total: number, grids: WorksLayout[]): WorksLayout[] {
  const g1 = grids[0]!;
  // 아주 적으면 한 점씩 크게 — 이때 반복은 단조로움이 아니라 **넉넉함**이다.
  if (total <= 6) return ['hero'];
  // 적당하면 크게 위주에 격자를 한 번씩 끼워 박자를 준다(8점을 전부 hero 로 뽑으면 8장이 똑같다).
  if (total <= 14) return ['hero', 'hero', g1];
  // ⚠️ 격자 밀도를 여러 개 섞지 말 것. 2점→4점→6점을 번갈아 쓰면 리듬이 아니라
  //    **일관성 없음**으로 읽힌다(§12: 같은 디자인 언어 안에서의 변주여야 한다).
  //    변주는 '크게 하나 + 작게 둘'(feature)과 격자의 교대가 만든다.
  if (total <= 24) return ['feature', g1];
  // 많으면 격자 비중을 늘려 쪽수를 줄인다.
  return ['feature', g1, g1];
}

/**
 * 시리즈 하나(작품 배열) → 페이지 계획.
 *
 * 자동이 아니면 사용자가 고른 구성 하나로 통일하되 **분할만 균형 있게** 한다
 * (고른 구성은 그 사람의 디자인 언어다 — 마음대로 바꾸지 않는다, §32).
 *
 * @param total 포트폴리오 전체 작품 수(밀도 판정용). 없으면 이 시리즈 길이.
 * @param ctx   자동 편집이 구성을 **재서** 고르는 데 필요한 지면·기하. 없으면 고정 리듬.
 */
export function planWorkPages(
  items: PortfolioImage[], design: PdfDesign, total = items.length,
  ctx?: { theme: PortfolioTheme; geom: GridGeometry; opened?: boolean },
): WorkPagePlan[] {
  if (items.length === 0) return [];
  if (!design.auto) {
    const per = WORKS_PER_PAGE[design.worksLayout];
    return take(items, balancedSplit(items.length, per))
      .map((group) => ({ composition: fitComposition(design.worksLayout, group.length), items: group }));
  }

  const plans: WorkPagePlan[] = [];
  let rest = items;
  // 시리즈의 첫 작품은 대형 한 장 — 여는 페이지가 있어야 다음 장들이 '이어지는 것'으로 읽힌다.
  // (시리즈 여는 장이 이미 대표작을 실었으면 `opened` 로 건너뛴다 — 큰 그림이 연달아 두 장이면 리듬이 죽는다)
  if (!ctx?.opened && rest.length >= 3 && total > 8) { plans.push({ composition: 'hero', items: rest.slice(0, 1) }); rest = rest.slice(1); }

  const grids = ctx ? rankGrids(ctx.theme, design, ctx.geom) : (['grid', 'duo', 'index'] as WorksLayout[]);
  const cadence = autoCadence(total, grids);
  let k = 0;
  while (rest.length > 0) {
    const want = cadence[k % cadence.length]!;
    k += 1;
    const per = WORKS_PER_PAGE[want];
    // 남은 게 정원보다 적으면 남은 수에 맞는 구성으로 — 빈 칸이 생기지 않게.
    if (rest.length < per) {
      plans.push({ composition: fitComposition(want, rest.length), items: rest });
      break;
    }
    // 정원대로 담으면 **다음 장에 1점만** 남는 경우: 이번 장을 한 점 줄여 2+2 로 나눈다.
    const leftover = rest.length - per;
    const nextPer = WORKS_PER_PAGE[cadence[k % cadence.length]!];
    const n = (leftover === 1 && per >= 2 && rest.length >= 3) ? per - 1
      : (leftover > 0 && leftover < nextPer * 0.5 && per >= 2) ? Math.max(2, Math.ceil(rest.length / 2))
        : per;
    plans.push({ composition: fitComposition(want, n), items: rest.slice(0, n) });
    rest = rest.slice(n);
  }
  return plans;
}

// ── 작품 페이지 레이아웃 분기 ──
// hero:대형 단독 / label:뮤지엄 라벨 / full:전면 / feature:비대칭 / duo·grid·index:격자(gridWorksPage)
function worksPages(theme: PortfolioTheme, data: PortfolioBookData, items: PortfolioImage[], label: string, running: string | undefined, composition: WorksLayout, design: PdfDesign, geom: GridGeometry): PortfolioPage[] {
  // ⚠️ **뮤지엄 라벨은 라벨에 적을 게 있을 때만 뮤지엄 라벨이다.**
  //    이 배치는 지면의 44% 를 캡션 칸으로 비워 두는데, 실서버 작품 372점 중 361점(97%)은
  //    제목·재료·크기·연도가 **전부 비어 있다** — 그러면 페이지 절반이 아무것도 없는 흰 칸이 된다.
  //    적을 게 없으면 조용히 `hero`(대형 단독)로 그린다. 고른 사람 입장에서 배신이 아니라,
  //    "라벨에 넣을 정보가 없으니 작품을 크게" 가 그 의도에 더 맞다. 정보를 채운 작품은 그대로 라벨이다.
  const labelHasContent = (a: PortfolioImage) =>
    !captionParts(a, false).empty
    || (design.desc !== 'none' && !!String(a.description ?? '').trim());

  const out = ((): PortfolioPage[] => {
    switch (composition) {
      case 'hero': return heroWorksPage(theme, data, items[0]!, label, running, design);
      case 'label': return labelHasContent(items[0]!)
        ? labelWorksPage(theme, data, items[0]!, label, running, design)
        : heroWorksPage(theme, data, items[0]!, label, running, design);
      case 'full': return fullWorksPage(theme, data, items[0]!, label, running);
      case 'feature': return featureWorksPage(theme, data, items, label, running, design, geom);
      default: return gridWorksPage(theme, data, items, label, running, composition, design, geom);
    }
  })();
  // 첫 장이 작품 장이고, 뒤따르는 '이야기' 장은 글이다.
  return out.map((p, i) => (i === 0
    ? { ...p, kind: 'works' as const, works: items.length, composition }
    : { ...p, kind: 'prose' as const }));
}

// 대형 단독 — 회화 한 점을 크게 세로 중앙, 캡션(+설명옵션)은 아래.
// 설명 '전체'는 작품 페이지엔 2줄 요약을 두고 **다음 글 페이지**로 전문을 잇는다(뮤지엄 라벨과 동일, 잘림 방지).
function heroWorksPage(theme: PortfolioTheme, data: PortfolioBookData, a: PortfolioImage, label: string, running: string | undefined, design: PdfDesign): PortfolioPage[] {
  const avail = availH(theme);
  const descOn = design.desc !== 'none';
  const capW = theme.page.w - PAD(theme).x * 2;
  const cp = captionParts(a, false);
  const hasDesc = descOn && !!String(a.description ?? '').trim();
  const capH = cp.empty && !hasDesc ? 0
    : CAP_TOP + cp.titleLines * CAP_TITLE_LINE + cp.meta.length * CAP_META_LINE
      + (descOn ? CAP_DESC_TOP + DESC_LINE_H * 2 : 0) + 24;
  const imgH = Math.max(120, avail - capH);
  // ⚠️ 이미지 상자에 `height` 를 못박지 말 것 — **`max-height` 여야 한다.**
  //    정사각·가로 작품은 폭에서 먼저 걸리므로(세로 지면에서 흔하다) 고정 높이 상자 안에서
  //    위아래로 뜨고, 그만큼 캡션이 작품에서 멀어진다. 실데이터 실측(2026-08-31):
  //    작품 아래 **145~185px** 이 비어 캡션이 따로 노는 글처럼 보였다 — 미술관 캡션은
  //    작품 바로 아래 붙는다. 상자를 내용 높이로 두면 바깥 flex 가 작품+캡션을 **한 덩어리로**
  //    가운데 정렬한다. 넘침은 `max-height` 가 그대로 막는다.
  const inner = `
    <div style="height:${avail}px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:8px">
      <div style="max-height:${imgH}px;width:100%;display:flex;align-items:center;justify-content:center">
        ${img(a.url, `max-width:100%;max-height:${imgH}px;object-fit:contain;display:block`)}
      </div>
      <div style="width:100%">${captionHtml(theme, a, 'center')}${descOn ? shortDescHtml(theme, a, capW, 'center') : ''}</div>
    </div>`;
  const first: PortfolioPage = { label, html: page(theme, data, inner, { running: running || undefined }) };
  // 전체 설명 → 요약 2줄이 다 못 담는 긴 글은 뒤 글 페이지로(넘침 없이 전문 노출).
  const desc = design.desc === 'full' ? String(a.description ?? '').trim() : '';
  return desc
    ? [first, ...prosePages(theme, data, 'NOTE', artworkTitle(a), desc, `${artworkTitle(a)} 이야기`)]
    : [first];
}

// 전면 — 소프트 패널 위에 작품을 꽉 채우고(여백 안), 작은 캡션은 하단 좌측.
function fullWorksPage(theme: PortfolioTheme, data: PortfolioBookData, a: PortfolioImage, label: string, running?: string): PortfolioPage[] {
  const { w, h } = theme.page;
  // ⚠️ `artworkTitle()` 을 그대로 쓰면 제목 없는 작품에 '무제' 가 찍힌다 — 실데이터의 97% 다.
  const meta = [hasTitle(a) ? artworkTitle(a) : '', a.year].filter(Boolean).join(' · ');
  const inner = `
    <div style="position:absolute;left:64px;right:64px;top:64px;bottom:96px;background:${softPanel(theme)};display:flex;align-items:center;justify-content:center">
      ${img(a.url, `max-width:100%;max-height:100%;object-fit:contain;display:block`)}
    </div>
    <div style="position:absolute;left:64px;bottom:52px;font-size:12px;letter-spacing:0.08em;color:${theme.sub};overflow-wrap:anywhere">${esc(meta)}</div>`;
  void w; void h;
  return [{ label, html: page(theme, data, inner, { running, bare: true }) }];
}

// 뮤지엄 라벨 — 작품(좌) + 캡션 블록(우: 제목 크게·재료·크기·연도·상태·설명). 긴 설명은 뒤 글페이지로 넘긴다.
function labelWorksPage(theme: PortfolioTheme, data: PortfolioBookData, a: PortfolioImage, label: string, running: string | undefined, design: PdfDesign): PortfolioPage[] {
  const { w } = theme.page;
  const avail = availH(theme);
  const px = PAD(theme).x;
  const imgW = Math.round((w - px * 2) * 0.56);
  const colW = w - px * 2 - imgW - 56;
  const st = statusLabel(a);
  const lines = captionLines(a);
  const desc = design.desc !== 'none' ? String(a.description ?? '').trim() : '';
  // 캡션 블록(제목·메타·상태) 높이 대략 예약 후, 남는 만큼 설명을 담고 나머지는 글페이지로.
  // ⚠️ 제목이 없으면 그 줄을 안 그리므로 예약도 빼야 한다(안 그러면 헛자리가 남는다).
  const showTitle = hasTitle(a);
  const CAP_BLOCK = 60 + (showTitle ? 26 : 0) + lines.length * 30 + (st ? 24 : 0);
  const room = Math.max(0, avail - CAP_BLOCK - 40);
  const parts = desc
    ? splitParagraphs(desc.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean), room, 1e9, 14, 27, colW, 14)
    : [[]];
  const head = parts[0] ?? [];
  const isSerif = theme.titleSerif ?? (theme.display === SERIF);
  const capBlock = `
    <div style="width:44px;height:3px;background:${theme.accent};margin-bottom:22px"></div>
    ${showTitle ? `<div style="font-family:${theme.display};font-size:26px;font-weight:${isSerif ? 400 : 700};letter-spacing:0.02em;line-height:1.3;color:${theme.ink};word-break:keep-all;overflow-wrap:anywhere">${esc(artworkTitle(a))}</div>` : ''}
    ${lines.length ? `<div style="margin-top:18px;font-size:14px;line-height:2.0;color:${theme.sub}">${lines.map((l) => esc(l)).join('<br/>')}</div>` : ''}
    ${st ? `<div style="margin-top:10px;font-size:13px;font-weight:700;color:${theme.accent};letter-spacing:0.04em">● ${esc(st)}</div>` : ''}
    ${head.length ? `<div style="margin-top:26px;padding-top:22px;border-top:1px solid ${theme.line}">
      ${head.map((t) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.9;color:${theme.ink};word-break:keep-all;overflow-wrap:anywhere;text-align:${theme.proseAlign ?? 'left'}">${esc(t).replace(/\n/g, '<br/>')}</p>`).join('')}
    </div>` : ''}`;
  const inner = `
    <div style="display:flex;gap:56px;align-items:center;height:${avail}px">
      <div style="width:${imgW}px;height:${avail}px;display:flex;align-items:center;justify-content:center">
        ${img(a.url, `max-width:${imgW}px;max-height:${avail}px;object-fit:contain;display:block`)}
      </div>
      <div style="flex:1;min-width:0">${capBlock}</div>
    </div>`;
  const firstHtml = page(theme, data, inner, { running: running || undefined });
  const rest = parts.slice(1).flat();
  return rest.length
    ? [{ label, html: firstHtml }, ...prosePages(theme, data, 'NOTE', artworkTitle(a), rest.join('\n\n'), `${artworkTitle(a)} 이야기`)]
    : [{ label, html: firstHtml }];
}

// ── CV ──
// 경력은 작가마다 편차가 극심하다(실서버에 72건짜리 작가가 있다). 한 장에 다 넣으려 하면
// 페이지가 고정 크기라 **넘치는 만큼 그냥 잘려 나간다** — 게다가 잘렸다는 표시조차 없다.
// 그래서 넣기 전에 높이를 계산해 여러 장으로 나눈다.
//
// 실측이 아니라 추정이다(빌더가 DOM 없는 순수 함수라 잴 수가 없다). 그래서 넉넉하게 잡는다 —
// 좀 남는 건 괜찮지만 넘치면 글자가 사라진다.
const CV_LINE_H = 23;   // 항목 한 줄 (13px / line-height 1.75)
const CV_HEAD_H = 41;   // 섹션 제목 + 밑줄 + 여백
const CV_SEC_GAP = 26;  // 섹션 사이 여백

interface CvChunk { key: CareerKey; label: string; en: string; entries: string[]; cont: boolean }

/** 한 항목이 몇 줄로 접히는지 추정 (한글은 글자폭이 넓어 넉넉히 잡는다) */
function cvEntryLines(text: string, colW: number): number {
  const perChar = 11.5; // 13px 한글 기준 근사
  return Math.max(1, Math.ceil((text.length * perChar) / Math.max(colW, 120)));
}

/**
 * 경력 항목들을 페이지 → 단(column) 단위로 나눈다.
 * - 섹션 제목만 단 끝에 남는 고아를 막는다(제목 뒤에 최소 1줄은 붙인다)
 * - 섹션이 이어지면 다음 단에 제목을 다시 쓰고 `(계속)`을 붙인다 — 안 그러면 어느 섹션인지 알 수 없다
 */
export function splitCvColumns(
  sections: { key: CareerKey; label: string; en: string; entries: string[] }[],
  colH: number,
  colW: number,
  colsPerPage: number,
  firstPageColH: number,
): CvChunk[][][] {
  const pages: CvChunk[][][] = [];
  let page: CvChunk[][] = [];
  let col: CvChunk[] = [];
  let used = 0;
  let limit = firstPageColH;

  const pushCol = () => {
    page.push(col); col = []; used = 0;
    if (page.length >= colsPerPage) { pages.push(page); page = []; limit = colH; }
  };

  for (const sec of sections) {
    let cont = false;
    let i = 0;
    while (i < sec.entries.length) {
      const headH = CV_HEAD_H;
      // 제목만 들어가고 항목이 하나도 안 들어가면 이 단은 접는다(고아 방지)
      if (used + headH + CV_LINE_H > limit && used > 0) { pushCol(); continue; }
      const taken: string[] = [];
      let h = used + headH;
      while (i < sec.entries.length) {
        const eh = cvEntryLines(sec.entries[i]!, colW) * CV_LINE_H;
        if (h + eh > limit && taken.length > 0) break;
        taken.push(sec.entries[i]!); h += eh; i++;
      }
      col.push({ key: sec.key, label: sec.label, en: sec.en, entries: taken, cont });
      used = h + CV_SEC_GAP;
      cont = true;
      if (i < sec.entries.length) pushCol();
    }
  }
  if (col.length) page.push(col);
  if (page.length) pages.push(page);
  return pages;
}

function cvPages(theme: PortfolioTheme, data: PortfolioBookData): PortfolioPage[] {
  const c = normalizeCareer(data.career);
  const isSerif = theme.titleSerif ?? (theme.display === SERIF);
  const bio = String(data.biography ?? '').trim();
  const sections = CV_ORDER
    .filter(({ key }) => (c[key] ?? []).length > 0)
    .map(({ key, label, en }) => ({ key, label, en, entries: (c[key] ?? []).map(careerLineText).filter(Boolean) }));

  // 세로 판형은 한 단, 가로 판형은 두 단 (가로에서 한 단이면 줄이 지나치게 길어져 읽기 나쁘다)
  const twoCol = theme.page.w > theme.page.h;
  const cols = twoCol ? 2 : 1;
  const gap = twoCol ? 64 : 0;
  const contentW = theme.page.w - PAD(theme).x * 2;
  const colW = (contentW - gap * (cols - 1)) / cols;

  // 첫 장은 이름·약력이 자리를 먹는다.
  // 값은 실측이다 — 아이브로우 18 / 이름 여백 14 / 이름 51(명조 34px)·48(고딕 32px) / 단 시작 여백 30.
  // 예전 값(16+14+40·38+30)은 이름 높이를 10px 넘게 낮잡아 그만큼 경력이 아래로 넘쳤다.
  const headBlock = 18 + 14 + (isSerif ? 51 : 48) + 30;
  // 추정이 맞아떨어져도 글꼴 버전·기기에 따라 몇 px 어긋난다. 마지막 줄이 가장자리에 딱 붙으면
  // 그 오차에 바로 잘리므로 쿠션을 둔다(글 페이지와 같은 값).
  const SAFETY = 24;

  // ⚠️ 약력 높이는 **줄바꿈을 세어야 한다**. 예전엔 글자 수만 폭으로 나눠 줄 수를 잡았는데,
  // 화면에는 `\n`이 `<br/>`로 그대로 나가므로 짧은 줄이 여럿인 약력(학력/수상을 줄 나눠 적는 흔한 형태)에서
  // 90~136px 씩 모자랐고, 그만큼 경력이 아래로 넘쳐 **잘려 나갔다**(4개 포맷 전부, 실측).
  // 글 페이지가 쓰는 estimateParaH 와 같은 규칙으로 통일한다.
  const BIO_FONT = 14, BIO_LINE = 27, BIO_GAP = 16;
  const bioW = twoCol ? 900 : contentW;
  const bioH = bio ? estimateParaH(bio, BIO_FONT, BIO_LINE, bioW, BIO_GAP) : 0;

  // 약력이 길어 첫 장에 경력 칸이 쓸 만큼 안 남으면, 약력을 글 페이지로 빼고 경력은 다음 장부터 시작한다.
  // 억지로 같은 장에 밀어 넣으면 추정을 아무리 잘 해도 물리적으로 안 들어간다(약력만 600px 넘는 작가가 있다).
  const MIN_COL_H = 200;
  const bioOwnPage = bioH > 0 && availH(theme) - headBlock - bioH < MIN_COL_H;
  const bioPages = bioOwnPage
    ? prosePages(theme, data, 'CURRICULUM VITAE', displayName(data.user), bio, '약력')
    : [];

  const firstColH = availH(theme) - headBlock - (bioOwnPage ? 0 : bioH) - SAFETY;
  // 이어지는 장은 아이브로우 + 작은 이름줄(18px)만 — 이것도 실측 기준
  const contColH = availH(theme) - (18 + 14 + 30 + 30) - SAFETY;

  // 경력이 하나도 없어도 약력은 반드시 실어야 한다. 예전엔 여기서 빈 배열이 나와
  // **약력이 통째로 사라졌다**(경력 미입력 작가는 PDF에 약력이 아예 안 찍혔다).
  const laid = sections.length === 0
    ? (bioOwnPage ? [] : [[]])
    : splitCvColumns(sections, contColH, colW, cols, firstColH);

  const blockHtml = (b: CvChunk) => `
    <div style="margin-bottom:${CV_SEC_GAP}px">
      <div style="display:flex;align-items:baseline;gap:10px;border-bottom:1px solid ${theme.line};padding-bottom:7px">
        <span style="font-size:${isSerif ? 16 : 15}px;font-weight:${isSerif ? 400 : 800};font-family:${theme.display}">${esc(b.label)}${b.cont ? ' <span style="font-size:11px;font-weight:400;color:' + theme.sub + '">(계속)</span>' : ''}</span>
        <span style="font-size:10px;letter-spacing:0.22em;color:${theme.sub}">${esc(b.en)}</span>
      </div>
      <div style="margin-top:9px">
        ${b.entries.map((e) => `<div style="font-size:13px;line-height:1.75;color:${theme.ink};overflow-wrap:anywhere">${esc(e)}</div>`).join('')}
      </div>
    </div>`;

  return [...bioPages, ...laid.map((cols2, pi) => ({
    label: pi === 0 ? 'CV' : `CV (${pi + 1})`,
    html: page(theme, data, `
      <div style="font-size:12px;letter-spacing:0.34em;color:${theme.accent};font-weight:700">CURRICULUM VITAE${pi > 0 ? ' (계속)' : ''}</div>
      ${pi === 0
        ? `<div style="margin-top:14px;font-size:${isSerif ? 34 : 32}px;font-weight:${isSerif ? 400 : 800};font-family:${theme.display}">${esc(displayName(data.user))}</div>
           ${bio && !bioOwnPage ? `<div style="margin-top:16px;font-size:14px;line-height:1.9;color:${theme.ink};max-width:${twoCol ? '900px' : '100%'};word-break:keep-all;overflow-wrap:anywhere">${esc(bio).replace(/\n/g, '<br/>')}</div>` : ''}`
        : `<div style="margin-top:14px;font-size:18px;font-weight:${isSerif ? 400 : 700};font-family:${theme.display};color:${theme.sub}">${esc(displayName(data.user))}</div>`}
      <div style="margin-top:30px;display:flex;gap:${gap}px;align-items:flex-start">
        ${Array.from({ length: cols }, (_, ci) =>
          `<div style="flex:1;min-width:0">${(cols2[ci] ?? []).map(blockHtml).join('')}</div>`).join('')}
      </div>`),
  }))];
}

// ── 연락처 (마지막 장) ──
function contactHtml(theme: PortfolioTheme, data: PortfolioBookData): string {
  const name = displayName(data.user);
  const isSerif = theme.titleSerif ?? (theme.display === SERIF);
  const rows = [
    ['E-mail', data.user.email],
    ['Phone', data.user.phone],
    ['Instagram', igLabel(data.user.instagramUrl)],
  ].filter(([, v]) => String(v ?? '').trim()) as [string, string][];

  return page(theme, data, `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
      <div style="font-size:12px;letter-spacing:0.4em;color:${theme.accent};font-weight:700">CONTACT</div>
      <div style="margin-top:26px;font-size:${isSerif ? 52 : 46}px;font-weight:${isSerif ? 400 : 800};font-family:${theme.display};letter-spacing:${isSerif ? '0.06em' : '-0.02em'}">${esc(name)}</div>
      <div style="margin-top:30px;width:56px;height:3px;background:${theme.accent}"></div>
      <div style="margin-top:34px">
        ${rows.map(([k, v]) => `
          <div style="display:flex;gap:20px;justify-content:center;align-items:baseline;margin-bottom:12px">
            <span style="width:96px;text-align:right;font-size:11.5px;letter-spacing:0.2em;color:${theme.sub}">${esc(k.toUpperCase())}</span>
            <span style="font-size:17px;color:${theme.ink};overflow-wrap:anywhere">${esc(v)}</span>
          </div>`).join('')}
      </div>
      <div style="margin-top:52px;font-size:11.5px;letter-spacing:0.24em;color:${theme.sub}">MADE WITH ARTLINK · artlink.cc</div>
    </div>`);
  // ⚠️ bare를 쓰면 안 된다. bare는 패딩·flex 래퍼 없이 배경만 깐 껍데기라 안쪽의 `flex:1`이 먹지 않고
  //    내용이 위로 쏠린다(화이트 갤러리 마지막 장이 실제로 그랬다). 세로 중앙 정렬이 필요한 페이지는 일반 경로로.
}

/**
 * 포트폴리오 전체를 페이지 배열로 만든다 (순수 함수 — 미리보기와 PDF가 같은 결과를 쓴다).
 * 순서: 표지 → 작가노트 → [시리즈 소개 → 작품…]× → CV → 연락처
 */
export function buildPortfolioPages(
  data: PortfolioBookData,
  baseTheme: PortfolioTheme,
  opts?: { forPdf?: boolean; design?: unknown },
): PortfolioPage[] {
  imgMode = opts?.forPdf ? 'pdf' : 'display';
  // 디자인(색·판형·밀도·설명)을 입힌 파생 테마 — 아래 빌더 전부 이 theme + design 을 쓴다
  const design = normalizePdfDesign(opts?.design ?? null);
  // 본문(여백·러닝요소)은 표지와 무관하게 **항상 일관**(archive 기준). 판형·색·글꼴은 design 이 override. 표지는 별도 레지스트리.
  const theme = applyDesign(themeById('archive'), design);
  const pages: PortfolioPage[] = [{ label: '표지', html: coverHtml(theme, data, design), kind: 'cover' }];

  const statement = String(data.statement ?? '').trim();
  if (statement) pages.push(...statementPages(theme, data, statement).map((p) => ({ ...p, kind: 'prose' as const })));

  // 격자 기하는 **포트폴리오 전체**에서 한 번 뽑는다 — 페이지마다 계산하면 장마다 작품
  // 크기가 달라져 책이 흔들린다(§27). 비율을 모르면 정사각(1.0)으로 본다 = 옛 동작.
  const geom = gridGeometry(data);

  for (const g of groupBySeries(data.images, data.seriesInfo)) {
    let works = g.images;
    let opened = false;
    if (g.name && g.note) {
      // 자동 편집이면 [소개 + 대표작]을 한 장으로 — 소개만 있는 빈 장을 만들지 않는다.
      const merged = design.auto ? seriesOpenerPage(theme, data, g.name, g.note, works[0], design, geom) : null;
      if (merged) { pages.push({ ...merged, kind: 'prose', works: 1 }); works = works.slice(1); opened = true; }
      else pages.push(...prosePages(theme, data, 'SERIES', g.name, g.note, `${g.name} 소개`).map((p) => ({ ...p, kind: 'prose' as const })));
    }
    for (const plan of planWorkPages(works, design, data.images.length, { theme, geom, opened })) {
      pages.push(...worksPages(theme, data, plan.items, g.name || '작품', g.name || undefined, plan.composition, design, geom));
    }
  }


  const c = normalizeCareer(data.career);
  const hasCv = String(data.biography ?? '').trim() || CV_ORDER.some(({ key }) => (c[key] ?? []).length > 0);
  if (hasCv) pages.push(...cvPages(theme, data).map((p) => ({ ...p, kind: 'cv' as const })));

  pages.push({ label: '연락처', html: contactHtml(theme, data), kind: 'contact' });
  return pages;
}

/** PDF에 실릴 모든 이미지 주소 (prefetch 대상) */
export function bookImageUrls(data: PortfolioBookData): string[] {
  return data.images.map((i) => i.url).filter(Boolean);
}

export type BookPhase = 'images' | 'retry' | 'render';

/**
 * 페이지 HTML 배열 → PDF.
 * 페이지 하나를 판형 크기 그대로 렌더해 한 장에 꽉 채운다(여백은 각 페이지 HTML이 이미 갖고 있다).
 */
export async function renderPagesToPdf(
  pages: PortfolioPage[],
  theme: PortfolioTheme,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);
  const { w, h, mmW, mmH } = theme.page;

  // 인쇄 품질 240dpi를 목표로 배율을 정한다(판형이 커질수록 배율은 낮아진다 — 파일이 무한정 커지지 않게).
  const scale = Math.max(1, Math.min(2.4, (mmW / 25.4) * 240 / w));

  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${w}px;height:${h}px;z-index:-1;background:${theme.bg};`;
  document.body.appendChild(host);

  // 글꼴이 늦게 붙으면 폴백 글꼴로 렌더된 PDF가 나온다 — 표지 큰 글씨에서 바로 티가 난다.
  try { await document.fonts?.ready; } catch { /* 지원 안 하는 브라우저는 그대로 진행 */ }

  try {
    const pdf = new jsPDF({
      orientation: mmW > mmH ? 'l' : 'p',
      unit: 'mm',
      format: [Math.min(mmW, mmH), Math.max(mmW, mmH)],
    });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();

    for (let i = 0; i < pages.length; i++) {
      host.innerHTML = pages[i].html;
      await waitPageImages(host);
      const canvas = await html2canvas(host, { scale, useCORS: true, backgroundColor: theme.bg, width: w, height: h });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, pw, ph);
      // 큰 캔버스를 붙들고 있으면 30장 넘는 포트폴리오에서 메모리가 터진다
      canvas.width = 0; canvas.height = 0;
      onProgress?.(i + 1, pages.length);
    }
    return pdf.output('blob');
  } finally {
    document.body.removeChild(host);
  }
}

// 페이지 안 이미지가 다 뜰 때까지 대기 (decode까지 기다려야 캔버스에 빈 칸으로 찍히지 않는다)
function waitPageImages(host: HTMLElement): Promise<void> {
  const imgs = Array.from(host.querySelectorAll('img'));
  return Promise.all(
    imgs.map((im) =>
      im.complete && im.naturalWidth > 0
        ? Promise.resolve()
        : new Promise<void>((res) => {
            im.addEventListener('load', () => res(), { once: true });
            im.addEventListener('error', () => res(), { once: true });
          }),
    ),
  ).then(() => undefined);
}

/**
 * 포맷 PDF 다운로드.
 * 반환값의 `missing`은 끝내 못 받은 이미지 주소 — 호출부가 "몇 장이 비었다"고 알려야 한다(조용한 빈 칸 금지).
 */
export async function downloadPortfolioBook(
  data: PortfolioBookData,
  themeId: PortfolioThemeId,
  onProgress?: (done: number, total: number, phase: BookPhase) => void,
  design?: unknown,
): Promise<{ missing: string[]; pages: number }> {
  const base = themeById(themeId);
  const theme = applyDesign(base, normalizePdfDesign(design)); // 렌더 배경색·파일명용 파생 테마
  const urls = bookImageUrls(data);
  let failed = urls.length ? await prefetchImages(urls, (d, t) => onProgress?.(d, t, 'images')) : [];
  if (failed.length) failed = await recoverFailed(failed, (d, t) => onProgress?.(d, t, 'retry'));

  const pages = buildPortfolioPages(data, base, { forPdf: true, design });
  const blob = await renderPagesToPdf(pages, theme, (d, t) => onProgress?.(d, t, 'render'));
  triggerDownload(blob, `${safeName(displayName(data.user))}_포트폴리오.pdf`);
  return { missing: failed, pages: pages.length };
}

// ════════════════════════════════════════════════════════════════════════
//  편집 가능한 PPTX 내보내기
//  ─ 페이지를 이미지로 통째 붙이지 않는다. **렌더된 DOM을 걸어** 각 요소를
//    네이티브 파워포인트 개체(텍스트 상자·사진·도형)로 변환한다 → 사람이 수정 가능.
//  ─ 위치는 getBoundingClientRect, 스타일은 getComputedStyle 에서 뽑아 실제 렌더와 맞춘다.
//  ⚠️ 한계: 파워포인트는 글꼴을 '이름'으로 참조한다. 한글 웹폰트(Pretendard/Noto Serif)는
//     보는 PC에 없으면 대체된다 → 널리 깔린 글꼴(맑은 고딕/바탕)으로 매핑한다. 색·위치·사진·정렬은 그대로.
// ════════════════════════════════════════════════════════════════════════
const INLINE_TAGS = new Set(['SPAN', 'B', 'I', 'EM', 'STRONG', 'A', 'U', 'SUP', 'SUB', 'BR']);

function hexOf(c: string | null | undefined): string | null {
  if (!c) return null;
  const m = c.match(/rgba?\(([^)]+)\)/i);
  if (!m) return null;
  const p = m[1].split(',').map((s) => parseFloat(s));
  if (p.length >= 4 && p[3] === 0) return null; // 완전 투명
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n || 0))).toString(16).padStart(2, '0');
  return (h(p[0]) + h(p[1]) + h(p[2])).toUpperCase();
}
function ptOf(px: number, k: number): number { return Math.round(px * k * 72 * 100) / 100; }
// ⚠️ **실제 글꼴 이름을 그대로** 내보낸다 — 보는 PC에 그 글꼴이 있으면 화면과 100% 동일하게 나온다.
//    없으면 파워포인트가 대체(그때만 다르게 보임). 생성 시점 computed 의 첫 패밀리를 쓴다.
//    generic 키워드만 남으면(드묾) 널리 깔린 한글 글꼴로 폴백.
function faceOf(cs: CSSStyleDeclaration): string {
  const first = (cs.fontFamily || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
  const low = first.toLowerCase();
  if (!first || low === 'sans-serif' || low === 'monospace') return '맑은 고딕';
  if (low === 'serif') return '바탕';
  return first;
}
function alignOf(a: string): 'left' | 'center' | 'right' | 'justify' {
  if (a === 'center') return 'center';
  if (a === 'right' || a === 'end') return 'right';
  if (a === 'justify') return 'justify';
  return 'left';
}
function isTextLeaf(el: Element): boolean {
  if (!(el.textContent || '').trim()) return false;
  return Array.from(el.children).every((c) => INLINE_TAGS.has(c.tagName));
}
// ⚠️ **중첩 인라인까지 재귀**한다 — 한 겹만 처리하면 바깥 span 을 통째로 바깥 스타일로 넣어
//    안쪽 span 의 크기·색을 잃는다("수상 및 선정 (계속)" 의 옅은 '(계속)' 이 PPT 에서 제목 크기로 나오던 버그).
//    각 텍스트 조각은 그를 감싼 **가장 가까운 요소의** computed 스타일로 run 을 만든다.
function buildRuns(el: Element, k: number): { text: string; options: Record<string, unknown> }[] {
  const runs: { text: string; options: Record<string, unknown> }[] = [];
  const push = (t: string, opts: Record<string, unknown>) => {
    const clean = t.replace(/\s+/g, ' ');
    if (!clean.trim() && (!runs.length || runs[runs.length - 1].options.breakLine)) return;
    runs.push({ text: clean, options: opts });
  };
  const styleOf = (e: Element) => {
    const s = getComputedStyle(e);
    return { color: hexOf(s.color) || '000000', bold: parseInt(s.fontWeight, 10) >= 600, italic: s.fontStyle === 'italic', fontSize: ptOf(parseFloat(s.fontSize), k) };
  };
  const walk = (node: Element) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) push(child.nodeValue || '', styleOf(node));
      else if (child.nodeType === 1) {
        const e = child as Element;
        if (e.tagName === 'BR') { if (runs.length) runs[runs.length - 1].options.breakLine = true; return; }
        walk(e); // 재귀 — 안쪽 텍스트는 e 의 스타일로
      }
    });
  };
  walk(el);
  return runs;
}
// ⚠️ **브라우저가 실제로 나눈 줄** 그대로 뽑는다 — PPT 가 자기 폰트로 재줄바꿈하면 미리보기와
//    다른 데서 줄이 바뀐다("번역하는" vs "잔상을"). 이 줄들을 그대로 박고 wrap 을 끄면 100% 일치.
//    글자별 rect 의 top 이 바뀌는 지점 = 줄바꿈. `<br>` 은 명시적 줄바꿈.
function visualLines(el: Element): string[] {
  const range = document.createRange();
  const lines: string[] = [];
  let cur = '', lastTop: number | null = null;
  const flush = () => { const t = cur.replace(/\s+/g, ' ').trim(); if (t) lines.push(t); cur = ''; };
  el.childNodes.forEach((node) => {
    if (node.nodeType === 1 && (node as Element).tagName === 'BR') { flush(); lastTop = null; return; }
    if (node.nodeType !== 3) { cur += node.textContent || ''; return; }
    const txt = node.nodeValue || '';
    for (let i = 0; i < txt.length; i++) {
      range.setStart(node, i); range.setEnd(node, i + 1);
      const rects = range.getClientRects();
      const top = rects.length ? Math.round(rects[rects.length - 1].top) : null;
      if (top !== null && lastTop !== null && Math.abs(top - lastTop) > 2) flush();
      if (top !== null) lastTop = top;
      cur += txt[i];
    }
  });
  flush();
  return lines;
}
function imgDataUrl(im: HTMLImageElement): string | null {
  try {
    const nw = im.naturalWidth, nh = im.naturalHeight;
    if (!nw || !nh) return null;
    const cap = 1500; const s = Math.min(1, cap / Math.max(nw, nh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(nw * s)); c.height = Math.max(1, Math.round(nh * s));
    c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', 0.9);
    c.width = 0; c.height = 0;
    return url;
  } catch { return null; } // taint 등
}

// 슬라이드 하나에 DOM 트리를 개체로 풀어 넣는다. (전수조사에서 mock slide 로도 호출)
// wIn/hIn = 슬라이드 크기(inch) — 한 줄 텍스트 여유 폭을 슬라이드 안으로 클램프하는 데 쓴다.
export function serializePage(root: HTMLElement, slide: any, k: number, wIn: number, hIn: number): void {
  void hIn;
  const origin = root.getBoundingClientRect();
  const box = (r: DOMRect) => ({ x: (r.left - origin.left) * k, y: (r.top - origin.top) * k, w: r.width * k, h: r.height * k });
  const walk = (el: Element) => {
    Array.from(el.children).forEach((child) => {
      const cs = getComputedStyle(child);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return;
      const r = child.getBoundingClientRect();
      if (r.width < 0.5 || r.height < 0.5) { walk(child); return; }
      const b = box(r as DOMRect);

      if (child.tagName === 'IMG') {
        const data = imgDataUrl(child as HTMLImageElement);
        if (data) slide.addImage({ data, x: b.x, y: b.y, w: b.w, h: b.h });
        return;
      }
      // 배경·테두리 → 도형
      const fill = hexOf(cs.backgroundColor);
      const bw = parseFloat(cs.borderTopWidth);
      const bc = bw > 0 && cs.borderTopStyle !== 'none' ? hexOf(cs.borderTopColor) : null;
      if (fill || bc) {
        slide.addShape('rect', {
          x: b.x, y: b.y, w: b.w, h: b.h,
          fill: fill ? { color: fill } : { type: 'none' },
          line: bc ? { color: bc, width: ptOf(bw, k) } : { type: 'none' },
        });
      }
      if (isTextLeaf(child)) {
        const fsPx = parseFloat(cs.fontSize);
        const lhPx = parseFloat(cs.lineHeight);
        const ls = parseFloat(cs.letterSpacing);
        const lineH = Number.isFinite(lhPx) && lhPx > 0 ? lhPx : fsPx * 1.2;
        const al = alignOf(cs.textAlign);
        // 방식 3분기:
        //  ① 한 줄(이름·머리말 등) → 재줄바꿈 끔 + 여유 폭. 폰트가 넓어도 절대 두 줄로 안 쪼개진다(연락처 이름 사고 방지).
        //  ② 여러 줄 + 양쪽맞춤/리치(색 span) → **자동 줄바꿈**. 양쪽맞춤은 자동일 때만 각 줄이 늘어난다(하드 줄바꿈은 정렬 무력화).
        //  ③ 여러 줄 + 왼/오/가운데 → **브라우저 실제 줄**을 그대로 박는다(미리보기와 줄바뀜 위치 일치).
        //     단 wrap 은 켜 둔다 — 보는 PC 글꼴이 더 넓으면 그 줄만 graceful 재줄바꿈(넘침 방지), 글꼴 있으면 그대로.
        const rich = Array.from(child.children).some((c) => c.tagName !== 'BR');
        const isJustify = al === 'justify';
        const single = Math.round((child as HTMLElement).clientHeight / lineH) <= 1;
        const hard = !single && !rich && !isJustify;
        let runs: { text: string; options: Record<string, unknown> }[];
        let wrap: boolean;
        if (single) { runs = buildRuns(child, k); wrap = false; }
        else if (hard) {
          const lines = visualLines(child);
          runs = lines.map((t, i) => ({ text: t, options: i < lines.length - 1 ? { breakLine: true } : {} }));
          wrap = false; // 미리보기 줄을 그대로 고정 — 재줄바꿈 금지(아래에서 폭을 넉넉히 줘 안 잘리게)
        } else { runs = buildRuns(child, k); wrap = true; } // 양쪽맞춤 · 리치
        if (!runs.length) { return; }
        let { x, y, w, h } = b;
        if (single) {
          // 한 줄은 재줄바꿈 금지 + 여유 폭(정렬 유지).
          const slack = 0.6;
          if (al === 'center') { const cx = x + w / 2; w = Math.min(wIn, w + slack); x = Math.max(0, Math.min(wIn - w, cx - w / 2)); }
          else if (al === 'right') { const right = x + w; x = Math.max(0, x - slack); w = right - x; }
          else { w = Math.min(wIn - x, w + slack); }
        } else if (hard) {
          // 하드줄은 정렬 방향으로 **끝까지** 넓힌다 — 보는 PC 글꼴이 Chrome 보다 다소 넓어도 그 줄이 안 잘리고
          //    재줄바꿈도 안 돼 미리보기 줄바뀜이 그대로 유지된다.
          const pad = 0.04;
          if (al === 'center') { const cx = x + w / 2; w = Math.min(wIn - 2 * pad, w + 1.6); x = Math.max(pad, Math.min(wIn - pad - w, cx - w / 2)); }
          else if (al === 'right') { const right = x + w; x = pad; w = right - pad; }
          else { w = wIn - x - pad; }
        }
        slide.addText(runs, {
          x, y, w, h, margin: 0, wrap,
          fontFace: faceOf(cs), fontSize: ptOf(fsPx, k), color: hexOf(cs.color) || '000000',
          bold: parseInt(cs.fontWeight, 10) >= 600, italic: cs.fontStyle === 'italic',
          align: al, valign: 'top',
          charSpacing: Number.isFinite(ls) ? ptOf(ls, k) : 0,
          // 줄 간격은 절대값(pt) — HTML line-height 를 pt 로 고정(배율은 PPT 폰트 기준이라 어긋나 겹침).
          lineSpacing: Number.isFinite(lineH) && lineH > 0 ? ptOf(lineH, k) : undefined,
        });
        return; // 텍스트 잎은 더 안 내려간다
      }
      walk(child);
    });
  };
  walk(root);
}

/** 편집 가능한 PPTX 생성 — 각 페이지가 한 슬라이드, 요소는 네이티브 개체. */
export async function renderPagesToPptx(
  pages: PortfolioPage[], theme: PortfolioTheme, fileName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const PptxGen = (await import('pptxgenjs')).default;
  const { w, h, mmW, mmH } = theme.page;
  const wIn = mmW / 25.4, hIn = mmH / 25.4;
  const k = wIn / w; // 페이지 px → 인치

  const pptx = new PptxGen();
  pptx.defineLayout({ name: 'PF', width: wIn, height: hIn });
  pptx.layout = 'PF';
  const bg = hexOf(theme.bg) || 'FFFFFF';

  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${w}px;height:${h}px;z-index:-1;background:${theme.bg};`;
  document.body.appendChild(host);
  try { await document.fonts?.ready; } catch { /* noop */ }

  try {
    for (let i = 0; i < pages.length; i++) {
      host.innerHTML = pages[i].html;
      await waitPageImages(host);
      const slide = pptx.addSlide();
      slide.background = { color: bg };
      const root = host.firstElementChild as HTMLElement | null;
      if (root) serializePage(root, slide, k, wIn, hIn);
      onProgress?.(i + 1, pages.length);
    }
    await pptx.writeFile({ fileName });
  } finally {
    document.body.removeChild(host);
  }
}

/** 편집 가능한 PPTX 다운로드. PDF 와 같은 이미지 프리페치(동일 출처 blob → canvas taint 없음)를 재사용. */
export async function downloadPortfolioPptx(
  data: PortfolioBookData,
  themeId: PortfolioThemeId,
  onProgress?: (done: number, total: number, phase: BookPhase) => void,
  design?: unknown,
): Promise<{ missing: string[]; pages: number }> {
  const base = themeById(themeId);
  const theme = applyDesign(base, normalizePdfDesign(design));
  const urls = bookImageUrls(data);
  let failed = urls.length ? await prefetchImages(urls, (d, t) => onProgress?.(d, t, 'images')) : [];
  if (failed.length) failed = await recoverFailed(failed, (d, t) => onProgress?.(d, t, 'retry'));

  const pages = buildPortfolioPages(data, base, { forPdf: true, design });
  await renderPagesToPptx(pages, theme, `${safeName(displayName(data.user))}_포트폴리오.pptx`, (d, t) => onProgress?.(d, t, 'render'));
  return { missing: failed, pages: pages.length };
}
