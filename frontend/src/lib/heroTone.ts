/**
 * 히어로 배너 — 사진 위 글자를 검정/흰색 중 무엇으로 쓸지 (2026-10-05 사용자 결정)
 *
 * ## 기준
 * 글자가 **실제로 놓인 자리**의 픽셀을 재서, 흰 글자와 검은 글자 중 명암비(WCAG)가 더 나은 쪽을 고른다.
 * 평균 한 값이 아니라 **가장 불리한 10%** 로 비교한다 — 흰 글자는 그 자리에서 가장 밝은 10%(p90)가, 검은 글자는
 * 가장 어두운 10%(p10)가 읽기를 망친다. 반은 희고 반은 검은 자리에서 평균(회색)으로 고르면 둘 다 반쯤 안 읽힌다.
 * 관리자가 슬라이드마다 '검정/흰색'으로 고정할 수 있다(`HeroSlide.textTone`, null = 자동).
 *
 * ## 무엇을 재나
 * 화면에 걸린 원본이 아니라 업로드 때 함께 만든 **t240 썸네일**(3KB 남짓)을 받는다 — 원본을 한 번 더 받지 않는다.
 * 썸네일이 없는 옛 업로드면 원본. 받는 길은 `lib/imageFetch.ts fetchImage`(R2 직접 → 실패 시 프록시, CLAUDE.md 규칙 16).
 * blob 을 그려 읽으므로 캔버스가 오염되지 않는다. 못 읽으면 null → 화면은 예전처럼 흰 글자 + 그림자.
 *
 * 순수 함수(재기·고르기·사진 자리 계산)는 테스트가 있다(`__tests__/heroTone.test.ts`). 받기(`loadHeroAnalysis`)는 브라우저 전용.
 */
import { fetchImage } from './imageFetch';
import { thumbUrl } from '@/components/shared/Thumb';

/** 'black' = 검은 글자, 'white' = 흰 글자. DB `HeroSlide.textTone` 과 같은 값(null = 자동) */
export type TextTone = 'black' | 'white';
export const TEXT_TONE_LABELS: Record<'auto' | TextTone, string> = { auto: '자동 (배경에 맞춤)', black: '검정', white: '흰색' };

/** 사진을 작게 줄여 둔 밝기 표 — 한 칸 = 썸네일 한 픽셀 */
export interface HeroAnalysis {
  w: number;
  h: number;
  /** 상대 휘도(WCAG, 0~1), 행 우선 */
  lum: Float32Array;
  /** 사진 전체의 평균 색 — 배너 띠 색을 만든다 */
  mean: [number, number, number];
}

export interface Rect { x: number; y: number; w: number; h: number }

const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
/** WCAG 상대 휘도 */
export function relLum(r: number, g: number, b: number): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
/** WCAG 명암비 */
export function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** 정렬된 배열의 백분위(0~100, 가장 가까운 값) */
function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i]!;
}

/**
 * 그 자리 픽셀들의 휘도로 글자 색을 고른다 — 가장 불리한 10% 끼리 비교.
 * 흰 글자: 대비(1, p90) · 검은 글자: 대비(0, p10). 같으면 흰색(예전 모습).
 */
export function pickTone(lums: number[]): TextTone {
  if (!lums.length) return 'white';
  const s = [...lums].sort((a, b) => a - b);
  const forWhite = contrast(1, percentile(s, 90));
  const forBlack = contrast(0, percentile(s, 10));
  return forBlack > forWhite ? 'black' : 'white';
}

/** RGBA 픽셀 → 밝기 표 */
export function analyzePixels(data: Uint8ClampedArray, w: number, h: number): HeroAnalysis {
  const lum = new Float32Array(w * h);
  let r = 0, g = 0, b = 0;
  for (let i = 0, p = 0; p < w * h; i += 4, p++) {
    lum[p] = relLum(data[i]!, data[i + 1]!, data[i + 2]!);
    r += data[i]!; g += data[i + 1]!; b += data[i + 2]!;
  }
  const n = Math.max(1, w * h);
  return { w, h, lum, mean: [r / n, g / n, b / n] };
}

/** object-fit: contain 으로 앉은 사진의 자리(틀 좌표) */
export function containRect(frameW: number, frameH: number, ratio: number | null | undefined): Rect {
  if (!ratio || !frameW || !frameH) return { x: 0, y: 0, w: frameW, h: frameH };
  if (ratio > frameW / frameH) {
    const h = frameW / ratio;
    return { x: 0, y: (frameH - h) / 2, w: frameW, h };
  }
  const w = frameH * ratio;
  return { x: (frameW - w) / 2, y: 0, w, h: frameH };
}

/**
 * 틀 좌표의 상자 `box` 안을 고르게 찍어 휘도를 모은다. 사진 위면 사진의 값, 사진 밖(여백)이면 `outsideLum`.
 * 사진과 여백에 걸친 상자도 면적만큼 섞여 들어간다.
 */
export function sampleBox(box: Rect, img: Rect, a: HeroAnalysis | null, outsideLum: number, steps = 12): number[] {
  const out: number[] = [];
  const nx = steps, ny = Math.max(3, Math.round(steps * Math.min(1, box.h / Math.max(1, box.w)) * 2));
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const px = box.x + ((i + 0.5) / nx) * box.w;
      const py = box.y + ((j + 0.5) / ny) * box.h;
      const u = (px - img.x) / img.w, v = (py - img.y) / img.h;
      if (!a || u < 0 || u >= 1 || v < 0 || v >= 1 || !img.w || !img.h) { out.push(outsideLum); continue; }
      const cx = Math.min(a.w - 1, Math.floor(u * a.w)), cy = Math.min(a.h - 1, Math.floor(v * a.h));
      out.push(a.lum[cy * a.w + cx]!);
    }
  }
  return out;
}

/**
 * 관리 화면 미리보기용 — 사진 좌표(0~1)로 본 대략의 자리. 실제 배너는 요소 상자를 재서 고르지만(HeroSlider),
 * 올리기 전에 "자동이면 무엇이 되는가"를 보여 줄 때는 이 자리로 어림한다(PC 1280px 기준 실측 자리).
 */
export const HERO_AUTO_REGIONS = {
  btn: { x: 0.86, y: 0.05, w: 0.115, h: 0.08 },     // 오른쪽 위 [자세히 보기]
  title: { x: 0.03, y: 0.7, w: 0.42, h: 0.18 },     // 왼쪽 아래 제목
} as const;
export function autoTones(a: HeroAnalysis | null | undefined): Record<keyof typeof HERO_AUTO_REGIONS, TextTone> | null {
  if (!a) return null;
  const unit = { x: 0, y: 0, w: 1, h: 1 };
  return {
    btn: pickTone(sampleBox(HERO_AUTO_REGIONS.btn, unit, a, 0)),
    title: pickTone(sampleBox(HERO_AUTO_REGIONS.title, unit, a, 0)),
  };
}

/** 배너 띠 색 — 사진 평균을 어둡게(예전 `extractColor` 와 같은 0.6배) */
export function bandColor(a: HeroAnalysis | null | undefined): string {
  if (!a) return '#1a1a2e';
  const [r, g, b] = a.mean.map((c) => Math.round(c * 0.6));
  return `rgb(${r},${g},${b})`;
}
export function bandLum(a: HeroAnalysis | null | undefined): number {
  if (!a) return relLum(0x1a, 0x1a, 0x2e);
  const [r, g, b] = a.mean.map((c) => Math.round(c * 0.6)) as [number, number, number];
  return relLum(r, g, b);
}

/** CSS 색 문자열(rgb/rgba/#hex) → 휘도. 못 읽으면 null */
export function cssLum(color: string): number | null {
  const m = /rgba?\(([^)]+)\)/.exec(color);
  if (m) {
    const [r, g, b, al] = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
    if (al === 0) return null;   // 투명 — 뒤의 색이 보인다
    if ([r, g, b].every((v) => Number.isFinite(v))) return relLum(r!, g!, b!);
  }
  const h = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (h) { const n = parseInt(h[1]!, 16); return relLum((n >> 16) & 255, (n >> 8) & 255, n & 255); }
  return null;
}

/**
 * 글자 색별 클래스. 흰 글자는 예전 그대로(어두운 그림자), 검은 글자는 옅은 흰 번짐 — 복잡한 자리에서 글자 테두리를 살린다.
 * ⚠️ Tailwind 가 소스를 훑어 클래스를 만들므로 **문자열을 조립하지 말고 통째로** 적을 것.
 */
export const TONE_CLASS = {
  white: {
    text: 'text-white',
    sub: 'text-white/80',
    shadow: '[text-shadow:0_1px_4px_rgba(0,0,0,0.55)]',
    link: 'text-white decoration-white/60 hover:decoration-white',
    dotOn: 'bg-white',
    dotOff: 'bg-white/40',
    arrow: 'bg-white/15 ring-white/40 text-white/90 group-hover/nav:bg-white/30',
  },
  black: {
    text: 'text-gray-950',
    sub: 'text-gray-950/75',
    shadow: '[text-shadow:0_0_6px_rgba(255,255,255,0.65)]',
    link: 'text-gray-950 decoration-gray-950/50 hover:decoration-gray-950',
    dotOn: 'bg-gray-950',
    dotOff: 'bg-gray-950/30',
    arrow: 'bg-white/40 ring-gray-950/30 text-gray-950/80 group-hover/nav:bg-white/60',
  },
} as const satisfies Record<TextTone, Record<string, string>>;

// ── 브라우저 전용 ────────────────────────────────────────────────────

/**
 * 계산된 CSS 색 → 휘도. ⚠️ Tailwind v4 는 색을 `oklch(...)` 로 내보내 `cssLum` 의 rgb 파서로는 못 읽는다
 * (실제로 사진 옆 여백 `bg-gray-100` 을 못 읽어 연회색 위에 흰 글자를 골랐다). 1px 캔버스에 칠해 sRGB 로 되읽는다.
 * 투명이면 null(뒤의 색이 보인다).
 */
export function colorLum(color: string): number | null {
  const quick = cssLum(color);
  if (quick != null || /rgba?\(/.test(color)) return quick;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, al] = ctx.getImageData(0, 0, 1, 1).data;
    return al === 0 ? null : relLum(r!, g!, b!);
  } catch {
    return null;
  }
}

const analyses = new Map<string, Promise<HeroAnalysis | null>>();

async function decode(url: string): Promise<HeroAnalysis | null> {
  const got = await fetchImage(url);
  if (!got || typeof createImageBitmap !== 'function') return null;
  const bmp = await createImageBitmap(got.blob);
  // 썸네일(240px)보다 큰 원본이 오면 줄여서 잰다 — 글자 하나가 덮는 자리를 보는 데 240px 이면 충분하다
  const k = Math.min(1, 240 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return analyzePixels(ctx.getImageData(0, 0, w, h).data, w, h);
}

/** 배너 사진 하나의 밝기 표 — 썸네일 먼저, 없으면 원본. 같은 주소는 한 번만 받는다. 실패하면 null(던지지 않는다) */
export function loadHeroAnalysis(src: string): Promise<HeroAnalysis | null> {
  const hit = analyses.get(src);
  if (hit) return hit;
  const p = (async () => {
    try {
      const small = thumbUrl(src, 'list');
      return (small !== src ? await decode(small).catch(() => null) : null) ?? await decode(src);
    } catch {
      return null;
    }
  })();
  analyses.set(src, p);
  return p;
}
