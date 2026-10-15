/**
 * 작품 가격 (2026-10-15, 작가 요청 · 사용자 결정: 숫자(원) · 홈페이지와 PDF 를 따로 켠다 · 둘 다 기본 꺼짐)
 * 화면 규칙 lib/artwork.ts(parsePriceInput·formatPrice·priceLabel) ↔ 서버 backend/src/lib/artworkPrice.ts · PDF 엔진의 캡션.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PRICE_MAX, artworkGridSignature, formatPrice, parsePriceInput, priceLabel, priceVisible } from '@/lib/artwork';
import { buildPortfolioPages, normalizePdfDesign, themeById, type PortfolioBookData } from '@/lib/portfolioFormats';
import { TAB_KEYS } from '@/lib/portfolioMaker';
import type { PortfolioImage } from '@/types';

const root = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf-8');

describe('가격 규칙 — 서버와 같다', () => {
  it('상한이 서버(lib/artworkPrice.ts)와 같다 — 다르면 화면이 통과시킨 값을 서버가 막는다', () => {
    const m = read('backend/src/lib/artworkPrice.ts').match(/export const PRICE_MAX = ([\d_]+);/);
    expect(m).not.toBeNull();
    expect(Number(m![1]!.replace(/_/g, ''))).toBe(PRICE_MAX);
  });

  it('입력칸 → 숫자(원). 쉼표·공백·원은 떼고, 비우면 지우기, 숫자가 아니거나 범위를 벗어나면 invalid', () => {
    expect(parsePriceInput('1,200,000')).toBe(1_200_000);
    expect(parsePriceInput(' 30 000원 ')).toBe(30_000);
    expect(parsePriceInput('')).toBeNull();
    expect(parsePriceInput('  ')).toBeNull();
    expect(parsePriceInput('0')).toBe('invalid');
    expect(parsePriceInput('12만')).toBe('invalid');
    expect(parsePriceInput('1.5')).toBe('invalid');
    expect(parsePriceInput(String(PRICE_MAX))).toBe(PRICE_MAX);
    expect(parsePriceInput(String(PRICE_MAX + 1))).toBe('invalid');
  });

  it('표기 — 국내식 1,200,000원 / 해외식 KRW 1,200,000 · 판매완료·비매·가격 없음은 null', () => {
    expect(formatPrice(1_200_000)).toBe('1,200,000원');
    expect(formatPrice(1_200_000, 'intl')).toBe('KRW 1,200,000');
    expect(priceLabel({ price: 500_000, status: 'AVAILABLE' })).toBe('500,000원');
    expect(priceLabel({ price: 500_000, status: null })).toBe('500,000원');
    expect(priceLabel({ price: 500_000, status: 'SOLD' })).toBeNull();
    expect(priceLabel({ price: 500_000, status: 'NFS' })).toBeNull();
    expect(priceLabel({ price: null, status: 'AVAILABLE' })).toBeNull();
    expect(priceVisible({ status: 'SOLD' })).toBe(false);
  });

  it('홈페이지 작품 격자는 가격이 바뀌면 다시 그린다(내용 지문에 가격이 들어 있다)', () => {
    const a = [{ id: 1, url: '/a.jpg', order: 0, price: 1000 }] as PortfolioImage[];
    const b = [{ id: 1, url: '/a.jpg', order: 0, price: 2000 }] as PortfolioImage[];
    expect(artworkGridSignature(a)).not.toBe(artworkGridSignature(b));
  });
});

const img = (p: Partial<PortfolioImage>): PortfolioImage => ({ id: p.id ?? 1, url: `https://x/${p.id ?? 1}.jpg`, order: 0, ...p }) as PortfolioImage;
const book = (images: PortfolioImage[]): PortfolioBookData => ({
  user: { name: '김작가' }, tagline: null, statement: null, biography: null, career: null, seriesInfo: [], images,
});
const worksHtml = (images: PortfolioImage[], design: Record<string, unknown>) =>
  buildPortfolioPages(book(images), themeById('archive'), { design: { auto: false, worksIndex: false, ...design } })
    .filter((p) => p.kind === 'works').map((p) => p.html).join('\n');

describe('PDF 캡션 — [작품] 탭 "작품 가격 싣기"', () => {
  const works = [
    img({ id: 1, title: '달빛', year: '2025', medium: 'Oil on canvas', sizeText: '72.7×60.6 cm', status: 'AVAILABLE', price: 1_200_000 }),
    img({ id: 2, title: '팔린 그림', year: '2024', medium: 'Oil on canvas', sizeText: '30×30 cm', status: 'SOLD', price: 3_300_000 }),
    img({ id: 3, title: '비매 그림', year: '2024', status: 'NFS', price: 4_400_000 }),
  ];

  it('기본(꺼짐)이면 어떤 배치에서도 가격이 없다', () => {
    expect(normalizePdfDesign(null).showPrice).toBe(false);
    for (const worksLayout of ['hero', 'label', 'full', 'feature', 'duo', 'grid', 'index']) {
      const html = worksHtml(works, { worksLayout });
      expect(html).not.toContain('1,200,000');
      expect(html).not.toContain('KRW');
    }
  });

  it('★ 켜면 판매 가능한 작품의 캡션 마지막 줄에 — 판매완료·비매는 빠진다(배치 일곱 가지 전부)', () => {
    for (const worksLayout of ['hero', 'label', 'full', 'feature', 'duo', 'grid', 'index']) {
      const html = worksHtml(works, { worksLayout, showPrice: true });
      expect(html, worksLayout).toContain('1,200,000원');
      expect(html, worksLayout).not.toContain('3,300,000');
      expect(html, worksLayout).not.toContain('4,400,000');
    }
  });

  it('해외식 캡션이면 KRW 1,200,000 · 제목만(minimal) 이어도 가격은 실린다 · 여러 점(4점씩)은 한 줄로 이어 붙인다', () => {
    expect(worksHtml(works, { worksLayout: 'hero', showPrice: true, captionStyle: 'intl' })).toContain('KRW 1,200,000');
    expect(worksHtml(works, { worksLayout: 'duo', worksCaption: 'minimal', showPrice: true })).toContain('1,200,000원');
    expect(worksHtml(works, { worksLayout: 'grid', showPrice: true })).toMatch(/Oil on canvas · 72\.7×60\.6 cm · 1,200,000원/);
  });

  it('[작품] 탭에 묶여 있다 — 그 탭의 [처음 상태로] 가 가격 싣기도 끈다', () => {
    expect(TAB_KEYS.works).toContain('showPrice');
  });
});

describe('공개 응답에 가격이 새지 않게 — 화면이 쓰는 자리', () => {
  it('홈페이지 캡션·크게 보기는 priceLabel 을 거친다(판매완료·비매를 한 번 더 거른다)', () => {
    expect(read('frontend/src/components/shared/HomepageView.tsx')).toMatch(/const price = priceLabel\(img\)/);
    expect(read('frontend/src/pages/PortfolioPage.tsx')).toMatch(/priceLabel\(i\)/);
  });
  it('편집 화면 미리보기는 저장 전 [가격 보이기] 를 따른다 — 꺼 두면 가격을 뺀 작품으로 그린다', () => {
    const src = read('frontend/src/components/homepage-edit/HomepageEditor.tsx');
    expect(src).toMatch(/previewImages = useMemo\(\(\) => \(showPrice \? images/);
    expect(src).toMatch(/images: previewImages/);
  });
});
