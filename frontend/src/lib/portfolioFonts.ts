/**
 * 글꼴 프리셋 — PDF 포트폴리오와 **웹 작가 홈페이지가 같이 쓴다** (2026-09-16 에 portfolioFormats.ts 에서 분리).
 *
 * 한 디자인, 두 출력: 작가가 고른 글꼴·색(`designConfig`)이 PDF 표지와 웹 홈페이지 마스트헤드에 똑같이 적용된다.
 * 웹 페이지가 2,000줄짜리 PDF 엔진을 통째로 import 하지 않도록 글꼴만 여기로 뺐다.
 */
export const SANS = `'Pretendard Variable',Pretendard,system-ui,sans-serif`;
// 명조는 index.html에서 Nanum Myeongjo를 함께 받는다. 못 받은 환경에서도 무너지지 않게 시스템 명조로 폴백.
export const SERIF = `'Nanum Myeongjo','Apple SD Gothic Neo',Georgia,'Times New Roman',serif`;

// ── 글꼴 프리셋 (제목 + 본문 페어링) ──
// 추가 한글 웹폰트(노토명조·고운바탕·플렉스·나눔고딕)는 필요한 화면이 열릴 때 지연 로드한다(`ensurePortfolioFonts`).
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
export const FONT_BY_KEY: Record<string, FontPreset> = Object.fromEntries(FONT_PRESETS.map((p) => [p.key, p]));
export const isFontKey = (k: unknown): k is FontKey => typeof k === 'string' && k in FONT_BY_KEY;

/** 화면에서 지연 로드할 구글 폰트 (Pretendard·Nanum Myeongjo 는 index.html 에 이미 있음) */
export const PORTFOLIO_FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;600;700&family=Gowun+Batang:wght@400;700&family=IBM+Plex+Sans+KR:wght@400;600;700&family=Nanum+Gothic:wght@400;700;800&display=swap';

/** 웹폰트가 필요한 프리셋인가 — 기본(명조·고딕)은 이미 있어서 안 받아도 된다 */
export const needsWebFont = (key: FontKey): boolean => key !== 'myeongjo' && key !== 'gothic';

/** `<link>` 를 한 번만 붙인다. 두 번 불러도 한 번만 받는다. */
export function ensurePortfolioFonts(): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`link[href="${PORTFOLIO_FONT_HREF}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = PORTFOLIO_FONT_HREF;
  document.head.appendChild(l);
}
