/**
 * 작가 홈페이지 테마 — PDF 디자인 설정(`Portfolio.designConfig`)의 색·글꼴을 **웹에도** 적용한다 (2026-09-16).
 *
 * 한 디자인, 두 출력: 작가가 [포트폴리오] 탭이나 [홈페이지] 편집에서 고른 배경·글자·강조·글꼴이
 * PDF 표지와 웹 홈페이지에 똑같이 나온다(사용자 결정: 배경색까지 허용).
 *
 * - 키 검증·팔레트 도출은 PDF 와 같은 함수(`lib/portfolioColors`)를 쓴다 — sub(보조 글자)·line(구분선)은
 *   대비를 만족하는 값으로 자동 도출되므로 어두운 배경에서도 읽힌다.
 * - 아무것도 안 골랐으면 **사이트 기본 톤**(흰 배경·검정 글자·`--color-accent`·Pretendard). 그래야 테마를
 *   모르는 작가의 페이지가 사이트의 나머지와 같은 얼굴이다.
 *   ⚠️ PDF 의 기본 글꼴은 명조(`normalizePdfDesign`)지만 웹 기본은 고딕이다 — 고르기 전까지는 각자 제 기본.
 *   고르는 순간부터 둘이 같다.
 *
 * ⚠️⚠️ **웹 테마는 작가가 [홈페이지] 편집에서 직접 고른 뒤부터만 적용한다**(`webTheme: true`, 2026-09-17 사용자 결정).
 *   이 기능이 나오기 전에 PDF 제작 화면을 한 번이라도 만진 작가는 그때 값이 designConfig 에 자동 저장돼 있다
 *   (글꼴은 고르지 않아도 기본 '명조'가 함께 저장됐다). 그걸 그대로 웹에 입히면 **본인이 고른 적 없는데**
 *   공개 홈페이지가 명조·어두운 배경으로 바뀐다. 표식이 없으면 색·글꼴은 사이트 기본 톤이다.
 *   대표작(`heroImageId`)은 웹 전용 키라 표식과 무관하게 읽는다.
 */
import type { CSSProperties } from 'react';
import { contrast, isAccentKey, isBgKey, isTextKey, resolvePalette } from './portfolioColors';
import { FONT_BY_KEY, isFontKey, type FontKey } from './portfolioFonts';

export interface HomepageThemeKeys { bg: string; ink: string; accent: string; font: FontKey; heroImageId: number | null }

export interface HomepageTheme {
  bg: string; ink: string; sub: string; line: string; accent: string;
  titleFont: string; bodyFont: string; serif: boolean;
  /** 배경이 어두운가 — 사진 뒤 판·배지처럼 밝기에 기대는 부품이 본다 */
  dark: boolean;
  /** 아무것도 안 골라 사이트 기본 톤 그대로인가 */
  isDefault: boolean;
  keys: HomepageThemeKeys;
}

/** designConfig 안의 표식 — 작가가 웹 테마를 직접 골라 저장한 적이 있다 */
export const WEB_THEME_FLAG = 'webTheme';
/** PDF 제작 화면은 모르는 키. 그쪽이 designConfig 를 통째로 갈아끼울 때 **들고 가야** 한다(`keepWebOnlyKeys`) */
const WEB_ONLY_KEYS = ['heroImageId', WEB_THEME_FLAG] as const;
const STYLE_KEYS = ['bg', 'ink', 'accent', 'font'] as const;

export const DEFAULT_THEME_KEYS: HomepageThemeKeys = { bg: 'white', ink: 'black', accent: 'red', font: 'gothic', heroImageId: null };

/** designConfig(무엇이든) → 검증된 키. 모르는 값은 기본으로 떨어진다 */
export function themeKeysFrom(designConfig: unknown): HomepageThemeKeys {
  const o = (designConfig && typeof designConfig === 'object' ? designConfig : {}) as Record<string, unknown>;
  const hero = typeof o.heroImageId === 'number' && Number.isInteger(o.heroImageId) && o.heroImageId > 0 ? o.heroImageId : null;
  // 표식이 없으면 저장된 색·글꼴은 **PDF 용으로 고른 것**이다 — 웹에 입히지 않는다(머리말 참고)
  const opted = o[WEB_THEME_FLAG] === true;
  return {
    bg: opted && isBgKey(o.bg) ? o.bg : DEFAULT_THEME_KEYS.bg,
    ink: opted && isTextKey(o.ink) ? o.ink : DEFAULT_THEME_KEYS.ink,
    accent: opted && isAccentKey(o.accent) ? o.accent : DEFAULT_THEME_KEYS.accent,
    font: opted && isFontKey(o.font) ? o.font : DEFAULT_THEME_KEYS.font,
    heroImageId: hero,
  };
}

/**
 * 편집에서 **실제로 바뀐** 스타일 키만 — 저장할 때 이것만 designConfig 에 얹는다.
 *
 * ⚠️ 키 전체를 써 넣지 말 것. 안 건드린 키까지 웹 기본값(흰 배경·고딕·빨강)으로 저장하면 그 값이 PDF 로 건너가
 * PDF 의 제 기본(명조·무채)을 조용히 덮고, `bg`·`font` 가 생기면서 '저장된 선택이 있다'로 읽혀 **자동 편집까지 꺼진다**.
 * "고르기 전까지는 각자 제 기본"이라는 규칙은 고른 키만 저장해야 성립한다.
 */
export function changedThemeKeys(saved: HomepageThemeKeys, next: HomepageThemeKeys): Partial<HomepageThemeKeys> {
  const out: Partial<HomepageThemeKeys> = {};
  (Object.keys(next) as (keyof HomepageThemeKeys)[]).forEach((k) => {
    if (next[k] !== saved[k]) Object.assign(out, { [k]: next[k] });
  });
  return out;
}

/**
 * [홈페이지] 편집을 저장할 때 designConfig 에 얹을 조각. 얹을 게 없으면 null — 그땐 designConfig 를 아예 보내지 않는다.
 *
 * - 스타일을 안 건드렸으면 null(또는 대표작만).
 * - **처음 고르는 순간**에는 화면에서 본 네 값(배경·글자·강조·글꼴)을 **전부** 쓰고 표식을 켠다. 바꾼 키만 쓰면
 *   나머지 자리에 남아 있던 PDF 용 값(예: 크림색 글자)이 표식이 켜지면서 함께 읽혀, 미리보기와 다른 — 심하면 읽을 수 없는 —
 *   조합이 공개된다. 미리보기에서 본 것이 저장되는 것이어야 한다.
 * - 이미 고른 적이 있으면 바뀐 키만.
 */
export function themeSavePatch(prevDesignConfig: unknown, next: HomepageThemeKeys): Record<string, unknown> | null {
  const changed = changedThemeKeys(themeKeysFrom(prevDesignConfig), next);
  if (Object.keys(changed).length === 0) return null;
  if (!STYLE_KEYS.some((k) => k in changed)) return changed;   // 대표작만 바꿨다 — 표식은 그대로
  const prev = (prevDesignConfig && typeof prevDesignConfig === 'object' ? prevDesignConfig : {}) as Record<string, unknown>;
  if (prev[WEB_THEME_FLAG] === true) return changed;
  return { ...changed, bg: next.bg, ink: next.ink, accent: next.accent, font: next.font, [WEB_THEME_FLAG]: true };
}

/**
 * PDF 제작 화면이 디자인을 저장할 때 — 그쪽 객체(`PdfDesign`)에는 웹 전용 키가 없고 서버는 designConfig 를 **통째로** 갈아끼운다.
 * 그대로 보내면 홈페이지에서 고른 대표작과 웹 테마 표식이 조용히 사라진다. 저장돼 있던 것에서 옮겨 싣는다.
 */
export function keepWebOnlyKeys<T extends object>(nextDesign: T, savedDesignConfig: unknown): T {
  const saved = (savedDesignConfig && typeof savedDesignConfig === 'object' ? savedDesignConfig : {}) as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  WEB_ONLY_KEYS.forEach((k) => { if (saved[k] !== undefined && saved[k] !== null) kept[k] = saved[k]; });
  return { ...nextDesign, ...kept };
}

export function resolveHomepageTheme(designConfig: unknown): HomepageTheme {
  const keys = themeKeysFrom(designConfig);
  const pal = resolvePalette(keys.bg, keys.ink, keys.accent);
  const font = FONT_BY_KEY[keys.font]!;
  const isDefault = keys.bg === DEFAULT_THEME_KEYS.bg && keys.ink === DEFAULT_THEME_KEYS.ink
    && keys.accent === DEFAULT_THEME_KEYS.accent && keys.font === DEFAULT_THEME_KEYS.font;
  return {
    ...pal,
    // 흰색과의 대비가 크면 어두운 배경(그래파이트·잉크·네이비)
    dark: contrast(pal.bg, '#FFFFFF') > 4,
    titleFont: font.title,
    bodyFont: font.body,
    serif: font.serif,
    isDefault,
    keys,
  };
}

/** 페이지 루트에 얹는 CSS 변수 — 안쪽 부품은 `var(--hp-…)` 만 본다 */
export function themeCssVars(t: HomepageTheme): CSSProperties {
  return {
    '--hp-bg': t.bg, '--hp-ink': t.ink, '--hp-sub': t.sub, '--hp-line': t.line, '--hp-accent': t.accent,
    '--hp-title-font': t.titleFont, '--hp-body-font': t.bodyFont,
    backgroundColor: t.bg, color: t.ink, fontFamily: t.bodyFont,
  } as CSSProperties;
}

/** 대표작 — 작가가 지정한 것이 있고 아직 있는 작품이면 그것, 아니면 첫 작품 */
export function pickHeroImage<T extends { id: number }>(images: T[], keys: Pick<HomepageThemeKeys, 'heroImageId'>): T | null {
  if (images.length === 0) return null;
  return (keys.heroImageId && images.find((i) => i.id === keys.heroImageId)) || images[0] || null;
}
