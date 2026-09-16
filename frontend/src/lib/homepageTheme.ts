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

export const DEFAULT_THEME_KEYS: HomepageThemeKeys = { bg: 'white', ink: 'black', accent: 'red', font: 'gothic', heroImageId: null };

/** designConfig(무엇이든) → 검증된 키. 모르는 값은 기본으로 떨어진다 */
export function themeKeysFrom(designConfig: unknown): HomepageThemeKeys {
  const o = (designConfig && typeof designConfig === 'object' ? designConfig : {}) as Record<string, unknown>;
  const hero = typeof o.heroImageId === 'number' && Number.isInteger(o.heroImageId) && o.heroImageId > 0 ? o.heroImageId : null;
  return {
    bg: isBgKey(o.bg) ? o.bg : DEFAULT_THEME_KEYS.bg,
    ink: isTextKey(o.ink) ? o.ink : DEFAULT_THEME_KEYS.ink,
    accent: isAccentKey(o.accent) ? o.accent : DEFAULT_THEME_KEYS.accent,
    font: isFontKey(o.font) ? o.font : DEFAULT_THEME_KEYS.font,
    heroImageId: hero,
  };
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
