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
  artworkTitle, careerLineText, displayYear, hasTitle,
  groupBySeries, normalizeCareer, statusLabel,
} from '@/lib/artwork';
import { artworkFacts } from '@/lib/artworkAnalysis';
import QRCode from 'qrcode';
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

// 글꼴 프리셋은 웹 작가 홈페이지와 같이 쓰므로 `lib/portfolioFonts.ts` 로 뺐다(2026-09-16). 이름은 그대로 다시 내보낸다.
import { SANS, SERIF, FONT_PRESETS, FONT_BY_KEY, PORTFOLIO_FONT_HREF, type FontKey, type FontPreset } from './portfolioFonts';
export { FONT_PRESETS, PORTFOLIO_FONT_HREF };
export type { FontKey, FontPreset };

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
/** `a5-portrait` 는 갤러리 도록(부스 툴킷, 2026-09-16)용 — 작가 화면의 판형 선택지에는 안 보인다 */
export type PageKey = 'a4-portrait' | 'a4-landscape' | 'wide' | 'a5-portrait';
export type Density = 1 | 2 | 4;
/**
 * 작품 설명을 싣는가 — **싣거나 안 싣거나 둘뿐이다**.
 *
 * ⚠️⚠️ **'요약(short)' 을 되살리지 말 것** (2026-09-13 삭제, 사용자 지적).
 * 포트폴리오는 작가가 자기 작업을 설명하는 문서다. 거기서 작가가 쓴 글을 2줄에 맞춰 잘라내고
 * `…` 를 붙이는 건 **말이 안 된다** — 문장 한가운데서 끊긴 설명은 없느니만 못하다.
 * 지면이 모자라면 자르는 게 아니라 **뒤 「〇〇 이야기」 장으로 잇는다**(넘침 없이 전문 노출).
 * 그래서 설명은 **한 장에 작품 한 점**인 구성(1점 크게·뮤지엄 라벨)에서만 싣는다 —
 * 격자에서 4점의 설명을 각각 뒤로 이으면 책이 글 페이지로 뒤덮인다.
 */
export type DescDepth = 'none' | 'full';
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
/** 캡션 표기 관례 — kr(작품명, 연도 / 재료 / 크기) | intl(작품명 / 재료 / 크기 / 연도) */
export type CaptionStyle = 'kr' | 'intl';
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
  /**
   * 캡션 표기 관례 (2026-09-16).
   *   kr   국내: **작품명, 제작연도 / 재료 / 크기** — 연도가 재료·크기 앞. 공개 홈페이지(`museumCaption`)와 같다.
   *   intl 해외: 작품명 / 재료 / 크기 / 연도 — 연도가 뒤.
   * 한 문서 안에서는 하나만 쓴다(조사: 심사자가 꼽는 결함 "캡션 형식이 장마다 다름").
   */
  captionStyle: CaptionStyle;
  /** 작가노트·마지막 장에 프로필 사진을 싣는가 (사진이 있을 때만 의미 있다). 골든 5권 중 3권이 넣는다 */
  artistPhoto: boolean;
  /** 마지막에 작품 목록(썸네일·쪽번호)을 붙이는가 — 도록의 List of Works. 작품이 6점 이상일 때만 만든다 */
  worksIndex: boolean;
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
  // A5 도록 — 픽셀을 A4 의 72% 로 잡아 글자(px 고정)가 인쇄에서 A4 와 같은 물리 크기(≈8pt)가 되게 한다.
  // A4 와 같은 1000px 로 두면 인쇄 시 글자가 5.9pt 로 줄어 못 읽는다. 여백·격자는 판형 비례라 그대로 따라온다.
  'a5-portrait':  { w: 720,  h: 1018, mmW: 148, mmH: 210 },
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
    // ⚠️ 기본 강조색은 **무채**(글자색과 같게)다 (2026-09-16 사용자 결정). 색은 작품이 갖고 지면은 물러난다 —
    //    골든(실제 작가 포트폴리오 5권)은 지면에 색을 거의 안 쓰고, 조사도 '흰 배경·검은 글자·장식 없이'가 관례였다.
    //    예전 기본 빨강은 머리말·막대·CV 제목이 전 장에서 빨갛게 나와 템플릿 냄새의 주범이었다. 고른 사람의 색은 그대로다.
    accent: isAccentKey(o.accent) ? o.accent : 'mono',
    font: (typeof o.font === 'string' && o.font in FONT_BY_KEY) ? o.font : (o.font === 'sans' ? 'gothic' : 'myeongjo'),
    page: (['a4-portrait', 'a4-landscape', 'wide', 'a5-portrait'] as const).includes(o.page) ? o.page : 'a4-portrait',
    // 작품 레이아웃 — 명시값 없으면 hero(대형 단독). 옛 density(1/2/4) → hero/duo/grid 마이그레이션.
    worksLayout: inList(['hero', 'label', 'full', 'feature', 'duo', 'grid', 'index'] as const, o.worksLayout) ? o.worksLayout
      : (o.density === 1 ? 'hero' : o.density === 4 ? 'grid' : o.density === 2 ? 'duo' : 'hero'),
    // 옛 '짧게(short)' 는 **전체로 올린다** — 잘린 글을 그대로 두느니 전문을 싣는 게 낫다
    desc: o.desc === 'full' || o.desc === 'short' ? 'full' : 'none',
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
    // ⚠️ 기본값은 **양쪽맞춤**이다(2026-09-13). 공개 홈페이지의 작가노트·약력이 이미 양쪽맞춤이라
    //    같은 글이 PDF 에서만 들쭉날쭉하면 두 화면이 다른 문서처럼 보인다. 고른 적 있으면 그 값을 지킨다.
    proseAlign: (['justify', 'left', 'right'] as const).includes(o.proseAlign) ? o.proseAlign : 'justify',
    captionStyle: o.captionStyle === 'intl' ? 'intl' : 'kr',
    artistPhoto: o.artistPhoto !== false,
    worksIndex: o.worksIndex !== false,
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
  user: {
    name: string; nickname?: string | null; email?: string | null; phone?: string | null; instagramUrl?: string | null;
    /** 프로필 사진 — 작가노트·마지막 장에 실린다(`design.artistPhoto`). 없으면 그 자리를 안 만든다 */
    avatar?: string | null;
  };
  /**
   * 작가 홈페이지 주소(절대 URL, 예 `https://artlink.cc/@kiiryang`). 마지막 장의 QR·주소 줄이 쓴다.
   * 빌더는 순수 함수라 origin 을 모르므로 **부르는 쪽이 만들어 넘긴다**(없으면 QR 도 없다).
   */
  homepageUrl?: string | null;
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
  kind?: 'cover' | 'prose' | 'works' | 'index' | 'cv' | 'contact';
  /** 이 장에 실린 작품 수 (kind==='works' 또는 시리즈 여는 장) */
  works?: number;
  /** 쓰인 배치 이름 (kind==='works') */
  composition?: WorksLayout;
  /** 이 장에 실린 작품 id — 마지막 '작품 목록'이 쪽번호를 찾는 데 쓴다 */
  workIds?: number[];
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

/**
 * 산문 한 줄의 **글자 수 상한** (2026-09-13).
 *
 * 줄이 길면 눈이 다음 줄 첫머리를 못 찾는다. 본문 폭을 그대로 쓰면 A4 세로에서 한 줄이 63자,
 * 가로 판형에서는 **69자**까지 간다(실측). 한글 산문은 **35~45자**가 읽기 좋고, 인쇄물의
 * 오랜 관례도 그 근처다. ⚠️ 상한은 **폭이 아니라 글자 수**로 둔다 — 판형·글꼴 크기가 달라져도
 * 읽는 조건이 같아야 한다.
 * ⚠️ 재는 폭(`colW`)과 그리는 폭(`max-width`)이 **같아야** 한다. 다르면 높이 추정이 틀려
 * 글이 조용히 잘린다(§19).
 */
const PROSE_MAX_CHARS = 46;
const proseColW = (fontPx: number, contentW: number) =>
  Math.min(contentW, Math.round(fontPx * CHAR_W_RATIO * PROSE_MAX_CHARS));

/** 문단 하나의 높이 추정 (줄바꿈 포함) */
export function estimateParaH(text: string, fontPx: number, lineH: number, colW: number, gap: number): number {
  const perLine = Math.max(1, Math.floor(colW / (fontPx * CHAR_W_RATIO)));
  const lines = text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
  return lines * lineH + gap;
}

/** 목록으로 보이는 줄 — "2024 개인전 …" 처럼 연도로 시작한다 */
const YEAR_LINE = /^\s*(?:19|20)\d{2}\s*[.\-–~/년]?/;

/**
 * 작가가 입력창에서 친 **단일 줄바꿈**을 산문에서는 공백으로 잇는다 (2026-09-13).
 *
 * ## 왜
 * 많은 작가가 글을 쓸 때 문장마다 엔터를 친다. 그대로 `<br/>` 로 내보내면 지면에서
 * "형상화한다." "언어이며," 같은 **한 단어짜리 행**이 생겨 글이 부서져 보인다.
 * 실데이터(실서버): 박기량 작가노트 246자에 단일 개행 5 · 빈 줄 0, 오무 약력 1246자에 단일 개행 21 · 빈 줄 0.
 *
 * ## 왜 "빈 줄만 문단"으로 단순화하면 안 되나
 * 위 두 사람은 빈 줄이 **하나도 없다**. 그 규칙만 넣으면 1246자가 통째로 한 문단이 된다.
 * 반대로 줄바꿈을 다 살리면 지금처럼 부서진다. 그래서 **글의 모양을 보고 가른다** —
 * 연도로 시작하는 줄이 많거나 줄이 짧으면 **목록**(학력·전시 이력을 줄 나눠 적은 것)이라
 * 그대로 두고, 아니면 **산문**이라 이어 붙인다.
 *
 * ⚠️ **높이 추정과 렌더가 같은 문자열을 봐야 한다**(§19). 그래서 이 함수는 그리기 직전이 아니라
 *    **문단으로 쪼개기 전에** 통과시킨다 — 한쪽만 고치면 추정이 틀려 글이 조용히 잘린다.
 * ⚠️ 저장된 원문은 건드리지 않는다. 화면(공개 홈페이지)은 작가가 친 그대로 보여준다 —
 *    여기서 합치는 건 **인쇄 지면**에서 한 단어짜리 행을 막기 위해서다.
 */
export function proseText(text: string | null | undefined): string {
  const raw = String(text ?? '');
  const body = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (body.length < 2) return raw;
  const yearish = body.filter((l) => YEAR_LINE.test(l)).length;
  const shortish = body.filter((l) => [...l].length <= 24).length;
  // 목록으로 보이면 줄을 그대로 지킨다
  if (yearish >= body.length * 0.4 || shortish >= body.length * 0.6) return raw;
  return raw
    .split(/\n{2,}/)
    .map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n\n');
}

/**
 * **마지막 장에 두세 줄만 남는 것을 막는다** (2026-09-13).
 *
 * 나누는 함수들은 앞 장을 꽉 채우고 남은 걸 뒤로 넘긴다. 그래서 딱 몇 줄이 넘치면
 * 그 몇 줄만 든 장이 생긴다 — 실측(실서버 작가 5명): `CV (계속)` 이 지면의 **30% · 30% · 17%**,
 * `약력 (계속)` 이 **16%**. 보는 사람에게 이건 부주의로 읽힌다.
 *
 * 쪽수를 **늘리지 않으면서** 고르게 펴는 방법은 하나다 — 같은 쪽수를 유지하는 **가장 작은 용량**을
 * 찾는 것. 용량을 줄이면 앞 장이 덜 담고 그만큼 뒤로 밀려, 마지막 장이 채워진다.
 * 용량↓ ⇒ 쪽수↑ 는 단조라 이분탐색이 된다(순수 문자열 계산이라 열 번 돌려도 공짜다).
 */
function evenPages<T>(make: (capScale: number) => T[]): T[] {
  const full = make(1);
  if (full.length <= 1) return full;
  const n = full.length;
  let lo = 0.4, hi = 1;                       // hi 는 늘 n 장. lo 는 n 장보다 많을 수 있다.
  if (make(lo).length === n) return make(lo);  // 더 줄여도 안 늘어나면 제일 고른 쪽
  for (let i = 0; i < 8; i += 1) {
    const mid = (lo + hi) / 2;
    if (make(mid).length === n) hi = mid; else lo = mid;
  }
  return make(hi);
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
  /** 쪽번호를 끄는 페이지(표지) */
  folio?: false;
}

/**
 * 쪽번호 자리표 — `page()` 가 심어 두고 `buildPortfolioPages` 가 **마지막에** 실제 번호로 바꾼다.
 *
 * ⚠️ 왜 자리표인가: `page()` 는 자기가 몇 번째 장인지 모른다(장은 여러 빌더가 제각각 만든다).
 *    번호를 인자로 넘기려면 모든 빌더의 시그니처를 바꿔야 하고, 한 군데만 빠뜨리면 **그 장만
 *    번호가 없다**. 자리표는 빠뜨릴 수가 없다.
 * ⚠️ 20~30쪽 문서에서 심사자가 "12쪽 작품"이라고 부를 수 없으면 그건 문서가 아니라 이미지 묶음이다.
 *    표지는 1쪽으로 세되 **찍지 않는다**(인쇄 관례).
 */
const FOLIO = '<!--FOLIO-->';

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

/** 러닝 머리말 기본 문구. 포트폴리오는 'PORTFOLIO', 갤러리 도록은 buildPortfolioPages 의 `runningHead` 로 바꾼다(2026-09-16) */
let runningHeadDefault = 'PORTFOLIO';

function page(theme: PortfolioTheme, data: PortfolioBookData, inner: string, chrome: Chrome = {}): string {
  const { w, h } = theme.page;
  const shell = (content: string, bg = theme.bg) =>
    `<div style="position:relative;width:${w}px;height:${h}px;background:${bg};font-family:${theme.bodyFont ?? SANS};color:${theme.ink};overflow:hidden;box-sizing:border-box">${content}</div>`;

  const p = PAD(theme);
  const folio = chrome.folio === false ? ''
    : `<div style="position:absolute;left:0;right:0;bottom:${Math.max(18, Math.round(p.bottom * 0.42))}px;text-align:center;font-size:11px;letter-spacing:0.18em;color:${theme.sub}">${FOLIO}</div>`;

  if (chrome.bare) return shell(inner + folio);

  const name = displayName(data.user);
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
        <span>${esc((chrome.running || runningHeadDefault).toUpperCase())}</span>
        <span>${esc(name)}</span>
      </div>`;
  }

  return shell(`${deco}<div style="position:relative;width:${w}px;height:${h}px;box-sizing:border-box;${pad};display:flex;flex-direction:column">${inner}</div>${folio}`);
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
  /** `images` 와 나란한 가로/세로 비율(모르면 1) — 여러 작품 표지가 칸을 그림 모양에 맞추는 데 쓴다 */
  aspects: number[];
  /** 실린 작품의 제작연도 범위("2021–2026"). 없으면 '' */
  yearRange: string;
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
// 여러 작품 그리드 셀 — contain(크롭 금지). url 이 비면 **빈 칸**(패널만 그려 자리를 표시한다).
// ⚠️ **그림이 있는 칸 뒤에는 패널을 깔지 않는다** — 아래 `softPanel` 주석 참고.
const gridCell = (theme: PortfolioTheme, url: string) =>
  `<div style="display:flex;align-items:center;justify-content:center;overflow:hidden">${panelBox(url ? undefined : softPanel(theme), url ? fillImg(url) : '')}</div>`;

type CoverRender = (theme: PortfolioTheme, data: PortfolioBookData, v: CoverArgs) => string;

/**
 * 소프트 패널색 — 글자색을 배경에 5% 섞은 옅은 면.
 *
 * ⚠️⚠️ **작품 그림 뒤에 깔지 말 것** (2026-09-13 전수 제거).
 * 그림은 자르지 않으므로(§18 `object-fit:contain`) 슬롯 비율과 그림 비율이 다른 만큼 **판이 드러난다**.
 * 실측(실서버 작가 5명 렌더): 표지 4점 격자는 판의 **30%** 만 그림이 덮었고(70% 가 회색),
 * 사진 오른쪽 38% · 반색반사진 62% · **전면 배치 작품 페이지는 65%** 였다 —
 * 27쪽 내내 좌우로 회색 띠가 붙었다. 매트처럼 보이지도 않는다(사방이 균등해야 매트인데
 * 한 축만 뜬다). 보는 사람은 **파일이 깨졌다**고 읽는다.
 * 이미 격자(`gridWorksPage`)는 칸을 비율대로 잡아 판이 안 보이는데(실측 덮음 100%),
 * 그 개정이 **표지와 전면 배치에는 안 갔던 것**이다(§45 정렬 격자와 같은 문제).
 *
 * 지금 이 색을 쓰는 곳은 둘뿐이다:
 *   ① `coverFullTint` 의 **전면 틴트 배경**(그림 뒤가 아니라 지면 전체가 그 색인 디자인)
 *   ② 표지 편집에서 **비운 칸**(`gridCell(url='')`) — 그림이 없으니 판이 곧 '여기 자리가 있다'는 표시다
 * 새로 쓸 일이 생기면 **그림 뒤인지** 먼저 볼 것. 그림 뒤면 답은 '깔지 않는다'다.
 */
// ⚠️ **CSS `color-mix()` 로 쓰지 말 것.** 크롬은 이걸 `color(srgb …)` 로 계산해 내리는데
//    html2canvas 1.4.1 이 `color()` 를 파싱하다 던져 **PDF 저장이 통째로 실패**한다
//    (표지 21종 중 13종 · 작품 레이아웃 6종 중 4종이 이 함수를 쓴다 = 조합의 87%).
//    PPTX 는 더 나쁘다 — `hexOf()` 가 `rgba?()` 만 받아 null 이 되고 배경 도형이 조용히 빠진다.
//    화면(크롬)에서는 둘 다 멀쩡해 보여서 눈으로는 절대 안 잡힌다. hex 로 미리 섞어 둘 것.
const softPanel = (theme: PortfolioTheme) => mixHex(theme.ink, theme.bg, 0.95);
const nc = (theme: PortfolioTheme, v: CoverArgs) => (v.nameAccent ? theme.accent : theme.ink);
const metaLine = (v: CoverArgs) => [v.showEyebrow ? esc(v.eyebrow) : '', v.showYear ? esc(v.year) : ''].filter(Boolean).join(' · ');
const shell = (theme: PortfolioTheme, data: PortfolioBookData, inner: string) =>
  page(theme, data, `<div style="position:absolute;inset:0;background:${theme.bg}"></div>${inner}`, { bare: true, folio: false });

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
    <div style="position:absolute;left:${P}px;right:${P}px;bottom:120px;display:flex;justify-content:space-between;font-size:13px;letter-spacing:0.34em;color:${t.sub}"><span>SELECTED WORKS${v.yearRange ? ` ${esc(v.yearRange)}` : ''}</span>${v.showYear ? `<span>${esc(v.year)}</span>` : '<span></span>'}</div>`); };


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
        ${v.hero ? panelBox(undefined, fillImg(v.hero)) : ''}
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
    ${v.hero ? heroBox(v.hero, `left:${P}px;right:${P}px;top:${Math.round(h * 0.42)}px;bottom:110px`) : ''}
    ${v.showYear ? `<div style="position:absolute;left:0;right:0;bottom:60px;text-align:center;font-size:13px;letter-spacing:0.4em;color:${t.sub}">${esc(v.year)}</div>` : ''}`); };

// ⚠️ 액자 표지의 사진은 크게 — 예전엔 좌우 160px·위 420px 을 비워 사진이 지면의 30% 였다(실측 G 와 같은 병: 자신감 없음).
//    골든은 표지 사진을 지면 끝까지 밀어붙인다. 자르지는 않되(사용자 결정) 여백을 최소로 줄인다.
const coverMatted: CoverRender = (t, d, v) => { const { w, h } = t.page; const P = Math.round(w * 0.1); const px = ft(v, 70, w - 200, 2);
  return shell(t, d, `
    <div style="position:absolute;left:0;right:0;top:${Math.round(h * 0.075)}px;text-align:center;padding:0 100px;box-sizing:border-box">
      ${v.showEyebrow ? `<div style="font-size:12px;letter-spacing:0.5em;color:${t.sub};margin-bottom:20px">${esc(v.eyebrow)}</div>` : ''}
      <div style="${titleCss(t, px, nc(t, v), '0.08em')};text-align:center">${esc(v.name)}</div></div>
    ${v.hero ? heroBox(v.hero, `left:${P}px;right:${P}px;top:${Math.round(h * 0.235)}px;bottom:${Math.round(h * 0.11)}px;border:1px solid ${t.line};padding:${Math.round(w * 0.032)}px`) : ''}
    ${v.showYear ? `<div style="position:absolute;left:0;right:0;bottom:${Math.round(h * 0.055)}px;text-align:center;font-size:14px;letter-spacing:0.4em;color:${t.sub}">${esc(v.year)}</div>` : ''}`); };

const coverFullTint: CoverRender = (t, d, v) => { const px = ft(v, 72, t.page.w - 220, 2);
  return page(t, d, `<div style="position:absolute;inset:0;background:${softPanel(t)}"></div>
    ${v.hero ? `<div style="position:absolute;left:0;right:0;top:60px;bottom:260px;display:flex;align-items:center;justify-content:center">${cImg(v.hero, 82, 100)}</div>` : ''}
    <div style="position:absolute;left:0;right:0;bottom:110px;text-align:center;padding:0 110px;box-sizing:border-box">
      <div style="${titleCss(t, px, nc(t, v), '0.06em')};text-align:center">${esc(v.name)}</div>
      ${metaLine(v) ? `<div style="margin-top:18px;font-size:13px;letter-spacing:0.42em;color:${t.sub}">${metaLine(v)}</div>` : ''}</div>`, { bare: true, folio: false }); };

const coverSquareHero: CoverRender = (t, d, v) => { const { w, h } = t.page; const P = 96, px = ft(v, 60, w - 200, 2);
  const areaH = h - 96 - 320; const sq = Math.round(Math.max(200, Math.min(w - 2 * P, areaH)) * coverImgScale);
  return shell(t, d, `
    ${v.hero ? `<div style="position:absolute;left:0;right:0;top:96px;bottom:320px;display:flex;align-items:center;justify-content:center"><div style="width:${sq}px;height:${sq}px;display:flex;align-items:center;justify-content:center">${fillImg(v.hero)}</div></div>` : ''}
    <div style="position:absolute;left:0;right:0;bottom:60px;height:236px;text-align:center;padding:0 100px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center">
      <div style="${titleCss(t, px, nc(t, v), '0.08em')};text-align:center">${esc(v.name)}</div>
      <div style="margin:20px auto 0;width:54px;height:2px;background:${t.accent}"></div>
      ${metaLine(v) ? `<div style="margin-top:16px;font-size:13px;letter-spacing:0.42em;color:${t.sub}">${metaLine(v)}</div>` : ''}
</div>`); };

const coverSide: CoverRender = (t, d, v) => { const { w, h } = t.page; const iw = Math.round(w * 0.52); const slotW = Math.round(w * 0.4) - 6; const px = ft(v, 74, slotW, 3);
  return shell(t, d, `
    ${v.hero ? heroBox(v.hero, `right:0;top:0;height:${h}px;width:${iw}px;padding:60px`) : ''}
    <div style="position:absolute;left:90px;width:${Math.round(w * 0.4)}px;top:50%;transform:translateY(-50%)">
      ${v.showEyebrow ? `<div style="font-size:12px;letter-spacing:0.42em;color:${t.accent};font-weight:700;margin-bottom:20px">${esc(v.eyebrow)}</div>` : ''}
      <div style="${titleCss(t, px, nc(t, v), '0.02em')};line-height:1.04">${esc(v.name)}</div>
      <div style="margin-top:26px;width:56px;height:3px;background:${t.accent}"></div>
      ${v.showYear ? `<div style="margin-top:22px;font-size:13px;letter-spacing:0.4em;color:${t.sub}">${esc(v.year)}</div>` : ''}
</div>`); };


// ⚠️ 여러 작품 표지의 칸은 **그림 모양에 맞춰** 잡는다 (2026-09-16). 예전엔 칸을 `1fr` 로 균등 분할해서
//    가로 그림 넷이면 칸의 위아래가, 세로 그림이면 좌우가 비어 격자가 성겨 보였다(실측 G: 사진이 작고 위쪽 몰림).
//    칸 높이를 네 그림의 중앙 비율로 정하고 격자 덩어리를 영역 안에서 가운데 두면 칸과 그림이 맞는다(자르지 않고).
const coverGrid2x2: CoverRender = (t, d, v) => { const { w, h } = t.page; const P = 96, gap = 16, px = ft(v, 56, w - 2 * P, 2); const g = v.images.slice(0, 4);
  const areaTop = Math.round(h * 0.068), areaBottom = Math.round(h * 0.21);
  const areaW = w - 2 * P, areaH = h - areaTop - areaBottom;
  const asp = v.aspects.slice(0, 4).filter((a) => a > 0).sort((a, b) => a - b);
  const median = asp.length ? asp[Math.floor(asp.length / 2)]! : 1;
  const cellW = (areaW - gap) / 2;
  const cellH = Math.min(cellW / median, (areaH - gap) / 2);
  return shell(t, d, `
    <div style="position:absolute;left:${P}px;right:${P}px;top:${areaTop}px;height:${areaH}px;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:${Math.round(cellH)}px ${Math.round(cellH)}px;gap:${gap}px;align-content:center">${g.map((u) => gridCell(t, u)).join('')}</div>
    <div style="position:absolute;left:${P}px;right:${P}px;bottom:${Math.round(h * 0.045)}px;height:${Math.round(h * 0.15)}px;display:flex;flex-direction:column;justify-content:center">
      <div style="width:56px;height:4px;background:${t.accent};margin-bottom:18px"></div>
      <div style="${titleCss(t, px, nc(t, v), '0.02em')}">${esc(v.name)}</div>
      ${metaLine(v) ? `<div style="margin-top:14px;font-size:12px;letter-spacing:0.42em;color:${t.sub}">${metaLine(v)}</div>` : ''}
</div>`); };

// 1점 크게 + 2점 — 큰 칸의 높이가 작은 두 칸을 합친 높이와 **정확히 같아야** 한 덩어리로 읽힌다.
// 칸 폭은 각 그림의 비율에서 나온다(큰 칸 = H×a₁, 작은 열 = (H−gap)/2 × max(a₂,a₃)). 그림이 칸을 채우므로 정렬이 맞는다(실측 I 수정).
const coverMosaic: CoverRender = (t, d, v) => { const { w, h } = t.page; const P = 96, gap = 16, px = ft(v, 60, w - 2 * P, 2); const g = v.images.slice(0, 3);
  const areaTop = Math.round(h * 0.068), areaBottom = Math.round(h * 0.21);
  const areaW = w - 2 * P, areaH = h - areaTop - areaBottom;
  const a1 = v.aspects[0] ?? 1, aS = Math.max(v.aspects[1] ?? 1, v.aspects[2] ?? 1);
  // W(H) = H·a1 + gap + (H−gap)/2·aS ≤ areaW
  const H = Math.min(areaH, (areaW - gap + (gap * aS) / 2) / (a1 + aS / 2));
  const bigW = Math.round(H * a1), smallH = Math.round((H - gap) / 2), colW = Math.round(smallH * aS);
  return shell(t, d, `
    <div style="position:absolute;left:${P}px;right:${P}px;top:${areaTop}px;height:${areaH}px;display:flex;align-items:center;justify-content:center">
      <div style="display:grid;grid-template-columns:${bigW}px ${colW}px;grid-template-rows:${smallH}px ${smallH}px;gap:${gap}px">
        <div style="grid-row:1 / span 2;overflow:hidden;display:flex;align-items:center;justify-content:center">${panelBox(g[0] ? undefined : softPanel(t), g[0] ? fillImg(g[0]) : '')}</div>
        ${gridCell(t, g[1] ?? '')}${gridCell(t, g[2] ?? '')}
      </div>
    </div>
    <div style="position:absolute;left:${P}px;right:${P}px;bottom:${Math.round(h * 0.045)}px;height:${Math.round(h * 0.15)}px;display:flex;flex-direction:column;justify-content:center">
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
</div>`, { bare: true, folio: false }); };

const coverColorBand: CoverRender = (t, d, v) => { const { w, h } = t.page; const P = 90, bandH = Math.round(h * 0.32), px = ft(v, 80, w - 2 * P, 2);
  return shell(t, d, `
    <div style="position:absolute;left:0;top:0;width:${w}px;height:${bandH}px;background:${t.accent};color:${t.bg};display:flex;flex-direction:column;justify-content:center;padding:0 ${P}px;box-sizing:border-box">
      ${metaLine(v) ? `<div style="font-size:12px;letter-spacing:0.4em;opacity:.9;margin-bottom:16px">${metaLine(v)}</div>` : ''}
      <div style="${titleCss(t, px, t.bg, '0.02em')}">${esc(v.name)}</div></div>
    ${v.hero ? heroBox(v.hero, `left:${P}px;right:${P}px;top:${bandH + 56}px;bottom:90px`) : ''}`); };

const coverSplit: CoverRender = (t, d, v) => { const { w, h } = t.page; const lw = Math.round(w * 0.46); const px = ft(v, 74, lw - 120, 3);
  return shell(t, d, `
    <div style="position:absolute;left:0;top:0;height:${h}px;width:${lw}px;background:${t.accent};color:${t.bg};display:flex;flex-direction:column;justify-content:center;padding:0 60px;box-sizing:border-box">
      ${v.showEyebrow ? `<div style="font-size:12px;letter-spacing:0.4em;opacity:.9;margin-bottom:20px">${esc(v.eyebrow)}</div>` : ''}
      <div style="${titleCss(t, px, t.bg, '0.02em')};line-height:1.05">${esc(v.name)}</div>
      <div style="margin-top:28px;width:56px;height:3px;background:${t.bg};opacity:.85"></div>
      ${v.showYear ? `<div style="margin-top:22px;font-size:13px;letter-spacing:0.4em;opacity:.9">${esc(v.year)}</div>` : ''}</div>
    ${v.hero ? heroBox(v.hero, `right:0;top:0;height:${h}px;left:${lw}px;padding:56px`) : ''}`); };

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
  // 표지 칸을 그림 모양에 맞추기 위한 비율(url → aspect). 비율을 모르면 정사각으로 본다(옛 동작).
  const aspectByUrl = new Map(data.images.map((i) => [i.url, Math.min(4, Math.max(0.25, artworkFacts(i, data.aspects ?? null).aspect))] as const));
  // 제작연도 범위 — "SELECTED WORKS 2021–2026" 처럼 실제 도록·포트폴리오가 쓰는 표기. 연도가 하나뿐이면 그 해만.
  const years = data.images.map((i) => displayYear(i.year)).map((y) => /^(19|20)\d{2}$/.test(y) ? Number(y) : NaN).filter((n) => !isNaN(n));
  const yearRange = years.length ? (Math.min(...years) === Math.max(...years) ? String(years[0]) : `${Math.min(...years)}–${Math.max(...years)}`) : '';
  const v: CoverArgs = {
    name: displayName(data.user),
    year: data.year || String(new Date().getFullYear()),
    eyebrow: (design.coverEyebrowText ?? '').trim() || EYEBROW,
    hero: images[0] || '',
    images,
    aspects: images.map((u) => aspectByUrl.get(u) ?? 1),
    yearRange,
    showEyebrow: design.coverEyebrow, showYear: design.coverYear,
    nameAccent: design.coverNameAccent, textScale: design.coverTextScale,
  };
  // 그림 크기 슬라이더 — 표지 렌더 동안만 모듈 변수 설정, 끝나면 복원(body 는 1로).
  coverImgScale = design.coverImageScale;
  const out = COVER_META[key].render(theme, data, v);
  coverImgScale = 1;
  return out;
}

// ── 글 장의 공통 문법 (2026-09-16 지면 체계 v2) ──────────────────────────────
// ⚠️ 예전 글 장은 전부 [작은 대문자 머리말 → 제목 → 강조색 막대 → 글] 을 지면 **가운데**에 쌓았다.
//    작가노트·시리즈 소개·연락처·CV 가 같은 관용구라 15장 넘게 반복됐고, 그게 곧 '템플릿 냄새'였다
//    (골든 5권과 나란히 놓고 본 미적 비평). 지금은 **윗선에 걸고**(top-anchored) 왼쪽에 맞추며,
//    머리말은 회색 소문자 라벨로 물러나고 강조색 막대는 쓰지 않는다 — 위계는 크기와 위치가 만든다.
//    행간도 205% → 180%: 한글 단행본 관례(165~180%)에 맞춘다(205% 는 웹 문법이라 글이 성겨 보였다).
const PROSE_FONT = 15;
const PROSE_LINE = 27;      // 15 × 1.8
const eyebrowCss = (theme: PortfolioTheme) => `font-size:11px;letter-spacing:0.28em;color:${theme.sub}`;
const proseTitleCss = (theme: PortfolioTheme, px: number) => {
  const isSerif = theme.titleSerif ?? (theme.display === SERIF);
  return `font-family:${theme.display};font-size:${px}px;line-height:1.2;font-weight:${isSerif ? 400 : 700};letter-spacing:${isSerif ? '0.02em' : '-0.02em'};color:${theme.ink};word-break:keep-all;overflow-wrap:anywhere`;
};
const proseParaCss = (theme: PortfolioTheme, fontPx = PROSE_FONT, lineH = PROSE_LINE, gap = 18) =>
  `margin:0 0 ${gap}px;font-size:${fontPx}px;line-height:${lineH}px;color:${theme.ink};word-break:keep-all;overflow-wrap:anywhere;text-align:${theme.proseAlign ?? 'left'}`;

// ── 글 페이지 (시리즈 소개 · 이어지는 이야기 · 긴 작가노트) ──
function prosePages(
  theme: PortfolioTheme, data: PortfolioBookData,
  eyebrow: string, title: string, body: string, label: string,
  opts: { continuation?: boolean } = {},
): PortfolioPage[] {
  const titlePx = 34;
  const contentW = theme.page.w - PAD(theme).x * 2;
  const colW = proseColW(PROSE_FONT, contentW);

  // 첫 장은 머리말 + 제목이 자리를 먹는다. 이어지는 장은 머리말 + 작은 제목만.
  // 여유분 24px — 추정이 맞아떨어져도 기기·글꼴 버전에 따라 몇 px씩 어긋난다. 마지막 줄이 가장자리에
  // 딱 붙으면 그런 오차에 바로 잘리므로 쿠션을 둔다(쪽수가 조금 늘어나는 건 감수).
  const SAFETY = 24;
  const firstCap = availH(theme) - (14 + 12 + Math.round(titlePx * 1.2) + 30) - SAFETY;
  const restCap = availH(theme) - (14 + 12 + 24 + 30) - SAFETY;
  const paras = proseText(body).split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  const pageParas = evenPages((k) => splitParagraphs(paras, firstCap * k, restCap * k, PROSE_FONT, PROSE_LINE, colW, 18));

  return pageParas.map((ps, i) => {
    const cont = i > 0 || !!opts.continuation;
    return {
      label: i === 0 ? label : `${label} (${i + 1})`,
      html: page(theme, data, `
      <div style="flex:1;display:flex;flex-direction:column;justify-content:flex-start">
        <div style="max-width:${colW}px;width:100%">
          <div style="${eyebrowCss(theme)}">${esc(eyebrow)}${cont ? ' · 계속' : ''}</div>
          ${i === 0
            ? `<div style="margin-top:12px;${proseTitleCss(theme, titlePx)}">${esc(title)}</div>`
            : `<div style="margin-top:12px;font-size:18px;line-height:1.3;font-family:${theme.display};color:${theme.sub};overflow-wrap:anywhere">${esc(title)}</div>`}
          <div style="margin-top:30px">${ps.map((t) => `<p style="${proseParaCss(theme)}">${esc(t).replace(/\n/g, '<br/>')}</p>`).join('')}</div>
        </div>
      </div>`),
    };
  });
}

/** 프로필 사진 블록 — 작품이 아니라 사진이므로 잘라 채워도 된다(3:4). `<img>` 가 아니라 배경으로 그려 작품 규칙(contain) 검사와 섞이지 않게 한다 */
function photoBlock(url: string, w: number, h: number): string {
  const src = imgMode === 'pdf' ? proxied(url) : url;
  return `<div style="width:${Math.round(w)}px;height:${Math.round(h)}px;flex:0 0 ${Math.round(w)}px;background-image:url('${esc(src)}');background-size:cover;background-position:center"></div>`;
}

// 작가노트 — 윗선에 걸린 글 칸 + (있으면) 오른쪽에 프로필 사진. 길면 읽는 컬럼(prosePages)으로.
// ⚠️ 예전엔 짧은 노트를 지면 한가운데 작은 덩어리로 띄웠다(실측 B: 작은 회색 글 덩어리만 있는 장).
//    골든은 글을 위에 걸고 옆에 사진을 두어 지면이 **한 쌍**으로 읽힌다(ERICA·김잔디·THALIA — 5권 중 3권이 작가 사진).
function statementPages(theme: PortfolioTheme, data: PortfolioBookData, statement: string, design: PdfDesign): PortfolioPage[] {
  const paras = proseText(statement).split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  const px = PAD(theme).x;
  const contentW = theme.page.w - px * 2;
  const avail = availH(theme);
  const landscape = theme.page.w >= theme.page.h;
  const photo = design.artistPhoto ? tx(data.user.avatar) : '';
  const fontPx = 16, lineH = 29;                 // 16 × 1.8
  // 사진은 글 칸과 균형이 맞게 넉넉히(세로 지면 360px ≈ 지면 높이의 40%). 작으면 구석의 명함 사진으로 읽힌다.
  const photoW = photo ? Math.round(Math.min(contentW * 0.42, landscape ? 340 : 360)) : 0;
  const gap = photo ? 64 : 0;
  const colW = proseColW(fontPx, contentW - photoW - gap);
  const titlePx = 36;
  const headH = 14 + 12 + Math.round(titlePx * 1.2) + 34;
  const totalH = paras.reduce((h, p) => h + estimateParaH(p, fontPx, lineH, colW, 20), 0);
  if (totalH > avail - headH - 24) {
    return prosePages(theme, data, 'ARTIST STATEMENT', '작가노트', statement, '작가노트');
  }
  const photoH = Math.min(Math.round(photoW * 4 / 3), avail);
  return [{ label: '작가노트', html: page(theme, data, `
    <div style="flex:1;display:flex;align-items:flex-start;gap:${gap}px">
      <div style="flex:1;min-width:0;max-width:${colW}px">
        <div style="${eyebrowCss(theme)}">ARTIST STATEMENT</div>
        <div style="margin-top:12px;${proseTitleCss(theme, titlePx)}">작가노트</div>
        <div style="margin-top:34px">${paras.map((p) => `<p style="${proseParaCss(theme, fontPx, lineH, 20)}">${esc(p).replace(/\n/g, '<br/>')}</p>`).join('')}</div>
      </div>
      ${photo ? photoBlock(photo, photoW, photoH) : ''}
    </div>`) }];
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

/** 문서 전체의 캡션 표기 관례 — `buildPortfolioPages` 가 시작할 때 정하고 그 동기 실행 동안만 유효(imgMode 와 같은 방식) */
let captionStyle: CaptionStyle = 'kr';
const tx = (v?: string | null) => String(v ?? '').trim();

/**
 * 캡션 조각 — 렌더와 높이 추정이 **같은 규칙**을 보게 하는 단일 출처.
 *
 *   head   첫 줄. 국내식이면 **"작품명, 연도"**(둘 다 있을 때), 해외식이면 작품명. 제목이 없으면 연도(국내식)만.
 *   meta   보조 줄들. 국내식 [재료, 크기] / 해외식 [재료, 크기, 연도]. compact 는 그걸 한 줄로(" · ").
 *   status 판매 상태(Sold/비매). 제목도 연도도 없고 상태만 있으면 상태가 첫 줄 자리를 대신한다.
 *
 * ⚠️ 국내 관례(creative-canvas·월간미술)는 연도가 재료·크기 **앞**이다. 공개 홈페이지 `museumCaption` 과 같은 순서라
 *    두 화면이 같은 캡션을 낸다. 해외 공모용은 `design.captionStyle='intl'`.
 */
function captionParts(a: PortfolioImage, detail: CaptionDetail | boolean) {
  const d: CaptionDetail = detail === true ? 'minimal' : detail === false ? 'full' : detail;
  const title = tx(a.title), year = displayYear(a.year), medium = tx(a.medium), size = tx(a.sizeText);
  const kr = captionStyle === 'kr';
  const head = kr ? (title && year ? `${title}, ${year}` : title || year) : title;
  const status = !!statusLabel(a);
  const fullMeta = (kr ? [medium, size] : [medium, size, year]).filter(Boolean);
  const meta = d === 'minimal' ? [] : d === 'compact' ? (fullMeta.length ? [fullMeta.join(' · ')] : []) : fullMeta;
  // 제목 줄을 그리는가 — head 가 있거나(상태만 있으면 상태가 그 자리)
  return { head, title: !!head, status, meta, titleLines: head || status ? 1 : 0, empty: !head && !status && meta.length === 0 };
}

/** 라벨 블록(뮤지엄 라벨)용 줄 — 제목은 따로 크게 쓰고, 나머지를 관례 순서로 */
function labelLines(a: PortfolioImage): string[] {
  const year = displayYear(a.year), medium = tx(a.medium), size = tx(a.sizeText);
  return (captionStyle === 'kr' ? [year, medium, size] : [medium, size, year]).filter(Boolean);
}

/** 캡션 블록(제목·보조 줄) 높이 — 격자·대형·옆칸이 같은 산수를 본다 */
function captionBlockH(a: PortfolioImage): number {
  const cp = captionParts(a, false);
  return cp.empty ? 0 : CAP_TOP + cp.titleLines * CAP_TITLE_LINE + cp.meta.length * CAP_META_LINE;
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
  // 글자 사이를 벌리지 않는다 — 넓은 자간의 작은 회색 글은 '템플릿'으로 읽힌다(2026-09-16 미적 비평).
  const titleLine = p.title
    ? `<div style="${oneLine}font-size:17px;font-weight:${isSerif ? 400 : 600};font-family:${theme.display};letter-spacing:${isSerif ? '0.02em' : '-0.01em'};overflow-wrap:anywhere">
        ${esc(p.head)}${badge ? `<span style="margin-left:10px">${badge}</span>` : ''}
      </div>`
    : (badge ? `<div>${badge}</div>` : '');
  const meta = p.meta
    .map((l) => `<div style="margin-top:5px;font-size:13px;color:${theme.sub};letter-spacing:0.01em">${esc(l)}</div>`)
    .join('');
  return `<div style="text-align:${align};margin-top:${CAP_TOP}px">${titleLine}${meta}</div>`;
}

// ── 작품 페이지 ──
// ── 작품 페이지 (밀도 기반 일반 그리드) — 판형×밀도×설명을 한 로직으로 ──
// 높이 안전: 페이지는 height:avail 고정, 행/칸이 그 안을 나눠 갖고 이미지는 imgH 로 못박는다
// (캡션 높이는 captionH 실측표 + 설명 2줄). overflow 회귀는 e2e/_pdfaudit.mjs(실측)로 잡는다.
const DESC_LINE_H = 21;

/** 짧은 설명(2줄) — 폭 기준 글자수로 잘라 2줄을 넘지 않게(조용한 잘림 방지).
 *  `block` = 글상자 위치(center 면 좁은 상자 가운데).
 *  ⚠️⚠️ **설명은 본문 정렬(proseAlign)을 따르지 않는다** (2026-09-13). 캡션의 일부지 읽는 글이 아니다.
 *     ① 가운데 캡션인데 설명만 왼쪽이면 **그 한 줄만 페이지 중심에서 밀려 보인다**
 *        (가운데 놓인 640px 상자 안에서 왼쪽에 붙기 때문).
 *     ② 양쪽맞춤을 따르게 두면 **300px 짜리 옆 캡션 칸에서 낱말 사이가 벌어진다** —
 *        양쪽맞춤은 한 줄이 충분히 길 때만 예쁘다.
 *     그래서 캡션이 가운데면 가운데, 아니면 왼쪽. 본문 정렬은 산문 페이지·라벨 설명에서만 쓴다.
 *  옛 주석은
 *  양쪽맞춤 선택이 작품설명에 안 먹던 문제(세로 지적). 캡션(제목·재료)은 별도(worksCaption). */
const DESC_FONT = 12.5;
/**
 * 작품 설명을 **자르지 않고 나눈다** — 들어가는 만큼만 돌려주고 남는 건 `rest` 로 넘긴다.
 * 부르는 쪽이 `rest` 를 뒤 글 페이지로 잇는다. 옛 `shortDescHtml` 은 2줄로 **잘라 `…`** 를 붙였다.
 */
function descSplit(text: string | null | undefined, cellW: number, maxLines: number): { head: string; rest: string; lines: number } {
  const t = String(text ?? '').trim();
  if (!t) return { head: '', rest: '', lines: 0 };
  const paras = proseText(t).split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  const pages = splitParagraphs(paras, Math.max(1, maxLines) * DESC_LINE_H, 1e9, DESC_FONT, DESC_LINE_H, cellW, 4);
  const head = (pages[0] ?? []).join('\n\n');
  const rest = pages.slice(1).flat().join('\n\n');
  const lines = head ? Math.ceil(estimateParaH(head, DESC_FONT, DESC_LINE_H, cellW, 0) / DESC_LINE_H) : 0;
  return { head, rest, lines };
}

/**
 * 설명 블록. ⚠️ 정렬은 **본문 정렬(proseAlign)을 따르지 않는다** — 캡션의 일부지 읽는 글이 아니다.
 *  ①가운데 캡션인데 설명만 왼쪽이면 그 한 줄만 페이지 중심에서 밀려 보인다
 *  ②양쪽맞춤을 따르면 300px 짜리 옆 캡션 칸에서 낱말 사이가 벌어진다
 */
function descHtml(theme: PortfolioTheme, text: string, block: 'center' | 'left' = 'left'): string {
  if (!text) return '';
  const box = block === 'center' ? 'margin-left:auto;margin-right:auto;max-width:min(100%,640px);' : '';
  const body = text.split('\n\n').map((t) =>
    `<p style="margin:0 0 6px;font-size:${DESC_FONT}px;line-height:1.6;color:${theme.sub};text-align:${block === 'center' ? 'center' : 'left'};word-break:keep-all;overflow-wrap:anywhere">${esc(t).replace(/\n/g, '<br/>')}</p>`).join('');
  return `<div style="margin-top:${CAP_DESC_TOP}px;${box}">${body}</div>`;
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
   * 대형 단독 장의 **캡션 기준선 칸** 높이 — 문서 전체에서 가장 긴 캡션(제목·보조 줄) 높이.
   * 장마다 제 캡션만큼 잡으면 캡션 위치가 장마다 달라진다(§캡션 기준선). 한 번 재서 전 장이 같이 쓴다.
   */
  heroCapZone: number;
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
  // ⚠️ **4점 이상 격자에는 설명을 싣지 않는다** (2026-09-13). 칸마다 요약 두 줄을 예약하면
  //    행마다 48px 이 더 붙는데, 가로 판형 2행이면 그것만으로 **지면 높이의 47%** 가 캡션 예약이
  //    된다(실측: 그래서 4점 격자의 작품 지면점유가 14.9% 였다). 설명은 1점·2점 구성에서 읽는다 —
  //    4점 칸에서 두 줄 요약은 어차피 읽히지도 않는다.
  // ⚠️ **격자에는 설명을 싣지 않는다.** 자르지 않는 게 원칙인데(§DescDepth) 4점의 설명을 각각
  //    뒤 장으로 이으면 책이 글 페이지로 뒤덮인다. 설명은 한 장에 한 점인 구성에서만 싣는다.
  const detail: CaptionDetail = (design.worksCaption === 'minimal' || forceMinimal) ? 'minimal' : per >= 4 ? 'compact' : 'full';
  const minimalCap = detail === 'minimal';

  const estCaptionH = (a: PortfolioImage, w: number) => {
    const p = captionParts(a, detail);
    if (p.empty) return 0;
    // 제목 줄 수 — 목록(메타 없음)은 렌더가 한 줄로 자르므로 추정도 한 줄이다
    const tCap = p.meta.length === 0 ? 1 : 3;
    const tLines = p.title ? Math.min(tCap, Math.max(1, Math.ceil((p.head.length * 17) / w))) : p.titleLines;
    const mLines = Math.min(5, p.meta.reduce((n, l) => n + Math.max(1, Math.ceil((l.length * 13) / w)), 0));
    return CAP_TOP + tLines * CAP_TITLE_LINE + mLines * CAP_META_LINE + 24; // +24 SAFETY 쿠션
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
  const capAlign: 'center' | 'left' = design.worksCaption === 'left' ? 'left' : 'center';
  // ⚠️ 배열·칸 높이·캡션 예약은 **정원(per) 기준으로 한 번만** 푼다(장마다 다시 풀면 쪽마다
  //    작품 크기가 달라진다, §27). 자동 편집이 구성을 고를 때도 **이 함수를 그대로** 부른다.
  const { cols, H, detail } = solveGrid(per, theme, design, geom, isIndex);
  // 행 자체를 균형 있게 나눈다 — 3열 격자에 4점이면 [3,1] 이 아니라 [2,2].
  const rowsItems = take(items, balancedSplit(items.length, cols));

  const cell = (a: PortfolioImage, w: number, h: number) => `
    <div style="flex:0 0 ${Math.round(w)}px;max-width:${Math.round(w)}px;min-width:0;display:flex;flex-direction:column;justify-content:flex-start">
      <div style="height:${Math.round(h)}px;width:100%;display:flex;align-items:center;justify-content:center">
        ${img(a.url, `max-width:100%;max-height:100%;object-fit:contain;display:block`)}
      </div>
      ${captionHtml(theme, a, capAlign, detail)}
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
  // ⚠️⚠️ **칸 폭을 똑같이 나누지 말 것 — 그 행에서 제일 넓은 작품이 나머지를 다 끌어내린다.**
  //    예전엔 본문 폭을 점수로 균등 분할하고(`trackW`) 행 높이를 `trackW / 제일넓은비율` 로 잡았다.
  //    그러면 파노라마 한 점이 섞인 행은 **모두가 그 점에 맞춰 납작해지고**, 좁은 작품 옆에는
  //    쓰지 않는 폭이 그대로 남는다. 실측(실서버 3명 × 판형 3): 4점 격자의 작품 지면점유가
  //    **13~33%** 였다(골든 56%). 가로 판형 한 행에 4점이면 8% 까지 떨어졌다.
  //    ⚠️ 그렇다고 **행마다 비율 합으로 폭을 나누면 안 된다** — 그건 2026-08-31 에 사용자가
  //    "삐뚤빼뚤하다"고 지적한 그 구성이다(행마다 총 폭이 달라 좌우 끝과 이음매가 제각각).
  //    그래서 **열 폭을 페이지 단위로 한 번** 정한다: 각 열의 폭은 그 열에 오는 작품들의
  //    **최대 비율**을 따른다. 모든 행이 같은 열 폭을 쓰므로 이음매·좌우 끝은 그대로 맞고,
  //    폭이 비율을 따르므로 낭비가 사라진다(실측 33% → 40%, 가로 8% → 18%).
  const colAspect: number[] = [];
  for (const r of rowsItems) r.forEach((a, i) => { colAspect[i] = Math.max(colAspect[i] ?? 0, geom.aspectOf(a)); });
  const sumAspect = colAspect.reduce((s, v) => s + v, 0) || 1;
  const rowH = Math.max(60, Math.min(H, (availW - (colAspect.length - 1) * colGap) / sumAspect));
  const rowHtml = (r: PortfolioImage[]) => `
    <div style="display:flex;gap:${colGap}px;align-items:flex-start;justify-content:center;width:100%">${
      r.map((a, i) => {
        const track = Math.round((colAspect[i] ?? 1) * rowH);
        return `<div style="flex:0 0 ${track}px;max-width:${track}px;display:flex;justify-content:center">${
          cell(a, rowH * geom.aspectOf(a), rowH)}</div>`;
      }).join('')}</div>`;
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
  const paras = proseText(note).split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);

  const colW = landscape ? Math.round(availW * 0.34) : proseColW(PROSE_FONT, availW);
  const titlePx = fitTitle(name, landscape ? 44 : 50, colW, 3, 28);
  const noteH = paras.reduce((h, t) => h + estimateParaH(t, PROSE_FONT, PROSE_LINE, colW, 16), 0);
  const headH = 14 + 16 + Math.ceil((name.length * titlePx) / colW) * Math.round(titlePx * 1.2) + 26 + noteH + 16;

  const cp = captionParts(work, false);
  const capH = cp.empty ? 0 : CAP_TOP + cp.titleLines * CAP_TITLE_LINE + cp.meta.length * CAP_META_LINE + 16;
  const gap = landscape ? 56 : 40;

  // 머리 — 회색 라벨 · 제목 · 소개. 강조색 막대는 쓰지 않는다(글 장 공통 문법).
  const head = `
    <div style="${eyebrowCss(theme)}">SERIES</div>
    <div style="margin-top:16px;${proseTitleCss(theme, titlePx)}">${esc(name)}</div>
    <div style="margin-top:26px">${paras.map((t) => `<p style="${proseParaCss(theme, PROSE_FONT, PROSE_LINE, 16)}">${esc(t).replace(/\n/g, '<br/>')}</p>`).join('')}</div>`;
  void isSerif;

  const shot = (w: number, h: number) => `
    <div style="width:${Math.round(w)}px;display:flex;flex-direction:column">
      <div style="height:${Math.round(h)}px;width:100%;display:flex;align-items:center;justify-content:center">
        ${img(work.url, 'max-width:100%;max-height:100%;object-fit:contain;display:block')}
      </div>
      ${captionHtml(theme, work, 'center')}
    </div>`;

  const a = geom.aspectOf(work);
  if (landscape) {
    const imgW = availW - colW - gap;
    const h = Math.min(avail - capH, imgW / a);
    if (h < 200) return null;
    // 글은 윗선에 걸고, 그림은 오른쪽 칸 가운데
    return { label: `${name} 소개`, html: page(theme, data, `
      <div style="display:flex;gap:${gap}px;align-items:flex-start;height:${avail}px">
        <div style="width:${colW}px;flex:0 0 ${colW}px">${head}</div>
        <div style="flex:1;min-width:0;height:${avail}px;display:flex;align-items:center;justify-content:center">${shot(Math.min(imgW, h * a), h)}</div>
      </div>`, { running: name }) };
  }
  const h = Math.min(avail - headH - gap - capH, availW / a);
  // 그림이 이만큼도 안 남으면 여는 장으로 삼을 이유가 없다 — 글 페이지로 돌린다.
  if (h < 260) return null;
  return { label: `${name} 소개`, html: page(theme, data, `
    <div style="height:${avail}px;display:flex;flex-direction:column;gap:${gap}px">
      <div>${head}</div>
      <div style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center">${shot(Math.min(availW, h * a), h)}</div>
    </div>`, { running: name }) };
}

/**
 * 시리즈 여는 장 — **수동 편집용**: 제목·소개 + 그 시리즈 작품의 **썸네일 띠**.
 *
 * 수동 편집은 사용자가 고른 배치가 곧 의도라 첫 작품을 대표작으로 빼내지 않는다(§32). 그렇다고 예전처럼
 * 제목 한 줄 + 소개 한 문장만 둔 장을 만들면 지면의 90% 가 빈다(실측 C — 20권에서 거의 빈 장의 두 번째 원인).
 * 도록이 장을 열 때 쓰는 문법이 이것이다: **제목 + 그 장에 실릴 도판의 차례**(콘택트시트). 보는 사람은
 * "이 시리즈에 몇 점이 있고 어떤 얼굴인지"를 한눈에 얻고, 뒤 장에서 하나씩 크게 본다.
 * 썸네일은 최대 12점(2줄). 작품 수를 세어 적지는 않는다 — 보이는 걸 다시 말하는 건 잔소리다.
 */
function seriesIndexPage(
  theme: PortfolioTheme, data: PortfolioBookData, name: string, note: string,
  works: PortfolioImage[], geom: GridGeometry, numberOf: (a: PortfolioImage) => number,
): PortfolioPage | null {
  const shown = works.filter((w) => w.url).slice(0, 12);
  if (shown.length === 0) return null;
  const avail = availH(theme);
  const availW = theme.page.w - PAD(theme).x * 2;
  const landscape = theme.page.w >= theme.page.h;
  const paras = proseText(note).split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);

  const colW = proseColW(PROSE_FONT, landscape ? Math.round(availW * 0.6) : availW);
  const titlePx = fitTitle(name, landscape ? 44 : 50, colW, 3, 28);
  const noteH = paras.reduce((h, t) => h + estimateParaH(t, PROSE_FONT, PROSE_LINE, colW, 16), 0);
  const headH = 14 + 16 + Math.ceil((name.length * titlePx) / colW) * Math.round(titlePx * 1.2) + 26 + noteH;
  const gap = 40;
  // 띠는 지면의 40% 까지 — 머리와 띠 사이 남는 자리가 이 장의 여백이다(빈 게 아니라 쉼).
  const stripMax = Math.round(avail * 0.4);
  const stripH = Math.min(stripMax, avail - headH - gap);
  if (stripH < 120) return null;   // 소개가 너무 길면 글 장으로 — 억지로 넣으면 잘린다

  // 6점까지 한 줄, 그 이상은 두 줄로 **고르게**(7점 → 4+3, 6+1 로 두면 둘째 줄에 한 점이 고아가 된다).
  const rows = shown.length <= 6 ? 1 : 2;
  const cols = Math.ceil(shown.length / rows);
  const rowSizes = balancedSplit(shown.length, cols);
  const thumbGap = 18, capH = 20;
  const rowH = (stripH - (rows - 1) * thumbGap) / rows - capH;
  const cellW = (availW - (cols - 1) * thumbGap) / cols;
  const cell = (a: PortfolioImage) => {
    const aspect = Math.min(4, Math.max(0.25, geom.aspectOf(a)));
    const w = Math.min(cellW, rowH * aspect);
    return `
      <div style="flex:0 0 ${Math.round(cellW)}px;max-width:${Math.round(cellW)}px;display:flex;flex-direction:column;align-items:flex-start">
        <div style="height:${Math.round(rowH)}px;width:${Math.round(w)}px;display:flex;align-items:flex-end">
          ${img(a.url, `max-width:100%;max-height:${Math.round(rowH)}px;object-fit:contain;display:block`)}
        </div>
        <div style="margin-top:6px;font-size:11px;line-height:14px;color:${theme.sub};letter-spacing:0.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">${numberOf(a)}${hasTitle(a) ? ` · ${esc(artworkTitle(a))}` : ''}</div>
      </div>`;
  };
  const rowsHtml = take(shown, rowSizes).map((r) => `
    <div style="display:flex;gap:${thumbGap}px;align-items:flex-end">${r.map(cell).join('')}</div>`).join('');

  return { label: `${name} 소개`, html: page(theme, data, `
    <div style="height:${avail}px;display:flex;flex-direction:column;justify-content:space-between">
      <div style="max-width:${colW}px">
        <div style="${eyebrowCss(theme)}">SERIES</div>
        <div style="margin-top:16px;${proseTitleCss(theme, titlePx)}">${esc(name)}</div>
        <div style="margin-top:26px">${paras.map((t) => `<p style="${proseParaCss(theme, PROSE_FONT, PROSE_LINE, 16)}">${esc(t).replace(/\n/g, '<br/>')}</p>`).join('')}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:${thumbGap}px">${rowsHtml}</div>
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
  if (rest.length === 0) return heroWorksPage(theme, data, main, label, running, design, geom);

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
    const tLines = p.title ? Math.min(3, Math.max(1, Math.ceil((p.head.length * 17) / Math.max(80, w)))) : p.titleLines;
    const mLines = p.meta.slice(0, maxMeta).reduce((n, l) => n + Math.max(1, Math.ceil((l.length * 13) / Math.max(80, w))), 0);
    return CAP_TOP + tLines * CAP_TITLE_LINE + Math.min(5, mLines) * CAP_META_LINE + 12;
  };

  const box = (a: PortfolioImage, w: number, h: number, cap: number) => `
    <div style="flex:0 0 ${Math.round(w)}px;max-width:${Math.round(w)}px;min-width:0;display:flex;flex-direction:column">
      <div style="height:${Math.round(h)}px;width:100%;display:flex;align-items:center;justify-content:center">
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
  const heroCapZone = Math.max(0, ...data.images.map(captionBlockH));
  return { aspectOf, median, heroCapZone, all: data.images };
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
/**
 * ⚠️ 남은 3점을 4점 격자에 넣지 말 것 — 2+1 로 나뉘어 **아래 한 점이 고아**가 된다(실측 자동 편집 18쪽 중 2장).
 *    3점은 '크게+작게'가 정확히 그 수를 위한 구성이다.
 * ⚠️ 자동 편집에서 남은 2점은 **'2점씩'(나란히/위아래 격자)** 으로 — '크게+작게'를 두 점에 쓰면 큰 것 하나와
 *    작은 것 하나가 세로로 쌓여 좌우가 통째로 비고(실측 F), 왜 한 점만 작은지 읽히지 않는다.
 *    사용자가 '크게+작게'를 **직접** 골랐으면 그대로 존중한다(§32).
 */
const fitComposition = (want: WorksLayout, n: number, auto = false): WorksLayout =>
  n >= WORKS_PER_PAGE[want] ? want
    : n === 1 ? (want === 'label' || want === 'full' ? want : 'hero')
      : n === 2 ? (want === 'duo' || auto ? 'duo' : want === 'feature' ? 'feature' : 'duo')
        : n === 3 ? (auto && (want === 'grid' || want === 'index') ? 'feature' : want) : want;

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
      plans.push({ composition: fitComposition(want, rest.length, true), items: rest });
      break;
    }
    // 정원대로 담으면 **다음 장에 1점만** 남는 경우: 이번 장을 한 점 줄여 2+2 로 나눈다.
    const leftover = rest.length - per;
    const nextPer = WORKS_PER_PAGE[cadence[k % cadence.length]!];
    const n = (leftover === 1 && per >= 2 && rest.length >= 3) ? per - 1
      : (leftover > 0 && leftover < nextPer * 0.5 && per >= 2) ? Math.max(2, Math.ceil(rest.length / 2))
        : per;
    plans.push({ composition: fitComposition(want, n, true), items: rest.slice(0, n) });
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
      case 'hero': return heroWorksPage(theme, data, items[0]!, label, running, design, geom);
      case 'label': return labelHasContent(items[0]!)
        ? labelWorksPage(theme, data, items[0]!, label, running, design, geom)
        : heroWorksPage(theme, data, items[0]!, label, running, design, geom);
      case 'full': return fullWorksPage(theme, data, items[0]!, label, running);
      case 'feature': return featureWorksPage(theme, data, items, label, running, design, geom);
      default: return gridWorksPage(theme, data, items, label, running, composition, design, geom);
    }
  })();
  // 첫 장이 작품 장이고, 뒤따르는 '이야기' 장은 글이다.
  return out.map((p, i) => (i === 0
    ? { ...p, kind: 'works' as const, works: items.length, composition, workIds: items.map((x) => x.id) }
    : { ...p, kind: 'prose' as const }));
}

// 대형 단독 — 회화 한 점을 크게, 캡션은 **아래 기준선**에.
//
// ## 캡션 기준선 (2026-09-16 지면 체계 v2)
// 예전엔 그림+캡션을 한 덩어리로 세로 가운데 정렬했다. 그러면 캡션 위치가 **그림 높이에 따라 장마다 달라진다**
// — 세로 그림 장에서는 아래쪽에, 가로 그림 장에서는 한가운데에. 골든(ERICA)은 캡션을 아래 여백의 **한 줄에 고정**해
// 책 전체가 한 선으로 꿰어진다. 그게 '일관성'이 눈에 보이는 방식이다.
// 그래서 캡션 칸(`capZone`)을 **문서 전체에서 가장 긴 캡션** 높이로 잡아 바닥에 고정하고, 그림은 그 위 상자에서
// 가운데 정렬한다. 캡션이 짧은 장은 칸 안에서 바닥에 붙어(justify-content:flex-end) 마지막 줄이 같은 높이에 온다.
//
// ## 설명이 길 때
// 설명은 캡션 아래에 잇되, **그림을 지면의 55% 까지만 양보**하고 그래도 남으면 뒤 글 장으로 넘긴다(자르지 않는다).
// 예전 상한(22%)은 두세 줄만 넘쳐도 새 장을 만들어 27점이 47쪽이 됐다(실측 A: 두 줄짜리 빈 장 7개).
function heroWorksPage(theme: PortfolioTheme, data: PortfolioBookData, a: PortfolioImage, label: string, running: string | undefined, design: PdfDesign, geom: GridGeometry): PortfolioPage[] {
  const avail = availH(theme);
  const descOn = design.desc !== 'none';
  const capW = theme.page.w - PAD(theme).x * 2;
  const raw = descOn ? String(a.description ?? '').trim() : '';
  const ownCap = captionBlockH(a);
  const landscape = theme.page.w >= theme.page.h;
  const aspect = Math.min(4, Math.max(0.25, geom.aspectOf(a)));

  // ── 가로 지면 + 세로 작품이면 캡션을 **옆으로** ────────────────────────────
  // ⚠️ 캡션을 아래 두면 그림이 **높이에서 먼저 걸린다**. 가로 지면(1414×1000)에서 세로 작품은
  //    그림이 지면의 22~24% 밖에 못 쓰는데(골든 42~56%), 좌우는 텅 빈다 — 지면 모양과 작품
  //    모양이 어긋난 만큼을 캡션 자리까지 더 빼앗기는 것이다. 옆에 두면 그림이 높이를 다 쓴다
  //    (실측 24% → 33%, 같은 작품·같은 판형). 가로 작품에는 적용하지 않는다 — 그쪽은 폭에서
  //    걸리므로 캡션을 옆에 두면 오히려 그림이 좁아진다.
  const sideGap = 48;
  let sideCapW = 300;
  let sideImgW = Math.min(capW - sideGap - sideCapW, avail * aspect);
  // 그림이 이보다 좁아지면 옆 캡션이 그림을 눌러 버린다 — 그럴 바엔 아래가 낫다.
  const sideCap = landscape && (ownCap > 0 || !!raw) && aspect < 1.15 && sideImgW > 260;
  // 옆 칸은 지면 높이를 통째로 쓸 수 있고 **설명을 늘려도 작품이 작아지지 않는다**(그림 폭은 이미 정해져 있다).
  const sideLines = Math.max(2, Math.floor((avail - ownCap - 24) / DESC_LINE_H));
  let side = sideCap ? descSplit(raw, sideCapW, sideLines) : null;
  // 300px 칸(한 줄 22자)에서 몇 줄이 넘치면 칸을 지면의 46% 까지 넓혀 본다 — 그림이 조금 좁아지는 쪽이 두 줄짜리 이어짐 장보다 낫다
  if (side?.rest) {
    const wideCol = Math.round(capW * 0.46);
    const wider = descSplit(raw, wideCol, sideLines);
    if (!wider.rest) { side = wider; sideCapW = wideCol; sideImgW = Math.min(capW - sideGap - sideCapW, avail * aspect); }
  }
  // ── 아래 캡션(기준선) — 옆 칸에서 설명이 넘치면 아래 배치로 갈아타 한 장에 담을 수 있는지도 본다 ──
  const zone = Math.max(geom.heroCapZone, ownCap);
  const gap = 8, SAFETY = 24;
  // 그림은 지면의 55% 까지만 양보한다. 다만 **그래도 몇 줄이 남아 새 장이 생길 판이면** 40% 까지 한 번 더 양보해
  // 한 장에 다 담는다 — 두세 줄짜리 이어짐 장이 그림 15% 보다 훨씬 나쁘다(실측: 27점 중 3점이 그랬다).
  // 40% 로도 안 들어가는 글은 진짜 긴 글이라 뒤 장으로 잇는다(그 장은 충분히 찬다).
  const linesFor = (floorRatio: number) =>
    Math.max(2, Math.floor((avail - zone - gap - SAFETY - Math.round(avail * floorRatio) - CAP_DESC_TOP) / DESC_LINE_H));
  let below = descSplit(raw, capW, linesFor(0.55));
  if (below.rest) { const deeper = descSplit(raw, capW, linesFor(0.40)); if (!deeper.rest) below = deeper; }

  if (side && (!side.rest || below.rest)) {
    // 캡션 칸은 그림과 같은 높이로 두고 글을 **그림 바닥선**에 맞춘다 — 한가운데 떠 있는 글보다 그림에 붙어 읽힌다.
    const shownH = Math.round(Math.min(avail, sideImgW / aspect));
    const sideInner = `
      <div style="height:${avail}px;display:flex;align-items:center;gap:${sideGap}px">
        <div style="flex:0 0 ${Math.round(sideImgW)}px;display:flex;align-items:center;justify-content:center">
          ${img(a.url, `max-width:100%;max-height:${avail}px;object-fit:contain;display:block`)}
        </div>
        <div style="flex:1;min-width:0;height:${shownH}px;display:flex;flex-direction:column;justify-content:flex-end">
          ${captionHtml(theme, a, 'left')}${descHtml(theme, side.head, 'left')}
        </div>
      </div>`;
    const sidePage: PortfolioPage = { label, html: page(theme, data, sideInner, { running: running || undefined }) };
    return side.rest
      ? [sidePage, ...prosePages(theme, data, 'NOTE', artworkTitle(a), side.rest, `${artworkTitle(a)} 이야기`, { continuation: true })]
      : [sidePage];
  }

  const descH = below.lines ? CAP_DESC_TOP + below.lines * DESC_LINE_H : 0;
  const imgH = Math.max(120, avail - zone - descH - gap - SAFETY);
  const capAlign: 'center' | 'left' = design.worksCaption === 'left' ? 'left' : 'center';

  const inner = `
    <div style="height:${avail}px;display:flex;flex-direction:column">
      <div style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center">
        ${img(a.url, `max-width:100%;max-height:${imgH}px;object-fit:contain;display:block`)}
      </div>
      <div style="flex:0 0 auto;min-height:${zone}px;width:100%;display:flex;flex-direction:column;justify-content:flex-end">
        ${captionHtml(theme, a, capAlign)}${descHtml(theme, below.head, capAlign)}
      </div>
    </div>`;
  const first: PortfolioPage = { label, html: page(theme, data, inner, { running: running || undefined }) };
  // 지면에 못 담은 나머지는 **자르지 않고** 뒤 글 페이지로 잇는다.
  return below.rest
    ? [first, ...prosePages(theme, data, 'NOTE', artworkTitle(a), below.rest, `${artworkTitle(a)} 이야기`, { continuation: true })]
    : [first];
}

// 전면 — 소프트 패널 위에 작품을 꽉 채우고(여백 안), 작은 캡션은 하단 좌측.
function fullWorksPage(theme: PortfolioTheme, data: PortfolioBookData, a: PortfolioImage, label: string, running?: string): PortfolioPage[] {
  const { w, h } = theme.page;
  // ⚠️ `artworkTitle()` 을 그대로 쓰면 제목 없는 작품에 '무제' 가 찍힌다 — 실데이터의 97% 다.
  //    첫 줄 규칙(제목, 연도)은 captionParts 하나가 정한다.
  const cp = captionParts(a, 'minimal');
  const meta = captionStyle === 'kr' ? cp.head : [cp.head, displayYear(a.year)].filter(Boolean).join(' · ');
  const inner = `
    <div style="position:absolute;left:64px;right:64px;top:64px;bottom:96px;display:flex;align-items:center;justify-content:center">
      ${img(a.url, `max-width:100%;max-height:100%;object-fit:contain;display:block`)}
    </div>
    <div style="position:absolute;left:64px;bottom:52px;font-size:12px;letter-spacing:0.08em;color:${theme.sub};overflow-wrap:anywhere">${esc(meta)}</div>`;
  void w; void h;
  return [{ label, html: page(theme, data, inner, { running, bare: true }) }];
}

// 뮤지엄 라벨 — 작품 + 캡션 블록(제목 크게·연도·재료·크기·상태·설명). 긴 설명은 뒤 글페이지로 넘긴다.
//
// ## 라벨을 옆에 둘지 아래에 둘지는 **판형이 아니라 그림 모양**으로 가른다 (2026-09-16)
// 2026-09-13 규칙("세로 지면은 아래, 가로 지면은 옆")은 세로 지면의 **세로 작품**에서 틀렸다 — 그림을 지면 높이만큼
// 세우면 오른쪽에 300px 넘는 빈 칸이 남는데, 라벨을 아래에 두느라 그 칸은 비우고 그림은 34% 칸에 밀린 설명 때문에
// 줄어들었고, 두세 줄 넘친 설명이 **빈 장**을 만들었다(실측 A: 27점 → 47쪽). 그림을 세워도 옆에 ≥300px 이 남으면
// 옆 칸을 쓴다 — 그러면 설명이 길어져도 그림이 안 줄고, 넘침 장이 거의 사라진다. 가로 그림은 예전처럼 아래.
function labelWorksPage(theme: PortfolioTheme, data: PortfolioBookData, a: PortfolioImage, label: string, running: string | undefined, design: PdfDesign, geom: GridGeometry): PortfolioPage[] {
  const { w } = theme.page;
  const avail = availH(theme);
  const px = PAD(theme).x;
  const contentW = w - px * 2;
  const aspect = Math.min(4, Math.max(0.25, geom.aspectOf(a)));
  const sideGap = 56, minCol = 300;
  const sideFits = avail * aspect + sideGap + minCol <= contentW;
  let stackLabel = !sideFits;
  let imgW = stackLabel ? contentW : Math.round(Math.min(avail * aspect, contentW - sideGap - minCol));
  let colW = stackLabel ? contentW : contentW - imgW - sideGap;
  const st = statusLabel(a);
  const lines = labelLines(a);
  const desc = design.desc !== 'none' ? String(a.description ?? '').trim() : '';
  // 캡션 블록(제목·메타·상태) 높이 대략 예약 후, 남는 만큼 설명을 담고 나머지는 글페이지로.
  // ⚠️ 제목이 없으면 그 줄을 안 그리므로 예약도 빼야 한다(안 그러면 헛자리가 남는다).
  const showTitle = hasTitle(a);
  const CAP_BLOCK = 44 + (showTitle ? 34 : 0) + lines.length * 28 + (st ? 24 : 0);
  const DESC_L = 25; // 14 × 1.8
  const descParas = desc ? proseText(desc).split(/\n{2,}/).map((x) => x.trim()).filter(Boolean) : [];
  // 아래에 둘 땐 라벨이 지면을 너무 먹지 않게 한정한다 — 주인공은 작품이다. 그림은 55% 까지만 양보한다.
  // 라벨을 아래 두면 설명이 본문 폭을 다 써서 한 줄이 88자가 된다 — 산문 상한을 건다.
  const stackedRoom = (floor: number) => Math.max(0, Math.round(avail * (1 - floor)) - CAP_BLOCK);
  const stackedW = proseColW(14, contentW);
  const splitInto = (room: number, w: number) => (desc ? splitParagraphs(descParas, room, 1e9, 14, DESC_L, w, 14) : [[]]);
  let descW = stackLabel ? stackedW : colW;
  const sideRoom = Math.max(0, avail - CAP_BLOCK - 40);
  let parts = splitInto(stackLabel ? stackedRoom(0.55) : sideRoom, descW);
  // 몇 줄이 남아 새 장이 생길 판이면 순서대로 양보한다 — 두세 줄짜리 이어짐 장이 그림 조금 줄어드는 것보다 훨씬 나쁘다.
  //  ① 옆 칸이면 **칸을 지면의 46% 까지 넓힌다**(그림은 그만큼만 좁아진다; 300px 칸은 한 줄 22자라 금방 넘친다)
  //  ② 그래도 안 되면 **아래 배치로 갈아타고 그림을 40% 까지** 양보한다(대형 단독과 같은 규칙)
  if (parts.length > 1 && !stackLabel) {
    const wideCol = Math.round(contentW * 0.46);
    const wider = splitInto(sideRoom, wideCol);
    if (wider.length === 1) { parts = wider; colW = wideCol; descW = wideCol; imgW = contentW - wideCol - sideGap; }
  }
  if (parts.length > 1) {
    const deeper = splitInto(stackedRoom(0.4), stackedW);
    if (deeper.length === 1) { parts = deeper; stackLabel = true; imgW = contentW; colW = contentW; descW = stackedW; }
  }
  const head = parts[0] ?? [];
  const isSerif = theme.titleSerif ?? (theme.display === SERIF);
  // 라벨 표식 — 짧은 잉크 룰 하나. 강조색 막대(3px)는 지면에 색을 뿌려 템플릿으로 읽혔다(2026-09-16).
  const capBlock = `
    <div style="width:44px;height:2px;background:${theme.ink};margin-bottom:20px"></div>
    ${showTitle ? `<div style="font-family:${theme.display};font-size:24px;font-weight:${isSerif ? 400 : 600};letter-spacing:0.01em;line-height:1.3;color:${theme.ink};word-break:keep-all;overflow-wrap:anywhere">${esc(artworkTitle(a))}</div>` : ''}
    ${lines.length ? `<div style="margin-top:14px;font-size:14px;line-height:2.0;color:${theme.sub}">${lines.map((l) => esc(l)).join('<br/>')}</div>` : ''}
    ${st ? `<div style="margin-top:10px;font-size:13px;font-weight:600;color:${theme.accent};letter-spacing:0.02em">● ${esc(st)}</div>` : ''}
    ${head.length ? `<div style="margin-top:24px;padding-top:20px;border-top:1px solid ${theme.line};max-width:${descW}px">
      ${head.map((t) => `<p style="margin:0 0 12px;font-size:14px;line-height:${DESC_L}px;color:${theme.ink};word-break:keep-all;overflow-wrap:anywhere;text-align:${stackLabel ? (theme.proseAlign ?? 'left') : 'left'}">${esc(t).replace(/\n/g, '<br/>')}</p>`).join('')}
    </div>` : ''}`;
  const gap = 34;
  const descH = head.reduce((h2, t) => h2 + estimateParaH(t, 14, DESC_L, descW, 12), 0) + (head.length ? 44 : 0);
  const imgH = Math.max(200, avail - CAP_BLOCK - descH - gap);
  const shownH = Math.round(Math.min(avail, imgW / aspect));
  const inner = stackLabel
    ? `
    <div style="height:${avail}px;display:flex;flex-direction:column;justify-content:flex-end;gap:${gap}px">
      <div style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center">
        ${img(a.url, `max-width:100%;max-height:${imgH}px;object-fit:contain;display:block`)}
      </div>
      <div>${capBlock}</div>
    </div>`
    : `
    <div style="display:flex;gap:${sideGap}px;align-items:center;height:${avail}px">
      <div style="flex:0 0 ${imgW}px;height:${avail}px;display:flex;align-items:center;justify-content:center">
        ${img(a.url, `max-width:${imgW}px;max-height:${avail}px;object-fit:contain;display:block`)}
      </div>
      <div style="flex:1;min-width:0;height:${shownH}px;display:flex;flex-direction:column;justify-content:flex-end">${capBlock}</div>
    </div>`;
  const firstHtml = page(theme, data, inner, { running: running || undefined });
  const rest = parts.slice(1).flat();
  return rest.length
    ? [{ label, html: firstHtml }, ...prosePages(theme, data, 'NOTE', artworkTitle(a), rest.join('\n\n'), `${artworkTitle(a)} 이야기`, { continuation: true })]
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
  const bio = proseText(data.biography).trim();
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
  const BIO_FONT = 14, BIO_LINE = 25, BIO_GAP = 16;   // 14 × 1.8 — 산문 행간 규칙과 같다
  // 약력도 산문이다 — 본문 폭을 다 쓰면 가로 판형에서 한 줄이 69자가 된다(실측).
  const bioW = proseColW(BIO_FONT, twoCol ? 900 : contentW);
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
    : evenPages((k) => splitCvColumns(sections, contColH * k, colW, cols, firstColH * k));

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
      <div style="${eyebrowCss(theme)}">CURRICULUM VITAE${pi > 0 ? ' · 계속' : ''}</div>
      ${pi === 0
        ? `<div style="margin-top:14px;font-size:${isSerif ? 34 : 32}px;font-weight:${isSerif ? 400 : 700};font-family:${theme.display}">${esc(displayName(data.user))}</div>
           ${bio && !bioOwnPage ? `<div style="margin-top:16px;font-size:${BIO_FONT}px;line-height:${BIO_LINE}px;color:${theme.ink};max-width:${bioW}px;text-align:${theme.proseAlign ?? 'left'};word-break:keep-all;overflow-wrap:anywhere">${esc(bio).replace(/\n/g, '<br/>')}</div>` : ''}`
        : `<div style="margin-top:14px;font-size:18px;font-weight:${isSerif ? 400 : 600};font-family:${theme.display};color:${theme.sub}">${esc(displayName(data.user))}</div>`}
      <div style="margin-top:30px;display:flex;gap:${gap}px;align-items:flex-start">
        ${Array.from({ length: cols }, (_, ci) =>
          `<div style="flex:1;min-width:0">${(cols2[ci] ?? []).map(blockHtml).join('')}</div>`).join('')}
      </div>`),
  }))];
}

// ── 작품 목록 (List of Works) ──
/**
 * 도록의 관례 — 마지막에 실린 작품을 **썸네일·번호·쪽번호**로 한 번 더 보여준다.
 * 심사자가 "12번 작품" 이라고 부를 수 있고, 27점을 한 장에 훑을 수 있다(골든: 아라야조 마지막 장).
 * 작품이 6점 미만이면 만들지 않는다(훑을 것이 없다). 쪽번호는 앞 장들이 확정된 뒤에 안다 — 그래서 CV 앞에 온다.
 */
function worksIndexPages(theme: PortfolioTheme, data: PortfolioBookData, pageOf: Map<number, number>, geom: GridGeometry): PortfolioPage[] {
  const works = data.images.filter((w) => w.url);
  if (works.length < 6) return [];
  const avail = availH(theme);
  const availW = theme.page.w - PAD(theme).x * 2;
  const landscape = theme.page.w >= theme.page.h;
  const gap = landscape ? 28 : 24, rowGap = 26;
  const capH = 36;                      // 번호·제목 한 줄 + 쪽 한 줄
  const headH = 14 + 12 + 40 + 30;
  // 열 수는 **한 장에 다 들어가는 가장 적은 열**로 — 27점을 4열로 두면 둘째 장에 7점만 남아 헐거워진다(실측).
  // 6열이면 5줄로 한 장에 든다. 그래도 안 들어가면(작품이 아주 많으면) 기본 열로 나눈다.
  const fitCols = (cols: number) => {
    const cw = (availW - (cols - 1) * gap) / cols;
    const th = Math.round(cw * 0.82);
    const rows = Math.max(1, Math.floor((avail - headH + rowGap) / (th + capH + rowGap)));
    return { cols, cellW: cw, thumbH: th, perPage: rows * cols };
  };
  const baseCols = landscape ? 6 : 4;
  const onePage = [baseCols, baseCols + 1, baseCols + 2, baseCols + 3].map(fitCols).find((f) => f.perPage >= works.length);
  const { cols, cellW, thumbH, perPage } = onePage ?? fitCols(baseCols);
  const chunks: PortfolioImage[][] = [];
  for (let i = 0; i < works.length; i += perPage) chunks.push(works.slice(i, i + perPage));

  const cell = (a: PortfolioImage, n: number) => {
    const aspect = Math.min(4, Math.max(0.25, geom.aspectOf(a)));
    const w = Math.min(cellW, thumbH * aspect);
    const p = pageOf.get(a.id);
    return `
      <div style="flex:0 0 ${Math.round(cellW)}px;max-width:${Math.round(cellW)}px;display:flex;flex-direction:column">
        <div style="height:${thumbH}px;width:${Math.round(w)}px;display:flex;align-items:flex-end">
          ${img(a.url, `max-width:100%;max-height:${thumbH}px;object-fit:contain;display:block`)}
        </div>
        <div style="margin-top:8px;font-size:11px;line-height:14px;color:${theme.ink};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n}${captionParts(a, 'minimal').head ? ` · ${esc(captionParts(a, 'minimal').head)}` : ''}</div>
        <div style="font-size:10.5px;line-height:14px;color:${theme.sub}">${p ? `p. ${p}` : ''}</div>
      </div>`;
  };
  let n = 0;
  return chunks.map((chunk, pi) => {
    const rows: string[] = [];
    for (let i = 0; i < chunk.length; i += cols) {
      rows.push(`<div style="display:flex;gap:${gap}px;align-items:flex-start">${chunk.slice(i, i + cols).map((a) => cell(a, ++n)).join('')}</div>`);
    }
    return {
      label: pi === 0 ? '작품 목록' : `작품 목록 (${pi + 1})`,
      kind: 'index' as const,
      html: page(theme, data, `
        <div style="${eyebrowCss(theme)}">LIST OF WORKS${pi > 0 ? ' · 계속' : ''}</div>
        <div style="margin-top:12px;${proseTitleCss(theme, 30)}">작품 목록</div>
        <div style="margin-top:30px;display:flex;flex-direction:column;gap:${rowGap}px">${rows.join('')}</div>`),
    };
  });
}

// ── QR (동기 SVG) ──
// `qrcode` 의 toDataURL 은 비동기라 순수 빌더에서 못 쓴다. 모듈 행렬만 동기로 뽑아(`create`) SVG 로 그린다.
// html2canvas·인쇄 경로 둘 다 인라인 SVG 를 그린다. 실패하면 빈 문자열 — QR 없이도 장은 나온다.
function qrSvg(text: string, color: string, sizePx: number): string {
  try {
    const q = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const n = q.modules.size;
    const d = q.modules.data;
    let path = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (d[r * n + c]) path += `M${c} ${r}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${sizePx}" height="${sizePx}" shape-rendering="crispEdges" style="display:block"><path d="${path}" fill="${color}"/></svg>`;
  } catch { return ''; }
}

// ── 마지막 장 — 연락처 · 홈페이지 QR · (있으면) 프로필 사진 ──
/**
 * 예전엔 이름 하나가 빈 지면 한가운데 떠 있었다(실측 D — 20권 전부의 마지막 장이 '거의 빈 장'). 골든(ERICA·THALIA)은
 * 마지막 장을 이름·연락처·사진 두 칸으로 놓아 **닫는 장**으로 만든다. 여기서 홈페이지 QR 이 PDF 와 ArtLink 홈페이지를
 * 잇는다 — 심사자가 종이에서 화면으로 건너오는 길. 우리 이름은 여전히 적지 않는다(아래 ⚠️).
 */
function contactHtml(theme: PortfolioTheme, data: PortfolioBookData, design: PdfDesign): string {
  const name = displayName(data.user);
  const isSerif = theme.titleSerif ?? (theme.display === SERIF);
  const home = tx(data.homepageUrl);
  const rows = [
    ['E-mail', data.user.email],
    ['Phone', data.user.phone],
    ['Instagram', igLabel(data.user.instagramUrl)],
    ['Web', home.replace(/^https?:\/\//, '')],
  ].filter(([, v]) => String(v ?? '').trim()) as [string, string][];
  const photo = design.artistPhoto ? tx(data.user.avatar) : '';
  const contentW = theme.page.w - PAD(theme).x * 2;
  const landscape = theme.page.w >= theme.page.h;
  const photoW = photo ? Math.round(Math.min(contentW * 0.36, landscape ? 340 : 320)) : 0;
  const photoH = Math.min(Math.round(photoW * 4 / 3), Math.round(availH(theme) * 0.7));
  const qr = home ? qrSvg(home, theme.ink, 108) : '';

  // 사진이 없으면 글 덩어리를 지면 가운데 폭 520px 로 모은다 — 왼쪽에만 몰려 있으면 반쪽 장으로 읽힌다.
  return page(theme, data, `
    <div style="flex:1;display:flex;align-items:center;justify-content:${photo ? 'space-between' : 'center'};gap:64px">
      <div style="${photo ? 'flex:1;min-width:0' : 'width:100%;max-width:520px'}">
        <div style="${eyebrowCss(theme)}">CONTACT</div>
        <div style="margin-top:14px;font-size:${isSerif ? 46 : 42}px;line-height:1.15;font-weight:${isSerif ? 400 : 700};font-family:${theme.display};letter-spacing:${isSerif ? '0.04em' : '-0.02em'};color:${theme.ink};word-break:keep-all;overflow-wrap:anywhere">${esc(name)}</div>
        <div style="margin-top:36px;display:flex;flex-direction:column;gap:12px">
          ${rows.map(([k, v]) => `
            <div style="display:flex;gap:18px;align-items:baseline">
              <span style="flex:0 0 84px;font-size:11px;letter-spacing:0.18em;color:${theme.sub}">${esc(k.toUpperCase())}</span>
              <span style="font-size:16px;color:${theme.ink};overflow-wrap:anywhere">${esc(v)}</span>
            </div>`).join('')}
        </div>
        ${qr ? `<div style="margin-top:40px;display:flex;align-items:flex-end;gap:16px">${qr}<div style="font-size:11px;line-height:16px;color:${theme.sub};max-width:220px;overflow-wrap:anywhere">작품과 소식을 홈페이지에서<br/>${esc(home.replace(/^https?:\/\//, ''))}</div></div>` : ''}
      </div>
      ${photo ? photoBlock(photo, photoW, photoH) : ''}
    </div>`);
  // ⚠️ **'MADE WITH ARTLINK · artlink.cc' 를 되살리지 말 것** (2026-09-13 삭제).
  //    이 PDF 는 작가가 갤러리·공모에 내는 **작가의 문서**다. 거기에 우리 이름을 박는 건
  //    남의 제출물을 우리 홍보물로 쓰는 것이고, 받는 쪽에는 '무료 툴로 만들었다'는 신호로 읽힌다.
  //    끄는 옵션을 두는 것도 답이 아니다 — 기본값이 켜져 있으면 대부분 그대로 나간다.
  //    홈페이지 QR·주소는 다르다 — **작가의** 홈페이지 주소이고, 작가가 자기 문서에 자기 주소를 적는 것이다.
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
  opts?: {
    forPdf?: boolean; design?: unknown;
    /** 쪽번호 시작값(기본 1). 갤러리 도록이 작가 여럿의 장을 이어 붙일 때 번호를 잇는다(2026-09-16) */
    folioStart?: number;
    /** 연락처 장을 만들지 않는다 — 도록에서는 작가마다 연락처 장이 붙으면 안 된다 */
    skipContact?: boolean;
    /** 러닝 머리말 문구(기본 'PORTFOLIO'). 도록은 'CATALOGUE' */
    runningHead?: string;
  },
): PortfolioPage[] {
  imgMode = opts?.forPdf ? 'pdf' : 'display';
  runningHeadDefault = opts?.runningHead ?? 'PORTFOLIO';
  // 디자인(색·판형·밀도·설명)을 입힌 파생 테마 — 아래 빌더 전부 이 theme + design 을 쓴다
  const design = normalizePdfDesign(opts?.design ?? null);
  captionStyle = design.captionStyle;
  // 본문(여백·러닝요소)은 표지와 무관하게 **항상 일관**(archive 기준). 판형·색·글꼴은 design 이 override. 표지는 별도 레지스트리.
  const theme = applyDesign(themeById('archive'), design);
  const pages: PortfolioPage[] = [{ label: '표지', html: coverHtml(theme, data, design), kind: 'cover' }];

  const statement = String(data.statement ?? '').trim();
  if (statement) pages.push(...statementPages(theme, data, statement, design).map((p) => ({ ...p, kind: 'prose' as const })));

  // 격자 기하는 **포트폴리오 전체**에서 한 번 뽑는다 — 페이지마다 계산하면 장마다 작품
  // 크기가 달라져 책이 흔들린다(§27). 비율을 모르면 정사각(1.0)으로 본다 = 옛 동작.
  const geom = gridGeometry(data);
  // 작품 번호 = 문서 전체 순서(시리즈 소개 띠·작품 목록이 같은 번호를 쓴다)
  const numberOf = (a: PortfolioImage) => data.images.findIndex((x) => x.id === a.id) + 1;

  for (const g of groupBySeries(data.images, data.seriesInfo)) {
    let works = g.images;
    let opened = false;
    if (g.name && g.note) {
      if (design.auto) {
        // 자동 편집이면 [소개 + 대표작]을 한 장으로 — 소개만 있는 빈 장을 만들지 않는다.
        const merged = seriesOpenerPage(theme, data, g.name, g.note, works[0], design, geom);
        if (merged) { pages.push({ ...merged, kind: 'prose', works: 1, workIds: works[0] ? [works[0].id] : [] }); works = works.slice(1); opened = true; }
        else pages.push(...prosePages(theme, data, 'SERIES', g.name, g.note, `${g.name} 소개`).map((p) => ({ ...p, kind: 'prose' as const })));
      } else {
        // 수동 편집이면 [소개 + 썸네일 띠] — 고른 배치는 그대로 두고, 여는 장이 그 시리즈의 차례가 된다.
        const idx = seriesIndexPage(theme, data, g.name, g.note, works, geom, numberOf);
        if (idx) pages.push({ ...idx, kind: 'prose' });
        else pages.push(...prosePages(theme, data, 'SERIES', g.name, g.note, `${g.name} 소개`).map((p) => ({ ...p, kind: 'prose' as const })));
      }
    }
    for (const plan of planWorkPages(works, design, data.images.length, { theme, geom, opened })) {
      pages.push(...worksPages(theme, data, plan.items, g.name || '작품', g.name || undefined, plan.composition, design, geom));
    }
  }

  // 작품 목록 — 작품 장들이 확정된 뒤라 쪽번호를 알 수 있다(표지가 1쪽).
  const start = opts?.folioStart ?? 1;
  if (design.worksIndex) {
    const pageOf = new Map<number, number>();
    pages.forEach((pg, i) => (pg.workIds ?? []).forEach((id) => { if (!pageOf.has(id)) pageOf.set(id, i + start); }));
    pages.push(...worksIndexPages(theme, data, pageOf, geom));
  }

  const c = normalizeCareer(data.career);
  const hasCv = String(data.biography ?? '').trim() || CV_ORDER.some(({ key }) => (c[key] ?? []).length > 0);
  if (hasCv) pages.push(...cvPages(theme, data).map((p) => ({ ...p, kind: 'cv' as const })));

  if (!opts?.skipContact) pages.push({ label: '연락처', html: contactHtml(theme, data, design), kind: 'contact' });
  // 쪽번호를 여기서 채운다 — 장을 만드는 곳이 여럿이라 각자 세게 하면 반드시 어긋난다.
  return pages.map((pg, i) => ({ ...pg, html: pg.html.split(FOLIO).join(String(i + start)) }));
}

/** PDF에 실릴 모든 이미지 주소 (prefetch 대상) — 작품 + 프로필 사진(작가노트·마지막 장) */
export function bookImageUrls(data: PortfolioBookData): string[] {
  const urls = data.images.map((i) => i.url).filter(Boolean);
  const avatar = String(data.user.avatar ?? '').trim();
  return avatar ? [...urls, avatar] : urls;
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
