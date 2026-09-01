/**
 * 포트폴리오 색 시스템 — 배경색 · 글자색 · 강조색을 **따로** 고른다.
 * 보조색(sub)·구분선(line)은 배경+글자에서 자동으로 뽑는다(직접 안 고름).
 *
 * "배경색별 추천 글자색"은 **WCAG 대비(contrast)** 로 자동 판정한다(≥4.5:1 이면 추천).
 * 색은 레이아웃 높이에 영향이 없어 overflow 위험이 0 — 마음껏 늘려도 안전하다.
 */
export interface ColorSwatch { key: string; label: string; hex: string }

export const BACKGROUNDS: ColorSwatch[] = [
  { key: 'white', label: '화이트', hex: '#FFFFFF' },
  { key: 'ivory', label: '아이보리', hex: '#FAF7F0' },
  { key: 'sand', label: '샌드', hex: '#F1E8DA' },
  { key: 'mist', label: '미스트', hex: '#EDF1F4' },
  { key: 'blush', label: '블러시', hex: '#F6EEEC' },
  { key: 'graphite', label: '그래파이트', hex: '#2B2B31' },
  { key: 'ink', label: '잉크', hex: '#15151B' },
  { key: 'navy', label: '네이비', hex: '#161B2E' },
];

export const TEXTS: ColorSwatch[] = [
  { key: 'black', label: '블랙', hex: '#1A1A1A' },
  { key: 'charcoal', label: '차콜', hex: '#3C3C44' },
  { key: 'brown', label: '브라운', hex: '#4A3F31' },
  { key: 'navy', label: '네이비', hex: '#1E2540' },
  { key: 'white', label: '화이트', hex: '#F5F5F5' },
  { key: 'cream', label: '크림', hex: '#EFE7D7' },
  { key: 'slate', label: '슬레이트', hex: '#C6CCD6' },
];

export const ACCENTS: ColorSwatch[] = [
  { key: 'red', label: '레드', hex: '#C4302B' },
  { key: 'gold', label: '골드', hex: '#8A7350' },
  { key: 'orange', label: '오렌지', hex: '#EA6A1E' },
  { key: 'blue', label: '블루', hex: '#2563EB' },
  { key: 'green', label: '그린', hex: '#2F7D5B' },
  { key: 'plum', label: '플럼', hex: '#7A3E63' },
  { key: 'mono', label: '모노', hex: '' }, // = 글자색과 동일(무채색 강조)
];

const BG = Object.fromEntries(BACKGROUNDS.map((s) => [s.key, s.hex]));
const TX = Object.fromEntries(TEXTS.map((s) => [s.key, s.hex]));
const AC = Object.fromEntries(ACCENTS.map((s) => [s.key, s.hex]));

const rgb = (h: string): [number, number, number] => {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
};
const relLum = ([r, g, b]: [number, number, number]): number => {
  const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export function contrast(a: string, b: string): number {
  const la = relLum(rgb(a)), lb = relLum(rgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/**
 * 두 색을 섞어 **hex 로** 돌려준다.
 *
 * ⚠️ CSS `color-mix()` 를 쓰지 말 것 — 크롬이 `color(srgb …)` 로 계산해 내리는데
 * **html2canvas 1.4.1 이 `color()` 함수를 파싱하다 던진다**(`unsupported color function "color"`).
 * PDF 는 그 예외로 통째로 실패하고, PPTX 는 `hexOf()` 가 `rgba?()` 만 받아 `null` 을 돌려주므로
 * 배경 도형이 **에러 없이 조용히 빠진다**. 화면(크롬)에서는 멀쩡해 보여서 더 위험하다.
 * 회귀는 `portfolioFormats.test.ts` 가 전 페이지 HTML 에서 `color-mix` 를 금지해 잡는다.
 */
export const mixHex = (a: string, b: string, t: number): string => {
  const A = rgb(a), B = rgb(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
};
const mix = mixHex;

/**
 * 배경 쪽으로 **최대한 물리되, 읽히는 선까지만** 물린 색.
 *
 * 왜 고정 비율이면 안 되나: 예전 `sub` 는 `mix(ink, bg, 0.45)` 상수였는데, 흰 배경·검정 글자
 * (가장 좋은 조합)에서도 대비가 **3.90:1** 로 AA(4.5) 미달이었다. `sub` 로 그려지는 건 장식이
 * 아니라 **작품 캡션(재료·크기·연도)·작품 설명·CV 영문 라벨·연락처** 다 — 엔진 주석이
 * "캡션이 없으면 정보 없는 이미지 더미로 읽힌다"고 적은 바로 그 정보다.
 * 팔레트 전수 실측에서 화면이 '추천'(초록 점)으로 표시하는 29조합 중 **23개(79%)가 미달**,
 * 최저 2.76:1 이었다. `ink`·`accent` 만 검사하고 여기서 파생되는 색은 아무도 안 쟀다.
 *
 * 그래서 "얼마나 물릴까"를 상수로 정하지 않고 **대비를 만족하는 가장 물린 값**을 찾는다.
 * `maxT` 보다 더 물리지 않으므로 기존 디자인 의도(은은함)는 그대로다.
 * 글자색 자체가 대비 미달인 조합(사용자가 비추천을 고른 경우)에서는 t=0 = 글자색으로 떨어진다.
 */
function towardBg(ink: string, bg: string, maxT: number, minContrast: number): string {
  for (let t = maxT; t > 0; t -= 0.01) {
    const c = mix(ink, bg, t);
    if (contrast(c, bg) >= minContrast) return c;
  }
  return ink;
}

/** 배경색에 대해 대비가 충분한(≥4.5:1) 글자색 키 목록 = 추천 */
export function recommendedTextKeys(bgKey: string): string[] {
  const bg = BG[bgKey] ?? '#FFFFFF';
  return TEXTS.filter((t) => contrast(t.hex, bg) >= 4.5).map((t) => t.key);
}
/** 그 배경에서 가장 대비 큰 추천 글자색(밝은 배경→어두운 글자, 어두운 배경→밝은 글자) */
export function bestTextKey(bgKey: string): string {
  const bg = BG[bgKey] ?? '#FFFFFF';
  return [...TEXTS].sort((a, b) => contrast(b.hex, bg) - contrast(a.hex, bg))[0].key;
}

/**
 * 배경색에서 충분히 읽히는 강조색 키 = 추천.
 *
 * ⚠️ 기준이 예전엔 3.0(대형 글자·그래픽 대비)이었는데 **실제 쓰임과 안 맞았다**.
 * 강조색이 큰 글자에만 쓰이면 3.0 이 맞지만, 엔진은 이 색으로 **10~13px 글자**도 찍는다 —
 * 글 페이지 아이브로우(12px) · CV 머리말(12px) · 연락처 라벨(11.5px) · 작품 판매상태 배지(12px).
 * 실측: 3.0 기준으로 추천된 38조합 중 **19개(50%)가 12px 글자 기준(4.5) 미달**이었다
 * (잉크+레드 3.29 · 네이비+블루 3.30). 초록 점은 "이 조합이 읽힌다"는 약속이므로 가장
 * 가혹한 쓰임에 맞춘다. 비추천 색도 **고를 수는 있다** — 막는 게 아니라 사실대로 표시할 뿐이다.
 * 'mono'(=글자색)는 이미 대비 검증된 글자색을 물려받으므로 항상 추천.
 */
export function recommendedAccentKeys(bgKey: string): string[] {
  const bg = BG[bgKey] ?? '#FFFFFF';
  return ACCENTS.filter((a) => a.key === 'mono' || contrast(a.hex, bg) >= 4.5).map((a) => a.key);
}
/** 그 배경에서 가장 대비 큰 유채색 강조(추천 대체용) */
export function bestAccentKey(bgKey: string): string {
  const bg = BG[bgKey] ?? '#FFFFFF';
  return ACCENTS.filter((a) => a.key !== 'mono').sort((a, b) => contrast(b.hex, bg) - contrast(a.hex, bg))[0].key;
}

/** 헤어라인 최소 대비. 장식이 아니라 **구조**를 그리는 자리라 안 보이면 안 된다. */
export const LINE_MIN_CONTRAST = 1.5;

/** 배경+글자+강조 → 엔진이 쓰는 색 토큰(bg/ink/sub/accent/line). sub·line 은 자동 도출. */
export function resolvePalette(bgKey: string, inkKey: string, accentKey: string) {
  const bg = BG[bgKey] ?? '#FFFFFF';
  const ink = TX[inkKey] ?? '#1A1A1A';
  const accent = accentKey === 'mono' ? ink : (AC[accentKey] ?? '#C4302B');
  return {
    bg, ink, accent,
    // 보조 글자 — 은은하되 **읽히는 선까지만**. 상수 0.45 는 흰 배경에서도 3.90:1 이었다.
    sub: towardBg(ink, bg, 0.45, 4.5),
    // 구분선 — 얇은 헤어라인이라 인쇄 관례(흰 배경 1.2~1.3:1)를 따르되 **하한**을 둔다.
    // 어두운 배경에서 상수 0.88 은 1.03:1 = 사실상 안 보였는데, 그 선이 곧 디자인인 표지가
    // 셋 있다(얇은 테두리·명패·가운데 액자). CV 섹션 밑줄도 같은 색이다.
    line: towardBg(ink, bg, 0.88, LINE_MIN_CONTRAST),
  };
}

export const isBgKey = (k: unknown): k is string => typeof k === 'string' && k in BG;
export const isTextKey = (k: unknown): k is string => typeof k === 'string' && k in TX;
export const isAccentKey = (k: unknown): k is string => typeof k === 'string' && (k === 'mono' || k in AC);
