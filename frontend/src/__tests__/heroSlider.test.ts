/**
 * 홈 배너 — 사진이 잘리지 않는 구조를 소스로 고정한다 (2026-10-01)
 *
 * 사파리(WebKit)는 `aspect-ratio` + `max-height` 가 걸린 상자 안의 `height:100%` 를 **깎이기 전 높이**로 계산한다.
 * 트랙 하나에 둘을 걸고 사진을 `h-full` 로 잡았더니, 상한에 걸리는 화면에서 사진 칸이 트랙보다 커져 아래가 잘렸다
 * (실측: PC 사파리 1280×720 에서 3:1 배너의 77.6% · 16:9 배너 46% · 4:5 모바일 이미지 + 아이폰 13 에서 95.3%. 크롬은 100%).
 *
 * jsdom 은 레이아웃을 못 재고 E2E 는 크롬만 돈다 — 실측은 `scratchpad/hero/matrix.js`(크롬+WebKit 128조합)로 한다.
 * 여기서는 그 구조가 조용히 되돌아가지 않게만 지킨다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const code = readFileSync(join(__dirname, '..', 'components/home/HeroSlider.tsx'), 'utf-8');
/** 주석을 뺀 JSX — 주석에 적힌 옛 클래스 이름에 속지 않게 */
const jsx = code.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('HeroSlider — 크기를 정하는 상자와 트랙을 가른다', () => {
  it('비율·상한은 바깥 상자(data-hero-frame)에만 건다', () => {
    const frame = jsx.match(/<div\s+data-hero-frame[\s\S]*?>/)?.[0] ?? '';
    expect(frame).toContain('aspectRatio');
    expect(frame).toMatch(/max-h-\[/);
    expect(frame).toContain('relative');
  });

  it('트랙은 absolute inset-0 으로 바깥 상자에 붙고, 스스로 비율·상한을 갖지 않는다', () => {
    const track = jsx.match(/<div\s+ref=\{containerRef\}[\s\S]*?>/)?.[0] ?? '';
    expect(track).toContain('absolute inset-0');
    expect(track).not.toContain('aspectRatio');
    expect(track).not.toMatch(/max-h-/);
  });

  it('사진은 absolute inset-0 + object-contain — 자르지 않는다', () => {
    const img = jsx.match(/<img[\s\S]*?\/>/)?.[0] ?? '';
    expect(img).toContain('absolute inset-0');
    expect(img).toContain('object-contain');
    expect(jsx).not.toContain('object-cover');
  });

  it('적을 게 없는 캡션 줄은 그리지 않는다(제목이 공백뿐인 한 장짜리 배너 아래 빈 띠)', () => {
    expect(jsx).toMatch(/compact && currentSlide && captionHasContent/);
    expect(jsx).toMatch(/title\?\.trim\(\)/);
  });
});
