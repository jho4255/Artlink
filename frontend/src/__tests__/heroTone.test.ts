/**
 * 히어로 배너 — 사진 위 글자 검정/흰색 고르기 (2026-10-05 사용자 결정, lib/heroTone.ts)
 *
 * 기준: 글자가 놓인 자리의 픽셀 → 흰 글자(가장 밝은 10% 대비)와 검은 글자(가장 어두운 10% 대비) 중 명암비가 더 큰 쪽.
 * 실제 화면 판정(요소 상자 재기 + 크롬·사파리)은 `scratchpad/hero/tone.js` + `tone_check.py` 가 본다 — jsdom 은 레이아웃이 없다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  analyzePixels, autoTones, bandColor, bandLum, containRect, contrast, cssLum, pickTone, relLum, sampleBox, HERO_AUTO_REGIONS, type HeroAnalysis,
} from '@/lib/heroTone';

/** w×h 사진 — fill(x, y) 가 [r,g,b] */
function img(w: number, h: number, fill: (x: number, y: number) => [number, number, number]): HeroAnalysis {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = fill(x, y);
    const i = (y * w + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  return analyzePixels(d, w, h);
}

describe('명암비 계산(WCAG)', () => {
  it('흰색·검정 휘도와 21:1', () => {
    expect(relLum(255, 255, 255)).toBeCloseTo(1, 5);
    expect(relLum(0, 0, 0)).toBe(0);
    expect(contrast(1, 0)).toBeCloseTo(21, 5);
  });
  it('rgb·hex 를 읽고 투명은 null', () => {
    expect(cssLum('rgb(255, 255, 255)')).toBeCloseTo(1, 5);
    expect(cssLum('#000000')).toBe(0);
    expect(cssLum('rgba(0, 0, 0, 0)')).toBeNull();
    expect(cssLum('oklch(0.97 0 0)')).toBeNull();   // 화면에서는 colorLum(캔버스)이 읽는다
  });
});

describe('pickTone — 가장 불리한 10% 끼리 비교', () => {
  it('밝은 바탕은 검은 글자, 어두운 바탕은 흰 글자', () => {
    expect(pickTone(Array(50).fill(relLum(240, 236, 228)))).toBe('black');   // 실서버 이벤트 배너의 종이색
    expect(pickTone(Array(50).fill(relLum(22, 28, 52)))).toBe('white');
  });
  it('중간 회색은 더 나은 쪽 — 띠 색(141,139,137)은 검정 6.2:1 > 흰 3.4:1', () => {
    expect(pickTone([relLum(141, 139, 137)])).toBe('black');
  });
  it('대부분 밝은데 어두운 점이 섞여도(연필 그림 등) 평균에 휘둘리지 않는다', () => {
    const lums = [...Array(85).fill(relLum(240, 238, 232)), ...Array(15).fill(relLum(30, 30, 30))];
    expect(pickTone(lums)).toBe('black');
  });
  it('잴 것이 없으면 흰색(예전 모습)', () => {
    expect(pickTone([])).toBe('white');
  });
});

describe('사진 자리(contain)와 상자 샘플링', () => {
  it('넓은 틀 + 3:1 사진 → 좌우 여백', () => {
    const r = containRect(1280, 368, 3);
    expect(r.h).toBe(368);
    expect(r.w).toBe(1104);
    expect(r.x).toBe(88);   // 비회원 1280px 실측과 같은 88px
  });
  it('높은 틀 + 3:1 사진 → 위아래 여백', () => {
    const r = containRect(768, 432, 3);
    expect(r).toEqual({ x: 0, y: 88, w: 768, h: 256 });
  });
  it('비율을 모르면 틀 전체', () => {
    expect(containRect(800, 300, null)).toEqual({ x: 0, y: 0, w: 800, h: 300 });
  });
  it('사진 위는 사진 값, 여백은 여백 값 — 걸친 상자는 면적만큼 섞인다', () => {
    const a = img(10, 10, () => [0, 0, 0]);   // 새까만 사진
    const frameImg = { x: 100, y: 0, w: 100, h: 100 };
    const inside = sampleBox({ x: 120, y: 10, w: 40, h: 20 }, frameImg, a, 1);
    expect(new Set(inside)).toEqual(new Set([0]));
    const outside = sampleBox({ x: 10, y: 10, w: 40, h: 20 }, frameImg, a, 0.9);
    expect(new Set(outside)).toEqual(new Set([0.9]));
    const half = sampleBox({ x: 80, y: 10, w: 40, h: 20 }, frameImg, a, 0.9);
    const share = half.filter((v) => v === 0).length / half.length;
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.6);
  });
});

describe('관리 화면 미리보기 — 오른쪽 위 / 왼쪽 아래', () => {
  it('밝은 사진의 오른쪽 위만 어두우면 [자세히 보기]는 흰 글자, 제목은 검은 글자', () => {
    const a = img(60, 20, (x, y) => (x >= 0.8 * 60 && y < 0.3 * 20 ? [25, 25, 30] : [238, 234, 226]));
    expect(autoTones(a)).toEqual({ btn: 'white', title: 'black' });
  });
  it('영역은 사진 안(0~1)에 있다', () => {
    for (const r of Object.values(HERO_AUTO_REGIONS)) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1);
      expect(r.y + r.h).toBeLessThanOrEqual(1);
    }
  });
  it('사진을 못 읽었으면 null', () => {
    expect(autoTones(null)).toBeNull();
  });
});

describe('띠 색 — 예전 extractColor 와 같은 0.6배', () => {
  it('사진 평균 × 0.6', () => {
    const a = img(4, 4, () => [200, 100, 50]);
    expect(bandColor(a)).toBe('rgb(120,60,30)');
    expect(bandLum(a)).toBeCloseTo(relLum(120, 60, 30), 6);
  });
  it('못 읽었으면 예전 기본색', () => {
    expect(bandColor(null)).toBe('#1a1a2e');
  });
});

describe('HeroSlider 소스 — 되돌아가지 않게', () => {
  const code = readFileSync(join(__dirname, '..', 'components/home/HeroSlider.tsx'), 'utf-8');
  const jsx = code.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('[자세히 보기]는 사진의 오른쪽 위 — 사진 자리(ir)로 top·right 를 잡는다(아래 고정 클래스 금지)', () => {
    // 여는 태그 안에 `=>` 가 있어 `>` 로 끊지 않고 버튼 글자까지 잘라 본다
    const btn = jsx.match(/<button\s+data-tone-key="btn"[\s\S]*?자세히 보기/)?.[0] ?? '';
    expect(btn).toMatch(/top: ir\.y/);
    expect(btn).toMatch(/right: irRight/);
    expect(btn).not.toMatch(/bottom-\d/);
  });

  it('사진 위 글자는 흰색을 박지 않고 TONE_CLASS 로 칠한다', () => {
    // 슬라이드 안 제목·버튼·넘김 표시·화살표 — 예전 흰색 고정 클래스가 남아 있으면 안 된다
    expect(jsx).not.toMatch(/text-white leading-snug/);
    expect(jsx).not.toMatch(/'bg-white w-6'/);
    expect(jsx).not.toMatch(/bg-white\/15 ring-1 ring-white\/40/);
    expect(jsx).toMatch(/TONE_CLASS\[toneOf\(i, 'btn'\)\]/);
    expect(jsx).toMatch(/TONE_CLASS\[sharedTone\('dots'\)\]/);
  });

  it('관리자가 고정한 색이 잰 값보다 먼저', () => {
    expect(code).toMatch(/slides\[i\]\?\.textTone \?\? tones\[/);
  });

  it('여백 색은 colorLum(캔버스)로 읽는다 — Tailwind v4 의 oklch 를 rgb 파서로 읽으면 못 읽는다', () => {
    expect(code).toMatch(/colorLum\(getComputedStyle\(slideEl\)\.backgroundColor\)/);
  });

  it('한 장뿐이면 사진 위 넘김 표시를 그리지 않는다', () => {
    expect(jsx).toMatch(/slides\.length > 1 && \(\s*<div data-tone-key="dots"/);
  });
});
