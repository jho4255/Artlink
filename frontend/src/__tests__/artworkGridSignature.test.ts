/**
 * 작품 격자 재렌더 방지 지문 — `lib/artwork.ts` 의 `artworkGridSignature`
 *
 * 홈페이지 편집 화면은 한 글자 칠 때마다 미리보기를 다시 그린다.
 * 작품 30장이면 그때마다 figure/img 30개가 재조정돼 **입력이 밀린다**.
 * 지문이 그대로면 이전 JSX 를 재사용해 그 일이 안 일어난다.
 *
 * 두 방향 모두 지켜야 한다:
 *  ① 무관한 편집(약력·작가노트) → 지문 그대로   ← 빠지면 느려진다
 *  ② 작품 정보 편집(캡션·시리즈) → 지문 변경    ← 빠지면 고쳐도 화면이 안 바뀐다
 */
import { describe, it, expect } from 'vitest';
import { artworkGridSignature } from '@/lib/artwork';
import type { PortfolioImage, SeriesInfo } from '@/types';

const img = (over: Partial<PortfolioImage> = {}): PortfolioImage => ({
  id: 1,
  url: 'https://img.artlink.cc/artlink/1756000000000-a.jpg',
  title: '무제',
  series: '푸른 방',
  medium: '캔버스에 유채',
  sizeText: '116.8×91.0cm',
  year: '2026',
  status: 'AVAILABLE',
  description: '설명',
  order: 0,
  ...over,
} as PortfolioImage);

describe('artworkGridSignature — 내용이 같으면 같은 지문', () => {
  it('★ 배열을 새로 만들어도(참조가 달라도) 내용이 같으면 지문이 같다', () => {
    const a = artworkGridSignature([img()], [{ name: '푸른 방', note: '메모' }]);
    const b = artworkGridSignature([img()], [{ name: '푸른 방', note: '메모' }]);
    expect(a).toBe(b);
  });

  it('★ 작품과 무관한 필드(설명·순서)는 지문을 바꾸지 않는다', () => {
    // 격자에 안 나오는 값까지 지문에 넣으면 최적화가 헐거워진다
    const base = artworkGridSignature([img()]);
    expect(artworkGridSignature([img({ description: '완전히 다른 설명' })])).toBe(base);
  });

  it('빈 목록도 안전하게 다룬다', () => {
    expect(artworkGridSignature([])).toBe(artworkGridSignature([], null));
    expect(artworkGridSignature([], undefined)).toBe(artworkGridSignature([], []));
  });
});

describe('artworkGridSignature — 화면에 나오는 값이 바뀌면 지문도 바뀐다', () => {
  const base = artworkGridSignature([img()], [{ name: '푸른 방', note: '메모' }]);

  it('작품명', () => {
    expect(artworkGridSignature([img({ title: '다른 제목' })], [{ name: '푸른 방', note: '메모' }])).not.toBe(base);
  });

  it('★ 재료·크기·연도(캡션) — 빠지면 작품 정보를 채워도 미리보기가 그대로다', () => {
    for (const over of [{ medium: '한지에 먹' }, { sizeText: '50×50cm' }, { year: '2020' }]) {
      expect(artworkGridSignature([img(over)], [{ name: '푸른 방', note: '메모' }])).not.toBe(base);
    }
  });

  it('시리즈명 (묶음이 달라진다)', () => {
    expect(artworkGridSignature([img({ series: '붉은 방' })], [{ name: '푸른 방', note: '메모' }])).not.toBe(base);
  });

  it('★ 시리즈 소개 글 (별도 인자라 놓치기 쉽다)', () => {
    expect(artworkGridSignature([img()], [{ name: '푸른 방', note: '고친 메모' }])).not.toBe(base);
  });

  it('판매상태 배지', () => {
    expect(artworkGridSignature([img({ status: 'SOLD' })], [{ name: '푸른 방', note: '메모' }])).not.toBe(base);
  });

  it('이미지 주소 (교체·재업로드)', () => {
    expect(artworkGridSignature([img({ url: '/uploads/other.jpg' })], [{ name: '푸른 방', note: '메모' }])).not.toBe(base);
  });

  it('작품 추가·삭제·순서 바꾸기', () => {
    const two = [img({ id: 1 }), img({ id: 2, title: '두 번째' })];
    const swapped = [two[1]!, two[0]!];
    const one = artworkGridSignature([img({ id: 1 })]);
    expect(artworkGridSignature(two)).not.toBe(one);
    expect(artworkGridSignature(swapped)).not.toBe(artworkGridSignature(two));
  });

  it('★ 구분자가 값에 섞여도 다른 작품이 같은 지문이 되지 않는다', () => {
    const a = artworkGridSignature([img({ title: 'A|B', series: '' })]);
    const b = artworkGridSignature([img({ title: 'A', series: 'B' })]);
    expect(a).not.toBe(b);
  });
});

describe('artworkGridSignature — 편집 시나리오', () => {
  const images = Array.from({ length: 30 }, (_, i) => img({ id: i + 1 }));
  const series: SeriesInfo[] = [{ name: '푸른 방', note: '2026년 연작' }];

  it('★ 작가노트를 한 글자씩 쳐도 작품 지문은 30번 내내 그대로', () => {
    // 지문에 작가노트가 섞여 있으면 여기서 30개의 서로 다른 값이 나온다
    const typed = Array.from({ length: 30 }, () => artworkGridSignature(images.map(i => ({ ...i })), [...series]));
    expect(new Set(typed).size).toBe(1);
  });

  it('30장짜리 지문 계산은 한 번에 5ms 이내 (매 타이핑마다 돌아도 부담 없어야 한다)', () => {
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) artworkGridSignature(images, series);
    expect((performance.now() - t0) / 20).toBeLessThan(5);
  });
});
